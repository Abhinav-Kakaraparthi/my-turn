import type { TemporalBufferSnapshot } from './TemporalLandmarkBuffer'

export type CapturedSignSequence = {
  featureSize: number
  frameCount: number
  schemaVersion: string
  values: Float32Array
}

export type CapturedPopsignSequence = {
  durationMs: number
  frameCount: number
  sequenceId: number
  values: Float32Array
}

export type LandmarkCounts = {
  face: number
  leftHand: number
  pose: number
  rightHand: number
}

export type LandmarkFrame = {
  face: Float32Array
  leftHand: Float32Array
  pose: Float32Array
  practice: Float32Array
  rightHand: Float32Array
}

export type LandmarkStatus = 'idle' | 'loading' | 'running' | 'error'

export type LandmarkWorkerRequest =
  | { type: 'initialize' }
  | { type: 'detect'; frame: ImageBitmap; timestampMs: number }
  | { type: 'begin-capture'; requestId: string }
  | { type: 'cancel-capture'; requestId: string }

export type LandmarkWorkerResponse =
  | { type: 'loading' }
  | { type: 'ready' }
  | {
      type: 'result'
      counts: LandmarkCounts
      landmarks: LandmarkFrame
      temporal: TemporalBufferSnapshot
      timestampMs: number
    }
  | { type: 'capture-started'; requestId: string }
  | {
      type: 'capture-completed'
      requestId: string
      sequence: CapturedSignSequence
    }
  | {
      type: 'popsign-segment-completed'
      sequence: CapturedPopsignSequence
    }
  | { type: 'capture-cancelled'; requestId: string }
  | { type: 'error'; message: string }
