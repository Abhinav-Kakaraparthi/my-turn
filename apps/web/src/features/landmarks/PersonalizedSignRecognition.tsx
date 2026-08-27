import { useState, type FormEvent } from 'react'
import {
  requestCommunicationDraft,
  type CommunicationDraft,
} from '../communication/communicationAgentClient'
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
  onSaveFeedback: (
    phrase: string,
    sequence: CapturedSignSequence,
  ) => Promise<PersonalizedSignSample>
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
  onSaveFeedback,
  perceptionReady,
  samples,
  temporal,
}: PersonalizedSignRecognitionProps) {
  const [closestMatch, setClosestMatch] =
    useState<PersonalizedSignMatch | null>(null)
  const [communicationDraft, setCommunicationDraft] =
    useState<CommunicationDraft | null>(null)
  const [capturedSequence, setCapturedSequence] =
    useState<CapturedSignSequence | null>(null)
  const [correctionPhrase, setCorrectionPhrase] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isComparing, setIsComparing] = useState(false)
  const [isSavingFeedback, setIsSavingFeedback] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const visibleMatch =
    closestMatch &&
    samples.some((sample) => sample.id === closestMatch.sampleId)
      ? closestMatch
      : null

  const phraseSuggestions = Array.from(
    new Set(samples.map((sample) => sample.phrase)),
  ).sort((left, right) => left.localeCompare(right))

  const canCompare =
    cameraActive &&
    perceptionReady &&
    samples.length > 0 &&
    !disabled &&
    !isSavingFeedback

  async function handleCompare() {
    setCapturedSequence(null)
    setClosestMatch(null)
    setCommunicationDraft(null)
    setCorrectionPhrase('')
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

      setCapturedSequence(sequence)
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

  async function saveFeedback(
    intendedPhrase: string,
    wasCorrected: boolean,
  ) {
    const normalizedPhrase = intendedPhrase.trim()

    if (!normalizedPhrase) {
      setErrorMessage('Enter the intended phrase before saving feedback.')
      return
    }

    if (!capturedSequence || !visibleMatch) {
      setErrorMessage('Compare a sign before providing feedback.')
      return
    }

    setErrorMessage(null)
    setNotice(null)
    setIsSavingFeedback(true)

    try {
      const sample = await onSaveFeedback(
        normalizedPhrase,
        capturedSequence,
      )

      setCapturedSequence(null)
      setClosestMatch(null)
      setCorrectionPhrase('')
      setNotice(
        wasCorrected
          ? `Correction saved locally as “${sample.phrase}”.`
          : `Confirmed and saved another example for “${sample.phrase}”.`,
      )

      const draft = await requestCommunicationDraft(normalizedPhrase)
      setCommunicationDraft(draft)
    } catch (error) {
      setErrorMessage(describeError(error))
    } finally {
      setIsSavingFeedback(false)
    }
  }

  function handleCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void saveFeedback(correctionPhrase, true)
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

          <div className="recognition-feedback">
            <p>Is this the phrase you intended?</p>

            <div className="recognition-feedback-actions">
              <button
                className="recognition-confirm-button"
                type="button"
                disabled={isSavingFeedback}
                onClick={() =>
                  void saveFeedback(visibleMatch.phrase, false)
                }
              >
                {isSavingFeedback
                  ? 'Saving feedback…'
                  : 'Yes, learn this example'}
              </button>
            </div>

            <form
              className="recognition-correction-form"
              onSubmit={handleCorrection}
            >
              <label htmlFor="recognition-correction-phrase">
                Or enter the intended phrase
              </label>

              <div className="recognition-correction-row">
                <input
                  id="recognition-correction-phrase"
                  type="text"
                  list="recognition-phrase-suggestions"
                  autoComplete="off"
                  maxLength={120}
                  placeholder="Choose or enter a correction"
                  value={correctionPhrase}
                  disabled={isSavingFeedback}
                  onChange={(event) =>
                    setCorrectionPhrase(event.target.value)
                  }
                />

                <button
                  type="submit"
                  disabled={
                    isSavingFeedback || !correctionPhrase.trim()
                  }
                >
                  Save correction
                </button>
              </div>

              <datalist id="recognition-phrase-suggestions">
                {phraseSuggestions.map((savedPhrase) => (
                  <option key={savedPhrase} value={savedPhrase} />
                ))}
              </datalist>
            </form>

            <p>
              Feedback stores this normalized landmark sequence locally.
              No camera image or video is saved.
            </p>
          </div>
        </div>
      )}

      {communicationDraft && (
        <div className="recognition-result" role="status">
          <div>
            <span>Gemini communication draft</span>
            <strong>{communicationDraft.caption}</strong>
          </div>

          {communicationDraft.needsUserConfirmation ? (
            <p>
              Confirmation required:{' '}
              {communicationDraft.clarificationQuestion ??
                'Please clarify the intended meaning.'}
            </p>
          ) : (
            <p>The caption is ready for voice output.</p>
          )}
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
