/// <reference lib="webworker" />

import type { HolisticLandmarker } from '@mediapipe/tasks-vision'
import { createHolisticLandmarker } from './createHolisticLandmarker'
import {
  createSignFeatureFrame,
  SIGN_FEATURE_SCHEMA_VERSION,
  SIGN_FEATURE_SIZE,
} from './signFeatureFrame'
import { TemporalLandmarkBuffer } from './TemporalLandmarkBuffer'
import type {
  LandmarkFrame,
  LandmarkWorkerRequest,
  LandmarkWorkerResponse,
} from './landmarkWorker.types'

const workerScope = self as unknown as DedicatedWorkerGlobalScope
const temporalBuffer = new TemporalLandmarkBuffer()

let activeCaptureId: string | null = null
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

function beginCapture(requestId: string) {
  if (activeCaptureId) {
    send({
      type: 'capture-cancelled',
      requestId: activeCaptureId,
    })
  }

  activeCaptureId = requestId
  temporalBuffer.clear()

  send({
    type: 'capture-started',
    requestId,
  })
}

function cancelCapture(requestId: string) {
  if (activeCaptureId !== requestId) {
    return
  }

  activeCaptureId = null
  temporalBuffer.clear()

  send({
    type: 'capture-cancelled',
    requestId,
  })
}

function completeCaptureIfReady(
  ready: boolean,
  frameCount: number,
) {
  if (!ready || !activeCaptureId) {
    return
  }

  const values = temporalBuffer.createSequence()

  if (!values) {
    return
  }

  const requestId = activeCaptureId
  activeCaptureId = null

  send({
    type: 'capture-completed',
    requestId,
    sequence: {
      featureSize: SIGN_FEATURE_SIZE,
      frameCount,
      schemaVersion: SIGN_FEATURE_SCHEMA_VERSION,
      values,
    },
  })
}

async function detectFrame(frame: ImageBitmap, timestampMs: number) {
  try {
    const detector = await getLandmarker()
    const result = detector.detectForVideo(frame, timestampMs)

    const featureFrame = createSignFeatureFrame({
      face: result.faceLandmarks[0],
      leftHand: result.leftHandLandmarks[0],
      pose: result.poseLandmarks[0],
      rightHand: result.rightHandLandmarks[0],
    })

    const temporal = featureFrame
      ? temporalBuffer.add(featureFrame, timestampMs)
      : temporalBuffer.noteMissing(timestampMs)

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
      temporal,
      counts: {
        face: countPoints(landmarks.face),
        leftHand: countPoints(landmarks.leftHand),
        pose: countPoints(landmarks.pose),
        rightHand: countPoints(landmarks.rightHand),
      },
    })

    completeCaptureIfReady(
      temporal.ready,
      temporal.targetFrames,
    )
  } finally {
    frame.close()
  }
}

async function handleMessage(message: LandmarkWorkerRequest) {
  switch (message.type) {
    case 'initialize':
      activeCaptureId = null
      temporalBuffer.clear()
      send({ type: 'loading' })
      await getLandmarker()
      send({ type: 'ready' })
      break

    case 'detect':
      await detectFrame(message.frame, message.timestampMs)
      break

    case 'begin-capture':
      beginCapture(message.requestId)
      break

    case 'cancel-capture':
      cancelCapture(message.requestId)
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