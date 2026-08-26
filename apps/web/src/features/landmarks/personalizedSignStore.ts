import type { CapturedSignSequence } from './landmarkWorker.types'

const DATABASE_NAME = 'my-turn-personalization'
const DATABASE_VERSION = 1
const SAMPLE_STORE = 'sign-samples'

let databasePromise: Promise<IDBDatabase> | null = null

export type PersonalizedSignSample = {
  capturedAt: string
  featureSize: number
  frameCount: number
  id: string
  phrase: string
  schemaVersion: string
  values: Float32Array
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
          new Error('The local sign library transaction failed.'),
      )
    }
    transaction.onabort = () => {
      reject(
        transaction.error ??
          new Error('The local sign library transaction was cancelled.'),
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
          'This browser does not support local personalized sign storage.',
        ),
      )
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(SAMPLE_STORE)) {
        const store = database.createObjectStore(SAMPLE_STORE, {
          keyPath: 'id',
        })

        store.createIndex('capturedAt', 'capturedAt')
        store.createIndex('phrase', 'phrase')
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
            'The local personalized sign library could not open.',
          ),
        ),
      )
    }

    request.onblocked = () => {
      databasePromise = null
      reject(
        new Error(
          'Close other My Turn tabs before updating the local sign library.',
        ),
      )
    }
  })

  return databasePromise
}

export async function listPersonalizedSigns() {
  const database = await openDatabase()
  const transaction = database.transaction(SAMPLE_STORE, 'readonly')
  const completion = waitForTransaction(transaction)
  const request = transaction.objectStore(SAMPLE_STORE).getAll()

  const samples = await new Promise<PersonalizedSignSample[]>(
    (resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result as PersonalizedSignSample[])
      }

      request.onerror = () => {
        reject(
          new Error(
            describeDatabaseError(
              request,
              'Personalized signs could not be loaded.',
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

export async function savePersonalizedSign(
  phrase: string,
  sequence: CapturedSignSequence,
) {
  const normalizedPhrase = phrase.trim()

  if (!normalizedPhrase) {
    throw new Error('Enter the intended phrase before recording.')
  }

  if (normalizedPhrase.length > 120) {
    throw new Error('Keep the intended phrase below 120 characters.')
  }

  if (
    sequence.values.length !==
    sequence.featureSize * sequence.frameCount
  ) {
    throw new Error('The captured sign sequence has an invalid size.')
  }

  const sample: PersonalizedSignSample = {
    capturedAt: new Date().toISOString(),
    featureSize: sequence.featureSize,
    frameCount: sequence.frameCount,
    id: crypto.randomUUID(),
    phrase: normalizedPhrase,
    schemaVersion: sequence.schemaVersion,
    values: sequence.values,
  }

  const database = await openDatabase()
  const transaction = database.transaction(SAMPLE_STORE, 'readwrite')
  const completion = waitForTransaction(transaction)

  transaction.objectStore(SAMPLE_STORE).put(sample)

  await completion

  return sample
}

export async function deletePersonalizedSign(id: string) {
  const database = await openDatabase()
  const transaction = database.transaction(SAMPLE_STORE, 'readwrite')
  const completion = waitForTransaction(transaction)

  transaction.objectStore(SAMPLE_STORE).delete(id)

  await completion
}