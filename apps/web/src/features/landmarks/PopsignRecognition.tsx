import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  loadRecentCommunicationMemory,
  requestCommunicationDraft,
  saveConfirmedCommunication,
  saveRecognitionCorrection,
  type CommunicationDraft,
} from '../communication/communicationAgentClient'
import { loadPracticeCatalog } from './practiceCatalog'
import {
  predictPopsign,
  type PopsignPrediction,
} from './popsignModel'
import {
  findRecognitionCorrection,
  listRecognitionCorrections,
  saveRecognitionCorrectionSample,
  type RecognitionCorrectionMatch,
  type RecognitionCorrectionSample,
} from './recognitionCorrectionStore'
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
const POPSIGN_MODEL_VERSION = 'my-turn-popsign-v1'

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

function applyRecognitionCorrection(
  prediction: PopsignPrediction,
  match: RecognitionCorrectionMatch,
): PopsignPrediction {
  const correctedCandidate = prediction.candidates.find(
    (candidate) => candidate.sign === match.correctedSign,
  ) ?? {
    confidence: match.similarity,
    index: -1,
    sign: match.correctedSign,
  }

  return {
    ...prediction,
    candidates: [
      {
        ...correctedCandidate,
        confidence: match.similarity,
      },
      ...prediction.candidates.filter(
        (candidate) => candidate.sign !== match.correctedSign,
      ),
    ].slice(0, 5),
    confidence: match.similarity,
    confirmationCandidates: undefined,
    decision: 'automatic',
    margin: match.similarity,
    model: 'personal-motion',
    sign: match.correctedSign,
  }
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
  const [communicationError, setCommunicationError] =
    useState<string | null>(null)
  const [communicationHistory, setCommunicationHistory] =
    useState<CommunicationHistoryItem[]>([])
  const [communicationNotice, setCommunicationNotice] =
    useState<string | null>(null)
  const [draftSign, setDraftSign] = useState<string | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionSign, setCorrectionSign] = useState('')
  const [correctionSigns, setCorrectionSigns] = useState<string[]>([])
  const [correctionNotice, setCorrectionNotice] =
    useState<string | null>(null)
  const [isSavingCorrection, setIsSavingCorrection] = useState(false)
  const [cloudMemoryStatus, setCloudMemoryStatus] =
    useState<CloudMemoryStatus>('loading')
  const communicationBusyRef = useRef(false)
  const communicationAbortRef = useRef<AbortController | null>(null)
  const communicationHistoryRef =
    useRef<CommunicationHistoryItem[]>([])
  const communicationRequestIdRef = useRef(0)
  const latestCommunicationEventIdRef = useRef<string | null>(null)
  const finalizedDraftIdsRef = useRef(new Set<number>())
  const pendingEvidenceRef = useRef(
    new Map<number, RecognitionMemoryEvidence>(),
  )
  const correctionSamplesRef = useRef<RecognitionCorrectionSample[]>([])
  const basePredictionRef = useRef<PopsignPrediction | null>(null)
  const predictionSequenceRef =
    useRef<CapturedPopsignSequence | null>(null)
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
    latestCommunicationEventIdRef.current = item.id
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
        ? `Caption confirmed and spoken for "${recognizedSign}".`
        : `Caption confirmed for "${recognizedSign}".`,
    )
  }

  async function createCommunicationDraft(
    recognizedSign: string,
    predictionEvidence?: PopsignPrediction,
  ) {
    if (communicationBusyRef.current) {
      communicationAbortRef.current?.abort()
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
    setCommunicationError(null)
    setCommunicationNotice(
      `Turning "${recognizedSign}" into a grounded caption...`,
    )
    setDraftSign(recognizedSign)
    setIsDrafting(true)

    try {
      const draft = await requestCommunicationDraft(
        recognizedSign,
        communicationHistoryRef.current.map((item) => item.caption),
        abortController.signal,
      )

      if (requestId !== communicationRequestIdRef.current) {
        pendingEvidenceRef.current.delete(requestId)
        return
      }

      const speakableDraft = draft.needsUserConfirmation
        ? {
            caption: recognizedSign,
            clarificationQuestion: null,
            needsUserConfirmation: false,
            speechText: recognizedSign,
          }
        : draft

      setCommunicationDraft(speakableDraft)
      finalizeCommunicationDraft(
        recognizedSign,
        speakableDraft,
        requestId,
      )
    } catch (error) {
      if (
        !isCancellation(error) &&
        requestId === communicationRequestIdRef.current
      ) {
        const fallbackDraft: CommunicationDraft = {
          caption: recognizedSign,
          clarificationQuestion: null,
          needsUserConfirmation: false,
          speechText: recognizedSign,
        }

        setCommunicationDraft(fallbackDraft)
        finalizeCommunicationDraft(
          recognizedSign,
          fallbackDraft,
          requestId,
        )
        setCommunicationError(
          `${describeError(error)} The recognized sign was spoken directly instead.`,
        )
        setCommunicationNotice(
          'Gemini was unavailable, so My Turn spoke the recognized sign directly.',
        )
      } else {
        pendingEvidenceRef.current.delete(requestId)
      }
    } finally {
      if (communicationAbortRef.current === abortController) {
        communicationAbortRef.current = null
        communicationBusyRef.current = false
        setIsDrafting(false)
      }
    }
  }

  async function handleSaveCorrection(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const intendedSign = correctionSign.trim()
    const correctionSequence = predictionSequenceRef.current
    const basePrediction = basePredictionRef.current ?? prediction

    if (!prediction || !basePrediction || !correctionSequence) {
      setCorrectionNotice(
        'Perform a sign before reporting a recognition issue.',
      )
      return
    }

    if (!intendedSign) {
      setCorrectionNotice('Choose the sign you intended.')
      return
    }

    if (intendedSign === prediction.sign) {
      setCorrectionNotice(
        'Choose a different sign when reporting an incorrect result.',
      )
      return
    }

    setIsSavingCorrection(true)
    setCorrectionNotice(null)

    try {
      const supersededCorrection = findRecognitionCorrection(
        correctionSequence,
        basePrediction.sign,
        correctionSamplesRef.current,
      )
      const sample = await saveRecognitionCorrectionSample({
        correctedSign: intendedSign,
        modelVersion: POPSIGN_MODEL_VERSION,
        prediction: basePrediction,
        sequence: correctionSequence,
        supersedesSampleId: supersededCorrection?.sampleId,
      })
      const nextSamples = [
        sample,
        ...correctionSamplesRef.current.filter(
          (candidate) =>
            candidate.id !== supersededCorrection?.sampleId,
        ),
      ]
      const correctedPrediction = applyRecognitionCorrection(
        prediction,
        {
          correctedSign: sample.correctedSign,
          sampleId: sample.id,
          similarity: 1,
        },
      )

      correctionSamplesRef.current = nextSamples

      const communicationEventId =
        latestCommunicationEventIdRef.current
      const correctedHistory = communicationHistoryRef.current.filter(
        (item) => item.id !== communicationEventId,
      )

      communicationHistoryRef.current = correctedHistory
      latestCommunicationEventIdRef.current = null
      setCommunicationHistory(correctedHistory)
      setPrediction(correctedPrediction)
      setCorrectionOpen(false)
      setCorrectionSign('')
      setCorrectionNotice(
        `Correction saved. Similar “${sample.predictedSign}” motions will now use “${sample.correctedSign}”.`,
      )

      void saveRecognitionCorrection({
        communicationEventId,
        confidence: sample.confidence,
        correctedSign: sample.correctedSign,
        correctionId: sample.id,
        durationMs: sample.durationMs,
        margin: sample.margin,
        model: sample.model,
        modelVersion: sample.modelVersion,
        predictedSign: sample.predictedSign,
        sequenceId: sample.sequenceId,
        supersedesCorrectionId: sample.supersedesCorrectionId,
        values: sample.values,
      })
        .then(() => {
          setCorrectionNotice(
            `Correction saved locally and queued for training: “${sample.predictedSign}” → “${sample.correctedSign}”.`,
          )
        })
        .catch(() => {
          setCorrectionNotice(
            'Correction saved on this device. Cloud training storage is currently unavailable.',
          )
        })

      void createCommunicationDraft(
        sample.correctedSign,
        correctedPrediction,
      )
    } catch (error) {
      setCorrectionNotice(describeError(error))
    } finally {
      setIsSavingCorrection(false)
    }
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
    let active = true

    void Promise.all([
      listRecognitionCorrections(),
      loadPracticeCatalog(),
    ])
      .then(([samples, catalog]) => {
        if (!active) {
          return
        }

        correctionSamplesRef.current = samples
        setCorrectionSigns(
          catalog.references.map((reference) => reference.sign),
        )
      })
      .catch((error: unknown) => {
        if (active) {
          setCorrectionNotice(describeError(error))
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
      basePredictionRef.current = null
      predictionSequenceRef.current = null
      setErrorMessage(null)
      setIsPredicting(false)
      return
    }

    let active = true

    setCommunicationDraft(null)
    setCommunicationError(null)
    setCommunicationNotice(null)
    setCorrectionOpen(false)
    setCorrectionSign('')
    setCorrectionNotice(null)
    setDraftSign(null)
    setErrorMessage(null)
    setIsPredicting(true)
    predictionSequenceRef.current = sequence

    void predictPopsign(sequence.values)
      .then((nextPrediction) => {
        if (active) {
          const correctionMatch = findRecognitionCorrection(
            sequence,
            nextPrediction.sign,
            correctionSamplesRef.current,
          )
          const effectivePrediction = correctionMatch
            ? applyRecognitionCorrection(
                nextPrediction,
                correctionMatch,
              )
            : nextPrediction

          basePredictionRef.current = nextPrediction
          setPrediction(effectivePrediction)

          if (correctionMatch) {
            setCorrectionNotice(
              `Applied your saved correction: “${nextPrediction.sign}” → “${effectivePrediction.sign}”.`,
            )
          }

          if (effectivePrediction.decision !== 'rejected') {
            void createCommunicationDraftRef.current(
              effectivePrediction.sign,
              effectivePrediction,
            )
          } else {
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
                  {prediction.model === 'personal-motion'
                    ? 'Personal correction'
                    : communicationDraft
                      ? 'Caption and voice'
                      : 'Auto voice'}
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

                <div className="popsign-camera-actions">
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

                  <button
                    className="popsign-camera-retry"
                    type="button"
                    disabled={isSavingCorrection}
                    onClick={() => setCorrectionOpen((open) => !open)}
                  >
                    {correctionOpen ? 'Cancel correction' : 'Wrong sign?'}
                  </button>
                </div>

                {correctionOpen && (
                  <form
                    className="popsign-camera-correction"
                    onSubmit={handleSaveCorrection}
                  >
                    <label>
                      <span>What sign did you intend?</span>
                      <select
                        aria-label="Intended sign"
                        value={correctionSign}
                        disabled={isSavingCorrection}
                        onChange={(event) =>
                          setCorrectionSign(event.target.value)
                        }
                      >
                        <option value="">Choose the correct sign</option>
                        {correctionSigns.map((sign) => (
                          <option value={sign} key={sign}>
                            {sign}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      className="popsign-camera-primary-action"
                      type="submit"
                      disabled={
                        isSavingCorrection || !correctionSign
                      }
                    >
                      {isSavingCorrection
                        ? 'Saving correction...'
                        : 'Save and speak correction'}
                    </button>

                    <small>
                      Saves this landmark sequence on your device and
                      submits it as labeled training feedback. No camera
                      image is uploaded.
                    </small>
                  </form>
                )}
              </div>
            ) : (
              <p>Creating the caption and voice automatically.</p>
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
        Accepted signs are captioned and spoken automatically. If a word
        is wrong, use the correction control in the camera panel so the
        captured landmarks become personal memory and training feedback.
      </p>

      <p className="popsign-recognition-status" role="status">
        {!enabled
          ? 'Public recognition is paused while Personalized mode is selected.'
          : practiceActive
            ? 'Practice is active. Its slow guided motion will not be classified.'
            : isTooLong
              ? 'Motion excluded because it exceeded 3 seconds. Perform one sign naturally and lower both hands.'
              : isPredicting
                ? 'Classifying the completed motion...'
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
                    <dt>Model tier</dt>
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

        {correctionNotice && (
          <p className="popsign-communication-notice" role="status">
            {correctionNotice}
          </p>
        )}

        {communicationError && (
          <div className="popsign-communication-error" role="alert">
            <p>{communicationError}</p>

            {prediction && prediction.decision !== 'rejected' && (
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

            <button
              type="button"
              disabled={isSavingCorrection}
              onClick={() => setCorrectionOpen(true)}
            >
              Wrong sign? Save a useful correction
            </button>
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
