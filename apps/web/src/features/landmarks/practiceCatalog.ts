import {
  PRACTICE_CHANNEL_COUNT,
  PRACTICE_FRAME_COUNT,
  PRACTICE_LANDMARK_COUNT,
} from './practiceReference'

const PRACTICE_CATALOG_ROOT = '/models/practice/references'
const PRACTICE_VALUE_COUNT =
  PRACTICE_FRAME_COUNT *
  PRACTICE_LANDMARK_COUNT *
  PRACTICE_CHANNEL_COUNT

export type PracticeCatalogEntry = {
  file: string
  participantId: number
  sequenceId: number
  sha256: string
  sign: string
  sourceFrameCount: number
}

export type PracticeCatalog = {
  dtype: 'float32-little-endian'
  references: PracticeCatalogEntry[]
  schemaVersion: 2
  shape: [number, number, number]
  source: {
    dataset: string
    name: string
    terms: string
    url: string
  }
}

export type LoadedPracticeReference = {
  catalog: PracticeCatalog
  entry: PracticeCatalogEntry
  values: Float32Array
}

let catalogPromise: Promise<PracticeCatalog> | null = null
const referencePromises = new Map<
  string,
  Promise<LoadedPracticeReference>
>()

function describeResponse(response: Response) {
  return `${response.status} ${response.statusText}`.trim()
}

function validateEntry(value: unknown): PracticeCatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A practice catalog entry is invalid.')
  }

  const entry = value as Partial<PracticeCatalogEntry>

  if (
    typeof entry.sign !== 'string' ||
    entry.sign.length === 0 ||
    typeof entry.file !== 'string' ||
    !entry.file.endsWith('.bin') ||
    typeof entry.participantId !== 'number' ||
    typeof entry.sequenceId !== 'number' ||
    typeof entry.sourceFrameCount !== 'number' ||
    typeof entry.sha256 !== 'string'
  ) {
    throw new Error('A practice catalog entry has an unsupported format.')
  }

  return entry as PracticeCatalogEntry
}

function validateCatalog(value: unknown): PracticeCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The practice catalog is invalid.')
  }

  const catalog = value as Partial<PracticeCatalog>

  if (
    catalog.schemaVersion !== 2 ||
    catalog.dtype !== 'float32-little-endian' ||
    !Array.isArray(catalog.shape) ||
    catalog.shape[0] !== PRACTICE_FRAME_COUNT ||
    catalog.shape[1] !== PRACTICE_LANDMARK_COUNT ||
    catalog.shape[2] !== PRACTICE_CHANNEL_COUNT ||
    !Array.isArray(catalog.references) ||
    catalog.references.length !== 250 ||
    !catalog.source ||
    typeof catalog.source.url !== 'string'
  ) {
    throw new Error('The practice catalog has an unsupported format.')
  }

  const references = catalog.references.map(validateEntry)
  const signs = new Set(references.map((entry) => entry.sign))

  if (signs.size !== references.length) {
    throw new Error('The practice catalog contains duplicate signs.')
  }

  return {
    ...(catalog as PracticeCatalog),
    references,
  }
}

async function createCatalog() {
  const response = await fetch(`${PRACTICE_CATALOG_ROOT}/index.json`)

  if (!response.ok) {
    throw new Error(
      `The 250-sign practice catalog could not be loaded (${describeResponse(response)}).`,
    )
  }

  return validateCatalog(await response.json())
}

export function loadPracticeCatalog() {
  catalogPromise ??= createCatalog().catch((error: unknown) => {
    catalogPromise = null
    throw error
  })

  return catalogPromise
}

export function loadPracticeReference(sign: string) {
  const normalizedSign = sign.trim().toLowerCase()
  const cached = referencePromises.get(normalizedSign)

  if (cached) {
    return cached
  }

  const promise = loadPracticeCatalog()
    .then(async (catalog) => {
      const entry = catalog.references.find(
        (candidate) => candidate.sign === normalizedSign,
      )

      if (!entry) {
        throw new Error(`No practice reference exists for “${normalizedSign}”.`)
      }

      const response = await fetch(
        `${PRACTICE_CATALOG_ROOT}/${entry.file}`,
      )

      if (!response.ok) {
        throw new Error(
          `The ${normalizedSign} landmarks could not be loaded (${describeResponse(response)}).`,
        )
      }

      const buffer = await response.arrayBuffer()

      if (
        buffer.byteLength !==
        PRACTICE_VALUE_COUNT * Float32Array.BYTES_PER_ELEMENT
      ) {
        throw new Error(
          `The ${normalizedSign} landmark file has an unexpected size.`,
        )
      }

      return {
        catalog,
        entry,
        values: new Float32Array(buffer),
      }
    })
    .catch((error: unknown) => {
      referencePromises.delete(normalizedSign)
      throw error
    })

  referencePromises.set(normalizedSign, promise)
  return promise
}
