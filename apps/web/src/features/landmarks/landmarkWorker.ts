/// <reference lib="webworker" />

import type { HolisticLandmarker } from '@mediapipe/tasks-vision'
import { createHolisticLandmarker } from './createHolisticLandmarker'
import type {
  LandmarkFrame,
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

function packCoordinates(
  landmarks: readonly { x: number; y: number }[] | undefined,
) {
  const coordinates = new Float32Array((landmarks?.length ?? 0) * 2)

  landmarks?.forEach((landmark, index) => {
    coordinates[index * 2] = landmark.x
    coordinates[index * 2 + 1] = landmark.y
  })

  return coordinates
}

function countPoints(coordinates: Float32Array) {
  return coordinates.length / 2
}

async function detectFrame(frame: ImageBitmap, timestampMs: number) {
  try {
    const detector = await getLandmarker()
    const result = detector.detectForVideo(frame, timestampMs)

    const landmarks: LandmarkFrame = {
      face: packCoordinates(result.faceLandmarks[0]),
      leftHand: packCoordinates(result.leftHandLandmarks[0]),
      pose: packCoordinates(result.poseLandmarks[0]),
      rightHand: packCoordinates(result.rightHandLandmarks[0]),
    }

    send({
      type: 'result',
      timestampMs,
      landmarks,
      counts: {
        face: countPoints(landmarks.face),
        leftHand: countPoints(landmarks.leftHand),
        pose: countPoints(landmarks.pose),
        rightHand: countPoints(landmarks.rightHand),
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