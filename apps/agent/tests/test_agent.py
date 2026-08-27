import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from google.adk.models import LlmResponse
from google.genai import types
from pydantic import ValidationError

from agents.my_turn_agent.agent import (
    CommunicationDraft,
    CommunicationRequest,
    root_agent,
)
from agents.my_turn_agent.observability import (
    LOGGER,
    after_model_callback,
    before_model_callback,
    on_model_error_callback,
)


class AgentContractTests(unittest.TestCase):
    def test_request_defaults_to_no_context(self) -> None:
        request = CommunicationRequest(
            confirmed_phrase="Hello",
        )

        self.assertEqual(
            request.confirmed_phrase,
            "Hello",
        )
        self.assertEqual(request.recent_context, [])

    def test_request_rejects_an_empty_phrase(self) -> None:
        with self.assertRaises(ValidationError):
            CommunicationRequest(confirmed_phrase="")

    def test_draft_supports_safe_clarification(self) -> None:
        draft = CommunicationDraft(
            caption="Could you repeat that?",
            speech_text="Could you repeat that?",
            needs_user_confirmation=True,
            clarification_question=(
                "Did you mean that you need help?"
            ),
        )

        self.assertTrue(
            draft.needs_user_confirmation,
        )

    def test_root_agent_contract_is_registered(self) -> None:
        self.assertEqual(
            root_agent.name,
            "communication_agent",
        )
        self.assertIs(
            root_agent.input_schema,
            CommunicationRequest,
        )
        self.assertIs(
            root_agent.output_schema,
            CommunicationDraft,
        )

    def test_completion_logs_usage_without_content(
        self,
    ) -> None:
        context = SimpleNamespace(
            agent_name="communication_agent",
            invocation_id="test-invocation",
        )
        response = LlmResponse(
            model_version="test-model",
            usage_metadata=(
                types.GenerateContentResponseUsageMetadata(
                    prompt_token_count=12,
                    candidates_token_count=5,
                    total_token_count=17,
                )
            ),
        )

        with patch.object(LOGGER, "log") as logger_log:
            before_model_callback(
                callback_context=context,
                llm_request=SimpleNamespace(),
            )
            after_model_callback(
                callback_context=context,
                llm_response=response,
            )

        completed_payload = json.loads(
            logger_log.call_args_list[-1].args[1],
        )

        self.assertEqual(
            completed_payload["prompt_tokens"],
            12,
        )
        self.assertEqual(
            completed_payload["completion_tokens"],
            5,
        )
        self.assertNotIn(
            "confirmed_phrase",
            completed_payload,
        )

    def test_failure_logs_type_without_content(self) -> None:
        context = SimpleNamespace(
            agent_name="communication_agent",
            invocation_id="failed-invocation",
        )

        with patch.object(LOGGER, "log") as logger_log:
            before_model_callback(
                callback_context=context,
                llm_request=SimpleNamespace(),
            )
            on_model_error_callback(
                callback_context=context,
                llm_request=SimpleNamespace(),
                error=RuntimeError("private diagnostic"),
            )

        failed_payload = json.loads(
            logger_log.call_args_list[-1].args[1],
        )

        self.assertEqual(
            failed_payload["error_type"],
            "RuntimeError",
        )
        self.assertNotIn(
            "error_message",
            failed_payload,
        )
        self.assertNotIn(
            "confirmed_phrase",
            failed_payload,
        )

if __name__ == "__main__":
    unittest.main()