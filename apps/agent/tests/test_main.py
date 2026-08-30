import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from main import (
    RecognitionCorrectionRequest,
    allowed_origins,
    app,
    normalize_request_id,
    save_recognition_correction,
)


class ApplicationTests(unittest.TestCase):
    def test_service_endpoints_are_registered(
        self,
    ) -> None:
        route_paths = {
            getattr(route, "path", "")
            for route in app.routes
        }

        self.assertIn("/healthz", route_paths)
        self.assertIn("/memory/events", route_paths)
        self.assertIn("/memory/recent", route_paths)
        self.assertIn("/feedback/corrections", route_paths)
        self.assertIn("/list-apps", route_paths)
        self.assertIn("/run", route_paths)

    def test_allowed_origins_are_trimmed(self) -> None:
        with patch.dict(
            os.environ,
            {
                "MY_TURN_ALLOWED_ORIGINS": (
                    "http://localhost:5173, "
                    "https://example.com "
                ),
            },
        ):
            self.assertEqual(
                allowed_origins(),
                [
                    "http://localhost:5173",
                    "https://example.com",
                ],
            )

    def test_request_id_rejects_unsafe_input(
        self,
    ) -> None:
        generated = normalize_request_id(
            "unsafe request id",
        )

        self.assertNotEqual(
            generated,
            "unsafe request id",
        )
        self.assertEqual(len(generated), 32)


class RecognitionCorrectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_landmark_base64_is_rejected(self) -> None:
        request = RecognitionCorrectionRequest(
            correction_id="correction-1",
            user_id="user-1",
            session_id="session-1",
            predicted_sign="dad",
            corrected_sign="mom",
            model="250-sign",
            model_version="my-turn-popsign-v1",
            confidence=0.92,
            margin=0.31,
            duration_ms=850,
            sequence_id=7,
            landmark_values_base64="!" * 100_000,
        )

        with self.assertRaises(HTTPException) as context:
            await save_recognition_correction(request)

        self.assertEqual(context.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
