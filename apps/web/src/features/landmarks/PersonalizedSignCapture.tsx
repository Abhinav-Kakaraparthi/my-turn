import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import type { TemporalBufferSnapshot } from './TemporalLandmarkBuffer'
import type { CapturedSignSequence } from './landmarkWorker.types'
import { PersonalizedSignRecognition } from './PersonalizedSignRecognition'
import {
  deletePersonalizedSign,
  listPersonalizedSigns,
  savePersonalizedSign,
  type PersonalizedSignSample,
} from './personalizedSignStore'
import './PersonalizedSignCapture.css'

type PersonalizedSignCaptureProps = {
  cameraActive: boolean
  cancelCapture: () => void
  captureSequence: () => Promise<CapturedSignSequence>
  perceptionReady: boolean
  temporal: TemporalBufferSnapshot
}

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The personalized sign library could not be updated.'
}

function isCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function formatCapturedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function PersonalizedSignCapture({
  cameraActive,
  cancelCapture,
  captureSequence,
  perceptionReady,
  temporal,
}: PersonalizedSignCaptureProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [phrase, setPhrase] = useState('')
  const [samples, setSamples] = useState<PersonalizedSignSample[]>([])

  useEffect(() => {
    let active = true

    void listPersonalizedSigns()
      .then((storedSamples) => {
        if (active) {
          setSamples(storedSamples)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(describeError(error))
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  async function handleRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const intendedPhrase = phrase.trim()

    if (!intendedPhrase) {
      setErrorMessage('Enter the intended phrase before recording.')
      return
    }

    setErrorMessage(null)
    setNotice(null)
    setIsRecording(true)

    try {
      const sequence = await captureSequence()
      const sample = await savePersonalizedSign(
        intendedPhrase,
        sequence,
      )

      setSamples((currentSamples) => [sample, ...currentSamples])
      setNotice(`Saved one local example for “${sample.phrase}”.`)
    } catch (error) {
      if (isCancellation(error)) {
        setNotice('Recording cancelled.')
      } else {
        setErrorMessage(describeError(error))
      }
    } finally {
      setIsRecording(false)
    }
  }

  function handleRecognitionActiveChange(active: boolean) {
    setIsRecognizing(active)

    if (active) {
      setErrorMessage(null)
      setNotice(null)
    }
  }

  async function handleSaveFeedback(
    intendedPhrase: string,
    sequence: CapturedSignSequence,
  ) {
    setErrorMessage(null)
    setNotice(null)

    const sample = await savePersonalizedSign(
      intendedPhrase,
      sequence,
    )

    setSamples((currentSamples) => [sample, ...currentSamples])

    return sample
  }
  async function handleDelete(sample: PersonalizedSignSample) {
    setDeletingId(sample.id)
    setErrorMessage(null)
    setNotice(null)

    try {
      await deletePersonalizedSign(sample.id)
      setSamples((currentSamples) =>
        currentSamples.filter(
          (currentSample) => currentSample.id !== sample.id,
        ),
      )
      setNotice(`Deleted one example for “${sample.phrase}”.`)
    } catch (error) {
      setErrorMessage(describeError(error))
    } finally {
      setDeletingId(null)
    }
  }

  const canRecord = cameraActive && perceptionReady

  return (
    <section
      className="personalized-capture"
      aria-labelledby="personalized-capture-title"
    >
      <div className="personalized-capture-copy">
        <p className="section-label">Personalized signing</p>
        <h3 id="personalized-capture-title">
          Teach My Turn your signing style.
        </h3>
        <p>
          Add a phrase, start recording, and perform the sign naturally.
          My Turn saves normalized landmarks on this device, not video.
        </p>
      </div>

      <div className="personalized-capture-workspace">
        <form className="capture-form" onSubmit={handleRecord}>
          <label htmlFor="personalized-sign-phrase">
            Intended phrase
          </label>

          <input
            id="personalized-sign-phrase"
            type="text"
            autoComplete="off"
            maxLength={120}
            placeholder="Hello, my name is Abhinav."
            value={phrase}
            disabled={isRecording}
            onChange={(event) => setPhrase(event.target.value)}
          />

          <div className="capture-actions">
            <button
              className="capture-record-button"
              type="submit"
              disabled={!canRecord || isRecording || isRecognizing}
            >
              {isRecording
                ? `Recording ${temporal.bufferedFrames}/${temporal.targetFrames}…`
                : 'Record example'}
            </button>

            {isRecording && (
              <button
                className="capture-cancel-button"
                type="button"
                onClick={cancelCapture}
              >
                Cancel
              </button>
            )}
          </div>

          {!cameraActive && (
            <p className="capture-guidance">
              Turn on the camera to record a personalized example.
            </p>
          )}

          {cameraActive && !perceptionReady && (
            <p className="capture-guidance">
              Wait for the local perception model to finish loading.
            </p>
          )}

          {isRecording && (
            <p className="capture-guidance" role="status">
              Keep your face, upper body, and signing hand visible until
              the motion window is complete.
            </p>
          )}
        </form>

        <div className="personalized-library">
          <div className="personalized-library-heading">
            <h4>Your local examples</h4>
            <span>{samples.length}</span>
          </div>

          {isLoading && (
            <p className="personalized-library-empty">
              Loading local examples…
            </p>
          )}

          {!isLoading && samples.length === 0 && (
            <p className="personalized-library-empty">
              No examples saved yet.
            </p>
          )}

          {samples.length > 0 && (
            <ul>
              {samples.map((sample) => (
                <li key={sample.id}>
                  <div>
                    <strong>{sample.phrase}</strong>
                    <span>
                      {sample.frameCount} frames ·{' '}
                      <time dateTime={sample.capturedAt}>
                        {formatCapturedAt(sample.capturedAt)}
                      </time>
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={deletingId === sample.id}
                    aria-label={`Delete example for ${sample.phrase}`}
                    onClick={() => void handleDelete(sample)}
                  >
                    {deletingId === sample.id ? 'Deleting…' : 'Delete'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <PersonalizedSignRecognition
          cameraActive={cameraActive}
          cancelCapture={cancelCapture}
          captureSequence={captureSequence}
          disabled={isRecording}
          onActiveChange={handleRecognitionActiveChange}
          onSaveFeedback={handleSaveFeedback}
          perceptionReady={perceptionReady}
          samples={samples}
          temporal={temporal}
        />

        {notice && (
          <p className="capture-notice" role="status">
            {notice}
          </p>
        )}

        {errorMessage && (
          <p className="capture-error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </section>
  )
}