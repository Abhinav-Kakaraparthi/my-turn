import {
  PRACTICE_CHANNEL_COUNT,
  PRACTICE_VALUES_PER_FRAME,
} from './practiceReference'

const LEFT_HAND_OFFSET = 40
const RIGHT_HAND_OFFSET = 73
const HAND_LANDMARK_COUNT = 21
const MIDDLE_FINGER_MCP = 9

type Point = {
  x: number
  y: number
  z: number
}

export type PracticeFeedback = {
  activeHand: 'Left hand' | 'Right hand'
  depthScore: number
  handshapeScore: number
  instruction: string
  locationScore: number
  overallScore: number
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value))
}

function readPoint(values: Float32Array, landmarkOffset: number) {
  const offset = landmarkOffset * PRACTICE_CHANNEL_COUNT

  if (values[offset + 3] !== 1) {
    return null
  }

  return {
    x: values[offset],
    y: values[offset + 1],
    z: values[offset + 2],
  }
}

function countValidHandPoints(values: Float32Array, handOffset: number) {
  let count = 0

  for (let index = 0; index < HAND_LANDMARK_COUNT; index += 1) {
    if (readPoint(values, handOffset + index)) {
      count += 1
    }
  }

  return count
}

function distance(left: Point, right: Point) {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  )
}

function relativeHandshapeError(
  current: Float32Array,
  target: Float32Array,
  handOffset: number,
) {
  const currentWrist = readPoint(current, handOffset)
  const targetWrist = readPoint(target, handOffset)
  const currentMiddleMcp = readPoint(
    current,
    handOffset + MIDDLE_FINGER_MCP,
  )
  const targetMiddleMcp = readPoint(
    target,
    handOffset + MIDDLE_FINGER_MCP,
  )

  if (
    !currentWrist ||
    !targetWrist ||
    !currentMiddleMcp ||
    !targetMiddleMcp
  ) {
    return Number.POSITIVE_INFINITY
  }

  const currentScale = distance(currentWrist, currentMiddleMcp)
  const targetScale = distance(targetWrist, targetMiddleMcp)

  if (currentScale < 0.0001 || targetScale < 0.0001) {
    return Number.POSITIVE_INFINITY
  }

  let error = 0
  let comparedPoints = 0

  for (let index = 1; index < HAND_LANDMARK_COUNT; index += 1) {
    const currentPoint = readPoint(current, handOffset + index)
    const targetPoint = readPoint(target, handOffset + index)

    if (!currentPoint || !targetPoint) {
      continue
    }

    const currentRelative = {
      x: (currentPoint.x - currentWrist.x) / currentScale,
      y: (currentPoint.y - currentWrist.y) / currentScale,
      z: (currentPoint.z - currentWrist.z) / currentScale,
    }
    const targetRelative = {
      x: (targetPoint.x - targetWrist.x) / targetScale,
      y: (targetPoint.y - targetWrist.y) / targetScale,
      z: (targetPoint.z - targetWrist.z) / targetScale,
    }

    error += distance(currentRelative, targetRelative)
    comparedPoints += 1
  }

  return comparedPoints >= 12
    ? error / comparedPoints
    : Number.POSITIVE_INFINITY
}

export function calculatePracticeFeedback(
  current: Float32Array,
  target: Float32Array,
): PracticeFeedback | null {
  if (
    current.length !== PRACTICE_VALUES_PER_FRAME ||
    target.length !== PRACTICE_VALUES_PER_FRAME
  ) {
    return null
  }

  const targetLeftCount = countValidHandPoints(target, LEFT_HAND_OFFSET)
  const targetRightCount = countValidHandPoints(target, RIGHT_HAND_OFFSET)
  const handOffset =
    targetRightCount >= targetLeftCount
      ? RIGHT_HAND_OFFSET
      : LEFT_HAND_OFFSET
  const activeHand =
    handOffset === RIGHT_HAND_OFFSET ? 'Right hand' : 'Left hand'
  const currentCount = countValidHandPoints(current, handOffset)

  if (currentCount < 12) {
    return {
      activeHand,
      depthScore: 0,
      handshapeScore: 0,
      instruction: `Show your ${activeHand.toLowerCase()} and place it over the green guide.`,
      locationScore: 0,
      overallScore: 0,
    }
  }

  const currentWrist = readPoint(current, handOffset)
  const targetWrist = readPoint(target, handOffset)

  if (!currentWrist || !targetWrist) {
    return null
  }

  const deltaX = targetWrist.x - currentWrist.x
  const deltaY = targetWrist.y - currentWrist.y
  const deltaZ = targetWrist.z - currentWrist.z
  const locationError = Math.hypot(deltaX, deltaY, deltaZ * 0.4)
  const handshapeError = relativeHandshapeError(
    current,
    target,
    handOffset,
  )
  const locationScore = Math.exp(-locationError * 2.1)
  const handshapeScore = Number.isFinite(handshapeError)
    ? Math.exp(-handshapeError * 1.8)
    : 0
  const depthScore = Math.exp(-Math.abs(deltaZ) * 3)
  const overallScore = clampScore(
    handshapeScore * 0.55 +
      locationScore * 0.3 +
      depthScore * 0.15,
  )

  let instruction = 'Good match. Keep following the green guide.'

  if (handshapeScore < 0.68) {
    instruction = 'Match the green finger shape and palm angle.'
  } else if (Math.abs(deltaZ) > 0.24) {
    instruction =
      deltaZ < 0
        ? 'Move your hand closer to the camera.'
        : 'Move your hand slightly farther from the camera.'
  } else if (Math.abs(deltaY) > 0.2) {
    instruction =
      deltaY < 0
        ? 'Raise your hand toward the green guide.'
        : 'Lower your hand toward the green guide.'
  } else if (Math.abs(deltaX) > 0.2) {
    instruction = 'Move your hand sideways onto the green guide.'
  }

  return {
    activeHand,
    depthScore: clampScore(depthScore),
    handshapeScore: clampScore(handshapeScore),
    instruction,
    locationScore: clampScore(locationScore),
    overallScore,
  }
}
