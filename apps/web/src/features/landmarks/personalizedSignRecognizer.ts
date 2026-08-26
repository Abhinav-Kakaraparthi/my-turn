import type { CapturedSignSequence } from './landmarkWorker.types'
import type { PersonalizedSignSample } from './personalizedSignStore'

const DEFAULT_WARP_RADIUS = 4

type ComparableSignSequence = {
  featureSize: number
  frameCount: number
  schemaVersion: string
  values: Float32Array
}

export type PersonalizedSignMatch = {
  distance: number
  phrase: string
  sampleId: string
  similarity: number
}

function isValidSequence(sequence: ComparableSignSequence) {
  if (
    !Number.isInteger(sequence.featureSize) ||
    sequence.featureSize <= 0 ||
    !Number.isInteger(sequence.frameCount) ||
    sequence.frameCount <= 0 ||
    sequence.values.length !==
      sequence.featureSize * sequence.frameCount
  ) {
    return false
  }

  for (const value of sequence.values) {
    if (!Number.isFinite(value)) {
      return false
    }
  }

  return true
}

function sequencesAreCompatible(
  query: ComparableSignSequence,
  candidate: ComparableSignSequence,
) {
  return (
    query.schemaVersion === candidate.schemaVersion &&
    query.featureSize === candidate.featureSize
  )
}

function calculateFrameDistance(
  query: ComparableSignSequence,
  candidate: ComparableSignSequence,
  queryFrame: number,
  candidateFrame: number,
) {
  const queryOffset = queryFrame * query.featureSize
  const candidateOffset = candidateFrame * candidate.featureSize
  let squaredDifference = 0

  for (let feature = 0; feature < query.featureSize; feature += 1) {
    const difference =
      query.values[queryOffset + feature] -
      candidate.values[candidateOffset + feature]

    squaredDifference += difference * difference
  }

  return Math.sqrt(squaredDifference / query.featureSize)
}

export function calculateSequenceDistance(
  query: CapturedSignSequence,
  candidate: PersonalizedSignSample,
  warpRadius = DEFAULT_WARP_RADIUS,
) {
  if (!isValidSequence(query) || !isValidSequence(candidate)) {
    throw new RangeError('A personalized sign sequence is invalid.')
  }

  if (!sequencesAreCompatible(query, candidate)) {
    throw new RangeError(
      'The personalized sign sequences use incompatible schemas.',
    )
  }

  if (!Number.isInteger(warpRadius) || warpRadius < 0) {
    throw new RangeError('The sequence warp radius cannot be negative.')
  }

  const effectiveWarpRadius = Math.max(
    warpRadius,
    Math.abs(query.frameCount - candidate.frameCount),
  )

  let previousRow = new Float64Array(candidate.frameCount + 1)
  let currentRow = new Float64Array(candidate.frameCount + 1)

  previousRow.fill(Number.POSITIVE_INFINITY)
  previousRow[0] = 0

  for (
    let queryFrame = 0;
    queryFrame < query.frameCount;
    queryFrame += 1
  ) {
    currentRow.fill(Number.POSITIVE_INFINITY)

    const firstCandidateFrame = Math.max(
      0,
      queryFrame - effectiveWarpRadius,
    )
    const lastCandidateFrame = Math.min(
      candidate.frameCount - 1,
      queryFrame + effectiveWarpRadius,
    )

    for (
      let candidateFrame = firstCandidateFrame;
      candidateFrame <= lastCandidateFrame;
      candidateFrame += 1
    ) {
      const column = candidateFrame + 1
      const frameDistance = calculateFrameDistance(
        query,
        candidate,
        queryFrame,
        candidateFrame,
      )

      currentRow[column] =
        frameDistance +
        Math.min(
          previousRow[column],
          currentRow[column - 1],
          previousRow[column - 1],
        )
    }

    const completedRow = previousRow
    previousRow = currentRow
    currentRow = completedRow
  }

  return (
    previousRow[candidate.frameCount] /
    Math.max(query.frameCount, candidate.frameCount)
  )
}

export function rankPersonalizedSignMatches(
  query: CapturedSignSequence,
  samples: PersonalizedSignSample[],
): PersonalizedSignMatch[] {
  if (!isValidSequence(query)) {
    throw new RangeError('The captured sign sequence is invalid.')
  }

  return samples
    .filter(
      (sample) =>
        isValidSequence(sample) &&
        sequencesAreCompatible(query, sample),
    )
    .map((sample) => {
      const distance = calculateSequenceDistance(query, sample)

      return {
        distance,
        phrase: sample.phrase,
        sampleId: sample.id,
        similarity: 1 / (1 + distance),
      }
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.phrase.localeCompare(right.phrase),
    )
}
