const DEFAULT_AGENT_BASE_URL = 'http://127.0.0.1:8080'

const agentBaseUrl = (
  import.meta.env.VITE_MY_TURN_AGENT_URL ?? DEFAULT_AGENT_BASE_URL
).replace(/\/+$/, '')

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const USER_ID_KEY = 'my-turn-user-id-v1'
const SESSION_ID_KEY = 'my-turn-session-id-v1'

function getOrCreateId(
  storage: Storage,
  key: string,
  prefix: string,
) {
  try {
    const existing = storage.getItem(key)

    if (existing && SAFE_ID_PATTERN.test(existing)) {
      return existing
    }

    const created = `${prefix}-${crypto.randomUUID()}`

    storage.setItem(key, created)
    return created
  } catch {
    return `${prefix}-${crypto.randomUUID()}`
  }
}

const userId = getOrCreateId(
  window.localStorage,
  USER_ID_KEY,
  'browser',
)
const sessionId = getOrCreateId(
  window.sessionStorage,
  SESSION_ID_KEY,
  'session',
)

export type CommunicationDraft = {
  caption: string
  clarificationQuestion: string | null
  needsUserConfirmation: boolean
  speechText: string
}

export type ConfirmedCommunicationMemory = {
  eventId: string
  predictedSign: string
  confirmedSign: string
  caption: string
  speechText: string
  model: string
  confidence: number
  margin: number
}

export type RecognitionCorrectionEvidence = {
  communicationEventId: string | null
  confidence: number
  correctedSign: string
  correctionId: string
  durationMs: number
  margin: number
  model: string
  modelVersion: string
  predictedSign: string
  sequenceId: number
  supersedesCorrectionId: string | null
  values: Float32Array
}

export type StoredCommunicationMemory = {
  id: string
  recognizedSign: string
  caption: string
  speechText: string
  createdAt: string
}

type AgentEvent = {
  content?: {
    parts?: Array<{
      text?: unknown
    }>
  }
  finishReason?: unknown
}

function parseCommunicationDraft(
  value: unknown,
): CommunicationDraft | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  const clarificationQuestion = candidate.clarification_question

  if (
    typeof candidate.caption !== 'string' ||
    typeof candidate.speech_text !== 'string' ||
    typeof candidate.needs_user_confirmation !== 'boolean' ||
    !(
      clarificationQuestion === null ||
      typeof clarificationQuestion === 'string'
    )
  ) {
    return null
  }

  return {
    caption: candidate.caption,
    clarificationQuestion,
    needsUserConfirmation: candidate.needs_user_confirmation,
    speechText: candidate.speech_text,
  }
}

function extractDraft(payload: unknown) {
  const events = (
    Array.isArray(payload) ? payload : [payload]
  ) as AgentEvent[]

  for (
    let eventIndex = events.length - 1;
    eventIndex >= 0;
    eventIndex -= 1
  ) {
    const event = events[eventIndex]

    if (event.finishReason === 'MAX_TOKENS') {
      throw new Error(
        'Gemini stopped before completing the communication draft.',
      )
    }

    const parts = event.content?.parts ?? []

    for (
      let partIndex = parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const text = parts[partIndex].text

      if (typeof text !== 'string') {
        continue
      }

      try {
        const draft = parseCommunicationDraft(JSON.parse(text))

        if (draft) {
          return draft
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          continue
        }

        throw error
      }
    }
  }

  throw new Error(
    'The communication agent returned no valid draft.',
  )
}

export async function requestCommunicationDraft(
  confirmedPhrase: string,
  recentContext: string[] = [],
  signal?: AbortSignal,
) {
  const normalizedPhrase = confirmedPhrase.trim()

  if (!normalizedPhrase) {
    throw new Error(
      'A confirmed phrase is required before drafting.',
    )
  }

  const response = await fetch(`${agentBaseUrl}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_name: 'my_turn_agent',
      user_id: userId,
      session_id: sessionId,
      new_message: {
        role: 'user',
        parts: [
          {
            text: JSON.stringify({
              confirmed_phrase: normalizedPhrase,
              recent_context: recentContext.slice(-6),
            }),
          },
        ],
      },
      streaming: false,
    }),
    credentials: 'omit',
    signal,
  })

  if (!response.ok) {
    throw new Error(
      `The communication agent request failed with status ${response.status}.`,
    )
  }

  return extractDraft(await response.json())
}

export async function saveConfirmedCommunication(
  memory: ConfirmedCommunicationMemory,
) {
  const response = await fetch(`${agentBaseUrl}/memory/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_id: memory.eventId,
      user_id: userId,
      session_id: sessionId,
      predicted_sign: memory.predictedSign,
      confirmed_sign: memory.confirmedSign,
      caption: memory.caption,
      speech_text: memory.speechText,
      model: memory.model,
      confidence: memory.confidence,
      margin: memory.margin,
    }),
    credentials: 'omit',
  })

  if (!response.ok) {
    throw new Error(
      `Cloud memory could not save this communication (status ${response.status}).`,
    )
  }
}

function encodeFloat32Values(values: Float32Array) {
  const bytes = new Uint8Array(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  )
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    )
  }

  return window.btoa(binary)
}

export async function saveRecognitionCorrection(
  correction: RecognitionCorrectionEvidence,
) {
  const response = await fetch(
    `${agentBaseUrl}/feedback/corrections`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        correction_id: correction.correctionId,
        communication_event_id: correction.communicationEventId,
        user_id: userId,
        session_id: sessionId,
        predicted_sign: correction.predictedSign,
        corrected_sign: correction.correctedSign,
        model: correction.model,
        model_version: correction.modelVersion,
        confidence: correction.confidence,
        margin: correction.margin,
        duration_ms: Math.max(
          1,
          Math.round(correction.durationMs),
        ),
        sequence_id: correction.sequenceId,
        supersedes_correction_id:
          correction.supersedesCorrectionId,
        landmark_values_base64: encodeFloat32Values(
          correction.values,
        ),
      }),
      credentials: 'omit',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Training feedback could not reach cloud storage (status ${response.status}).`,
    )
  }
}

export async function loadRecentCommunicationMemory() {
  const parameters = new URLSearchParams({
    user_id: userId,
    limit: '6',
  })
  const response = await fetch(
    `${agentBaseUrl}/memory/recent?${parameters.toString()}`,
    {
      credentials: 'omit',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Cloud memory could not load recent communications (status ${response.status}).`,
    )
  }

  const payload: unknown = await response.json()

  if (!payload || typeof payload !== 'object') {
    throw new Error('Cloud memory returned an invalid response.')
  }

  const items = (payload as { items?: unknown }).items

  if (!Array.isArray(items)) {
    throw new Error('Cloud memory returned no communication list.')
  }

  return items.flatMap((value): StoredCommunicationMemory[] => {
    if (!value || typeof value !== 'object') {
      return []
    }

    const item = value as Record<string, unknown>

    if (
      typeof item.id !== 'string' ||
      typeof item.recognized_sign !== 'string' ||
      typeof item.caption !== 'string' ||
      typeof item.speech_text !== 'string' ||
      typeof item.created_at !== 'string'
    ) {
      return []
    }

    return [{
      id: item.id,
      recognizedSign: item.recognized_sign,
      caption: item.caption,
      speechText: item.speech_text,
      createdAt: item.created_at,
    }]
  })
}
