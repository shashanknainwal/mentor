"""Test harness shared by the in-browser runner (Pyodide) and scripts/verify-labs.mjs.

Exposes two coroutines:
  run_script(code)          -> JSON: run code, capture stdout/stderr
  run_lab(code, test_code)  -> JSON: run code, then every test_* function in test_code
"""
import ast
import inspect
import io
import json
import sys
import time
import traceback

_FLAGS = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT


def _short_tb(filename_whitelist=("solution.py", "tests.py", "scratch.py")):
    etype, evalue, tb = sys.exc_info()
    frames = [f for f in traceback.extract_tb(tb) if f.filename in filename_whitelist]
    lines = []
    for f in frames[-3:]:
        lines.append(f'  File "{f.filename}", line {f.lineno}, in {f.name}')
        if f.line:
            lines.append(f"    {f.line}")
    lines.append(f"{etype.__name__}: {evalue}")
    return "\n".join(lines)


async def _exec(source, filename, ns):
    code = compile(source, filename, "exec", flags=_FLAGS)
    result = eval(code, ns)
    if inspect.isawaitable(result):
        await result


async def run_script(code):
    ns = {"__name__": "__main__"}
    out = io.StringIO()
    old = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    t0 = time.perf_counter()
    error = None
    try:
        await _exec(code, "scratch.py", ns)
    except BaseException:  # noqa: BLE001 - surface everything to the learner
        error = _short_tb(("scratch.py",))
    finally:
        sys.stdout, sys.stderr = old
    return json.dumps({
        "ok": error is None,
        "stdout": out.getvalue()[-20000:],
        "error": error,
        "ms": round((time.perf_counter() - t0) * 1000, 1),
    })


async def run_lab(code, test_code):
    ns = {"__name__": "__lab__"}
    out = io.StringIO()
    old = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    results = []
    load_error = None
    try:
        try:
            await _exec(code, "solution.py", ns)
        except BaseException:  # noqa: BLE001
            load_error = _short_tb()
        if load_error is None:
            tns = dict(ns)
            tns["__name__"] = "__tests__"
            await _exec(test_code, "tests.py", tns)
            tests = [
                (name, fn) for name, fn in tns.items()
                if name.startswith("test_") and callable(fn)
                and getattr(getattr(fn, "__code__", None), "co_filename", "") == "tests.py"
            ]
            for name, fn in tests:
                label = (fn.__doc__ or name.replace("test_", "").replace("_", " ")).strip()
                try:
                    r = fn()
                    if inspect.isawaitable(r):
                        await r
                    results.append({"name": name, "label": label, "passed": True})
                except AssertionError as e:
                    msg = str(e) or "assertion failed"
                    results.append({"name": name, "label": label, "passed": False, "error": msg})
                except BaseException:  # noqa: BLE001
                    results.append({"name": name, "label": label, "passed": False, "error": _short_tb()})
    finally:
        sys.stdout, sys.stderr = old
    passed = sum(1 for r in results if r["passed"])
    return json.dumps({
        "ok": load_error is None and bool(results) and passed == len(results),
        "load_error": load_error,
        "stdout": out.getvalue()[-20000:],
        "tests": results,
        "passed": passed,
        "total": len(results),
    })
