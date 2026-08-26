import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  TEMPORAL_WINDOW_FRAMES,
  type TemporalBufferSnapshot,
} from './TemporalLandmarkBuffer'
import type {
  CapturedSignSequence,
  LandmarkCounts,
  LandmarkFrame,
  LandmarkStatus,
  LandmarkWorkerResponse,
} from './landmarkWorker.types'

const DETECTION_INTERVAL_MS = 100

const EMPTY_COUNTS: LandmarkCounts = {
  face: 0,
  leftHand: 0,
  pose: 0,
  rightHand: 0,
}

const EMPTY_TEMPORAL_BUFFER: TemporalBufferSnapshot = {
  bufferedFrames: 0,
  durationMs: 0,
  progress: 0,
  ready: false,
  targetFrames: TEMPORAL_WINDOW_FRAMES,
}

type PendingCapture = {
  reject: (reason?: unknown) => void
  requestId: string
  resolve: (sequence: CapturedSignSequence) => void
}

type LandmarkDetectionResult = {
  cancelSequenceCapture: () => void
  captureSequence: () => Promise<CapturedSignSequence>
  counts: LandmarkCounts
  errorMessage: string | null
  frame: LandmarkFrame | null
  status: LandmarkStatus
  temporal: TemporalBufferSnapshot
}

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The camera frame could not be analyzed.'
}

export function useLandmarkDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): LandmarkDetectionResult {
  const workerRef = useRef<Worker | null>(null)
  const pendingCaptureRef = useRef<PendingCapture | null>(null)
  const [counts, setCounts] = useState<LandmarkCounts>(EMPTY_COUNTS)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [frame, setFrame] = useState<LandmarkFrame | null>(null)
  const [temporal, setTemporal] = useState<TemporalBufferSnapshot>(
    EMPTY_TEMPORAL_BUFFER,
  )
  const [workerStatus, setWorkerStatus] =
    useState<Exclude<LandmarkStatus, 'idle'>>('loading')

  const captureSequence = useCallback(
    (): Promise<CapturedSignSequence> => {
      const worker = workerRef.current

      if (!worker) {
        return Promise.reject(
          new Error('Turn on the camera before recording an example.'),
        )
      }

      if (pendingCaptureRef.current) {
        return Promise.reject(
          new Error('A sign example is already being recorded.'),
        )
      }

      const requestId = crypto.randomUUID()

      return new Promise<CapturedSignSequence>((resolve, reject) => {
        pendingCaptureRef.current = {
          reject,
          requestId,
          resolve,
        }

        try {
          worker.postMessage({
            type: 'begin-capture',
            requestId,
          })
        } catch (error) {
          pendingCaptureRef.current = null
          reject(
            error instanceof Error
              ? error
              : new Error('The sign recording could not start.'),
          )
        }
      })
    },
    [],
  )

  const cancelSequenceCapture = useCallback(() => {
    const pendingCapture = pendingCaptureRef.current
    const worker = workerRef.current

    if (!pendingCapture) {
      return
    }

    if (!worker) {
      pendingCaptureRef.current = null
      pendingCapture.reject(
        new DOMException('Sign recording cancelled.', 'AbortError'),
      )
      return
    }

    worker.postMessage({
      type: 'cancel-capture',
      requestId: pendingCapture.requestId,
    })
  }, [])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const video = videoRef.current

    if (!video) {
      return
    }

    const activeVideo: HTMLVideoElement = video

    const worker = new Worker(
      new URL('./landmarkWorker.ts', import.meta.url),
      {
        name: 'holistic-landmarks',
        type: 'module',
      },
    )

    workerRef.current = worker

    let animationFrameId = 0
    let disposed = false
    let frameInFlight = false
    let lastDetectionAt = 0
    let workerReady = false

    function rejectPendingCapture(error: Error) {
      const pendingCapture = pendingCaptureRef.current

      if (!pendingCapture) {
        return
      }

      pendingCaptureRef.current = null
      pendingCapture.reject(error)
    }

    function fail(message: string) {
      if (disposed) {
        return
      }

      workerReady = false
      frameInFlight = false
      setWorkerStatus('error')
      setErrorMessage(message)
      setCounts(EMPTY_COUNTS)
      setFrame(null)
      setTemporal(EMPTY_TEMPORAL_BUFFER)
      rejectPendingCapture(new Error(message))
    }

    function handleWorkerMessage(
      event: MessageEvent<LandmarkWorkerResponse>,
    ) {
      switch (event.data.type) {
        case 'loading':
          setWorkerStatus('loading')
          setErrorMessage(null)
          setCounts(EMPTY_COUNTS)
          setFrame(null)
          setTemporal(EMPTY_TEMPORAL_BUFFER)
          break

        case 'ready':
          workerReady = true
          setWorkerStatus('running')
          break

        case 'result':
          frameInFlight = false
          setCounts(event.data.counts)
          setFrame(event.data.landmarks)
          setTemporal(event.data.temporal)
          break

        case 'capture-started':
          break

        case 'capture-completed': {
          const pendingCapture = pendingCaptureRef.current

          if (pendingCapture?.requestId === event.data.requestId) {
            pendingCaptureRef.current = null
            pendingCapture.resolve(event.data.sequence)
          }
          break
        }

        case 'capture-cancelled': {
          const pendingCapture = pendingCaptureRef.current

          if (pendingCapture?.requestId === event.data.requestId) {
            pendingCaptureRef.current = null
            pendingCapture.reject(
              new DOMException('Sign recording cancelled.', 'AbortError'),
            )
          }
          break
        }

        case 'error':
          fail(event.data.message)
          break
      }
    }

    function captureFrame() {
      frameInFlight = true

      void createImageBitmap(activeVideo)
        .then((cameraFrame) => {
          if (disposed) {
            cameraFrame.close()
            return
          }

          try {
            worker.postMessage(
              {
                type: 'detect',
                frame: cameraFrame,
                timestampMs: performance.now(),
              },
              [cameraFrame],
            )
          } catch (error) {
            cameraFrame.close()
            fail(describeError(error))
          }
        })
        .catch((error: unknown) => {
          fail(describeError(error))
        })
    }

    function processFrame(timestamp: number) {
      if (disposed) {
        return
      }

      const intervalElapsed =
        timestamp - lastDetectionAt >= DETECTION_INTERVAL_MS

      if (
        workerReady &&
        !frameInFlight &&
        intervalElapsed &&
        activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        lastDetectionAt = timestamp
        captureFrame()
      }

      animationFrameId = requestAnimationFrame(processFrame)
    }

    worker.addEventListener('message', handleWorkerMessage)
    worker.addEventListener('error', (event) => {
      fail(event.message || 'The landmark worker stopped unexpectedly.')
    })

    worker.postMessage({ type: 'initialize' })
    animationFrameId = requestAnimationFrame(processFrame)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrameId)

      if (workerRef.current === worker) {
        workerRef.current = null
      }

      rejectPendingCapture(
        new Error('The camera stopped before recording finished.'),
      )
      worker.terminate()
    }
  }, [enabled, videoRef])

  const status: LandmarkStatus = enabled ? workerStatus : 'idle'

  return {
    cancelSequenceCapture,
    captureSequence,
    counts: enabled ? counts : EMPTY_COUNTS,
    errorMessage: enabled ? errorMessage : null,
    frame: enabled ? frame : null,
    status,
    temporal: enabled ? temporal : EMPTY_TEMPORAL_BUFFER,
  }
}