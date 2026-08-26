import { useEffect, useRef } from 'react'
import { useCamera, type CameraStatus } from './useCamera'
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

export function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { errorMessage, startCamera, status, stopCamera, stream } = useCamera()

  const isActive = status === 'active'
  const isRequesting = status === 'requesting'

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

  return (
    <section
      className="camera-section"
      id="camera-workspace"
      aria-labelledby="camera-title"
    >
      <div className="camera-heading">
        <p className="section-label">Signer workspace</p>
        <h2 id="camera-title">Start only when you are ready.</h2>
        <p>
          My Turn requests camera access only after you choose to begin. You can
          stop the camera at any moment.
        </p>
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
        </div>

        <aside className="camera-controls" aria-label="Camera controls">
          <p className="camera-status-label">Camera status</p>
          <p className="camera-status" role="status" aria-live="polite">
            {statusText[status]}
          </p>

          {errorMessage && (
            <p className="camera-error" role="alert">
              {errorMessage}
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
            Video remains in this browser. No frames are uploaded in this
            stage.
          </p>
        </aside>
      </div>
    </section>
  )
}
