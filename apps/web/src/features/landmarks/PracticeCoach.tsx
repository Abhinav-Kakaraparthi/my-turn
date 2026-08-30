import type { SignPracticeController } from './useSignPractice'
import './PracticeCoach.css'

type PracticeCoachProps = {
  cameraReady: boolean
  controller: SignPracticeController
  onSignChange: (sign: string) => void
  signs: readonly string[]
}

function formatPercentage(value: number | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`
}

export function PracticeCoach({
  cameraReady,
  controller,
  onSignChange,
  signs,
}: PracticeCoachProps) {
  const feedback = controller.feedback
  const disabled = !cameraReady || controller.status !== 'ready'

  return (
    <section
      className="practice-coach"
      aria-labelledby="practice-coach-title"
    >
      <div className="practice-coach-heading">
        <div>
          <p className="section-label">Model-aligned guidance</p>
          <h3 id="practice-coach-title">Practice Coach</h3>
        </div>

        <span data-active={controller.active}>
          {controller.active
            ? `Following ${controller.sign}`
            : 'Paused'}
        </span>
      </div>

      <p className="practice-coach-copy">
        Match the green {controller.sign} skeleton over your live landmarks. Red arrows
        point from your fingertips toward the current target position.
      </p>

      <div className="practice-coach-toolbar">
        <label>
          <span>Practice sign</span>
          <select
            value={controller.sign}
            aria-label="Practice sign"
            onChange={(event) => onSignChange(event.target.value)}
          >
            {signs.map((sign) => (
              <option value={sign} key={sign}>
                {sign}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={disabled}
          onClick={controller.toggle}
        >
          {controller.active
            ? 'Pause guide'
            : `Start ${controller.sign} practice`}
        </button>

        <button
          className="practice-coach-secondary"
          type="button"
          disabled={disabled}
          onClick={controller.restart}
        >
          Restart
        </button>
      </div>

      {controller.status === 'loading' && (
        <p className="practice-coach-message" role="status">
          Loading the local {controller.sign} reference…
        </p>
      )}

      {controller.errorMessage && (
        <p className="practice-coach-error" role="alert">
          {controller.errorMessage}
        </p>
      )}

      {controller.status === 'ready' && (
        <div className="practice-coach-feedback" aria-live="polite">
          <div className="practice-coach-instruction">
            <span>
              {controller.active
                ? `Reference frame ${controller.frameIndex + 1} of 64`
                : 'Ready when you are'}
            </span>
            <strong>
              {controller.active
                ? feedback?.instruction ??
                  'Keep your shoulders and hand visible.'
                : cameraReady
                  ? 'Start the guide, then follow the green overlay.'
                  : 'Turn on the camera and wait for perception.'}
            </strong>
          </div>

          <dl>
            <div>
              <dt>Overall match</dt>
              <dd>{formatPercentage(feedback?.overallScore)}</dd>
            </div>
            <div>
              <dt>Handshape</dt>
              <dd>{formatPercentage(feedback?.handshapeScore)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{formatPercentage(feedback?.locationScore)}</dd>
            </div>
            <div>
              <dt>Depth</dt>
              <dd>{formatPercentage(feedback?.depthScore)}</dd>
            </div>
          </dl>
        </div>
      )}

      <p className="practice-coach-note">
        This compares your landmarks with one model reference; it is not a
        substitute for instruction from a qualified ASL educator.
      </p>
    </section>
  )
}
