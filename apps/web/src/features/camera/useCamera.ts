import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'busy'
  | 'error'

type CameraFailure = {
  status: Exclude<CameraStatus, 'idle' | 'requesting' | 'active'>
  message: string
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function describeCameraFailure(error: unknown): CameraFailure {
  if (!(error instanceof DOMException)) {
    return {
      status: 'error',
      message: 'The camera could not be started. Please try again.',
    }
  }

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        status: 'denied',
        message:
          'Camera access was blocked. Allow camera access in your browser settings and try again.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        status: 'unavailable',
        message: 'No compatible camera was found on this device.',
      }
    case 'NotReadableError':
    case 'AbortError':
      return {
        status: 'busy',
        message:
          'The camera is unavailable or being used by another application.',
      }
    default:
      return {
        status: 'error',
        message: 'The camera could not be started. Please try again.',
      }
  }
}

export function useCamera() {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(true)

  const stopCamera = useCallback(() => {
    stopTracks(streamRef.current)
    streamRef.current = null

    if (mountedRef.current) {
      setStream(null)
      setStatus('idle')
      setErrorMessage(null)
    }
  }, [])

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable')
      setErrorMessage(
        'Camera access is not supported in this browser or connection.',
      )
      return
    }

    setStatus('requesting')
    setErrorMessage(null)

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })

      if (!mountedRef.current) {
        stopTracks(nextStream)
        return
      }

      stopTracks(streamRef.current)
      streamRef.current = nextStream
      setStream(nextStream)
      setStatus('active')
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      const failure = describeCameraFailure(error)
      setStatus(failure.status)
      setErrorMessage(failure.message)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      stopTracks(streamRef.current)
      streamRef.current = null
    }
  }, [])

  return {
    errorMessage,
    startCamera,
    status,
    stopCamera,
    stream,
  }
}
