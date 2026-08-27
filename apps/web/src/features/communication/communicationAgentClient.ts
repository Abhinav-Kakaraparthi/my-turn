const DEFAULT_AGENT_BASE_URL = 'http://127.0.0.1:8080'

const agentBaseUrl = (
  import.meta.env.VITE_MY_TURN_AGENT_URL ?? DEFAULT_AGENT_BASE_URL
).replace(/\/+$/, '')

const sessionId = crypto.randomUUID()

export type CommunicationDraft = {
  caption: string
  clarificationQuestion: string | null
  needsUserConfirmation: boolean
  speechText: string
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
      user_id: 'local-browser-user',
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
