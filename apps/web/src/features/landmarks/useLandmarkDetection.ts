import { useEffect, useState, type RefObject } from 'react'
import {
  TEMPORAL_WINDOW_FRAMES,
  type TemporalBufferSnapshot,
} from './TemporalLandmarkBuffer'
import type {
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

type LandmarkDetectionResult = {
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
  const [counts, setCounts] = useState<LandmarkCounts>(EMPTY_COUNTS)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [frame, setFrame] = useState<LandmarkFrame | null>(null)
  const [temporal, setTemporal] = useState<TemporalBufferSnapshot>(
    EMPTY_TEMPORAL_BUFFER,
  )
  const [workerStatus, setWorkerStatus] =
    useState<Exclude<LandmarkStatus, 'idle'>>('loading')

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

    let animationFrameId = 0
    let disposed = false
    let frameInFlight = false
    let lastDetectionAt = 0
    let workerReady = false

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
      worker.terminate()
    }
  }, [enabled, videoRef])

  const status: LandmarkStatus = enabled ? workerStatus : 'idle'

  return {
    counts: enabled ? counts : EMPTY_COUNTS,
    errorMessage: enabled ? errorMessage : null,
    frame: enabled ? frame : null,
    status,
    temporal: enabled ? temporal : EMPTY_TEMPORAL_BUFFER,
  }
}