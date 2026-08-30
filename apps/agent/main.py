import base64
import binascii
import os
import re
import time
import uuid
from dataclasses import asdict
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request, status
from google.adk.cli.fast_api import get_fast_api_app
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import GoogleAuthError
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from agents.my_turn_agent.observability import log_event
from firestore_memory import (
    ConfirmedCommunication,
    FirestoreMemoryStore,
    RecognitionCorrection,
)


BASE_DIR = Path(__file__).resolve().parent
AGENTS_DIR = BASE_DIR / "agents"
REQUEST_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9._:-]{1,128}$",
)
SAFE_ID_PATTERN = r"^[A-Za-z0-9._:-]{1,128}$"
POPSIGN_LANDMARK_BYTE_COUNT = 64 * 94 * 4 * 4


class MemoryEventRequest(BaseModel):
    event_id: str = Field(pattern=SAFE_ID_PATTERN)
    user_id: str = Field(pattern=SAFE_ID_PATTERN)
    session_id: str = Field(pattern=SAFE_ID_PATTERN)
    predicted_sign: str = Field(min_length=1, max_length=80)
    confirmed_sign: str = Field(min_length=1, max_length=80)
    caption: str = Field(min_length=1, max_length=240)
    speech_text: str = Field(min_length=1, max_length=240)
    model: str = Field(min_length=1, max_length=64)
    confidence: float = Field(ge=0, le=1)
    margin: float = Field(ge=0, le=1)


class MemoryEventResponse(BaseModel):
    stored: bool
    document_path: str


class RecentCommunicationResponse(BaseModel):
    id: str
    recognized_sign: str
    caption: str
    speech_text: str
    created_at: str


class RecentMemoryResponse(BaseModel):
    items: list[RecentCommunicationResponse]


class RecognitionCorrectionRequest(BaseModel):
    correction_id: str = Field(pattern=SAFE_ID_PATTERN)
    communication_event_id: str | None = Field(
        default=None,
        pattern=SAFE_ID_PATTERN,
    )
    user_id: str = Field(pattern=SAFE_ID_PATTERN)
    session_id: str = Field(pattern=SAFE_ID_PATTERN)
    predicted_sign: str = Field(min_length=1, max_length=80)
    corrected_sign: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=64)
    model_version: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    margin: float = Field(ge=0, le=1)
    duration_ms: int = Field(ge=1, le=3000)
    sequence_id: int = Field(ge=0)
    supersedes_correction_id: str | None = Field(
        default=None,
        pattern=SAFE_ID_PATTERN,
    )
    landmark_values_base64: str = Field(
        min_length=100_000,
        max_length=150_000,
    )


class RecognitionCorrectionResponse(BaseModel):
    stored: bool
    document_path: str


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
memory_store: FirestoreMemoryStore | None = None


def get_memory_store() -> FirestoreMemoryStore:
    global memory_store

    if memory_store is None:
        memory_store = FirestoreMemoryStore()

    return memory_store


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


@app.post(
    "/memory/events",
    response_model=MemoryEventResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_memory_event(
    request: MemoryEventRequest,
) -> MemoryEventResponse:
    communication = ConfirmedCommunication(
        event_id=request.event_id,
        user_id=request.user_id,
        session_id=request.session_id,
        predicted_sign=request.predicted_sign,
        confirmed_sign=request.confirmed_sign,
        caption=request.caption,
        speech_text=request.speech_text,
        model=request.model,
        confidence=request.confidence,
        margin=request.margin,
    )

    try:
        store = get_memory_store()
        document_path = await run_in_threadpool(
            store.save_confirmed_communication,
            communication,
        )
    except (GoogleAPICallError, GoogleAuthError) as error:
        log_event(
            "firestore.memory.failed",
            error_type=type(error).__name__,
            severity="ERROR",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud memory is temporarily unavailable.",
        ) from error

    log_event(
        "firestore.memory.saved",
        corrected=(
            request.predicted_sign != request.confirmed_sign
        ),
    )
    return MemoryEventResponse(
        stored=True,
        document_path=document_path,
    )


@app.get(
    "/memory/recent",
    response_model=RecentMemoryResponse,
)
async def recent_memory(
    user_id: str = Query(
        min_length=1,
        max_length=128,
        pattern=SAFE_ID_PATTERN,
    ),
    limit: int = Query(default=6, ge=1, le=6),
) -> RecentMemoryResponse:
    try:
        store = get_memory_store()
        items = await run_in_threadpool(
            store.recent_communications,
            user_id,
            limit,
        )
    except (GoogleAPICallError, GoogleAuthError) as error:
        log_event(
            "firestore.memory.read_failed",
            error_type=type(error).__name__,
            severity="ERROR",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud memory is temporarily unavailable.",
        ) from error

    return RecentMemoryResponse(
        items=[
            RecentCommunicationResponse(
                **asdict(item),
            )
            for item in items
        ],
    )


@app.post(
    "/feedback/corrections",
    response_model=RecognitionCorrectionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_recognition_correction(
    request: RecognitionCorrectionRequest,
) -> RecognitionCorrectionResponse:
    try:
        landmark_values = base64.b64decode(
            request.landmark_values_base64,
            validate=True,
        )
    except (binascii.Error, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The landmark tensor is not valid base64.",
        ) from error

    if len(landmark_values) != POPSIGN_LANDMARK_BYTE_COUNT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "The landmark tensor does not have shape [64, 94, 4]."
            ),
        )

    correction = RecognitionCorrection(
        communication_event_id=request.communication_event_id,
        confidence=request.confidence,
        corrected_sign=request.corrected_sign,
        correction_id=request.correction_id,
        duration_ms=request.duration_ms,
        landmark_values=landmark_values,
        margin=request.margin,
        model=request.model,
        model_version=request.model_version,
        predicted_sign=request.predicted_sign,
        sequence_id=request.sequence_id,
        session_id=request.session_id,
        supersedes_correction_id=(
            request.supersedes_correction_id
        ),
        user_id=request.user_id,
    )

    try:
        store = get_memory_store()
        document_path = await run_in_threadpool(
            store.save_recognition_correction,
            correction,
        )
    except (GoogleAPICallError, GoogleAuthError) as error:
        log_event(
            "firestore.correction.failed",
            error_type=type(error).__name__,
            severity="ERROR",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Training feedback is temporarily unavailable.",
        ) from error

    log_event(
        "firestore.correction.saved",
        corrected_sign=request.corrected_sign,
        predicted_sign=request.predicted_sign,
    )
    return RecognitionCorrectionResponse(
        stored=True,
        document_path=document_path,
    )


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
    )
