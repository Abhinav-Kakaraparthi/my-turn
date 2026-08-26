export type LandmarkCounts = {
  face: number
  leftHand: number
  pose: number
  rightHand: number
}

export type LandmarkStatus = 'idle' | 'loading' | 'running' | 'error'

export type LandmarkWorkerRequest =
  | { type: 'initialize' }
  | { type: 'detect'; frame: ImageBitmap; timestampMs: number }

export type LandmarkWorkerResponse =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'result'; counts: LandmarkCounts; timestampMs: number }
  | { type: 'error'; message: string }
