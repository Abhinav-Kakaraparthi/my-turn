import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  loadRecentCommunicationMemory,
  requestCommunicationDraft,
  saveConfirmedCommunication,
  type CommunicationDraft,
} from '../communication/communicationAgentClient'
import {
  predictPopsign,
  type PopsignPrediction,
} from './popsignModel'
import type {
  CapturedPopsignSequence,
  LandmarkStatus,
} from './landmarkWorker.types'
import type { PopsignModelStatus } from './usePopsignModel'
import './PopsignRecognition.css'

type PopsignRecognitionProps = {
  cameraActive: boolean
  enabled: boolean
  modelStatus: PopsignModelStatus
  overlayElement: HTMLElement | null
  perceptionStatus: LandmarkStatus
  practiceActive: boolean
  sequence: CapturedPopsignSequence | null
}

const MAXIMUM_ISOLATED_SIGN_DURATION_MS = 3000

type CommunicationHistoryItem = {
  caption: string
  createdAt: string
  id: string
  recognizedSign: string
  speechText: string
}

type RecognitionMemoryEvidence = {
  confidence: number
  margin: number
  model: PopsignPrediction['model']
  predictedSign: string
}

type CloudMemoryStatus =
  | 'loading'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'error'

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The captured sign could not be classified.'
}

function isCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function formatPercentage(value: number) {
  return `${Math.round(value * 100)}%`
}

export function PopsignRecognition({
  cameraActive,
  enabled,
  modelStatus,
  overlayElement,
  perceptionStatus,
  practiceActive,
  sequence,
}: PopsignRecognitionProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPredicting, setIsPredicting] = useState(false)
  const [prediction, setPrediction] =
    useState<PopsignPrediction | null>(null)
  const [communicationDraft, setCommunicationDraft] =
    useState<CommunicationDraft | null>(null)
  const [communicationDraftId, setCommunicationDraftId] =
    useState<number | null>(null)
  const [communicationError, setCommunicationError] =
    useState<string | null>(null)
  const [communicationHistory, setCommunicationHistory] =
    useState<CommunicationHistoryItem[]>([])
  const [communicationNotice, setCommunicationNotice] =
    useState<string | null>(null)
  const [draftApproved, setDraftApproved] = useState(false)
  const [draftSign, setDraftSign] = useState<string | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [confirmationPending, setConfirmationPending] =
    useState(false)
  const [cloudMemoryStatus, setCloudMemoryStatus] =
    useState<CloudMemoryStatus>('loading')
  const communicationBusyRef = useRef(false)
  const communicationAbortRef = useRef<AbortController | null>(null)
  const communicationHistoryRef =
    useRef<CommunicationHistoryItem[]>([])
  const communicationRequestIdRef = useRef(0)
  const finalizedDraftIdsRef = useRef(new Set<number>())
  const pendingEvidenceRef = useRef(
    new Map<number, RecognitionMemoryEvidence>(),
  )
  const ignoredDisabledSequenceIdRef = useRef<number | null>(null)
  const ignoredPracticeSequenceIdRef = useRef<number | null>(null)
  const speechUtteranceRef =
    useRef<SpeechSynthesisUtterance | null>(null)

  function speakText(text: string) {
    const normalizedText = text.trim()

    if (!normalizedText) {
      return false
    }

    if (!('speechSynthesis' in window)) {
      setCommunicationError(
        'This browser does not support synthesized speech.',
      )
      return false
    }

    const synthesis = window.speechSynthesis
    const utterance = new SpeechSynthesisUtterance(normalizedText)

    speechUtteranceRef.current = utterance

    utterance.onend = () => {
      if (speechUtteranceRef.current !== utterance) return

      speechUtteranceRef.current = null
      setIsSpeaking(false)
    }

    utterance.onerror = (event) => {
      if (speechUtteranceRef.current !== utterance) return

      speechUtteranceRef.current = null
      setIsSpeaking(false)

      if (
        event.error !== 'canceled' &&
        event.error !== 'interrupted'
      ) {
        setCommunicationError(
          'The browser could not play the caption.',
        )
      }
    }

    const startSpeech = () => {
      if (speechUtteranceRef.current !== utterance) return

      synthesis.resume()
      synthesis.speak(utterance)
    }

    setIsSpeaking(true)

    if (synthesis.speaking || synthesis.pending) {
      synthesis.cancel()
      window.setTimeout(startSpeech, 75)
    } else {
      startSpeech()
    }

    return true
  }

  function finalizeCommunicationDraft(
    recognizedSign: string,
    draft: CommunicationDraft,
    requestId: number,
  ) {
    if (finalizedDraftIdsRef.current.has(requestId)) {
      return
    }

    finalizedDraftIdsRef.current.add(requestId)
    setDraftApproved(true)

    const item: CommunicationHistoryItem = {
      caption: draft.caption,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      recognizedSign,
      speechText: draft.speechText,
    }
    const nextHistory = [
      ...communicationHistoryRef.current,
      item,
    ].slice(-6)

    communicationHistoryRef.current = nextHistory
    setCommunicationHistory(nextHistory)

    const evidence = pendingEvidenceRef.current.get(requestId) ?? {
      confidence: 1,
      margin: 1,
      model: '250-sign' as const,
      predictedSign: recognizedSign,
    }

    setCloudMemoryStatus('saving')
    void saveConfirmedCommunication({
      eventId: item.id,
      predictedSign: evidence.predictedSign,
      confirmedSign: recognizedSign,
      caption: draft.caption,
      speechText: draft.speechText,
      model: evidence.model,
      confidence: evidence.confidence,
      margin: evidence.margin,
    })
      .then(() => setCloudMemoryStatus('saved'))
      .catch(() => setCloudMemoryStatus('error'))
      .finally(() => pendingEvidenceRef.current.delete(requestId))

    const speechStarted = speakText(draft.speechText)

    setCommunicationNotice(
      speechStarted
        ? `Caption confirmed and spoken for â€œ${recognizedSign}â€.`
        : `Caption confirmed for â€œ${recognizedSign}â€.`,
    )
  }

  async function createCommunicationDraft(
    recognizedSign: string,
    predictionEvidence?: PopsignPrediction,
  ) {
    if (communicationBusyRef.current) {
      setCommunicationNotice(
        'Finish the current communication draft before sending another sign.',
      )
      return
    }

    communicationBusyRef.current = true
    const abortController = new AbortController()
    const requestId = communicationRequestIdRef.current + 1

    communicationAbortRef.current = abortController
    communicationRequestIdRef.current = requestId
    pendingEvidenceRef.current.set(requestId, {
      confidence: predictionEvidence?.confidence ?? 1,
      margin: predictionEvidence?.margin ?? 1,
      model: predictionEvidence?.model ?? '250-sign',
      predictedSign: predictionEvidence?.sign ?? recognizedSign,
    })
    setCommunicationDraft(null)
    setCommunicationDraftId(null)
    setCommunicationError(null)
    setCommunicationNotice(
      `Turning â€œ${recognizedSign}â€ into a grounded captionâ€¦`,
    )
    setDraftApproved(false)
    setDraftSign(recognizedSign)
    setIsDrafting(true)

    try {
      const draft = await requestCommunicationDraft(
        recognizedSign,
        communicationHistoryRef.current.map((item) => item.caption),
        abortController.signal,
      )

      if (requestId !== communicationRequestIdRef.current) {
        return
      }

      setCommunicationDraft(draft)
      setCommunicationDraftId(requestId)

      if (draft.needsUserConfirmation) {
        setCommunicationNotice(
          draft.clarificationQuestion ??
            'Review the generated caption before it is spoken.',
        )
        return
      }

      finalizeCommunicationDraft(recognizedSign, draft, requestId)
    } catch (error) {
      if (
        !isCancellation(error) &&
        requestId === communicationRequestIdRef.current
      ) {
        setCommunicationError(describeError(error))
        setCommunicationNotice(
          'The recognized sign was retained, but no caption was spoken.',
        )
      }

      pendingEvidenceRef.current.delete(requestId)
    } finally {
      if (communicationAbortRef.current === abortController) {
        communicationAbortRef.current = null
        communicationBusyRef.current = false
        setIsDrafting(false)
      }
    }
  }

  function approveCurrentDraft() {
    if (
      !communicationDraft ||
      communicationDraftId === null ||
      !draftSign
    ) {
      return
    }

    finalizeCommunicationDraft(
      draftSign,
      communicationDraft,
      communicationDraftId,
    )
  }

  function confirmRecognizedSign(recognizedSign: string) {
    if (!prediction) {
      return
    }

    setConfirmationPending(false)
    void createCommunicationDraft(recognizedSign, prediction)
  }

  function retryCurrentSign() {
    setConfirmationPending(false)
    setPrediction(null)
    setCommunicationNotice(
      'Nothing was sent. Lower both hands, then perform the sign again.',
    )
  }

  const createCommunicationDraftRef = useRef(
    createCommunicationDraft,
  )

  useEffect(() => {
    let active = true

    void loadRecentCommunicationMemory()
      .then((items) => {
        if (!active) {
          return
        }

        communicationHistoryRef.current = items
        setCommunicationHistory(items)
        setCloudMemoryStatus('ready')
      })
      .catch(() => {
        if (active) {
          setCloudMemoryStatus('error')
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (enabled && cameraActive) {
      return
    }

    communicationAbortRef.current?.abort()

    speechUtteranceRef.current = null

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [cameraActive, enabled])

  useEffect(() => {
    if (!sequence) {
      return
    }

    if (!enabled) {
      ignoredDisabledSequenceIdRef.current = sequence.sequenceId
      return
    }

    if (practiceActive) {
      ignoredPracticeSequenceIdRef.current = sequence.sequenceId
      return
    }

    if (
      sequence.sequenceId === ignoredDisabledSequenceIdRef.current ||
      sequence.sequenceId === ignoredPracticeSequenceIdRef.current ||
      sequence.durationMs > MAXIMUM_ISOLATED_SIGN_DURATION_MS ||
      modelStatus !== 'ready'
    ) {
      setPrediction(null)
      setErrorMessage(null)
      setIsPredicting(false)
      return
    }

    let active = true

    setCommunicationDraft(null)
    setCommunicationDraftId(null)
    setCommunicationError(null)
    setCommunicationNotice(null)
    setConfirmationPending(false)
    setDraftApproved(false)
    setDraftSign(null)
    setErrorMessage(null)
    setIsPredicting(true)

    void predictPopsign(sequence.values)
      .then((nextPrediction) => {
        if (active) {
          setPrediction(nextPrediction)

          if (nextPrediction.decision === 'automatic') {
            setConfirmationPending(false)
            void createCommunicationDraftRef.current(
              nextPrediction.sign,
              nextPrediction,
            )
          } else if (nextPrediction.decision === 'confirmation') {
            setConfirmationPending(true)
            setCommunicationNotice(
              'The model is uncertain. Confirm the intended sign in the camera panel.',
            )
          } else {
            setConfirmationPending(false)
            setCommunicationNotice(
              'No communication was sent because the motion was rejected.',
            )
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(describeError(error))
        }
      })
      .finally(() => {
        if (active) {
          setIsPredicting(false)
        }
      })

    return () => {
      active = false
    }
  }, [
    enabled,
    modelStatus,
    practiceActive,
    sequence,
  ])

  const isTooLong = Boolean(
    sequence &&
      sequence.durationMs > MAXIMUM_ISOLATED_SIGN_DURATION_MS,
  )

  const ready =
    enabled &&
    cameraActive &&
    modelStatus === 'ready' &&
    perceptionStatus === 'running' &&
    !practiceActive

  const cameraPrediction =
    overlayElement && prediction && prediction.decision !== 'rejected'
      ? createPortal(
          <aside
            className="popsign-camera-card"
            data-decision={prediction.decision}
            aria-live="polite"
          >
            <div className="popsign-camera-card-heading">
              <div>
                <span>
                  {communicationDraft
                    ? 'Caption and voice'
                    : prediction.decision === 'automatic'
                      ? 'Auto voice'
                      : 'Quick confirmation'}
                </span>
                <strong>{draftSign ?? prediction.sign}</strong>
              </div>
              <span>{formatPercentage(prediction.confidence)}</span>
            </div>

            {communicationDraft && draftSign ? (
              <div className="popsign-camera-caption">
                <div className="popsign-camera-caption-heading">
                  <span>Ready to communicate</span>
                  {isSpeaking && <strong>Speaking</strong>}
                </div>

                <blockquote>{communicationDraft.caption}</blockquote>

                {communicationDraft.needsUserConfirmation &&
                !draftApproved ? (
                  <button
                    className="popsign-camera-primary-action"
                    type="button"
                    onClick={approveCurrentDraft}
                  >
                    Approve & speak
                  </button>
                ) : (
                  <button
                    className="popsign-camera-primary-action"
                    type="button"
                    disabled={isSpeaking}
                    onClick={() =>
                      speakText(communicationDraft.speechText)
                    }
                  >
                    {isSpeaking ? 'Speaking...' : 'Replay voice'}
                  </button>
                )}
              </div>
            ) : prediction.decision === 'automatic' ? (
              <p>High-confidence match. Creating the caption automatically.</p>
            ) : confirmationPending ? (
              <>
                <p>The match is uncertain. Tap the sign you intended.</p>

                <div className="popsign-camera-choices">
                  {(prediction.confirmationCandidates ??
                    prediction.candidates.slice(0, 3))
                    .map((candidate) => (
                      <button
                        key={candidate.index}
                        type="button"
                        disabled={isDrafting || !ready}
                        onClick={() =>
                          confirmRecognizedSign(candidate.sign)
                        }
                      >
                        <span>{candidate.sign}</span>
                        <strong>
                          {formatPercentage(candidate.confidence)}
                        </strong>
                      </button>
                    ))}
                </div>

                <button
                  className="popsign-camera-retry"
                  type="button"
                  onClick={retryCurrentSign}
                >
                  None — try again
                </button>
              </>
            ) : (
              <p>Selection received. Creating the caption.</p>
            )}
          </aside>,
          overlayElement,
        )
      : null

  return (
    <>
      {cameraPrediction}
      <section
        className="popsign-recognition"
        aria-labelledby="popsign-recognition-title"
      >
      <div className="popsign-recognition-heading">
        <div>
          <p className="section-label">Public 250-sign vocabulary</p>
          <h3 id="popsign-recognition-title">
            Test signer-independent recognition.
          </h3>
        </div>

        <span>{ready ? 'Listening' : 'Waiting'}</span>
      </div>

      <p className="popsign-recognition-copy">
        Raise either hand to begin a sign, then lower both hands briefly
        to finish it. My Turn captures a variable-length motion and
        resamples it internally; you do not need to count frames.
        High-confidence signs are spoken automatically. Only uncertain
        matches ask for a quick confirmation in the camera panel.
      </p>

      <p className="popsign-recognition-status" role="status">
        {!enabled
          ? 'Public recognition is paused while Personalized mode is selected.'
          : practiceActive
          ? 'Practice is active. Its slow guided motion will not be classified.'
          : isTooLong
              ? 'Motion excluded because it exceeded 3 seconds. Perform one sign naturally and lower both hands.'
              : isPredicting
          ? 'Classifying the completed motionâ€¦'
          : ready
            ? 'Ready. Perform one sign from the 250-sign vocabulary.'
            : 'Turn on the camera and wait for both local models.'}
      </p>

      {sequence && (
        <p className="popsign-segment-details">
          Latest motion: {sequence.frameCount} captured frames over{' '}
          {(sequence.durationMs / 1000).toFixed(1)} seconds.
        </p>
      )}

      {!practiceActive && prediction && (
        <div className="popsign-result" role="status">
          <div>
            <span>
              {prediction.decision === 'rejected'
                ? 'Recognition status'
                : 'Best candidate'}
            </span>
            <strong>
              {prediction.decision === 'rejected'
                ? 'No reliable match'
                : prediction.sign}
            </strong>
          </div>

          {prediction.decision === 'rejected' ? (
            <p className="popsign-rejection-note">
              {prediction.model === 'personal-motion'
                ? 'This motion was outside the learned range or too close to another calibrated sign. No label was published or spoken.'
                : 'This motion did not pass the 250-sign confidence gate. No label was published or spoken.'}
            </p>
          ) : (
            <div>
              <details className="popsign-diagnostics">
                <summary>Recognition details</summary>
                <dl>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{formatPercentage(prediction.confidence)}</dd>
                  </div>
                  <div>
                    <dt>Decision</dt>
                    <dd>{prediction.decision}</dd>
                  </div>
                  <div>
                    <dt>Top-two margin</dt>
                    <dd>{formatPercentage(prediction.margin)}</dd>
                  </div>
                </dl>

                <span>Top five</span>
                <ol>
                  {prediction.candidates.map((candidate) => (
                    <li key={candidate.index}>
                      <span>{candidate.sign}</span>
                      <strong>
                        {formatPercentage(candidate.confidence)}
                      </strong>
                    </li>
                  ))}
                </ol>
              </details>

              {prediction.decision === 'confirmation' &&
                confirmationPending && (
                <div className="popsign-confirmation">
                  <p>
                    Use the quick confirmation card displayed over your
                    live camera. These controls are repeated here only as
                    an accessible fallback.
                  </p>

                  <div>
                    {(prediction.confirmationCandidates ??
                      prediction.candidates.slice(0, 3))
                      .map((candidate) => (
                        <button
                          key={candidate.index}
                          type="button"
                          disabled={isDrafting || !ready}
                          onClick={() =>
                            confirmRecognizedSign(candidate.sign)
                          }
                        >
                          <span>{candidate.sign}</span>
                          <strong>
                            {formatPercentage(candidate.confidence)}
                          </strong>
                        </button>
                      ))}
                  </div>

                  <button
                    className="popsign-confirmation-retry"
                    type="button"
                    onClick={retryCurrentSign}
                  >
                    None of these â€” try the sign again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <section
        className="popsign-communication"
        aria-labelledby="popsign-communication-title"
      >
        <div className="popsign-communication-heading">
          <div>
            <span>Grounded communication</span>
            <h4 id="popsign-communication-title">
              Caption and voice
            </h4>
          </div>

          <span data-active={isDrafting || isSpeaking}>
            {isDrafting
              ? 'Gemini drafting'
              : isSpeaking
                ? 'Speaking'
                : cloudMemoryStatus === 'loading'
                  ? 'Loading memory'
                  : cloudMemoryStatus === 'saving'
                    ? 'Saving memory'
                    : cloudMemoryStatus === 'saved'
                      ? 'Cloud memory saved'
                      : cloudMemoryStatus === 'error'
                        ? 'Memory unavailable'
                        : 'Ready'}
          </span>
        </div>

        {communicationNotice && (
          <p className="popsign-communication-notice" role="status">
            {communicationNotice}
          </p>
        )}

        {communicationError && (
          <div className="popsign-communication-error" role="alert">
            <p>{communicationError}</p>

            {prediction && prediction.decision === 'automatic' && (
              <button
                type="button"
                disabled={isDrafting}
                onClick={() =>
                  void createCommunicationDraft(
                    prediction.sign,
                    prediction,
                  )
                }
              >
                Try Gemini again
              </button>
            )}
          </div>
        )}

        {communicationDraft && draftSign && (
          <article className="popsign-current-caption">
            <div>
              <span>Recognized evidence</span>
              <strong>{draftSign}</strong>
            </div>

            <blockquote>{communicationDraft.caption}</blockquote>

            {communicationDraft.needsUserConfirmation &&
              !draftApproved && (
                <button
                  type="button"
                  onClick={approveCurrentDraft}
                >
                  Approve caption and speak
                </button>
              )}
          </article>
        )}

        <details className="popsign-history">
          <summary>
            <span>History / previous captions</span>
            <strong>{communicationHistory.length} saved</strong>
          </summary>

          {communicationHistory.length === 0 ? (
            <p>
              Confirmed captions will appear here and become bounded
              context for the next communication draft.
            </p>
          ) : (
            <ol>
              {[...communicationHistory]
                .reverse()
                .map((item) => (
                  <li key={item.id}>
                    <div>
                      <span>{item.recognizedSign}</span>
                      <strong>{item.caption}</strong>
                    </div>

                    <button
                      type="button"
                      onClick={() => speakText(item.speechText)}
                    >
                      Replay
                    </button>
                  </li>
                ))}
            </ol>
          )}
        </details>
      </section>

      {errorMessage && (
        <p className="popsign-error" role="alert">
          {errorMessage}
        </p>
      )}
      </section>
    </>
  )
}
