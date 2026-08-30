import {
  preprocessPopsignFrames,
  type PopsignFrame,
} from './popsignPreprocessor'

const PRE_ROLL_FRAMES = 2
const TRAILING_FRAMES = 2
const END_AFTER_MISSING_FRAMES = 2
const MINIMUM_SEGMENT_FRAMES = 4
const MAXIMUM_SEGMENT_FRAMES = 50

export type CompletedPopsignSegment = {
  durationMs: number
  frameCount: number
  sequenceId: number
  values: Float32Array
}

export class PopsignSegmentBuffer {
  private readonly activeFrames: PopsignFrame[] = []
  private missingHandFrames = 0
  private readonly preRollFrames: PopsignFrame[] = []
  private sequenceId = 0
  private waitingForHandsToClear = false

  add(frame: PopsignFrame): CompletedPopsignSegment | null {
    if (this.waitingForHandsToClear) {
      if (frame.hasHand) {
        this.missingHandFrames = 0
      } else {
        this.missingHandFrames += 1
      }

      if (this.missingHandFrames >= END_AFTER_MISSING_FRAMES) {
        this.waitingForHandsToClear = false
        this.missingHandFrames = 0
        this.rememberPreRoll(frame)
      }

      return null
    }

    if (this.activeFrames.length === 0) {
      this.rememberPreRoll(frame)

      if (frame.hasHand) {
        this.activeFrames.push(...this.preRollFrames)
        this.preRollFrames.length = 0
        this.missingHandFrames = 0
      }

      return null
    }

    this.activeFrames.push(frame)

    if (frame.hasHand) {
      this.missingHandFrames = 0
    } else {
      this.missingHandFrames += 1
    }

    if (this.missingHandFrames >= END_AFTER_MISSING_FRAMES) {
      const removableFrames = Math.max(
        0,
        this.missingHandFrames - TRAILING_FRAMES,
      )
      const completedFrames = this.activeFrames.slice(
        0,
        this.activeFrames.length - removableFrames,
      )

      return this.complete(completedFrames, false)
    }

    if (this.activeFrames.length >= MAXIMUM_SEGMENT_FRAMES) {
      return this.complete([...this.activeFrames], frame.hasHand)
    }

    return null
  }

  clear() {
    this.activeFrames.length = 0
    this.missingHandFrames = 0
    this.preRollFrames.length = 0
    this.waitingForHandsToClear = false
  }

  private complete(
    frames: readonly PopsignFrame[],
    waitForHandsToClear: boolean,
  ): CompletedPopsignSegment | null {
    this.activeFrames.length = 0
    this.missingHandFrames = 0
    this.preRollFrames.length = 0
    this.waitingForHandsToClear = waitForHandsToClear

    if (frames.length < MINIMUM_SEGMENT_FRAMES) {
      return null
    }

    const values = preprocessPopsignFrames(frames)

    if (!values) {
      return null
    }

    const firstFrame = frames[0]
    const lastFrame = frames.at(-1)

    if (!firstFrame || !lastFrame) {
      return null
    }

    this.sequenceId += 1

    return {
      durationMs: Math.max(
        0,
        lastFrame.timestampMs - firstFrame.timestampMs,
      ),
      frameCount: frames.length,
      sequenceId: this.sequenceId,
      values,
    }
  }

  private rememberPreRoll(frame: PopsignFrame) {
    this.preRollFrames.push(frame)

    if (this.preRollFrames.length > PRE_ROLL_FRAMES) {
      this.preRollFrames.shift()
    }
  }
}
