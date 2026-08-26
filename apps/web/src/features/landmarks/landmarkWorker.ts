/// <reference lib="webworker" />

import type { HolisticLandmarker } from '@mediapipe/tasks-vision'
import { createHolisticLandmarker } from './createHolisticLandmarker'
import type {
  LandmarkWorkerRequest,
  LandmarkWorkerResponse,
} from './landmarkWorker.types'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

let landmarker: HolisticLandmarker | null = null
let initialization: Promise<HolisticLandmarker> | null = null

async function getLandmarker() {
  if (landmarker) {
    return landmarker
  }

  initialization ??= createHolisticLandmarker()

  try {
    landmarker = await initialization
    return landmarker
  } catch (error) {
    initialization = null
    throw error
  }
}

function send(message: LandmarkWorkerResponse) {
  workerScope.postMessage(message)
}

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Landmark detection failed unexpectedly.'
}

async function detectFrame(frame: ImageBitmap, timestampMs: number) {
  try {
    const detector = await getLandmarker()
    const result = detector.detectForVideo(frame, timestampMs)

    send({
      type: 'result',
      timestampMs,
      counts: {
        face: result.faceLandmarks[0]?.length ?? 0,
        leftHand: result.leftHandLandmarks[0]?.length ?? 0,
        pose: result.poseLandmarks[0]?.length ?? 0,
        rightHand: result.rightHandLandmarks[0]?.length ?? 0,
      },
    })
  } finally {
    frame.close()
  }
}

async function handleMessage(message: LandmarkWorkerRequest) {
  switch (message.type) {
    case 'initialize':
      send({ type: 'loading' })
      await getLandmarker()
      send({ type: 'ready' })
      break

    case 'detect':
      await detectFrame(message.frame, message.timestampMs)
      break
  }
}

workerScope.addEventListener(
  'message',
  (event: MessageEvent<LandmarkWorkerRequest>) => {
    void handleMessage(event.data).catch((error: unknown) => {
      send({
        type: 'error',
        message: describeError(error),
      })
    })
  },
)
