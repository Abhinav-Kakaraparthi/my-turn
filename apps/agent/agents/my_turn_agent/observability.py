import json
import logging
import os
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any

from google.adk.agents.context import Context
from google.adk.models import LlmRequest, LlmResponse


LOGGER = logging.getLogger("my_turn.agent")
_MODEL_START_TIMES: dict[str, float] = {}
_MODEL_TIMES_LOCK = threading.Lock()


def configure_logging() -> None:
    if not LOGGER.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        LOGGER.addHandler(handler)

    configured_level = os.getenv(
        "MY_TURN_LOG_LEVEL",
        "INFO",
    ).upper()
    LOGGER.setLevel(
        getattr(logging, configured_level, logging.INFO),
    )
    LOGGER.propagate = False


def log_event(
    event: str,
    *,
    severity: str = "INFO",
    **fields: Any,
) -> None:
    payload = {
        "event": event,
        "severity": severity,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    level = getattr(logging, severity, logging.INFO)

    LOGGER.log(
        level,
        json.dumps(
            payload,
            default=str,
            separators=(",", ":"),
        ),
    )


def before_model_callback(
    callback_context: Context,
    llm_request: LlmRequest,
) -> None:
    del llm_request

    invocation_id = callback_context.invocation_id

    with _MODEL_TIMES_LOCK:
        _MODEL_START_TIMES[invocation_id] = time.perf_counter()

    log_event(
        "agent.model.started",
        agent_name=callback_context.agent_name,
        invocation_id=invocation_id,
    )


def after_model_callback(
    callback_context: Context,
    llm_response: LlmResponse,
) -> None:
    invocation_id = callback_context.invocation_id
    usage = llm_response.usage_metadata

    log_event(
        "agent.model.completed",
        agent_name=callback_context.agent_name,
        cached_tokens=getattr(
            usage,
            "cached_content_token_count",
            None,
        ),
        completion_tokens=getattr(
            usage,
            "candidates_token_count",
            None,
        ),
        finish_reason=llm_response.finish_reason,
        invocation_id=invocation_id,
        latency_ms=_take_model_latency(invocation_id),
        model_version=llm_response.model_version,
        prompt_tokens=getattr(
            usage,
            "prompt_token_count",
            None,
        ),
        thoughts_tokens=getattr(
            usage,
            "thoughts_token_count",
            None,
        ),
        total_tokens=getattr(
            usage,
            "total_token_count",
            None,
        ),
    )


def on_model_error_callback(
    callback_context: Context,
    llm_request: LlmRequest,
    error: Exception,
) -> None:
    del llm_request

    invocation_id = callback_context.invocation_id

    log_event(
        "agent.model.failed",
        agent_name=callback_context.agent_name,
        error_type=type(error).__name__,
        invocation_id=invocation_id,
        latency_ms=_take_model_latency(invocation_id),
        severity="ERROR",
    )


def _take_model_latency(
    invocation_id: str,
) -> float | None:
    with _MODEL_TIMES_LOCK:
        started_at = _MODEL_START_TIMES.pop(
            invocation_id,
            None,
        )

    if started_at is None:
        return None

    return round(
        (time.perf_counter() - started_at) * 1000,
        2,
    )


configure_logging()