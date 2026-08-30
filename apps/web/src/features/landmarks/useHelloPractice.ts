import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LandmarkFrame } from './landmarkWorker.types'
import {
  getPracticeReferenceFrame,
  loadHelloPracticeReference,
  PRACTICE_FRAME_COUNT,
  type PracticeReference,
} from './practiceReference'
import {
  calculatePracticeFeedback,
  type PracticeFeedback,
} from './practiceFeedback'

const PLAYBACK_FRAME_INTERVAL_MS = 125
const START_HOLD_TICKS = 6
const FINISH_HOLD_TICKS = 8
const PLAYBACK_FRAMES = [
  ...Array.from({ length: START_HOLD_TICKS }, () => 0),
  ...Array.from(
    { length: PRACTICE_FRAME_COUNT },
    (_, index) => index,
  ),
  ...Array.from(
    { length: FINISH_HOLD_TICKS },
    () => PRACTICE_FRAME_COUNT - 1,
  ),
]

export type HelloPracticeStatus =
  | 'loading'
  | 'ready'
  | 'error'

export type HelloPracticeController = {
  active: boolean
  errorMessage: string | null
  feedback: PracticeFeedback | null
  frameIndex: number
  referenceConfidence: number | null
  restart: () => void
  status: HelloPracticeStatus
  targetFrame: Float32Array | null
  toggle: () => void
}

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The hello practice reference could not be loaded.'
}

export function useHelloPractice(
  frame: LandmarkFrame | null,
  cameraReady: boolean,
): HelloPracticeController {
  const [active, setActive] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [reference, setReference] =
    useState<PracticeReference | null>(null)
  const [status, setStatus] =
    useState<HelloPracticeStatus>('loading')

  useEffect(() => {
    let mounted = true

    void loadHelloPracticeReference()
      .then((nextReference) => {
        if (!mounted) {
          return
        }

        setReference(nextReference)
        setStatus('ready')
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return
        }

        setReference(null)
        setStatus('error')
        setErrorMessage(describeError(error))
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (cameraReady) {
      return
    }

    const resetTimer = window.setTimeout(() => {
      setActive(false)
      setPlaybackIndex(0)
    }, 0)

    return () => {
      window.clearTimeout(resetTimer)
    }
  }, [cameraReady])

  useEffect(() => {
    if (!active || !reference || !cameraReady) {
      return
    }

    const interval = window.setInterval(() => {
      setPlaybackIndex((currentIndex) =>
        (currentIndex + 1) % PLAYBACK_FRAMES.length,
      )
    }, PLAYBACK_FRAME_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [active, cameraReady, reference])

  const frameIndex = PLAYBACK_FRAMES[playbackIndex] ?? 0
  const targetFrame = useMemo(
    () =>
      reference
        ? getPracticeReferenceFrame(reference, frameIndex)
        : null,
    [frameIndex, reference],
  )
  const feedback = useMemo(
    () =>
      frame?.practice && targetFrame
        ? calculatePracticeFeedback(frame.practice, targetFrame)
        : null,
    [frame, targetFrame],
  )

  const toggle = useCallback(() => {
    if (!cameraReady || status !== 'ready') {
      return
    }

    setActive((currentActive) => {
      if (!currentActive) {
        setPlaybackIndex(0)
      }

      return !currentActive
    })
  }, [cameraReady, status])

  const restart = useCallback(() => {
    setPlaybackIndex(0)
    setActive(cameraReady && status === 'ready')
  }, [cameraReady, status])

  return {
    active,
    errorMessage,
    feedback,
    frameIndex,
    referenceConfidence:
      reference?.manifest.modelConfidence ?? null,
    restart,
    status,
    targetFrame,
    toggle,
  }
}
