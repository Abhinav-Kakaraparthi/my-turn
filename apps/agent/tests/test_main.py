import os
import unittest
from unittest.mock import patch

from main import (
    allowed_origins,
    app,
    normalize_request_id,
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


if __name__ == "__main__":
    unittest.main()