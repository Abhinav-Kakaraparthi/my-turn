const PRACTICE_REFERENCE_ROOT = '/models/practice/hello'
const PRACTICE_FRAME_COUNT = 64
const PRACTICE_LANDMARK_COUNT = 94
const PRACTICE_CHANNEL_COUNT = 4
const PRACTICE_VALUES_PER_FRAME =
  PRACTICE_LANDMARK_COUNT * PRACTICE_CHANNEL_COUNT
const PRACTICE_VALUE_COUNT =
  PRACTICE_FRAME_COUNT * PRACTICE_VALUES_PER_FRAME

export type PracticeReferenceManifest = {
  dtype: string
  file: string
  modelConfidence: number
  schemaVersion: number
  shape: [number, number, number]
  sign: string
}

export type PracticeReference = {
  manifest: PracticeReferenceManifest
  values: Float32Array
}

let referencePromise: Promise<PracticeReference> | null = null

function describeResponse(response: Response) {
  return `${response.status} ${response.statusText}`.trim()
}

function validateManifest(
  value: unknown,
): PracticeReferenceManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The practice reference manifest is invalid.')
  }

  const manifest = value as Partial<PracticeReferenceManifest>

  if (
    manifest.schemaVersion !== 1 ||
    manifest.sign !== 'hello' ||
    manifest.dtype !== 'float32-little-endian' ||
    manifest.file !== 'hello.bin' ||
    !Array.isArray(manifest.shape) ||
    manifest.shape.length !== 3 ||
    manifest.shape[0] !== PRACTICE_FRAME_COUNT ||
    manifest.shape[1] !== PRACTICE_LANDMARK_COUNT ||
    manifest.shape[2] !== PRACTICE_CHANNEL_COUNT ||
    typeof manifest.modelConfidence !== 'number'
  ) {
    throw new Error('The hello practice reference has an unsupported format.')
  }

  return manifest as PracticeReferenceManifest
}

async function createReference() {
  const manifestResponse = await fetch(
    `${PRACTICE_REFERENCE_ROOT}/manifest.json`,
  )

  if (!manifestResponse.ok) {
    throw new Error(
      `The practice manifest could not be loaded (${describeResponse(manifestResponse)}).`,
    )
  }

  const manifest = validateManifest(await manifestResponse.json())
  const binaryResponse = await fetch(
    `${PRACTICE_REFERENCE_ROOT}/${manifest.file}`,
  )

  if (!binaryResponse.ok) {
    throw new Error(
      `The practice landmarks could not be loaded (${describeResponse(binaryResponse)}).`,
    )
  }

  const buffer = await binaryResponse.arrayBuffer()

  if (buffer.byteLength !== PRACTICE_VALUE_COUNT * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('The hello practice landmark file has an unexpected size.')
  }

  return {
    manifest,
    values: new Float32Array(buffer),
  }
}

export function loadHelloPracticeReference() {
  referencePromise ??= createReference().catch((error: unknown) => {
    referencePromise = null
    throw error
  })

  return referencePromise
}

export function getPracticeReferenceFrame(
  reference: PracticeReference,
  frameIndex: number,
) {
  const start = frameIndex * PRACTICE_VALUES_PER_FRAME

  return reference.values.subarray(
    start,
    start + PRACTICE_VALUES_PER_FRAME,
  )
}

export {
  PRACTICE_CHANNEL_COUNT,
  PRACTICE_FRAME_COUNT,
  PRACTICE_LANDMARK_COUNT,
  PRACTICE_VALUES_PER_FRAME,
}
