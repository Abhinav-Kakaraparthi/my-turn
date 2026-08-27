# My Turn agent service

Google ADK service that converts signer-confirmed phrases and recent confirmed
meeting context into structured caption and speech drafts.

Camera frames, video, and landmark sequences are never sent to this service.

## Observability

The service emits one-line JSON logs for HTTP and Gemini model boundaries.

Logged fields include request IDs, status codes, latency, model version, token
usage, finish reason, and exception type.

The service does not log confirmed phrases, meeting context, prompts, model
responses, landmarks, video, images, API keys, or authorization headers.

## Local execution

Use Google Cloud Application Default Credentials (ADC) with Agent Platform.
Do not create or store a Gemini API key for this service.

Enable `aiplatform.googleapis.com` for the configured project, then authenticate:

    gcloud auth application-default login --scopes="https://www.googleapis.com/auth/cloud-platform"

Create a private `.env` from `.env.example` and set the project ID. Never
commit `.env` or an ADC credential file.

From `apps/agent`, run the tests:

    .\.venv\Scripts\python.exe -m unittest discover -s tests -v

Start the service:

    .\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8080

Useful endpoints:

- `GET /healthz`
- `GET /list-apps`
- `POST /run`
- `GET /docs`

The initial session service is intentionally in-memory. Persistent meeting
memory will be added separately.

## Container

The production container runs as a non-root user, listens on the Cloud Run
`PORT`, and excludes local credentials, virtual environments, test files,
caches, and databases from both Docker and Cloud Build contexts.

From the repository root, build the image:

    docker build --tag my-turn-agent:local apps/agent

The deployed Cloud Run service must remain authenticated until an
application-level authentication and abuse-prevention boundary is added.
It uses a dedicated runtime service account with Vertex AI access.
