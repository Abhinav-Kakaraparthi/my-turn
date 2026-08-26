import { useState } from 'react'
import type { TemporalBufferSnapshot } from './TemporalLandmarkBuffer'
import type { CapturedSignSequence } from './landmarkWorker.types'
import {
  rankPersonalizedSignMatches,
  type PersonalizedSignMatch,
} from './personalizedSignRecognizer'
import type { PersonalizedSignSample } from './personalizedSignStore'
import './PersonalizedSignRecognition.css'

type PersonalizedSignRecognitionProps = {
  cameraActive: boolean
  cancelCapture: () => void
  captureSequence: () => Promise<CapturedSignSequence>
  disabled: boolean
  onActiveChange: (active: boolean) => void
  perceptionReady: boolean
  samples: PersonalizedSignSample[]
  temporal: TemporalBufferSnapshot
}

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The personalized sign comparison could not finish.'
}

function isCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function PersonalizedSignRecognition({
  cameraActive,
  cancelCapture,
  captureSequence,
  disabled,
  onActiveChange,
  perceptionReady,
  samples,
  temporal,
}: PersonalizedSignRecognitionProps) {
  const [closestMatch, setClosestMatch] =
    useState<PersonalizedSignMatch | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isComparing, setIsComparing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const visibleMatch =
    closestMatch &&
    samples.some((sample) => sample.id === closestMatch.sampleId)
      ? closestMatch
      : null

  const canCompare =
    cameraActive &&
    perceptionReady &&
    samples.length > 0 &&
    !disabled

  async function handleCompare() {
    setClosestMatch(null)
    setErrorMessage(null)
    setNotice(null)
    setIsComparing(true)
    onActiveChange(true)

    try {
      const sequence = await captureSequence()
      const matches = rankPersonalizedSignMatches(sequence, samples)
      const bestMatch = matches[0]

      if (!bestMatch) {
        setErrorMessage(
          'No compatible local examples were available for comparison.',
        )
        return
      }

      setClosestMatch(bestMatch)
    } catch (error) {
      if (isCancellation(error)) {
        setNotice('Comparison cancelled.')
      } else {
        setErrorMessage(describeError(error))
      }
    } finally {
      setIsComparing(false)
      onActiveChange(false)
    }
  }

  return (
    <section
      className="personalized-recognition"
      aria-labelledby="personalized-recognition-title"
    >
      <div className="personalized-recognition-heading">
        <div>
          <p className="recognition-label">Local comparison</p>
          <h4 id="personalized-recognition-title">
            Try your saved signing examples
          </h4>
        </div>

        <span>{samples.length} available</span>
      </div>

      <p className="recognition-copy">
        Perform a sign again and My Turn will find the closest example
        saved on this device.
      </p>

      <div className="recognition-actions">
        <button
          className="recognition-compare-button"
          type="button"
          disabled={!canCompare || isComparing}
          onClick={() => void handleCompare()}
        >
          {isComparing
            ? `Comparing ${temporal.bufferedFrames}/${temporal.targetFrames}…`
            : 'Compare my sign'}
        </button>

        {isComparing && (
          <button
            className="recognition-cancel-button"
            type="button"
            onClick={cancelCapture}
          >
            Cancel
          </button>
        )}
      </div>

      {samples.length === 0 && (
        <p className="recognition-guidance">
          Record at least one personalized example before comparing.
        </p>
      )}

      {samples.length > 0 && !cameraActive && (
        <p className="recognition-guidance">
          Turn on the camera to compare a sign.
        </p>
      )}

      {cameraActive && !perceptionReady && (
        <p className="recognition-guidance">
          Wait for the local perception model to finish loading.
        </p>
      )}

      {isComparing && (
        <p className="recognition-guidance" role="status">
          Perform the sign while your face, upper body, and signing hand
          remain visible.
        </p>
      )}

      {visibleMatch && (
        <div className="recognition-result" role="status">
          <div>
            <span>Closest local example</span>
            <strong>{visibleMatch.phrase}</strong>
          </div>

          <dl>
            <div>
              <dt>Relative similarity</dt>
              <dd>{Math.round(visibleMatch.similarity * 100)}%</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{visibleMatch.distance.toFixed(3)}</dd>
            </div>
          </dl>

          <p>
            This is a local similarity candidate, not a confirmed ASL
            translation.
          </p>
        </div>
      )}

      {notice && (
        <p className="recognition-notice" role="status">
          {notice}
        </p>
      )}

      {errorMessage && (
        <p className="recognition-error" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  )
}
