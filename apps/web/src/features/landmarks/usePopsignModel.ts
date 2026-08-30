import { useEffect, useState } from 'react'
import { loadPopsignModel } from './popsignModel'

export type PopsignModelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The 250-sign recognition model could not be loaded.'
}

export function usePopsignModel(enabled: boolean) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [status, setStatus] = useState<PopsignModelStatus>('idle')

  useEffect(() => {
    let active = true

    const loadTimer = window.setTimeout(() => {
      if (!active) {
        return
      }

      if (!enabled) {
        setErrorMessage(null)
        setStatus('idle')
        return
      }

      setErrorMessage(null)
      setStatus('loading')

      void loadPopsignModel()
        .then(() => {
          if (active) {
            setStatus('ready')
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setErrorMessage(describeError(error))
            setStatus('error')
          }
        })
    }, 0)

    return () => {
      active = false
      window.clearTimeout(loadTimer)
    }
  }, [enabled])

  return { errorMessage, status }
}
