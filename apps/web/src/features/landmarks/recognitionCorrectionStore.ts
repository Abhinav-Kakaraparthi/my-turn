import type {
  CapturedPopsignSequence,
  CapturedSignSequence,
} from './landmarkWorker.types'
import type { PopsignPrediction } from './popsignModel'
import {
  rankPersonalizedSignMatches,
} from './personalizedSignRecognizer'
import type { PersonalizedSignSample } from './personalizedSignStore'

const DATABASE_NAME = 'my-turn-recognition-corrections'
const DATABASE_VERSION = 1
const CORRECTION_STORE = 'recognition-corrections'
const CORRECTION_SCHEMA_VERSION = 'popsign-64x94x4-v1'
const CORRECTION_FEATURE_SIZE = 94 * 4
const CORRECTION_FRAME_COUNT = 64
const MINIMUM_OVERRIDE_SIMILARITY = 0.88
const MINIMUM_LABEL_LEAD = 0.025

let databasePromise: Promise<IDBDatabase> | null = null

export type RecognitionCorrectionSample = PersonalizedSignSample & {
  confidence: number
  correctedSign: string
  durationMs: number
  margin: number
  model: PopsignPrediction['model']
  modelVersion: string
  predictedSign: string
  sequenceId: number
  supersedesCorrectionId: string | null
}

type SaveRecognitionCorrectionInput = {
  correctedSign: string
  modelVersion: string
  prediction: PopsignPrediction
  sequence: CapturedPopsignSequence
  supersedesSampleId?: string
}

export type RecognitionCorrectionMatch = {
  correctedSign: string
  sampleId: string
  similarity: number
}

function describeDatabaseError(
  request: IDBRequest | IDBOpenDBRequest,
  fallback: string,
) {
  return request.error?.message ?? fallback
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => {
      reject(
        transaction.error ??
          new Error('The correction-memory transaction failed.'),
      )
    }
    transaction.onabort = () => {
      reject(
        transaction.error ??
          new Error('The correction-memory transaction was cancelled.'),
      )
    }
  })
}

function openDatabase() {
  if (databasePromise) {
    return databasePromise
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(
        new Error(
          'This browser does not support local correction memory.',
        ),
      )
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(CORRECTION_STORE)) {
        const store = database.createObjectStore(CORRECTION_STORE, {
          keyPath: 'id',
        })

        store.createIndex('capturedAt', 'capturedAt')
        store.createIndex('predictedSign', 'predictedSign')
        store.createIndex('correctedSign', 'correctedSign')
      }
    }

    request.onsuccess = () => {
      const database = request.result

      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }

      resolve(database)
    }

    request.onerror = () => {
      databasePromise = null
      reject(
        new Error(
          describeDatabaseError(
            request,
            'The local correction memory could not open.',
          ),
        ),
      )
    }
  })

  return databasePromise
}

function toComparableSequence(
  sequence: CapturedPopsignSequence,
): CapturedSignSequence {
  return {
    featureSize: CORRECTION_FEATURE_SIZE,
    frameCount: CORRECTION_FRAME_COUNT,
    schemaVersion: CORRECTION_SCHEMA_VERSION,
    values: sequence.values,
  }
}

function validateSequence(sequence: CapturedPopsignSequence) {
  const expectedValues =
    CORRECTION_FEATURE_SIZE * CORRECTION_FRAME_COUNT

  if (sequence.values.length !== expectedValues) {
    throw new RangeError(
      `The correction sequence contains ${sequence.values.length} values; expected ${expectedValues}.`,
    )
  }
}

export async function listRecognitionCorrections() {
  const database = await openDatabase()
  const transaction = database.transaction(
    CORRECTION_STORE,
    'readonly',
  )
  const completion = waitForTransaction(transaction)
  const request = transaction.objectStore(CORRECTION_STORE).getAll()

  const samples = await new Promise<RecognitionCorrectionSample[]>(
    (resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result as RecognitionCorrectionSample[])
      }
      request.onerror = () => {
        reject(
          new Error(
            describeDatabaseError(
              request,
              'Recognition corrections could not be loaded.',
            ),
          ),
        )
      }
    },
  )

  await completion
  return samples.sort((left, right) =>
    right.capturedAt.localeCompare(left.capturedAt),
  )
}

export async function saveRecognitionCorrectionSample({
  correctedSign,
  modelVersion,
  prediction,
  sequence,
  supersedesSampleId,
}: SaveRecognitionCorrectionInput) {
  const normalizedSign = correctedSign.trim()

  if (!normalizedSign) {
    throw new Error('Choose the intended sign before saving.')
  }

  validateSequence(sequence)

  const sample: RecognitionCorrectionSample = {
    capturedAt: new Date().toISOString(),
    confidence: prediction.confidence,
    correctedSign: normalizedSign,
    durationMs: sequence.durationMs,
    featureSize: CORRECTION_FEATURE_SIZE,
    frameCount: CORRECTION_FRAME_COUNT,
    id: crypto.randomUUID(),
    margin: prediction.margin,
    model: prediction.model,
    modelVersion,
    phrase: normalizedSign,
    predictedSign: prediction.sign,
    schemaVersion: CORRECTION_SCHEMA_VERSION,
    sequenceId: sequence.sequenceId,
    supersedesCorrectionId: supersedesSampleId ?? null,
    values: new Float32Array(sequence.values),
  }

  const database = await openDatabase()
  const transaction = database.transaction(
    CORRECTION_STORE,
    'readwrite',
  )
  const completion = waitForTransaction(transaction)

  const store = transaction.objectStore(CORRECTION_STORE)

  if (supersedesSampleId) {
    store.delete(supersedesSampleId)
  }

  store.put(sample)
  await completion

  return sample
}

export function findRecognitionCorrection(
  sequence: CapturedPopsignSequence,
  predictedSign: string,
  samples: RecognitionCorrectionSample[],
): RecognitionCorrectionMatch | null {
  validateSequence(sequence)

  const relevantSamples = samples.filter(
    (sample) => sample.predictedSign === predictedSign,
  )

  if (relevantSamples.length === 0) {
    return null
  }

  const matches = rankPersonalizedSignMatches(
    toComparableSequence(sequence),
    relevantSamples,
  )
  const bestMatch = matches[0]

  if (
    !bestMatch ||
    bestMatch.similarity < MINIMUM_OVERRIDE_SIMILARITY
  ) {
    return null
  }

  const competingLabel = matches.find(
    (match) => match.phrase !== bestMatch.phrase,
  )

  if (
    competingLabel &&
    bestMatch.similarity - competingLabel.similarity <
      MINIMUM_LABEL_LEAD
  ) {
    return null
  }

  return {
    correctedSign: bestMatch.phrase,
    sampleId: bestMatch.sampleId,
    similarity: bestMatch.similarity,
  }
}
