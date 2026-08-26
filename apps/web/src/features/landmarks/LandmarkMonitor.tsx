import type { TemporalBufferSnapshot } from './TemporalLandmarkBuffer'
import type {
  LandmarkCounts,
  LandmarkStatus,
} from './landmarkWorker.types'
import './LandmarkMonitor.css'

type LandmarkMonitorProps = {
  counts: LandmarkCounts
  errorMessage: string | null
  status: LandmarkStatus
  temporal: TemporalBufferSnapshot
}

function describeStatus(status: LandmarkStatus, counts: LandmarkCounts) {
  switch (status) {
    case 'idle':
      return 'Starts with camera'
    case 'loading':
      return 'Loading local model…'
    case 'running':
      return counts.face > 0 || counts.pose > 0
        ? 'Signer detected'
        : 'Looking for signer'
    case 'error':
      return 'Perception unavailable'
  }
}

function describeTemporalState(temporal: TemporalBufferSnapshot) {
  if (temporal.ready) {
    return 'Ready'
  }

  if (temporal.bufferedFrames > 0) {
    return 'Collecting'
  }

  return 'Waiting for a hand'
}

export function LandmarkMonitor({
  counts,
  errorMessage,
  status,
  temporal,
}: LandmarkMonitorProps) {
  const durationSeconds = (temporal.durationMs / 1000).toFixed(1)

  return (
    <section
      className="landmark-monitor"
      aria-labelledby="landmark-monitor-title"
    >
      <p className="landmark-monitor-label">Local perception</p>
      <p
        className="landmark-monitor-state"
        id="landmark-monitor-title"
        aria-live="polite"
      >
        {describeStatus(status, counts)}
      </p>

      {status === 'running' && (
        <>
          <dl className="landmark-counts">
            <div>
              <dt>Face</dt>
              <dd>{counts.face}</dd>
            </div>
            <div>
              <dt>Pose</dt>
              <dd>{counts.pose}</dd>
            </div>
            <div>
              <dt>Left hand</dt>
              <dd>{counts.leftHand}</dd>
            </div>
            <div>
              <dt>Right hand</dt>
              <dd>{counts.rightHand}</dd>
            </div>
          </dl>

          <div className="temporal-window">
            <div className="temporal-window-heading">
              <span>Motion window</span>
              <strong>{describeTemporalState(temporal)}</strong>
            </div>

            <progress
              aria-label="Usable frames in the local motion window"
              max={temporal.targetFrames}
              value={temporal.bufferedFrames}
            />

            <p>
              {temporal.bufferedFrames} of {temporal.targetFrames} usable frames
              {temporal.durationMs > 0 && (
                <span> · {durationSeconds}s</span>
              )}
            </p>
          </div>
        </>
      )}

      {errorMessage && (
        <p className="landmark-monitor-error" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  )
}