"""Web search and browsing."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from . import ToolError, obj, s, n, tool

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MentorDesktop/0.1"


async def fetch_url_text(url: str, max_chars: int = 40000) -> str:
    if not re.match(r"^https?://", url):
        raise ToolError("URL must start with http:// or https://")
    async with httpx.AsyncClient(follow_redirects=True, timeout=25, headers={"User-Agent": UA}) as client:
        r = await client.get(url)
        r.raise_for_status()
        ctype = r.headers.get("content-type", "")
        if "html" in ctype:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(r.text, "html.parser")
            for t in soup(["script", "style", "nav", "footer", "header", "noscript", "svg"]):
                t.decompose()
            title = soup.title.string.strip() if soup.title and soup.title.string else ""
            text = re.sub(r"\n{3,}", "\n\n", soup.get_text("\n")).strip()
            text = f"# {title}\n\n{text}" if title else text
        elif "pdf" in ctype:
            from ..ingest import extract_bytes

            text = extract_bytes("page.pdf", r.content)
        else:
            text = r.text
    return text[:max_chars]


async def ddg_search(query: str, max_results: int = 8) -> list[dict[str, str]]:
    from bs4 import BeautifulSoup

    async with httpx.AsyncClient(follow_redirects=True, timeout=20, headers={"User-Agent": UA}) as client:
        r = await client.post("https://html.duckduckgo.com/html/", data={"q": query})
        r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    results = []
    for res in soup.select(".result"):
        a = res.select_one(".result__a")
        if not a:
            continue
        href = a.get("href", "")
        if "uddg=" in href:
            href = unquote(parse_qs(urlparse(href).query).get("uddg", [href])[0])
        snippet = res.select_one(".result__snippet")
        results.append({"title": a.get_text(strip=True), "url": href, "snippet": snippet.get_text(" ", strip=True) if snippet else ""})
        if len(results) >= max_results:
            break
    return results


@tool(
    "web_search",
    "Search the public web. Returns titles, URLs and snippets. Use for current events, facts you are unsure of, "
    "or anything after your training cutoff. Follow up with web_fetch to read a result.",
    obj(["query"], query=s("Search query"), max_results=n("1-10, default 6")),
    risk="low",
    category="Web",
)
async def web_search(args, ctx):
    try:
        results = await ddg_search(args["query"], int(args.get("max_results", 6)))
    except httpx.HTTPError as e:
        raise ToolError(f"Web search failed (network/proxy?): {e}")
    if not results:
        return "No results."
    return "\n\n".join(f"[{i}] {r['title']}\n{r['url']}\n{r['snippet']}" for i, r in enumerate(results, 1))


@tool(
    "web_fetch",
    "Fetch a web page or online PDF and return its readable text.",
    obj(["url"], url=s("Absolute http(s) URL"), max_chars=n("Default 20000")),
    risk="low",
    category="Web",
)
async def web_fetch(args, ctx):
    try:
        return await fetch_url_text(args["url"], int(args.get("max_chars", 20000)))
    except httpx.HTTPError as e:
        raise ToolError(f"Could not fetch {args['url']}: {e}")
