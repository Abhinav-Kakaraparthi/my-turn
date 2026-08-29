import { useEffect, useRef, useState } from 'react'
import { useCamera, type CameraStatus } from './useCamera'
import { LandmarkMonitor } from '../landmarks/LandmarkMonitor'
import { LandmarkOverlay } from '../landmarks/LandmarkOverlay'
import { PersonalizedSignCapture } from '../landmarks/PersonalizedSignCapture'
import { PopsignRecognition } from '../landmarks/PopsignRecognition'
import { PracticeCoach } from '../landmarks/PracticeCoach'
import { PracticeOverlay } from '../landmarks/PracticeOverlay'
import { useHelloPractice } from '../landmarks/useHelloPractice'
import { useLandmarkDetection } from '../landmarks/useLandmarkDetection'
import {
  usePopsignModel,
  type PopsignModelStatus,
} from '../landmarks/usePopsignModel'
import './CameraPreview.css'

const statusText: Record<CameraStatus, string> = {
  idle: 'Camera is off',
  requesting: 'Waiting for camera permission',
  active: 'Camera is on',
  denied: 'Camera permission is blocked',
  unavailable: 'Camera is unavailable',
  busy: 'Camera is busy',
  error: 'Camera could not start',
}

const popsignStatusText: Record<PopsignModelStatus, string> = {
  idle: 'Starts after camera consent',
  loading: 'Loading and warming up',
  ready: 'Ready for 250 signs',
  error: 'Model could not start',
}

export function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [recognitionOverlayElement, setRecognitionOverlayElement] =
    useState<HTMLDivElement | null>(null)
  const [recognitionMode, setRecognitionMode] = useState<
    'public' | 'personalized'
  >('public')
  const { errorMessage, startCamera, status, stopCamera, stream } = useCamera()

  const isActive = status === 'active'
  const isRequesting = status === 'requesting'
  const popsignModel = usePopsignModel(isActive)
  const {
    cancelSequenceCapture,
    captureSequence,
    frame: landmarkFrame,
    popsignSequence,
    ...landmarkMonitor
  } = useLandmarkDetection(videoRef, isActive)
  const practiceCameraReady =
    isActive && landmarkMonitor.status === 'running'
  const helloPractice = useHelloPractice(
    landmarkFrame,
    practiceCameraReady,
  )

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    video.srcObject = stream

    return () => {
      video.srcObject = null
    }
  }, [stream])

  function chooseRecognitionMode(
    nextMode: 'public' | 'personalized',
  ) {
    if (nextMode === recognitionMode) {
      return
    }

    cancelSequenceCapture()

    if (helloPractice.active) {
      helloPractice.toggle()
    }

    setRecognitionMode(nextMode)
  }

  return (
    <section
      className="camera-section"
      id="camera-workspace"
      aria-labelledby="camera-title"
    >
      <div className="camera-heading">
        <div>
          <p className="section-label">Live intelligence workspace</p>
          <h2 id="camera-title">Your communication command center.</h2>
        </div>

        <div className="camera-heading-aside">
          <span>
            <i aria-hidden="true" />
            On-device perception
          </span>
          <p>
            Begin only when you are ready. Stop the camera at any moment.
          </p>
        </div>
      </div>

      <div className="camera-panel">
        <div className="camera-frame" data-active={isActive}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="Your live camera preview"
          />

          <LandmarkOverlay frame={landmarkFrame} videoRef={videoRef} />

          <PracticeOverlay
            enabled={
              recognitionMode === 'public' && helloPractice.active
            }
            frame={landmarkFrame}
            targetFrame={helloPractice.targetFrame}
            videoRef={videoRef}
          />

          {!isActive && (
            <div className="camera-placeholder">
              <span className="camera-placeholder-mark" aria-hidden="true" />
              <p>Your preview will appear here.</p>
            </div>
          )}

          {isActive && (
            <span className="camera-live">
              <span aria-hidden="true" />
              Camera on
            </span>
          )}

          {recognitionMode === 'public' && helloPractice.active && (
            <span className="practice-live">
              Practice: hello · {helloPractice.frameIndex + 1}/64
            </span>
          )}

          <div
            className="camera-recognition-overlay"
            ref={setRecognitionOverlayElement}
          />
        </div>

        <aside className="camera-controls" aria-label="Camera controls">
          <div className="camera-controls-header">
            <div>
              <p className="camera-status-label">System status</p>
              <p
                className="camera-status"
                data-state={status}
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true" />
                {statusText[status]}
              </p>
            </div>
            <span className="camera-private-badge">Local</span>
          </div>

          {errorMessage && (
            <p className="camera-error" role="alert">
              {errorMessage}
            </p>
          )}

          <LandmarkMonitor {...landmarkMonitor} />

          <div className="model-status-block">
            <p className="camera-status-label">Recognition engine</p>
            <p className="model-status" role="status" aria-live="polite">
              {popsignStatusText[popsignModel.status]}
            </p>
          </div>

          {popsignModel.errorMessage && (
            <p className="camera-error" role="alert">
              {popsignModel.errorMessage}
            </p>
          )}

          <button
            className={isActive ? 'camera-button stop' : 'camera-button'}
            type="button"
            disabled={isRequesting}
            onClick={isActive ? stopCamera : startCamera}
          >
            {isRequesting
              ? 'Requesting access…'
              : isActive
                ? 'Turn camera off'
                : 'Turn camera on'}
          </button>

          <p className="camera-privacy">
            Your video remains in this browser. No frames leave this device at
            this stage.
          </p>
        </aside>
      </div>

      <div className="recognition-mode" aria-label="Recognition mode">
        <div>
          <p className="section-label">Recognition route</p>
          <strong>Choose one active voice pipeline.</strong>
          <span>
            This prevents one gesture from producing competing public and
            personalized captions.
          </span>
        </div>

        <div className="recognition-mode-actions">
          <button
            type="button"
            data-active={recognitionMode === 'public'}
            aria-pressed={recognitionMode === 'public'}
            onClick={() => chooseRecognitionMode('public')}
          >
            <span>Public model</span>
            <strong>250 signs</strong>
          </button>

          <button
            type="button"
            data-active={recognitionMode === 'personalized'}
            aria-pressed={recognitionMode === 'personalized'}
            onClick={() => chooseRecognitionMode('personalized')}
          >
            <span>Personalized</span>
            <strong>My examples</strong>
          </button>
        </div>
      </div>

      {recognitionMode === 'public' && (
        <PracticeCoach
          cameraReady={practiceCameraReady}
          controller={helloPractice}
        />
      )}

      <div hidden={recognitionMode !== 'public'}>
        <PopsignRecognition
          cameraActive={isActive}
          enabled={recognitionMode === 'public'}
          modelStatus={popsignModel.status}
          overlayElement={recognitionOverlayElement}
          perceptionStatus={landmarkMonitor.status}
          practiceActive={helloPractice.active}
          sequence={popsignSequence}
        />
      </div>

      {recognitionMode === 'personalized' && (
        <PersonalizedSignCapture
          cameraActive={isActive}
          cancelCapture={cancelSequenceCapture}
          captureSequence={captureSequence}
          perceptionReady={landmarkMonitor.status === 'running'}
          temporal={landmarkMonitor.temporal}
        />
      )}
    </section>
  )
}
