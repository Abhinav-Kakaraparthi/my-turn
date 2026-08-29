import * as tf from '@tensorflow/tfjs'

const MODEL_ROOT = '/models/my-turn-popsign'
const MODEL_URL = `${MODEL_ROOT}/model.json`
const LABEL_MAP_URL = `${MODEL_ROOT}/sign_to_prediction_index_map.json`
const FAMILY_SPECIALIST_ROOT = '/models/my-turn-family-specialist'
const FAMILY_SPECIALIST_MODEL_URL = `${FAMILY_SPECIALIST_ROOT}/model.json`
const MODEL_OUTPUT_NAME = 'Identity'
const TEMPORAL_FEATURE_OUTPUT_NAME =
  'StatefulPartitionedCall/my_turn_popsign_recognizer_float32_1/activation_17_1/mul_1'

const FAMILY_SPECIALIST_LABELS = [
  'dad',
  'grandpa',
  'hello',
] as const
const FAMILY_SPECIALIST_SIGNS = new Set<string>(
  FAMILY_SPECIALIST_LABELS,
)

export const POPSIGN_FRAME_COUNT = 64
export const POPSIGN_LANDMARK_COUNT = 94
export const POPSIGN_CHANNEL_COUNT = 4
export const POPSIGN_CLASS_COUNT = 250

// High-confidence public predictions should flow directly to caption and
// speech. Ambiguous results still stop for a quick user check.
const AUTOMATIC_CONFIDENCE = 0.82
const AUTOMATIC_MARGIN = 0.3
const CONFIRMATION_CONFIDENCE = 0.6
const SPECIALIST_FEATURE_COUNT = 256
const SPECIALIST_GRU_UNITS = 96

type GruWeights = {
  bias: tf.Tensor2D
  kernel: tf.Tensor2D
  recurrentKernel: tf.Tensor2D
}

type FamilySpecialist = {
  backward: GruWeights
  denseBias: tf.Tensor1D
  denseKernel: tf.Tensor2D
  forward: GruWeights
  outputBias: tf.Tensor1D
  outputKernel: tf.Tensor2D
}

type PopsignRuntime = {
  labels: string[]
  model: tf.GraphModel
  specialist: FamilySpecialist
}

export type PopsignCandidate = {
  confidence: number
  index: number
  sign: string
}

export type PopsignPrediction = {
  candidates: PopsignCandidate[]
  confirmationCandidates?: PopsignCandidate[]
  confidence: number
  decision: 'automatic' | 'confirmation' | 'rejected'
  margin: number
  model: '250-sign' | 'family-specialist' | 'personal-motion'
  sign: string
}

let runtimePromise: Promise<PopsignRuntime> | null = null

function describeResponse(response: Response) {
  return `${response.status} ${response.statusText}`.trim()
}

async function loadLabels() {
  const response = await fetch(LABEL_MAP_URL)

  if (!response.ok) {
    throw new Error(
      `The sign label map could not be loaded (${describeResponse(response)}).`,
    )
  }

  const value: unknown = await response.json()

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The sign label map has an invalid format.')
  }

  const labels = new Array<string>(POPSIGN_CLASS_COUNT)

  Object.entries(value as Record<string, unknown>).forEach(
    ([sign, index]) => {
      if (
        typeof index === 'number' &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < POPSIGN_CLASS_COUNT
      ) {
        labels[index] = sign
      }
    },
  )

  for (let index = 0; index < POPSIGN_CLASS_COUNT; index += 1) {
    if (typeof labels[index] !== 'string') {
      throw new Error('The sign label map does not contain all 250 signs.')
    }
  }

  return labels
}

function executeModel(model: tf.GraphModel, input: tf.Tensor4D) {
  const result = model.execute(
    { landmark_sequence: input },
    [MODEL_OUTPUT_NAME, TEMPORAL_FEATURE_OUTPUT_NAME],
  )

  if (!Array.isArray(result) || result.length < 2) {
    const tensors = Array.isArray(result) ? result : [result]
    tensors.forEach((tensor) => tensor.dispose())
    throw new Error(
      'The sign model did not expose its temporal feature tensor.',
    )
  }

  const [scores, temporalFeatures, ...unexpectedOutputs] = result

  unexpectedOutputs.forEach((tensor) => tensor.dispose())

  if (!scores || !temporalFeatures) {
    scores?.dispose()
    temporalFeatures?.dispose()
    throw new Error('The sign model returned incomplete output tensors.')
  }

  if (
    temporalFeatures.rank !== 3 ||
    temporalFeatures.shape[1] !== POPSIGN_FRAME_COUNT ||
    temporalFeatures.shape[2] !== 256
  ) {
    scores.dispose()
    temporalFeatures.dispose()
    throw new Error(
      `The sign model returned temporal features with shape [${temporalFeatures.shape.join(', ')}]; expected [1, 64, 256].`,
    )
  }

  return {
    scores,
    temporalFeatures: temporalFeatures as tf.Tensor3D,
  }
}

function hasShape(tensor: tf.Tensor, expectedShape: number[]) {
  return (
    tensor.shape.length === expectedShape.length &&
    tensor.shape.every(
      (dimension, index) => dimension === expectedShape[index],
    )
  )
}

function requireWeight<T extends tf.Tensor>(
  weights: tf.NamedTensorMap,
  name: string,
  shape: number[],
) {
  const tensor = weights[name]

  if (!tensor) {
    throw new Error(`The family specialist is missing ${name}.`)
  }

  if (!hasShape(tensor, shape)) {
    throw new Error(
      `The family specialist weight ${name} has shape [${tensor.shape.join(', ')}]; expected [${shape.join(', ')}].`,
    )
  }

  return tensor as T
}

async function loadFamilySpecialist(): Promise<FamilySpecialist> {
  const response = await fetch(FAMILY_SPECIALIST_MODEL_URL)

  if (!response.ok) {
    throw new Error(
      `The family specialist could not be loaded (${describeResponse(response)}).`,
    )
  }

  const document: unknown = await response.json()
  const weightsManifest =
    document && typeof document === 'object'
      ? (document as { weightsManifest?: unknown }).weightsManifest
      : undefined

  if (!Array.isArray(weightsManifest)) {
    throw new Error('The family specialist weight manifest is invalid.')
  }

  const weights = await tf.io.loadWeights(
    weightsManifest as Parameters<typeof tf.io.loadWeights>[0],
    `${FAMILY_SPECIALIST_ROOT}/`,
  )

  try {
    return {
      forward: {
        kernel: requireWeight<tf.Tensor2D>(
          weights,
          'forward_gru/gru_cell/kernel',
          [SPECIALIST_FEATURE_COUNT, SPECIALIST_GRU_UNITS * 3],
        ),
        recurrentKernel: requireWeight<tf.Tensor2D>(
          weights,
          'forward_gru/gru_cell/recurrent_kernel',
          [SPECIALIST_GRU_UNITS, SPECIALIST_GRU_UNITS * 3],
        ),
        bias: requireWeight<tf.Tensor2D>(
          weights,
          'forward_gru/gru_cell/bias',
          [2, SPECIALIST_GRU_UNITS * 3],
        ),
      },
      backward: {
        kernel: requireWeight<tf.Tensor2D>(
          weights,
          'backward_gru/gru_cell/kernel',
          [SPECIALIST_FEATURE_COUNT, SPECIALIST_GRU_UNITS * 3],
        ),
        recurrentKernel: requireWeight<tf.Tensor2D>(
          weights,
          'backward_gru/gru_cell/recurrent_kernel',
          [SPECIALIST_GRU_UNITS, SPECIALIST_GRU_UNITS * 3],
        ),
        bias: requireWeight<tf.Tensor2D>(
          weights,
          'backward_gru/gru_cell/bias',
          [2, SPECIALIST_GRU_UNITS * 3],
        ),
      },
      denseKernel: requireWeight<tf.Tensor2D>(
        weights,
        'confusion_dense/kernel',
        [SPECIALIST_GRU_UNITS * 2 + SPECIALIST_FEATURE_COUNT * 2, 192],
      ),
      denseBias: requireWeight<tf.Tensor1D>(
        weights,
        'confusion_dense/bias',
        [192],
      ),
      outputKernel: requireWeight<tf.Tensor2D>(
        weights,
        'specialist_probabilities/kernel',
        [192, FAMILY_SPECIALIST_LABELS.length],
      ),
      outputBias: requireWeight<tf.Tensor1D>(
        weights,
        'specialist_probabilities/bias',
        [FAMILY_SPECIALIST_LABELS.length],
      ),
    }
  } catch (error) {
    Object.values(weights).forEach((tensor) => tensor.dispose())
    throw error
  }
}

function runResetAfterGru(
  input: tf.Tensor3D,
  weights: GruWeights,
  backwards: boolean,
) {
  const batchSize = input.shape[0]

  if (batchSize === undefined) {
    throw new Error('The family specialist received an unknown batch size.')
  }

  const inputBias = weights.bias
    .slice([0, 0], [1, SPECIALIST_GRU_UNITS * 3])
    .reshape([SPECIALIST_GRU_UNITS * 3]) as tf.Tensor1D
  const recurrentBias = weights.bias
    .slice([1, 0], [1, SPECIALIST_GRU_UNITS * 3])
    .reshape([SPECIALIST_GRU_UNITS * 3]) as tf.Tensor1D
  let state = tf.zeros([batchSize, SPECIALIST_GRU_UNITS]) as tf.Tensor2D

  try {
    for (let step = 0; step < POPSIGN_FRAME_COUNT; step += 1) {
      const frameIndex = backwards
        ? POPSIGN_FRAME_COUNT - step - 1
        : step
      const previousState = state

      state = tf.tidy(() => {
        const frame = input
          .slice(
            [0, frameIndex, 0],
            [batchSize, 1, SPECIALIST_FEATURE_COUNT],
          )
          .as2D(batchSize, SPECIALIST_FEATURE_COUNT)
        const inputProjection = tf.add(
          tf.matMul(frame, weights.kernel),
          inputBias,
        )
        const recurrentProjection = tf.add(
          tf.matMul(previousState, weights.recurrentKernel),
          recurrentBias,
        )
        const [inputUpdate, inputReset, inputCandidate] = tf.split(
          inputProjection,
          3,
          1,
        )
        const [recurrentUpdate, recurrentReset, recurrentCandidate] =
          tf.split(recurrentProjection, 3, 1)
        const updateGate = tf.sigmoid(
          tf.add(inputUpdate, recurrentUpdate),
        )
        const resetGate = tf.sigmoid(
          tf.add(inputReset, recurrentReset),
        )
        const candidate = tf.tanh(
          tf.add(inputCandidate, tf.mul(resetGate, recurrentCandidate)),
        )

        return tf.add(
          tf.mul(updateGate, previousState),
          tf.mul(tf.sub(1, updateGate), candidate),
        ) as tf.Tensor2D
      })

      previousState.dispose()
    }

    return state
  } finally {
    inputBias.dispose()
    recurrentBias.dispose()
  }
}

function gelu(input: tf.Tensor) {
  return tf.mul(
    0.5,
    tf.mul(
      input,
      tf.add(1, tf.erf(tf.mul(input, Math.SQRT1_2))),
    ),
  )
}

function executeSpecialistModel(
  model: FamilySpecialist,
  input: tf.Tensor3D,
) {
  return tf.tidy(() => {
    const forward = runResetAfterGru(input, model.forward, false)
    const backward = runResetAfterGru(input, model.backward, true)
    const average = tf.mean(input, 1) as tf.Tensor2D
    const maximum = tf.max(input, 1) as tf.Tensor2D
    const combined = tf.concat(
      [forward, backward, average, maximum],
      1,
    ) as tf.Tensor2D
    const hidden = gelu(
      tf.add(tf.matMul(combined, model.denseKernel), model.denseBias),
    ) as tf.Tensor2D
    const logits = tf.add(
      tf.matMul(hidden, model.outputKernel),
      model.outputBias,
    )

    return tf.softmax(logits) as tf.Tensor2D
  })
}

function makeDecision(
  bestConfidence: number,
  margin: number,
): PopsignPrediction['decision'] {
  if (
    bestConfidence >= AUTOMATIC_CONFIDENCE &&
    margin >= AUTOMATIC_MARGIN
  ) {
    return 'automatic'
  }

  return bestConfidence >= CONFIRMATION_CONFIDENCE
    ? 'confirmation'
    : 'rejected'
}

async function createRuntime(): Promise<PopsignRuntime> {
  await tf.ready()

  const [model, specialist, labels] = await Promise.all([
    tf.loadGraphModel(MODEL_URL),
    loadFamilySpecialist(),
    loadLabels(),
  ])

  const warmupInput = tf.zeros(
    [
      1,
      POPSIGN_FRAME_COUNT,
      POPSIGN_LANDMARK_COUNT,
      POPSIGN_CHANNEL_COUNT,
    ],
    'float32',
  ) as tf.Tensor4D

  let warmupOutput: tf.Tensor | null = null
  let warmupFeatures: tf.Tensor3D | null = null
  let specialistWarmupOutput: tf.Tensor | null = null

  try {
    const baseWarmup = executeModel(model, warmupInput)
    warmupOutput = baseWarmup.scores
    warmupFeatures = baseWarmup.temporalFeatures
    specialistWarmupOutput = executeSpecialistModel(
      specialist,
      baseWarmup.temporalFeatures,
    )
    await Promise.all([
      warmupOutput.data(),
      specialistWarmupOutput.data(),
    ])
  } finally {
    warmupInput.dispose()
    warmupOutput?.dispose()
    warmupFeatures?.dispose()
    specialistWarmupOutput?.dispose()
  }

  return { labels, model, specialist }
}

export function loadPopsignModel() {
  runtimePromise ??= createRuntime().catch((error: unknown) => {
    runtimePromise = null
    throw error
  })

  return runtimePromise
}

export async function predictPopsign(
  sequence: Float32Array,
): Promise<PopsignPrediction> {
  const expectedValues =
    POPSIGN_FRAME_COUNT *
    POPSIGN_LANDMARK_COUNT *
    POPSIGN_CHANNEL_COUNT

  if (sequence.length !== expectedValues) {
    throw new RangeError(
      `The sign sequence contains ${sequence.length} values; expected ${expectedValues}.`,
    )
  }

  const { labels, model } = await loadPopsignModel()
  const input = tf.tensor4d(
    sequence,
    [
      1,
      POPSIGN_FRAME_COUNT,
      POPSIGN_LANDMARK_COUNT,
      POPSIGN_CHANNEL_COUNT,
    ],
    'float32',
  )

  let output: tf.Tensor | null = null
  let temporalFeatures: tf.Tensor3D | null = null

  try {
    const basePrediction = executeModel(model, input)
    output = basePrediction.scores
    temporalFeatures = basePrediction.temporalFeatures
    const scores = await output.data()
    const baseCandidates = Array.from(scores, (confidence, index) => ({
      confidence,
      index,
      sign: labels[index] ?? `sign-${index}`,
    }))
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5)

    const baseBest = baseCandidates[0]
    const baseSecond = baseCandidates[1]

    if (!baseBest || !baseSecond) {
      throw new Error('The sign model returned too few predictions.')
    }

    const baseMargin = baseBest.confidence - baseSecond.confidence
    const baseDecision = makeDecision(baseBest.confidence, baseMargin)

    // Public recognition must remain a genuine 250-class decision. The
    // previous three-class motion/specialist overrides had no "unknown"
    // class, so they could collapse unrelated input to grandpa. Keep their
    // learned samples isolated from this path and use only the raw public
    // model probabilities here.
    const isAmbiguousFamilySign = FAMILY_SPECIALIST_SIGNS.has(
      baseBest.sign,
    )
    const confirmationCandidates = isAmbiguousFamilySign
      ? FAMILY_SPECIALIST_LABELS.map((sign) => {
          const index = labels.indexOf(sign)

          return {
            confidence: index >= 0 ? scores[index]! : 0,
            index,
            sign,
          }
        }).sort((left, right) => right.confidence - left.confidence)
      : undefined
    const decision =
      isAmbiguousFamilySign && baseDecision !== 'rejected'
        ? 'confirmation'
        : baseDecision

    return {
      candidates: baseCandidates,
      confirmationCandidates,
      confidence: baseBest.confidence,
      decision,
      margin: baseMargin,
      model: '250-sign',
      sign: baseBest.sign,
    }
  } finally {
    input.dispose()
    output?.dispose()
    temporalFeatures?.dispose()
  }
}
