"""Model providers.

AI inference always runs on AWS Bedrock (Anthropic Messages API via the Bedrock
"Mantle" endpoint). A `demo` provider exists purely so the desktop app can be
developed and demoed without AWS credentials - it is clearly labelled in the UI.

Messages use the Anthropic Messages API shape throughout the engine:
    {"role": "user"|"assistant", "content": [ {type: text|image|document|tool_use|tool_result|thinking ...} ]}
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .config import settings

log = logging.getLogger("mentor.llm")

TextCallback = Callable[[str], Awaitable[None] | None]

# Models offered in Settings > Models. Bedrock IDs carry the `anthropic.` prefix.
BEDROCK_MODELS = [
    {"id": "anthropic.claude-opus-5-5", "label": "Claude Opus 5.5 (default)", "effort": True},
    {"id": "anthropic.claude-sonnet-5-5", "label": "Claude Sonnet 5.5", "effort": True},
    {"id": "anthropic.claude-haiku-4-5", "label": "Claude Haiku 4.5 (fast)", "effort": False},
]


def supports_effort(model_id: str) -> bool:
    return not any(m in model_id for m in ("haiku", "sonnet-4-5", "3-"))


@dataclass
class LLMResult:
    content: list[dict[str, Any]]
    stop_reason: str | None
    usage: dict[str, Any] = field(default_factory=dict)
    model: str = ""

    @property
    def text(self) -> str:
        return "".join(b.get("text", "") for b in self.content if b.get("type") == "text")

    @property
    def tool_uses(self) -> list[dict[str, Any]]:
        return [b for b in self.content if b.get("type") == "tool_use"]


class LLMError(Exception):
    pass


async def _emit(cb: TextCallback | None, text: str) -> None:
    if cb is None or not text:
        return
    res = cb(text)
    if asyncio.iscoroutine(res):
        await res


# ---------------------------------------------------------------------------
# Bedrock
# ---------------------------------------------------------------------------
class BedrockProvider:
    name = "bedrock"

    def __init__(self) -> None:
        self._client = None
        self._client_key: tuple | None = None

    def _creds(self) -> dict[str, Any]:
        m = settings.get("model")
        kw: dict[str, Any] = {"aws_region": m.get("aws_region") or "us-east-1"}
        if m.get("aws_access_key") and m.get("aws_secret_key"):
            kw["aws_access_key"] = m["aws_access_key"]
            kw["aws_secret_key"] = m["aws_secret_key"]
            if m.get("aws_session_token"):
                kw["aws_session_token"] = m["aws_session_token"]
        elif m.get("aws_profile"):
            kw["aws_profile"] = m["aws_profile"]
        return kw

    def client(self):
        from anthropic import AsyncAnthropicBedrockMantle

        kw = self._creds()
        key = tuple(sorted(kw.items()))
        if self._client is None or key != self._client_key:
            self._client = AsyncAnthropicBedrockMantle(**kw, max_retries=2, timeout=600)
            self._client_key = key
        return self._client

    async def complete(
        self,
        system: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        on_text: TextCallback | None = None,
        model: str | None = None,
        effort: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMResult:
        import anthropic

        model = model or settings.get("model.model_id")
        params: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens or settings.get("model.max_tokens", 16000),
            "system": system,
            "messages": messages,
        }
        if tools:
            params["tools"] = tools
        effort = effort or settings.get("model.effort")
        if effort and supports_effort(model):
            params["output_config"] = {"effort": effort}
        try:
            async with self.client().messages.stream(**params) as stream:
                async for event in stream:
                    if event.type == "content_block_delta" and getattr(event.delta, "type", "") == "text_delta":
                        await _emit(on_text, event.delta.text)
                final = await stream.get_final_message()
        except anthropic.AuthenticationError as e:
            raise LLMError(f"AWS credentials were rejected by Bedrock: {e}") from e
        except anthropic.PermissionDeniedError as e:
            raise LLMError(f"No access to model {model} in this AWS account/region: {e}") from e
        except anthropic.NotFoundError as e:
            raise LLMError(f"Model {model} not found in region {settings.get('model.aws_region')}: {e}") from e
        except anthropic.RateLimitError as e:
            raise LLMError(f"Bedrock throttled the request - try again shortly: {e}") from e
        except anthropic.APIStatusError as e:
            raise LLMError(f"Bedrock returned HTTP {e.status_code}: {e}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError(f"Could not reach AWS Bedrock - check your network/VPN: {e}") from e
        except Exception as e:  # botocore credential errors etc.
            raise LLMError(f"Bedrock call failed: {e}") from e

        content = [b.model_dump(exclude_none=True) for b in final.content]
        usage = final.usage.model_dump(exclude_none=True) if final.usage else {}
        if final.stop_reason == "refusal":
            await _emit(on_text, "\n\n_The model declined to answer this request._")
        return LLMResult(content=content, stop_reason=final.stop_reason, usage=usage, model=model)


# ---------------------------------------------------------------------------
# Demo (offline) provider
# ---------------------------------------------------------------------------
class DemoProvider:
    """Deterministic offline stand-in. Exercises streaming and the tool loop."""

    name = "demo"

    TOOL_HINTS = [
        (r"\b(time|date|today)\b", "get_datetime", lambda t: {}),
        (r"\bremember\b(.*)", "memory_save", lambda t: {"text": t.strip(" :.") or "user preference"}),
        (r"\b(calendar|schedule|meetings?)\b", "calendar_list", lambda t: {"days": 7}),
        (r"\bsearch the web\b(.*)", "web_search", lambda t: {"query": t.strip(" :.?") or "KPMG advisory"}),
        (r"\bcalculate\b(.*)", "calculator", lambda t: {"expression": t.strip(" :.?") or "2+2"}),
    ]

    async def complete(self, system, messages, tools=None, on_text=None, model=None, effort=None, max_tokens=None):
        last = messages[-1] if messages else {"content": []}
        tool_names = {t["name"] for t in tools or []}
        # After a tool result, summarise it.
        results = [b for b in last.get("content", []) if isinstance(b, dict) and b.get("type") == "tool_result"]
        if results:
            body = results[0].get("content")
            text_out = body if isinstance(body, str) else json.dumps(body)[:1500]
            reply = f"Here is what the tool returned:\n\n```\n{text_out[:1500]}\n```\n\n_(Demo mode - connect AWS Bedrock in Settings › Models for real answers.)_"
            for chunk in re.findall(r".{1,24}", reply, flags=re.S):
                await _emit(on_text, chunk)
                await asyncio.sleep(0.01)
            return LLMResult([{"type": "text", "text": reply}], "end_turn", {"input_tokens": 0, "output_tokens": 0}, "demo")

        user_text = " ".join(
            b.get("text", "") for b in last.get("content", []) if isinstance(b, dict) and b.get("type") == "text"
        )
        for pattern, tool, args in self.TOOL_HINTS:
            m = re.search(pattern, user_text, flags=re.I)
            if m and tool in tool_names:
                arg_text = m.group(m.lastindex) if m.lastindex else ""
                await _emit(on_text, f"Let me use `{tool}` for that.\n\n")
                return LLMResult(
                    [
                        {"type": "text", "text": f"Let me use `{tool}` for that.\n\n"},
                        {"type": "tool_use", "id": f"toolu_demo_{tool}", "name": tool, "input": args(arg_text)},
                    ],
                    "tool_use",
                    {},
                    "demo",
                )
        ctx_note = ""
        if "<memory>" in system:
            ctx_note += "\n- I found related memories and included them as context."
        if "<context" in system:
            ctx_note += "\n- I retrieved excerpts from your projects / knowledge base."
        if "<skill" in system:
            ctx_note += "\n- A skill/SOP is active for this turn."
        reply = (
            f"**Demo mode** - you said: _{user_text[:400]}_\n\n"
            "Mentor is running without AWS Bedrock, so this is a canned response. "
            "Open **Settings › Models**, choose *AWS Bedrock*, add your AWS profile or keys, and click **Test connection**."
            + (f"\n\nWhat happened behind the scenes:{ctx_note}" if ctx_note else "")
            + "\n\nTry: *what time is it*, *remember I prefer concise answers*, *show my calendar*, *calculate 17*23*."
        )
        for chunk in re.findall(r".{1,16}", reply, flags=re.S):
            await _emit(on_text, chunk)
            await asyncio.sleep(0.008)
        return LLMResult([{"type": "text", "text": reply}], "end_turn", {"input_tokens": 0, "output_tokens": 0}, "demo")


_bedrock = BedrockProvider()
_demo = DemoProvider()


def provider():
    return _demo if settings.get("model.provider") == "demo" else _bedrock


async def complete(*args, **kwargs) -> LLMResult:
    return await provider().complete(*args, **kwargs)


async def quick_text(prompt: str, system: str = "You are a precise assistant.", max_tokens: int = 2000) -> str:
    """One-shot helper for internal tasks (memory extraction, drafting skills, reports)."""
    res = await complete(
        system,
        [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        model=settings.get("model.fast_model_id") if provider().name == "bedrock" else None,
        effort="low",
        max_tokens=max_tokens,
    )
    return res.text


def extract_json(text: str) -> Any:
    """Pull the first JSON object/array out of a model response."""
    m = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.S)
    candidate = m.group(1) if m else text
    for opener, closer in (("[", "]"), ("{", "}")):
        start, end = candidate.find(opener), candidate.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(candidate[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


async def test_connection() -> dict[str, Any]:
    if provider().name == "demo":
        return {"ok": True, "provider": "demo", "message": "Demo mode - no AWS call made."}
    try:
        res = await _bedrock.complete(
            "Reply with the single word: pong",
            [{"role": "user", "content": [{"type": "text", "text": "ping"}]}],
            effort="low",
            max_tokens=64,
        )
        return {"ok": True, "provider": "bedrock", "model": res.model, "message": res.text.strip()[:100]}
    except LLMError as e:
        return {"ok": False, "provider": "bedrock", "message": str(e)}


# ---------------------------------------------------------------------------
# Bedrock auxiliary models (embeddings, images) via boto3 bedrock-runtime
# ---------------------------------------------------------------------------
def _boto_runtime():
    import boto3

    m = settings.get("model")
    if m.get("aws_access_key") and m.get("aws_secret_key"):
        session = boto3.Session(
            aws_access_key_id=m["aws_access_key"],
            aws_secret_access_key=m["aws_secret_key"],
            aws_session_token=m.get("aws_session_token") or None,
            region_name=m.get("aws_region"),
        )
    else:
        session = boto3.Session(profile_name=m.get("aws_profile") or None, region_name=m.get("aws_region"))
    return session.client("bedrock-runtime")


def bedrock_embed_sync(texts: list[str], dims: int = 512) -> list[list[float]]:
    client = _boto_runtime()
    model_id = settings.get("model.embedding_model_id")
    out = []
    for t in texts:
        body = json.dumps({"inputText": t[:20000], "dimensions": dims, "normalize": True})
        resp = client.invoke_model(modelId=model_id, body=body)
        out.append(json.loads(resp["body"].read())["embedding"])
    return out


def bedrock_image_sync(prompt: str, width: int = 1024, height: int = 1024) -> bytes:
    client = _boto_runtime()
    body = json.dumps(
        {
            "taskType": "TEXT_IMAGE",
            "textToImageParams": {"text": prompt[:1000]},
            "imageGenerationConfig": {"numberOfImages": 1, "width": width, "height": height},
        }
    )
    resp = client.invoke_model(modelId=settings.get("model.image_model_id"), body=body)
    return base64.b64decode(json.loads(resp["body"].read())["images"][0])
