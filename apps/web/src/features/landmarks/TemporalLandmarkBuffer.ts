import {
  SIGN_FEATURE_SIZE,
  type SignFeatureFrame,
} from './signFeatureFrame'

export const TEMPORAL_WINDOW_FRAMES = 20

const DEFAULT_MAX_FRAME_GAP_MS = 350

type BufferedFrame = {
  timestampMs: number
  values: Float32Array
}

export type TemporalBufferSnapshot = {
  bufferedFrames: number
  durationMs: number
  progress: number
  ready: boolean
  targetFrames: number
}

export class TemporalLandmarkBuffer {
  private readonly capacity: number
  private readonly frames: BufferedFrame[] = []
  private readonly maxFrameGapMs: number

  constructor(
    capacity = TEMPORAL_WINDOW_FRAMES,
    maxFrameGapMs = DEFAULT_MAX_FRAME_GAP_MS,
  ) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new RangeError('Temporal buffer capacity must be at least two.')
    }

    if (!Number.isFinite(maxFrameGapMs) || maxFrameGapMs <= 0) {
      throw new RangeError('Maximum frame gap must be positive.')
    }

    this.capacity = capacity
    this.maxFrameGapMs = maxFrameGapMs
  }

  add(frame: SignFeatureFrame, timestampMs: number) {
    if (frame.values.length !== SIGN_FEATURE_SIZE) {
      throw new RangeError('The sign feature frame has an invalid size.')
    }

    if (!Number.isFinite(timestampMs)) {
      throw new RangeError('The frame timestamp must be finite.')
    }

    const previousFrame = this.frames.at(-1)

    if (
      previousFrame &&
      timestampMs - previousFrame.timestampMs > this.maxFrameGapMs
    ) {
      this.clear()
    }

    this.frames.push({
      timestampMs,
      values: frame.values,
    })

    if (this.frames.length > this.capacity) {
      this.frames.shift()
    }

    return this.snapshot()
  }

  noteMissing(timestampMs: number) {
    const previousFrame = this.frames.at(-1)

    if (
      previousFrame &&
      timestampMs - previousFrame.timestampMs > this.maxFrameGapMs
    ) {
      this.clear()
    }

    return this.snapshot()
  }

  clear() {
    this.frames.length = 0
  }

  createSequence() {
    if (this.frames.length < this.capacity) {
      return null
    }

    const sequence = new Float32Array(
      this.capacity * SIGN_FEATURE_SIZE,
    )

    this.frames.forEach((frame, index) => {
      sequence.set(frame.values, index * SIGN_FEATURE_SIZE)
    })

    return sequence
  }

  snapshot(): TemporalBufferSnapshot {
    const firstFrame = this.frames[0]
    const lastFrame = this.frames.at(-1)

    return {
      bufferedFrames: this.frames.length,
      durationMs:
        firstFrame && lastFrame
          ? Math.max(0, lastFrame.timestampMs - firstFrame.timestampMs)
          : 0,
      progress: this.frames.length / this.capacity,
      ready: this.frames.length === this.capacity,
      targetFrames: this.capacity,
    }
  }
}