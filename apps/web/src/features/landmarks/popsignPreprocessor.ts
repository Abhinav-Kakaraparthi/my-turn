const LIP_INDICES = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 146, 91, 181, 84, 17, 314, 405, 321, 375,
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
  95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
] as const

const POSE_INDICES = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
] as const

const HAND_LANDMARK_COUNT = 21
const TARGET_FRAME_COUNT = 64
const LANDMARK_COUNT = 94
const CHANNEL_COUNT = 4
const VALUES_PER_FRAME = LANDMARK_COUNT * CHANNEL_COUNT
const LEFT_SHOULDER_OFFSET = 61
const RIGHT_SHOULDER_OFFSET = 62
const MINIMUM_SCALE = 0.0001

export type PopsignLandmarkPoint = {
  x: number
  y: number
  z: number
}

export type PopsignFrameInput = {
  face: readonly PopsignLandmarkPoint[] | undefined
  leftHand: readonly PopsignLandmarkPoint[] | undefined
  pose: readonly PopsignLandmarkPoint[] | undefined
  rightHand: readonly PopsignLandmarkPoint[] | undefined
  timestampMs: number
}

export type PopsignFrame = {
  hasHand: boolean
  timestampMs: number
  values: Float32Array
}

function isFinitePoint(
  point: PopsignLandmarkPoint | undefined,
): point is PopsignLandmarkPoint {
  return Boolean(
    point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z),
  )
}

function writePoint(
  values: Float32Array,
  landmarkOffset: number,
  point: PopsignLandmarkPoint | undefined,
) {
  const offset = landmarkOffset * CHANNEL_COUNT

  if (!isFinitePoint(point)) {
    return
  }

  values[offset] = point.x
  values[offset + 1] = point.y
  values[offset + 2] = point.z
  values[offset + 3] = 1
}

function writeGroup(
  values: Float32Array,
  landmarkOffset: number,
  points: readonly PopsignLandmarkPoint[] | undefined,
  indices: readonly number[],
) {
  indices.forEach((index, groupOffset) => {
    writePoint(values, landmarkOffset + groupOffset, points?.[index])
  })

  return landmarkOffset + indices.length
}

function handIndices() {
  return Array.from(
    { length: HAND_LANDMARK_COUNT },
    (_, index) => index,
  )
}

const HAND_INDICES = handIndices()

export function createPopsignFrame(
  input: PopsignFrameInput,
): PopsignFrame {
  const values = new Float32Array(VALUES_PER_FRAME)
  let landmarkOffset = 0

  landmarkOffset = writeGroup(
    values,
    landmarkOffset,
    input.face,
    LIP_INDICES,
  )
  landmarkOffset = writeGroup(
    values,
    landmarkOffset,
    input.leftHand,
    HAND_INDICES,
  )
  landmarkOffset = writeGroup(
    values,
    landmarkOffset,
    input.pose,
    POSE_INDICES,
  )
  writeGroup(
    values,
    landmarkOffset,
    input.rightHand,
    HAND_INDICES,
  )

  return {
    hasHand:
      (input.leftHand?.length ?? 0) >= HAND_LANDMARK_COUNT ||
      (input.rightHand?.length ?? 0) >= HAND_LANDMARK_COUNT,
    timestampMs: input.timestampMs,
    values,
  }
}

function readPoint(frame: PopsignFrame, landmarkOffset: number) {
  const offset = landmarkOffset * CHANNEL_COUNT

  if (frame.values[offset + 3] !== 1) {
    return null
  }

  return {
    x: frame.values[offset],
    y: frame.values[offset + 1],
    z: frame.values[offset + 2],
  }
}

function median(values: number[]) {
  if (values.length === 0) {
    return Number.NaN
  }

  const sortedValues = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sortedValues.length / 2)

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle]
  }

  return (sortedValues[middle - 1] + sortedValues[middle]) / 2
}

function clampCoordinate(value: number) {
  return Math.max(-5, Math.min(5, value))
}

export function normalizePopsignFrame(frame: PopsignFrame) {
  const leftShoulder = readPoint(frame, LEFT_SHOULDER_OFFSET)
  const rightShoulder = readPoint(frame, RIGHT_SHOULDER_OFFSET)

  if (!leftShoulder || !rightShoulder) {
    return null
  }

  const centerX = (leftShoulder.x + rightShoulder.x) / 2
  const centerY = (leftShoulder.y + rightShoulder.y) / 2
  const centerZ = (leftShoulder.z + rightShoulder.z) / 2
  const scale = Math.hypot(
    leftShoulder.x - rightShoulder.x,
    leftShoulder.y - rightShoulder.y,
    leftShoulder.z - rightShoulder.z,
  )

  if (!Number.isFinite(scale) || scale < MINIMUM_SCALE) {
    return null
  }

  const normalized = new Float32Array(VALUES_PER_FRAME)

  for (
    let landmarkOffset = 0;
    landmarkOffset < LANDMARK_COUNT;
    landmarkOffset += 1
  ) {
    const point = readPoint(frame, landmarkOffset)

    if (!point) {
      continue
    }

    const offset = landmarkOffset * CHANNEL_COUNT

    normalized[offset] = clampCoordinate(
      (point.x - centerX) / scale,
    )
    normalized[offset + 1] = clampCoordinate(
      (point.y - centerY) / scale,
    )
    normalized[offset + 2] = clampCoordinate(
      (point.z - centerZ) / scale,
    )
    normalized[offset + 3] = 1
  }

  return normalized
}

function selectFrameIndex(targetIndex: number, sourceCount: number) {
  if (sourceCount === 1) {
    return 0
  }

  return Math.round(
    (targetIndex * (sourceCount - 1)) / (TARGET_FRAME_COUNT - 1),
  )
}

export function preprocessPopsignFrames(
  frames: readonly PopsignFrame[],
) {
  if (frames.length < 2) {
    return null
  }

  const centerXValues: number[] = []
  const centerYValues: number[] = []
  const centerZValues: number[] = []
  const shoulderWidths: number[] = []

  frames.forEach((frame) => {
    const leftShoulder = readPoint(frame, LEFT_SHOULDER_OFFSET)
    const rightShoulder = readPoint(frame, RIGHT_SHOULDER_OFFSET)

    if (!leftShoulder || !rightShoulder) {
      return
    }

    centerXValues.push((leftShoulder.x + rightShoulder.x) / 2)
    centerYValues.push((leftShoulder.y + rightShoulder.y) / 2)
    centerZValues.push((leftShoulder.z + rightShoulder.z) / 2)
    shoulderWidths.push(
      Math.hypot(
        leftShoulder.x - rightShoulder.x,
        leftShoulder.y - rightShoulder.y,
        leftShoulder.z - rightShoulder.z,
      ),
    )
  })

  const centerX = median(centerXValues)
  const centerY = median(centerYValues)
  const centerZ = median(centerZValues)
  const scale = median(shoulderWidths)

  if (
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(centerZ) ||
    !Number.isFinite(scale) ||
    scale < MINIMUM_SCALE
  ) {
    return null
  }

  const sequence = new Float32Array(
    TARGET_FRAME_COUNT * VALUES_PER_FRAME,
  )

  for (
    let targetFrame = 0;
    targetFrame < TARGET_FRAME_COUNT;
    targetFrame += 1
  ) {
    const sourceFrame = frames[
      selectFrameIndex(targetFrame, frames.length)
    ]

    for (
      let landmarkOffset = 0;
      landmarkOffset < LANDMARK_COUNT;
      landmarkOffset += 1
    ) {
      const sourceOffset = landmarkOffset * CHANNEL_COUNT
      const targetOffset =
        targetFrame * VALUES_PER_FRAME + sourceOffset

      if (sourceFrame.values[sourceOffset + 3] !== 1) {
        continue
      }

      sequence[targetOffset] = clampCoordinate(
        (sourceFrame.values[sourceOffset] - centerX) / scale,
      )
      sequence[targetOffset + 1] = clampCoordinate(
        (sourceFrame.values[sourceOffset + 1] - centerY) / scale,
      )
      sequence[targetOffset + 2] = clampCoordinate(
        (sourceFrame.values[sourceOffset + 2] - centerZ) / scale,
      )
      sequence[targetOffset + 3] = 1
    }
  }

  return sequence
}
