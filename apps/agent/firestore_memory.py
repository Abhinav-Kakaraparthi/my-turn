import os
from dataclasses import asdict, dataclass
from datetime import datetime

from google.cloud import firestore


USERS_COLLECTION = "my_turn_users"


@dataclass(frozen=True)
class ConfirmedCommunication:
    event_id: str
    user_id: str
    session_id: str
    predicted_sign: str
    confirmed_sign: str
    caption: str
    speech_text: str
    model: str
    confidence: float
    margin: float


@dataclass(frozen=True)
class StoredCommunication:
    id: str
    recognized_sign: str
    caption: str
    speech_text: str
    created_at: str


class FirestoreMemoryStore:
    def __init__(self) -> None:
        project_id = os.getenv(
            "GOOGLE_CLOUD_PROJECT",
            "my-turn-hackathon",
        )
        database_id = os.getenv(
            "MY_TURN_FIRESTORE_DATABASE",
            "(default)",
        )

        self.client = firestore.Client(
            project=project_id,
            database=database_id,
        )

    def save_confirmed_communication(
        self,
        communication: ConfirmedCommunication,
    ) -> str:
        user_reference = self.client.collection(
            USERS_COLLECTION,
        ).document(communication.user_id)
        session_reference = user_reference.collection(
            "sessions",
        ).document(communication.session_id)
        event_reference = user_reference.collection(
            "communication_events",
        ).document(communication.event_id)
        is_correction = (
            communication.predicted_sign
            != communication.confirmed_sign
        )
        event_document = {
            **asdict(communication),
            "event_type": (
                "recognition_corrected"
                if is_correction
                else "communication_confirmed"
            ),
            "created_at": firestore.SERVER_TIMESTAMP,
            "stores_camera_data": False,
        }
        session_document = {
            "session_id": communication.session_id,
            "last_active_at": firestore.SERVER_TIMESTAMP,
            "last_caption": communication.caption,
            "last_confirmed_sign": communication.confirmed_sign,
            "confirmed_count": firestore.Increment(1),
        }
        user_document = {
            "last_active_at": firestore.SERVER_TIMESTAMP,
            "last_session_id": communication.session_id,
            "confirmed_count": firestore.Increment(1),
            "correction_count": firestore.Increment(
                1 if is_correction else 0,
            ),
            "stores_camera_data": False,
        }
        batch = self.client.batch()

        batch.set(user_reference, user_document, merge=True)
        batch.set(session_reference, session_document, merge=True)
        batch.set(event_reference, event_document)
        batch.commit()

        return event_reference.path

    def recent_communications(
        self,
        user_id: str,
        limit: int,
    ) -> list[StoredCommunication]:
        user_reference = self.client.collection(
            USERS_COLLECTION,
        ).document(user_id)
        query = (
            user_reference.collection("communication_events")
            .order_by(
                "created_at",
                direction=firestore.Query.DESCENDING,
            )
            .limit(limit)
        )
        recent: list[StoredCommunication] = []

        for snapshot in query.stream():
            value = snapshot.to_dict() or {}
            created_at = value.get("created_at")

            recent.append(
                StoredCommunication(
                    id=snapshot.id,
                    recognized_sign=str(
                        value.get("confirmed_sign", ""),
                    ),
                    caption=str(value.get("caption", "")),
                    speech_text=str(
                        value.get("speech_text", ""),
                    ),
                    created_at=(
                        created_at.isoformat()
                        if isinstance(created_at, datetime)
                        else ""
                    ),
                ),
            )

        recent.reverse()
        return recent
