import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
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

const AUTO_SPEAK_MIN_SIMILARITY = 0.88

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
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const liveRecognitionBusyRef = useRef(false)
  const waitingForHandsToClearRef = useRef(false)

  const visibleMatch =
    closestMatch &&
    samples.some((sample) => sample.id === closestMatch.sampleId)
      ? closestMatch
      : null

  const phraseSuggestions = Array.from(
    new Set(samples.map((sample) => sample.phrase)),
  ).sort((left, right) => left.localeCompare(right))

  const liveRecognitionReady =
    cameraActive &&
    perceptionReady &&
    samples.length > 0 &&
    !disabled &&
    !isSavingFeedback

  const speakText = useCallback((text: string) => {
    const normalizedText = text.trim()

    if (!normalizedText) {
      return false
    }

    if (!('speechSynthesis' in window)) {
      setErrorMessage('This browser does not support speech output.')
      return false
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(normalizedText)

    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => {
      setIsSpeaking(false)
      setErrorMessage('The browser could not play the communication draft.')
    }

    setErrorMessage(null)
    setIsSpeaking(true)
    window.speechSynthesis.speak(utterance)
    return true
  }, [])

  const makeSpeakableDraft = useCallback((
    draft: CommunicationDraft,
    recognizedPhrase: string,
  ): CommunicationDraft => {
    if (!draft.needsUserConfirmation) {
      return draft
    }

    return {
      caption: recognizedPhrase,
      clarificationQuestion: null,
      needsUserConfirmation: false,
      speechText: recognizedPhrase,
    }
  }, [])

  const recognizeCurrentSign = useCallback(async () => {
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

      if (bestMatch.similarity < AUTO_SPEAK_MIN_SIMILARITY) {
        setNotice(
          `My Turn is only ${Math.round(
            bestMatch.similarity * 100,
          )}% confident. Show the sign again or correct the result below.`,
        )
        return
      }

      const agentDraft = await requestCommunicationDraft(
        bestMatch.phrase,
      )
      const speakableDraft = makeSpeakableDraft(
        agentDraft,
        bestMatch.phrase,
      )

      setCommunicationDraft(speakableDraft)

      const speechStarted = speakText(speakableDraft.speechText)

      setNotice(
        speechStarted
          ? `Recognized “${bestMatch.phrase}” and spoke it automatically.`
          : `Recognized “${bestMatch.phrase}”.`,
      )
    } catch (error) {
      if (isCancellation(error)) {
        setNotice('Live recognition paused.')
      } else {
        setErrorMessage(describeError(error))
      }
    } finally {
      liveRecognitionBusyRef.current = false
      setIsComparing(false)
      onActiveChange(false)
    }
  }, [
    captureSequence,
    makeSpeakableDraft,
    onActiveChange,
    samples,
    speakText,
  ])

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

      const agentDraft = await requestCommunicationDraft(normalizedPhrase)
      const speakableDraft = makeSpeakableDraft(
        agentDraft,
        normalizedPhrase,
      )

      setCommunicationDraft(speakableDraft)
      speakText(speakableDraft.speechText)
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

  useEffect(() => {
    if (!cameraActive || !perceptionReady || samples.length === 0) {
      waitingForHandsToClearRef.current = false
      return
    }

    if (disabled || isSavingFeedback) {
      waitingForHandsToClearRef.current = true
      return
    }

    if (isSpeaking) {
      return
    }

    if (waitingForHandsToClearRef.current) {
      if (
        temporal.bufferedFrames === 0 &&
        !liveRecognitionBusyRef.current
      ) {
        waitingForHandsToClearRef.current = false
        setNotice('Live translation is listening for the next sign.')
      }

      return
    }

    if (
      temporal.bufferedFrames === 0 ||
      liveRecognitionBusyRef.current
    ) {
      return
    }

    waitingForHandsToClearRef.current = true
    liveRecognitionBusyRef.current = true
    void recognizeCurrentSign()
  }, [
    cameraActive,
    disabled,
    isSavingFeedback,
    isSpeaking,
    perceptionReady,
    recognizeCurrentSign,
    samples.length,
    temporal.bufferedFrames,
  ])

  return (
    <section
      className="personalized-recognition"
      aria-labelledby="personalized-recognition-title"
    >
      <div className="personalized-recognition-heading">
        <div>
          <p className="recognition-label">Live translation</p>
          <h4 id="personalized-recognition-title">
            Sign naturally. My Turn will speak automatically.
          </h4>
        </div>

        <span>{samples.length} available</span>
      </div>

      <p className="recognition-copy">
        When a signing hand appears, My Turn automatically captures the
        motion window, compares it with examples saved on this device,
        and speaks high-confidence results.
      </p>

      <div className="recognition-actions">
        <p className="recognition-guidance" role="status">
          {isComparing
            ? `Listening ${temporal.bufferedFrames}/${temporal.targetFrames}…`
            : liveRecognitionReady
              ? temporal.bufferedFrames > 0
                ? 'Lower your hands briefly before the next sign.'
                : 'Live translation is listening.'
              : 'Live translation will start when the camera and local examples are ready.'}
        </p>

        {isComparing && (
          <button
            className="recognition-cancel-button"
            type="button"
            onClick={cancelCapture}
          >
            Stop current capture
          </button>
        )}
      </div>

      {samples.length === 0 && (
        <p className="recognition-guidance">
          Record at least one personalized example before starting live
          translation.
        </p>
      )}

      {samples.length > 0 && !cameraActive && (
        <p className="recognition-guidance">
          Turn on the camera to start automatic translation.
        </p>
      )}

      {cameraActive && !perceptionReady && (
        <p className="recognition-guidance">
          Wait for the local perception model to finish loading.
        </p>
      )}

      {isComparing && (
        <p className="recognition-guidance" role="status">
          Keep your face, upper body, and signing hand visible. No compare
          or speak button is required.
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
            High-confidence matches are spoken automatically. Use the
            correction controls only when the detected phrase is wrong.
          </p>

          {visibleMatch.similarity < AUTO_SPEAK_MIN_SIMILARITY && (
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
          )}
        </div>
      )}

      {communicationDraft && (
        <div className="recognition-result" role="status">
          <div>
            <span>Gemini communication draft</span>
            <strong>{communicationDraft.caption}</strong>
          </div>

          <p>
            {isSpeaking
              ? 'Speaking automatically…'
              : 'Automatic voice output completed.'}
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
