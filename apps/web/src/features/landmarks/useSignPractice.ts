import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LandmarkFrame } from './landmarkWorker.types'
import {
  loadPracticeReference,
  type LoadedPracticeReference,
} from './practiceCatalog'
import {
  PRACTICE_FRAME_COUNT,
  PRACTICE_VALUES_PER_FRAME,
} from './practiceReference'
import {
  calculatePracticeFeedback,
  type PracticeFeedback,
} from './practiceFeedback'

const PLAYBACK_FRAME_INTERVAL_MS = 75
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

export type SignPracticeStatus = 'loading' | 'ready' | 'error'

export type SignPracticeController = {
  active: boolean
  errorMessage: string | null
  feedback: PracticeFeedback | null
  frameIndex: number
  restart: () => void
  sign: string
  status: SignPracticeStatus
  targetFrame: Float32Array | null
  toggle: () => void
}

type LoadedState = {
  reference: LoadedPracticeReference
  sign: string
}

type ErrorState = {
  message: string
  sign: string
}

function describeError(error: unknown, sign: string) {
  return error instanceof Error
    ? error.message
    : `The ${sign} practice reference could not be loaded.`
}

export function useSignPractice(
  frame: LandmarkFrame | null,
  cameraReady: boolean,
  sign: string,
): SignPracticeController {
  const normalizedSign = sign.trim().toLowerCase()
  const [active, setActive] = useState(false)
  const [errorState, setErrorState] = useState<ErrorState | null>(null)
  const [loadedState, setLoadedState] = useState<LoadedState | null>(null)
  const [playbackIndex, setPlaybackIndex] = useState(0)

  useEffect(() => {
    let mounted = true
    const resetTimer = window.setTimeout(() => {
      setActive(false)
      setPlaybackIndex(0)
    }, 0)

    void loadPracticeReference(normalizedSign)
      .then((reference) => {
        if (!mounted) {
          return
        }

        setLoadedState({ reference, sign: normalizedSign })
        setErrorState(null)
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return
        }

        setErrorState({
          message: describeError(error, normalizedSign),
          sign: normalizedSign,
        })
      })

    return () => {
      mounted = false
      window.clearTimeout(resetTimer)
    }
  }, [normalizedSign])

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

  const reference =
    loadedState?.sign === normalizedSign
      ? loadedState.reference
      : null
  const errorMessage =
    errorState?.sign === normalizedSign
      ? errorState.message
      : null
  const status: SignPracticeStatus = reference
    ? 'ready'
    : errorMessage
      ? 'error'
      : 'loading'

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
  const targetFrame = useMemo(() => {
    if (!reference) {
      return null
    }

    const start = frameIndex * PRACTICE_VALUES_PER_FRAME
    return reference.values.subarray(
      start,
      start + PRACTICE_VALUES_PER_FRAME,
    )
  }, [frameIndex, reference])
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
    restart,
    sign: normalizedSign,
    status,
    targetFrame,
    toggle,
  }
}
