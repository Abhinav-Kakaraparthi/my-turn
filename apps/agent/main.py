import os
import re
import time
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from google.adk.cli.fast_api import get_fast_api_app

from agents.my_turn_agent.observability import log_event


BASE_DIR = Path(__file__).resolve().parent
AGENTS_DIR = BASE_DIR / "agents"
REQUEST_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9._:-]{1,128}$",
)


def allowed_origins() -> list[str]:
    configured = os.getenv(
        "MY_TURN_ALLOWED_ORIGINS",
        "http://localhost:5173",
    )

    return [
        origin.strip()
        for origin in configured.split(",")
        if origin.strip()
    ]


def normalize_request_id(
    value: str | None,
) -> str:
    if value and REQUEST_ID_PATTERN.fullmatch(value):
        return value

    return uuid.uuid4().hex


app: FastAPI = get_fast_api_app(
    agents_dir=str(AGENTS_DIR),
    session_service_uri="memory://",
    allow_origins=allowed_origins(),
    web=False,
    auto_create_session=True,
)


@app.middleware("http")
async def log_http_request(
    request: Request,
    call_next,
):
    request_id = normalize_request_id(
        request.headers.get("x-request-id"),
    )
    started_at = time.perf_counter()

    log_event(
        "http.request.started",
        method=request.method,
        path=request.url.path,
        request_id=request_id,
    )

    try:
        response = await call_next(request)
    except Exception as error:
        log_event(
            "http.request.failed",
            error_type=type(error).__name__,
            latency_ms=round(
                (time.perf_counter() - started_at) * 1000,
                2,
            ),
            method=request.method,
            path=request.url.path,
            request_id=request_id,
            severity="ERROR",
        )
        raise

    response.headers["X-Request-ID"] = request_id

    log_event(
        "http.request.completed",
        latency_ms=round(
            (time.perf_counter() - started_at) * 1000,
            2,
        ),
        method=request.method,
        path=request.url.path,
        request_id=request_id,
        status_code=response.status_code,
    )

    return response


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {
        "service": "my-turn-agent",
        "status": "ok",
    }


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
    )