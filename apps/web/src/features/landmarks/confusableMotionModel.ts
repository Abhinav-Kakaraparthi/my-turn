const STORAGE_KEY = 'my-turn.confusable-motion.v1'
const STORAGE_VERSION = 1
const FRAME_COUNT = 64
const LANDMARK_COUNT = 94
const CHANNEL_COUNT = 4
const VALUES_PER_FRAME = LANDMARK_COUNT * CHANNEL_COUNT
const FINGERPRINT_FRAME_COUNT = 32
const MINIMUM_ACTIVE_FRAMES = 6
const MINIMUM_SAMPLES_PER_LABEL = 3
const AUTOMATIC_SAMPLES_PER_LABEL = 5
const MAXIMUM_SAMPLES_PER_LABEL = 8
const DTW_RADIUS = 6

const LEFT_HAND_OFFSET = 40
const RIGHT_HAND_OFFSET = 73
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const
const MCP_INDICES = [5, 9, 13, 17] as const

export const CONFUSABLE_MOTION_LABELS = [
  'hello',
  'dad',
  'grandpa',
] as const

export type ConfusableMotionLabel =
  (typeof CONFUSABLE_MOTION_LABELS)[number]

type Point = {
  x: number
  y: number
  z: number
}

type MotionFingerprint = {
  featureSize: number
  frames: number[]
  summary: number[]
}

type StoredMotionSample = MotionFingerprint & {
  capturedAt: string
  id: string
  label: ConfusableMotionLabel
}

type MotionDocument = {
  samples: StoredMotionSample[]
  version: number
}

export type ConfusableMotionSnapshot = {
  counts: Record<ConfusableMotionLabel, number>
  ready: boolean
  total: number
}

export type ConfusableMotionPrediction = {
  candidates: Array<{
    confidence: number
    index: number
    sign: ConfusableMotionLabel
  }>
  confidence: number
  decision: 'automatic' | 'confirmation' | 'rejected'
  margin: number
  sign: ConfusableMotionLabel
}

function emptyDocument(): MotionDocument {
  return { samples: [], version: STORAGE_VERSION }
}

function isMotionLabel(value: unknown): value is ConfusableMotionLabel {
  return CONFUSABLE_MOTION_LABELS.includes(
    value as ConfusableMotionLabel,
  )
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  )
}

function isStoredSample(value: unknown): value is StoredMotionSample {
  if (!value || typeof value !== 'object') {
    return false
  }

  const sample = value as Partial<StoredMotionSample>

  return Boolean(
    typeof sample.id === 'string' &&
      typeof sample.capturedAt === 'string' &&
      isMotionLabel(sample.label) &&
      Number.isInteger(sample.featureSize) &&
      (sample.featureSize ?? 0) > 0 &&
      isFiniteNumberArray(sample.frames) &&
      isFiniteNumberArray(sample.summary) &&
      sample.frames!.length ===
        FINGERPRINT_FRAME_COUNT * sample.featureSize!,
  )
}

function loadDocument() {
  if (typeof window === 'undefined') {
    return emptyDocument()
  }

  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY)

    if (!serialized) {
      return emptyDocument()
    }

    const value: unknown = JSON.parse(serialized)

    if (!value || typeof value !== 'object') {
      return emptyDocument()
    }

    const document = value as Partial<MotionDocument>

    if (
      document.version !== STORAGE_VERSION ||
      !Array.isArray(document.samples)
    ) {
      return emptyDocument()
    }

    return {
      samples: document.samples.filter(isStoredSample),
      version: STORAGE_VERSION,
    }
  } catch {
    return emptyDocument()
  }
}

function saveDocument(document: MotionDocument) {
  if (typeof window === 'undefined') {
    throw new Error('Motion calibration requires a browser.')
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document))
}

function countSamples(samples: StoredMotionSample[]) {
  const counts: Record<ConfusableMotionLabel, number> = {
    dad: 0,
    grandpa: 0,
    hello: 0,
  }

  samples.forEach((sample) => {
    counts[sample.label] += 1
  })

  return counts
}

function makeSnapshot(samples: StoredMotionSample[]): ConfusableMotionSnapshot {
  const counts = countSamples(samples)

  return {
    counts,
    ready: CONFUSABLE_MOTION_LABELS.every(
      (label) => counts[label] >= MINIMUM_SAMPLES_PER_LABEL,
    ),
    total: samples.length,
  }
}

export function getConfusableMotionSnapshot() {
  return makeSnapshot(loadDocument().samples)
}

function sequenceOffset(frame: number, landmark: number) {
  return frame * VALUES_PER_FRAME + landmark * CHANNEL_COUNT
}

function readPoint(
  sequence: Float32Array,
  frame: number,
  landmark: number,
): Point | null {
  const offset = sequenceOffset(frame, landmark)

  if (sequence[offset + 3] < 0.5) {
    return null
  }

  const point = {
    x: sequence[offset],
    y: sequence[offset + 1],
    z: sequence[offset + 2],
  }

  return Object.values(point).every(Number.isFinite) ? point : null
}

function subtract(left: Point, right: Point): Point {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function magnitude(point: Point) {
  return Math.hypot(point.x, point.y, point.z)
}

function distance(left: Point, right: Point) {
  return magnitude(subtract(left, right))
}

function averageFacePoint(sequence: Float32Array, frame: number) {
  const points: Point[] = []

  for (let landmark = 0; landmark < 40; landmark += 1) {
    const point = readPoint(sequence, frame, landmark)

    if (point) {
      points.push(point)
    }
  }

  if (points.length === 0) {
    return null
  }

  return points.reduce(
    (center, point) => ({
      x: center.x + point.x / points.length,
      y: center.y + point.y / points.length,
      z: center.z + point.z / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  )
}

function cross(left: Point, right: Point): Point {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function normalize(point: Point): Point {
  const length = Math.max(magnitude(point), 0.0001)

  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
  }
}

function countPresentFrames(sequence: Float32Array, handOffset: number) {
  let count = 0

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    if (readPoint(sequence, frame, handOffset)) {
      count += 1
    }
  }

  return count
}

function mirrorX(value: number, mirror: boolean) {
  return mirror ? -value : value
}

function createBaseFrame(
  sequence: Float32Array,
  frame: number,
  handOffset: number,
  mirror: boolean,
) {
  const wrist = readPoint(sequence, frame, handOffset)
  const face = averageFacePoint(sequence, frame)
  const middleMcp = readPoint(sequence, frame, handOffset + 9)
  const indexMcp = readPoint(sequence, frame, handOffset + 5)
  const pinkyMcp = readPoint(sequence, frame, handOffset + 17)

  if (!wrist || !face || !middleMcp || !indexMcp || !pinkyMcp) {
    return null
  }

  const handScale = Math.max(distance(wrist, middleMcp), 0.025)
  const wristFromFace = subtract(wrist, face)
  const values = [
    mirrorX(wristFromFace.x, mirror) * 1.5,
    wristFromFace.y * 1.5,
    wristFromFace.z,
  ]

  const writeRelativeLandmarks = (indices: readonly number[], weight: number) => {
    for (const index of indices) {
      const point = readPoint(sequence, frame, handOffset + index)

      if (!point) {
        return false
      }

      const relative = subtract(point, wrist)
      values.push(
        (mirrorX(relative.x, mirror) / handScale) * weight,
        (relative.y / handScale) * weight,
        (relative.z / handScale) * weight,
      )
    }

    return true
  }

  if (
    !writeRelativeLandmarks(FINGERTIP_INDICES, 0.75) ||
    !writeRelativeLandmarks(MCP_INDICES, 0.55)
  ) {
    return null
  }

  const fingertips = FINGERTIP_INDICES.map((index) =>
    readPoint(sequence, frame, handOffset + index),
  )

  if (fingertips.some((point) => !point)) {
    return null
  }

  for (let index = 0; index < fingertips.length - 1; index += 1) {
    values.push(
      (distance(fingertips[index]!, fingertips[index + 1]!) / handScale) *
        0.8,
    )
  }

  const palmNormal = normalize(
    cross(subtract(indexMcp, wrist), subtract(pinkyMcp, wrist)),
  )

  values.push(
    mirrorX(palmNormal.x, mirror) * 0.45,
    palmNormal.y * 0.45,
    palmNormal.z * 0.45,
    magnitude(wristFromFace),
  )

  return values
}

function interpolateFrames(frames: number[][]) {
  if (frames.length < MINIMUM_ACTIVE_FRAMES) {
    throw new Error(
      'Keep the signing hand, face, and upper body visible for the whole motion.',
    )
  }

  const featureSize = frames[0]!.length
  const result = Array.from(
    { length: FINGERPRINT_FRAME_COUNT },
    () => new Array<number>(featureSize).fill(0),
  )

  for (let target = 0; target < FINGERPRINT_FRAME_COUNT; target += 1) {
    const sourcePosition =
      (target * (frames.length - 1)) / (FINGERPRINT_FRAME_COUNT - 1)
    const lower = Math.floor(sourcePosition)
    const upper = Math.min(frames.length - 1, Math.ceil(sourcePosition))
    const blend = sourcePosition - lower

    for (let feature = 0; feature < featureSize; feature += 1) {
      result[target]![feature] =
        frames[lower]![feature]! * (1 - blend) +
        frames[upper]![feature]! * blend
    }
  }

  return result
}

function countDirectionChanges(values: number[]) {
  let previousDirection = 0
  let changes = 0

  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index]! - values[index - 1]!
    const direction = Math.abs(delta) < 0.008 ? 0 : Math.sign(delta)

    if (
      direction !== 0 &&
      previousDirection !== 0 &&
      direction !== previousDirection
    ) {
      changes += 1
    }

    if (direction !== 0) {
      previousDirection = direction
    }
  }

  return changes
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function createFingerprint(sequence: Float32Array): MotionFingerprint {
  if (
    sequence.length !==
    FRAME_COUNT * LANDMARK_COUNT * CHANNEL_COUNT
  ) {
    throw new Error('The motion sequence has an unexpected size.')
  }

  const leftFrames = countPresentFrames(sequence, LEFT_HAND_OFFSET)
  const rightFrames = countPresentFrames(sequence, RIGHT_HAND_OFFSET)
  const useLeftHand = leftFrames > rightFrames
  const handOffset = useLeftHand ? LEFT_HAND_OFFSET : RIGHT_HAND_OFFSET
  const baseFrames: number[][] = []

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const features = createBaseFrame(
      sequence,
      frame,
      handOffset,
      useLeftHand,
    )

    if (features) {
      baseFrames.push(features)
    }
  }

  const resampled = interpolateFrames(baseFrames)
  const featureSize = resampled[0]!.length + 7
  const enriched = resampled.map((frame, index) => {
    const previous = resampled[Math.max(0, index - 1)]!
    const beforePrevious = resampled[Math.max(0, index - 2)]!
    const velocity = [0, 1, 2].map(
      (axis) => (frame[axis]! - previous[axis]!) * 7,
    )
    const acceleration = [0, 1, 2].map(
      (axis) =>
        (frame[axis]! - 2 * previous[axis]! + beforePrevious[axis]!) * 14,
    )
    const radialVelocity =
      (frame[frame.length - 1]! - previous[previous.length - 1]!) * 7

    return [...frame, ...velocity, ...acceleration, radialVelocity]
  })
  const wristX = resampled.map((frame) => frame[0]!)
  const wristY = resampled.map((frame) => frame[1]!)
  const wristRadius = resampled.map((frame) => frame[frame.length - 1]!)
  let pathLength = 0

  for (let index = 1; index < resampled.length; index += 1) {
    pathLength += Math.hypot(
      resampled[index]![0]! - resampled[index - 1]![0]!,
      resampled[index]![1]! - resampled[index - 1]![1]!,
      resampled[index]![2]! - resampled[index - 1]![2]!,
    )
  }

  const first = resampled[0]!
  const last = resampled.at(-1)!
  const spreadStart = 30
  const summary = [
    (last[0]! - first[0]!) * 2,
    (last[1]! - first[1]!) * 2,
    (last[2]! - first[2]!) * 2,
    pathLength * 1.5,
    (Math.max(...wristRadius) - Math.min(...wristRadius)) * 2,
    countDirectionChanges(wristRadius) / 4,
    countDirectionChanges(wristX) / 4,
    countDirectionChanges(wristY) / 4,
    ...Array.from({ length: 4 }, (_, index) =>
      mean(resampled.map((frame) => frame[spreadStart + index]!)),
    ),
  ]

  return {
    featureSize,
    frames: enriched.flat(),
    summary,
  }
}

function fingerprintFrameDistance(
  left: MotionFingerprint,
  right: MotionFingerprint,
  leftFrame: number,
  rightFrame: number,
) {
  let squaredDifference = 0
  const leftOffset = leftFrame * left.featureSize
  const rightOffset = rightFrame * right.featureSize

  for (let feature = 0; feature < left.featureSize; feature += 1) {
    const difference =
      left.frames[leftOffset + feature]! -
      right.frames[rightOffset + feature]!

    squaredDifference += difference * difference
  }

  return Math.sqrt(squaredDifference / left.featureSize)
}

function calculateTemporalDistance(
  left: MotionFingerprint,
  right: MotionFingerprint,
) {
  let previous = new Float64Array(FINGERPRINT_FRAME_COUNT + 1)
  let current = new Float64Array(FINGERPRINT_FRAME_COUNT + 1)

  previous.fill(Number.POSITIVE_INFINITY)
  previous[0] = 0

  for (let leftFrame = 0; leftFrame < FINGERPRINT_FRAME_COUNT; leftFrame += 1) {
    current.fill(Number.POSITIVE_INFINITY)
    const firstRight = Math.max(0, leftFrame - DTW_RADIUS)
    const lastRight = Math.min(
      FINGERPRINT_FRAME_COUNT - 1,
      leftFrame + DTW_RADIUS,
    )

    for (let rightFrame = firstRight; rightFrame <= lastRight; rightFrame += 1) {
      const column = rightFrame + 1
      current[column] =
        fingerprintFrameDistance(left, right, leftFrame, rightFrame) +
        Math.min(previous[column]!, current[column - 1]!, previous[column - 1]!)
    }

    const completed = previous
    previous = current
    current = completed
  }

  return previous[FINGERPRINT_FRAME_COUNT]! / FINGERPRINT_FRAME_COUNT
}

function calculateSummaryDistance(
  left: MotionFingerprint,
  right: MotionFingerprint,
) {
  let squaredDifference = 0

  for (let index = 0; index < left.summary.length; index += 1) {
    const difference = left.summary[index]! - right.summary[index]!
    squaredDifference += difference * difference
  }

  return Math.sqrt(squaredDifference / left.summary.length)
}

function calculateDistance(
  left: MotionFingerprint,
  right: MotionFingerprint,
) {
  if (
    left.featureSize !== right.featureSize ||
    left.summary.length !== right.summary.length
  ) {
    return Number.POSITIVE_INFINITY
  }

  return (
    calculateTemporalDistance(left, right) * 0.82 +
    calculateSummaryDistance(left, right) * 0.18
  )
}

function calculateFamilyDynamicsDistance(
  left: MotionFingerprint,
  right: MotionFingerprint,
) {
  if (
    left.featureSize !== right.featureSize ||
    left.summary.length !== right.summary.length
  ) {
    return Number.POSITIVE_INFINITY
  }

  const dynamicsOffset = left.featureSize - 7
  const motionFeatureIndices = [
    0,
    1,
    2,
    dynamicsOffset,
    dynamicsOffset + 1,
    dynamicsOffset + 2,
    dynamicsOffset + 3,
    dynamicsOffset + 4,
    dynamicsOffset + 5,
    dynamicsOffset + 6,
  ]
  let temporalSquaredDifference = 0
  let temporalValueCount = 0

  // Deliberately compare aligned frames without DTW. Dad versus grandpa is
  // distinguished by the extra pulse, which temporal warping can erase.
  for (let frame = 0; frame < FINGERPRINT_FRAME_COUNT; frame += 1) {
    const leftOffset = frame * left.featureSize
    const rightOffset = frame * right.featureSize

    for (const feature of motionFeatureIndices) {
      const difference =
        left.frames[leftOffset + feature]! -
        right.frames[rightOffset + feature]!

      temporalSquaredDifference += difference * difference
      temporalValueCount += 1
    }
  }

  const summaryWeights = [1.5, 1.5, 1, 2.5, 2.5, 3, 2, 2]
  let summarySquaredDifference = 0
  let summaryWeightTotal = 0

  for (let index = 0; index < summaryWeights.length; index += 1) {
    const weight = summaryWeights[index]!
    const difference = left.summary[index]! - right.summary[index]!

    summarySquaredDifference += difference * difference * weight
    summaryWeightTotal += weight
  }

  const temporalDistance = Math.sqrt(
    temporalSquaredDifference / temporalValueCount,
  )
  const summaryDistance = Math.sqrt(
    summarySquaredDifference / summaryWeightTotal,
  )

  return temporalDistance * 0.42 + summaryDistance * 0.58
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function meanNearestDistances(
  fingerprint: MotionFingerprint,
  candidates: MotionFingerprint[],
  count = 2,
) {
  const distances = candidates
    .map((candidate) => calculateDistance(fingerprint, candidate))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
    .slice(0, count)

  return distances.length > 0 ? mean(distances) : Number.POSITIVE_INFINITY
}

function classThreshold(samples: StoredMotionSample[]) {
  const leaveOneOutDistances = samples.map((sample, sampleIndex) =>
    meanNearestDistances(
      sample,
      samples.filter((_, index) => index !== sampleIndex),
    ),
  )
  const center = median(leaveOneOutDistances)
  const deviation = median(
    leaveOneOutDistances.map((value) => Math.abs(value - center)),
  )

  return Math.max(0.04, center * 2.2 + deviation * 3)
}

function pooledCalibrationScale(samples: StoredMotionSample[]) {
  const nearestSameLabelDistances = samples
    .map((sample, sampleIndex) => {
      const sameLabel = samples.filter(
        (candidate, candidateIndex) =>
          candidateIndex !== sampleIndex &&
          candidate.label === sample.label,
      )

      return meanNearestDistances(sample, sameLabel, 1)
    })
    .filter(Number.isFinite)

  return Math.max(0.02, median(nearestSameLabelDistances))
}

function meanNearestFamilyDynamics(
  fingerprint: MotionFingerprint,
  candidates: MotionFingerprint[],
  count = 3,
) {
  const distances = candidates
    .map((candidate) =>
      calculateFamilyDynamicsDistance(fingerprint, candidate),
    )
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
    .slice(0, count)

  return distances.length > 0 ? mean(distances) : Number.POSITIVE_INFINITY
}

function pooledFamilyDynamicsScale(samples: StoredMotionSample[]) {
  const familySamples = samples.filter(
    (sample) => sample.label === 'dad' || sample.label === 'grandpa',
  )
  const nearestSameLabelDistances = familySamples
    .map((sample, sampleIndex) => {
      const sameLabel = familySamples.filter(
        (candidate, candidateIndex) =>
          candidateIndex !== sampleIndex &&
          candidate.label === sample.label,
      )

      return meanNearestFamilyDynamics(sample, sameLabel, 1)
    })
    .filter(Number.isFinite)

  return Math.max(0.01, median(nearestSameLabelDistances))
}

export function saveConfusableMotionSample(
  label: ConfusableMotionLabel,
  sequence: Float32Array,
) {
  const fingerprint = createFingerprint(sequence)
  const document = loadDocument()
  const sample: StoredMotionSample = {
    ...fingerprint,
    capturedAt: new Date().toISOString(),
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    label,
  }
  const sameLabel = document.samples.filter(
    (storedSample) => storedSample.label === label,
  )
  const keepIds = new Set(
    sameLabel
      .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
      .slice(0, MAXIMUM_SAMPLES_PER_LABEL - 1)
      .map((storedSample) => storedSample.id),
  )

  document.samples = [
    sample,
    ...document.samples.filter(
      (storedSample) =>
        storedSample.label !== label || keepIds.has(storedSample.id),
    ),
  ]
  saveDocument(document)

  return makeSnapshot(document.samples)
}

export function clearConfusableMotionSamples() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
  }

  return makeSnapshot([])
}

export function classifyConfusableMotion(
  sequence: Float32Array,
): ConfusableMotionPrediction | null {
  const document = loadDocument()
  const snapshot = makeSnapshot(document.samples)

  if (!snapshot.ready) {
    return null
  }

  const query = createFingerprint(sequence)
  const calibrationScale = pooledCalibrationScale(document.samples)
  const familyDynamicsScale = pooledFamilyDynamicsScale(document.samples)
  const familyDynamicsDistances = new Map<ConfusableMotionLabel, number>()

  for (const label of ['dad', 'grandpa'] as const) {
    const samples = document.samples.filter((sample) => sample.label === label)

    familyDynamicsDistances.set(
      label,
      meanNearestFamilyDynamics(query, samples),
    )
  }

  const bestFamilyDynamicsDistance = Math.min(
    familyDynamicsDistances.get('dad')!,
    familyDynamicsDistances.get('grandpa')!,
  )
  const ranked = CONFUSABLE_MOTION_LABELS.map((label, index) => {
    const samples = document.samples.filter((sample) => sample.label === label)
    const rawDistance = meanNearestDistances(query, samples, 3)
    const threshold = classThreshold(samples)
    const familyDynamicsDistance = familyDynamicsDistances.get(label)
    const familyDynamicsPenalty =
      familyDynamicsDistance === undefined
        ? 0
        : ((familyDynamicsDistance - bestFamilyDynamicsDistance) /
            familyDynamicsScale) *
          1.6

    return {
      index,
      label,
      matchRatio: rawDistance / threshold,
      rawDistance,
      rankingScore:
        -rawDistance / calibrationScale - familyDynamicsPenalty,
    }
  }).sort(
    (left, right) => right.rankingScore - left.rankingScore,
  )
  const bestRankingScore = ranked[0]!.rankingScore
  const exponentials = ranked.map((candidate) =>
    Math.exp(candidate.rankingScore - bestRankingScore),
  )
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  const absoluteMatch = Math.max(
    0,
    Math.min(1, 1.25 - ranked[0]!.matchRatio),
  )
  const candidates = ranked.map((candidate, index) => ({
    confidence:
      (total > 0 ? exponentials[index]! / total : 0) * absoluteMatch,
    index: candidate.index,
    sign: candidate.label,
  }))
  const best = ranked[0]!
  const confidence = candidates[0]!.confidence
  const margin = confidence - candidates[1]!.confidence
  const enoughForAutomatic = CONFUSABLE_MOTION_LABELS.every(
    (label) => snapshot.counts[label] >= AUTOMATIC_SAMPLES_PER_LABEL,
  )
  const automaticMatch =
    best.matchRatio <= 0.9
  const confirmationMatch = best.matchRatio <= 1.2
  const decision =
    enoughForAutomatic &&
    automaticMatch &&
    confidence >= 0.62 &&
    margin >= 0.2
      ? 'automatic'
      : confirmationMatch && confidence >= 0.3 && margin >= 0.07
        ? 'confirmation'
        : 'rejected'

  return {
    candidates,
    confidence,
    decision,
    margin,
    sign: candidates[0]!.sign,
  }
}
