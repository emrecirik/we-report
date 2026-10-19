"""we-report data backend — FastAPI implementation of protocol/openapi.yaml (v1).

SQLite (standard library) and PostgreSQL (psycopg). Run: python main.py
"""
import ipaddress
import json
import os
import re
import sys
import tempfile
import time
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from databases import DRIVERS
from fetch_guard import guarded_fetch
from query import ApiError, build_free_sql, build_select

MAX_BODY = 1024 * 1024


def _list(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def load_config(env=os.environ) -> dict:
    """All settings come from the environment (and an optional connections file), never from requests."""
    demo = env.get("WE_REPORT_DEMO") == "1"
    raw = env.get("WE_REPORT_CONNECTIONS")
    if not raw and os.path.exists("connections.json"):
        with open("connections.json", encoding="utf-8") as f:
            raw = f.read()
    if raw:
        connections = json.loads(raw)
        ids = set()
        for c in connections:
            for key in ("id", "name", "dialect", "url"):
                if not c.get(key):
                    raise SystemExit(f'Every connection needs "{key}".')
            if not re.fullmatch(r"[\w-]+", c["id"]) or c["id"] in ids:
                raise SystemExit(f'Connection id "{c["id"]}" must be unique and use letters, digits, _ or -.')
            if c["dialect"] not in DRIVERS:
                raise SystemExit(f'Unsupported dialect "{c["dialect"]}" (this sample: {", ".join(DRIVERS)}).')
            ids.add(c["id"])
    else:
        connections = [{"id": "sample", "name": "Sample shop (SQLite)", "dialect": "sqlite",
                        "url": os.path.join(tempfile.gettempdir(), "we-report-sample-python.db"), "seed": "sample"}]
    for c in connections:
        # Demo mode never runs free SQL, whatever the file says.
        c["allowFreeSql"] = not demo and c.get("allowFreeSql") is True
        c["maxRows"] = min(int(c.get("maxRows") or 5000), 50000)
        c["timeoutSeconds"] = max(1, int(c.get("timeoutMs") or 15000) // 1000)
    return {
        "host": env.get("WE_REPORT_HOST", "127.0.0.1"),
        "port": int(env.get("WE_REPORT_PORT") or env.get("PORT") or 5480),
        "demo": demo,
        "auth_token": env.get("WE_REPORT_AUTH_TOKEN") or None,
        "cors_origins": _list(env.get("WE_REPORT_CORS_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200")),
        # The fetch proxy would be an open proxy on a public demo.
        "web_service_fetch": not demo and env.get("WE_REPORT_FETCH") != "0",
        "fetch_allow_hosts": {h.lower() for h in _list(env.get("WE_REPORT_FETCH_ALLOW_HOSTS"))},
        "rate_limit": int(env.get("WE_REPORT_RATE_LIMIT") or (60 if demo else 600)),
        "connections": connections,
    }


config = load_config()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=config["cors_origins"], allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type", "Authorization"], max_age=600)
_databases: dict = {}
_hits: dict = defaultdict(int)


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status, headers={"X-Content-Type-Options": "nosniff"})


def _is_loopback(host: str | None) -> bool:
    try:
        return host is not None and ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@app.middleware("http")
async def access(request: Request, call_next):
    """Who may call, and how often. Without a token only local callers are accepted — unless this is
    the public demo, which serves read-only sample data to anyone. Plug your own auth in here."""
    if request.method == "OPTIONS":
        return await call_next(request)
    ip = request.client.host if request.client else ""
    minute = int(time.time() // 60)
    _hits[(ip, minute)] += 1
    if len(_hits) > 10000:
        for key in [k for k in _hits if k[1] != minute]:
            del _hits[key]
    if _hits[(ip, minute)] > config["rate_limit"]:
        return _error(429, "Too many requests; try again in a minute.")
    if config["auth_token"]:
        allowed = request.headers.get("authorization") == f"Bearer {config['auth_token']}"
    elif config["demo"]:
        allowed = True
    else:
        # Local only — and addressed as a local host, so a page whose domain was re-pointed at
        # 127.0.0.1 (DNS rebinding) cannot use the browser to read local data.
        host = re.sub(r":\d+$", "", request.headers.get("host", "")).strip("[]")
        allowed = _is_loopback(ip) and (host == "localhost" or _is_loopback(host))
    if request.method == "POST" and int(request.headers.get("content-length") or 0) > MAX_BODY:
        return _error(413, "Request body too large.")
    if not allowed:
        return _error(401, "Not authorized.")
    try:
        response = await call_next(request)
    except ApiError as e:
        return _error(e.status, e.message)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(ApiError)
async def api_error(_request: Request, e: ApiError):
    return _error(e.status, e.message)


@app.exception_handler(Exception)
async def unexpected(_request: Request, e: Exception):
    # Unexpected errors are logged here and never echoed: they could contain internals.
    print(f"Request failed: {e!r}", file=sys.stderr)
    return _error(500, "Internal error.")


@app.exception_handler(404)
async def not_found(_request: Request, _e):
    return _error(404, "Not found.")


def _connection(cid: str) -> tuple[dict, object]:
    c = next((x for x in config["connections"] if x["id"] == cid), None)
    if c is None:
        raise ApiError(404, f'No connection "{cid}".')
    if cid not in _databases:
        _databases[cid] = DRIVERS[c["dialect"]](c)
    return c, _databases[cid]


async def _json(request: Request) -> dict:
    # Read with a running count: chunked bodies have no Content-Length to check up front.
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_BODY:
            raise ApiError(413, "Request body too large.")
    try:
        body = json.loads(raw or b"{}")
    except ValueError as e:
        raise ApiError(400, "Body must be JSON.") from e
    if not isinstance(body, dict):
        raise ApiError(400, "Body must be a JSON object.")
    return body


@app.get("/v1/info")
def info():
    return {"protocol": 1, "server": "we-report-python",
            "capabilities": {"webServiceFetch": config["web_service_fetch"], "demo": config["demo"]}}


@app.get("/v1/connections")
def connections():
    # Never the url: ids, names, dialects and what is allowed.
    return [{"id": c["id"], "name": c["name"], "dialect": c["dialect"], "freeSql": c["allowFreeSql"]} for c in config["connections"]]


@app.get("/v1/connections/{cid}/schema")
async def schema(cid: str):
    _, db = _connection(cid)
    return {"tables": await run_in_threadpool(db.schema)}


@app.post("/v1/connections/{cid}/query")
async def query(cid: str, request: Request):
    c, db = _connection(cid)
    body = await _json(request)
    params = body.get("params") if isinstance(body.get("params"), dict) else {}
    if "sql" in body:
        if not c["allowFreeSql"]:
            raise ApiError(403, "Free SQL is not allowed on this connection. Use the query builder.")
        built = build_free_sql(body["sql"], db.placeholder, params, c["maxRows"], db.wrap)
    else:
        built = build_select(body.get("query"), await run_in_threadpool(db.schema), db.quote, db.placeholder, params, c["maxRows"], db.select)
    try:
        # Drivers block; a thread keeps one slow query from freezing every other request.
        rows = await run_in_threadpool(db.query, built, c["timeoutSeconds"])
    except ApiError:
        raise
    except Exception as e:
        # Driver messages can name hosts, users and databases: logged here, never sent.
        print(f'Query on "{cid}" failed: {e!r}', file=sys.stderr)
        raise ApiError(400, "The query failed. The backend log has the details.") from e
    truncated = len(rows) > built.limit
    rows = rows[: built.limit]
    columns = [{"name": k, "type": "unknown" if v is None else "boolean" if isinstance(v, bool) else
                "number" if isinstance(v, (int, float)) else "string"} for k, v in (rows[0].items() if rows else [])]
    return {"columns": columns, "rows": rows, "truncated": truncated}


@app.post("/v1/webservice/fetch")
async def fetch(request: Request):
    if not config["web_service_fetch"]:
        raise ApiError(403, "Web service fetching is disabled on this backend.")
    body = await _json(request)
    if not isinstance(body.get("url"), str):
        raise ApiError(400, "url is required.")
    content_type, data = await run_in_threadpool(guarded_fetch, body["url"], "POST" if body.get("method") == "POST" else "GET",
                                       body.get("headers") or [], body.get("body"), config["fetch_allow_hosts"])
    # Passed through as-is; the client parses JSON or CSV exactly as when it calls directly.
    return Response(content=data, media_type=content_type)


if __name__ == "__main__":
    import uvicorn

    loopback = config["host"] in ("127.0.0.1", "::1", "localhost")
    if not loopback and not config["auth_token"] and not config["demo"]:
        sys.exit(f"Refusing to listen on {config['host']} without authentication. Set WE_REPORT_AUTH_TOKEN, "
                 "plug your own auth into access() in main.py, or keep WE_REPORT_HOST=127.0.0.1.")
    names = ", ".join(f"{c['id']} ({c['dialect']})" for c in config["connections"])
    print(f"we-report backend on http://{config['host']}:{config['port']} — connections: {names}"
          + (" — DEMO MODE" if config["demo"] else ""))
    uvicorn.run(app, host=config["host"], port=config["port"], log_level="warning")
