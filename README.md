# my-turn
A personalized sign and gesture-to-voice communication agent built with Gemini, Google ADK, MediaPipe, and Google Cloud.

---

## Spin-up instructions

These instructions reproduce the My Turn web application and Google ADK agent locally or on Google Cloud.

### Architecture summary

1. MediaPipe extracts hand, face, and pose landmarks in the browser.
2. TensorFlow.js classifies a normalized 64-frame sequence against 250 isolated signs.
3. The signer confirms or corrects uncertain recognition.
4. The confirmed phrase is sent to a Google ADK communication agent.
5. Gemini 3.5 Flash on Vertex AI produces structured caption and speech text.
6. Firestore stores bounded confirmed communication and correction metadata.
7. The browser presents captions and speech output.

Live camera frames remain in the browser and are not uploaded to the agent service.

### Prerequisites

Install:

- Git
- Node.js 22 or newer
- npm 10 or newer
- Python 3.12
- Google Cloud CLI
- A browser with webcam access
- A Google Cloud project with billing enabled

### 1. Clone the repository

```powershell
git clone "https://github.com/Abhinav-Kakaraparthi/my-turn.git"
Set-Location "my-turn"
```

### 2. Configure Google Cloud

Replace the project ID if deploying into another Google Cloud project.

```powershell
$PROJECT_ID = "my-turn-hackathon"
$REGION = "us-central1"

gcloud auth login

gcloud auth application-default login `
  --scopes="https://www.googleapis.com/auth/cloud-platform"

gcloud config set project $PROJECT_ID

gcloud services enable `
  aiplatform.googleapis.com `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  firestore.googleapis.com `
  artifactregistry.googleapis.com
```

The application expects a Firestore Native database named `(default)`.

Check whether it exists:

```powershell
gcloud firestore databases describe `
  --database="(default)"
```

If it does not exist, create it once:

```powershell
gcloud firestore databases create `
  --database="(default)" `
  --location="nam5" `
  --type="firestore-native"
```

### 3. Run the Google ADK agent locally

Open PowerShell in the repository root:

```powershell
Set-Location "apps\agent"

python -m venv ".venv"

& ".\.venv\Scripts\python.exe" `
  -m pip install --upgrade pip

& ".\.venv\Scripts\python.exe" `
  -m pip install -r "requirements.txt"
```

Configure the runtime environment:

```powershell
$env:GOOGLE_GENAI_USE_ENTERPRISE = "1"
$env:GOOGLE_CLOUD_PROJECT = "my-turn-hackathon"
$env:GOOGLE_CLOUD_LOCATION = "global"
$env:MY_TURN_FIRESTORE_DATABASE = "(default)"
$env:MY_TURN_GEMINI_MODEL = "gemini-3.5-flash"
$env:MY_TURN_ALLOWED_ORIGINS = "http://localhost:5173"
$env:MY_TURN_LOG_LEVEL = "INFO"
$env:PORT = "8080"
```

Run the backend tests:

```powershell
& ".\.venv\Scripts\python.exe" `
  -m unittest discover -s "tests" -v
```

Start the agent service:

```powershell
& ".\.venv\Scripts\python.exe" `
  -m uvicorn main:app --reload --port 8080
```

Verify it from another PowerShell window:

```powershell
Invoke-RestMethod "http://127.0.0.1:8080/healthz"
```

Useful local endpoints:

- Health: `http://127.0.0.1:8080/healthz`
- API documentation: `http://127.0.0.1:8080/docs`
- ADK applications: `http://127.0.0.1:8080/list-apps`
- Recent memory: `http://127.0.0.1:8080/memory/recent`

### 4. Run the web application locally

Keep the agent running and open another PowerShell window:

```powershell
Set-Location "apps\web"

npm ci

$env:VITE_MY_TURN_AGENT_URL = "http://127.0.0.1:8080"

npm run dev -- --host "127.0.0.1" --port 5173
```

Open:

```powershell
Start-Process "http://127.0.0.1:5173"
```

Allow camera access when prompted. Camera access requires HTTPS or a localhost address.

### 5. Validate the frontend

From `apps\web`:

```powershell
npm run lint
npm run build
```

### 6. Deploy the agent to Cloud Run

Run from the repository root:

```powershell
$PROJECT_ID = "my-turn-hackathon"
$REGION = "us-central1"

gcloud config set project $PROJECT_ID

gcloud run deploy "my-turn-agent" `
  --source="apps\agent" `
  --region=$REGION `
  --allow-unauthenticated `
  --set-env-vars="GOOGLE_GENAI_USE_ENTERPRISE=1,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,MY_TURN_FIRESTORE_DATABASE=(default),MY_TURN_GEMINI_MODEL=gemini-3.5-flash,MY_TURN_ALLOWED_ORIGINS=*" `
  --quiet

$AGENT_URL = gcloud run services describe "my-turn-agent" `
  --region=$REGION `
  --format="value(status.url)"

Write-Host "Agent URL: $AGENT_URL"
```

Unauthenticated access is used for the public hackathon demonstration. A production deployment should add authentication, rate limiting, and an application gateway.

### 7. Deploy the web application to Cloud Run

Configure the deployed agent URL for the Vite production build:

```powershell
"VITE_MY_TURN_AGENT_URL=$AGENT_URL" |
  Set-Content "apps\web\.env.production" -Encoding utf8
```

Deploy:

```powershell
gcloud run deploy "my-turn-web" `
  --source="apps\web" `
  --region=$REGION `
  --allow-unauthenticated `
  --quiet

$WEB_URL = gcloud run services describe "my-turn-web" `
  --region=$REGION `
  --format="value(status.url)"

Write-Host "Web URL: $WEB_URL"
```

Restrict the agent's browser CORS policy to the deployed frontend:

```powershell
gcloud run services update "my-turn-agent" `
  --region=$REGION `
  --update-env-vars="MY_TURN_ALLOWED_ORIGINS=$WEB_URL"
```

Open the deployment:

```powershell
Start-Process $WEB_URL
```

### 8. Production verification

```powershell
Invoke-RestMethod "$AGENT_URL/healthz"

gcloud run services describe "my-turn-agent" `
  --region=$REGION `
  --format="value(status.url,status.latestReadyRevisionName)"

gcloud run services describe "my-turn-web" `
  --region=$REGION `
  --format="value(status.url,status.latestReadyRevisionName)"
```

A successful deployment should provide:

- A responsive HTTPS frontend
- Browser camera and landmark tracking
- Local TensorFlow.js recognition
- Signer confirmation and correction
- Gemini-generated structured captions
- Browser speech output
- Firestore-backed confirmed communication memory

### Reproducibility and data notes

- Training is not required to run the submitted application because browser-ready model artifacts are included.
- Raw training datasets are not committed to the repository.
- Camera frames are not stored or sent to the cloud agent.
- Only signer-confirmed communication and explicitly submitted correction evidence reach cloud services.
- This prototype recognizes 250 isolated signs and does not claim unrestricted continuous ASL translation.

## Hosted application

https://my-turn-web-722601582403.us-central1.run.app
