export const SIGN_FEATURE_SCHEMA_VERSION = 'my-turn.holistic.v1'

const HAND_LANDMARK_COUNT = 21

const POSE_INDICES = [0, 11, 12, 13, 14, 15, 16] as const

const FACE_INDICES = [
  0,
  13,
  14,
  17,
  61,
  78,
  82,
  87,
  291,
  308,
  312,
  317,
  33,
  133,
  362,
  263,
  70,
  63,
  105,
  66,
  107,
  336,
  296,
  334,
  293,
  300,
] as const

const HAND_INDICES = Array.from(
  { length: HAND_LANDMARK_COUNT },
  (_, index) => index,
)

const COORDINATES_PER_LANDMARK = 3
const PRESENCE_VALUE_COUNT = 2

export const SIGN_FEATURE_SIZE =
  (POSE_INDICES.length +
    FACE_INDICES.length +
    HAND_LANDMARK_COUNT * 2) *
    COORDINATES_PER_LANDMARK +
  PRESENCE_VALUE_COUNT

export type LandmarkPoint3D = {
  x: number
  y: number
  z: number
}

export type SignFeatureInput = {
  face: readonly LandmarkPoint3D[] | undefined
  leftHand: readonly LandmarkPoint3D[] | undefined
  pose: readonly LandmarkPoint3D[] | undefined
  rightHand: readonly LandmarkPoint3D[] | undefined
}

export type SignFeatureFrame = {
  hasLeftHand: boolean
  hasRightHand: boolean
  values: Float32Array
}

function hasLandmarks(
  landmarks: readonly LandmarkPoint3D[] | undefined,
  indices: readonly number[],
) {
  return Boolean(
    landmarks &&
      indices.every((index) => landmarks[index] !== undefined),
  )
}

function sanitize(value: number) {
  return Number.isFinite(value) ? value : 0
}

function writeLandmark(
  values: Float32Array,
  offset: number,
  landmark: LandmarkPoint3D | undefined,
  origin: LandmarkPoint3D,
  scale: number,
) {
  if (!landmark) {
    values[offset] = 0
    values[offset + 1] = 0
    values[offset + 2] = 0
    return offset + COORDINATES_PER_LANDMARK
  }

  values[offset] = sanitize((landmark.x - origin.x) / scale)
  values[offset + 1] = sanitize((landmark.y - origin.y) / scale)
  values[offset + 2] = sanitize((landmark.z - origin.z) / scale)

  return offset + COORDINATES_PER_LANDMARK
}

function writeGroup(
  values: Float32Array,
  offset: number,
  landmarks: readonly LandmarkPoint3D[] | undefined,
  indices: readonly number[],
  origin: LandmarkPoint3D,
  scale: number,
) {
  let nextOffset = offset

  indices.forEach((index) => {
    nextOffset = writeLandmark(
      values,
      nextOffset,
      landmarks?.[index],
      origin,
      scale,
    )
  })

  return nextOffset
}

export function createSignFeatureFrame(
  input: SignFeatureInput,
): SignFeatureFrame | null {
  const hasPose = hasLandmarks(input.pose, POSE_INDICES)
  const hasFace = hasLandmarks(input.face, FACE_INDICES)
  const hasLeftHand =
    (input.leftHand?.length ?? 0) >= HAND_LANDMARK_COUNT
  const hasRightHand =
    (input.rightHand?.length ?? 0) >= HAND_LANDMARK_COUNT

  if (
    !hasPose ||
    !hasFace ||
    (!hasLeftHand && !hasRightHand) ||
    !input.pose
  ) {
    return null
  }

  const leftShoulder = input.pose[11]
  const rightShoulder = input.pose[12]

  const origin: LandmarkPoint3D = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: (leftShoulder.z + rightShoulder.z) / 2,
  }

  const scale = Math.hypot(
    leftShoulder.x - rightShoulder.x,
    leftShoulder.y - rightShoulder.y,
    leftShoulder.z - rightShoulder.z,
  )

  if (!Number.isFinite(scale) || scale < 0.0001) {
    return null
  }

  const values = new Float32Array(SIGN_FEATURE_SIZE)
  let offset = 0

  offset = writeGroup(
    values,
    offset,
    input.pose,
    POSE_INDICES,
    origin,
    scale,
  )
  offset = writeGroup(
    values,
    offset,
    input.face,
    FACE_INDICES,
    origin,
    scale,
  )
  offset = writeGroup(
    values,
    offset,
    hasLeftHand ? input.leftHand : undefined,
    HAND_INDICES,
    origin,
    scale,
  )
  offset = writeGroup(
    values,
    offset,
    hasRightHand ? input.rightHand : undefined,
    HAND_INDICES,
    origin,
    scale,
  )

  values[offset] = hasLeftHand ? 1 : 0
  values[offset + 1] = hasRightHand ? 1 : 0

  return {
    hasLeftHand,
    hasRightHand,
    values,
  }
}