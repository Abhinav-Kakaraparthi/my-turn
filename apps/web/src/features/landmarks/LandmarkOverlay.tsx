import { useEffect, useRef, type RefObject } from 'react'
import type { LandmarkFrame } from './landmarkWorker.types'
import './LandmarkOverlay.css'

type LandmarkOverlayProps = {
  frame: LandmarkFrame | null
  videoRef: RefObject<HTMLVideoElement | null>
}

type Projection = {
  cropX: number
  cropY: number
  renderedHeight: number
  renderedWidth: number
  width: number
}

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
] as const

const POSE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
] as const

function projectPoint(
  coordinates: Float32Array,
  index: number,
  projection: Projection,
) {
  const offset = index * 2

  if (offset + 1 >= coordinates.length) {
    return null
  }

  const normalizedX = coordinates[offset]
  const normalizedY = coordinates[offset + 1]

  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    return null
  }

  const unmirroredX =
    normalizedX * projection.renderedWidth - projection.cropX

  return {
    x: projection.width - unmirroredX,
    y: normalizedY * projection.renderedHeight - projection.cropY,
  }
}

function drawConnections(
  context: CanvasRenderingContext2D,
  coordinates: Float32Array,
  connections: readonly (readonly [number, number])[],
  projection: Projection,
  color: string,
  lineWidth: number,
) {
  context.beginPath()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = lineWidth
  context.strokeStyle = color

  connections.forEach(([startIndex, endIndex]) => {
    const start = projectPoint(coordinates, startIndex, projection)
    const end = projectPoint(coordinates, endIndex, projection)

    if (!start || !end) {
      return
    }

    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
  })

  context.stroke()
}

function drawPoints(
  context: CanvasRenderingContext2D,
  coordinates: Float32Array,
  projection: Projection,
  color: string,
  radius: number,
) {
  context.beginPath()
  context.fillStyle = color

  for (let index = 0; index < coordinates.length / 2; index += 1) {
    const point = projectPoint(coordinates, index, projection)

    if (!point) {
      continue
    }

    context.moveTo(point.x + radius, point.y)
    context.arc(point.x, point.y, radius, 0, Math.PI * 2)
  }

  context.fill()
}

function createProjection(
  video: HTMLVideoElement,
  width: number,
  height: number,
): Projection {
  const scale = Math.max(
    width / video.videoWidth,
    height / video.videoHeight,
  )
  const renderedWidth = video.videoWidth * scale
  const renderedHeight = video.videoHeight * scale

  return {
    cropX: (renderedWidth - width) / 2,
    cropY: (renderedHeight - height) / 2,
    renderedHeight,
    renderedWidth,
    width,
  }
}

export function LandmarkOverlay({
  frame,
  videoRef,
}: LandmarkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current

    if (!canvas || !video) {
      return
    }

    const context = canvas.getContext('2d')
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    if (!context || width === 0 || height === 0) {
      return
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const pixelWidth = Math.round(width * pixelRatio)
    const pixelHeight = Math.round(height * pixelRatio)

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, width, height)

    if (!frame || video.videoWidth === 0 || video.videoHeight === 0) {
      return
    }

    const projection = createProjection(video, width, height)

    drawConnections(
      context,
      frame.pose,
      POSE_CONNECTIONS,
      projection,
      'rgba(255, 255, 255, 0.72)',
      1.8,
    )
    drawPoints(
      context,
      frame.pose,
      projection,
      'rgba(255, 255, 255, 0.9)',
      2,
    )
    drawPoints(
      context,
      frame.face,
      projection,
      'rgba(112, 224, 184, 0.64)',
      0.85,
    )

    drawConnections(
      context,
      frame.leftHand,
      HAND_CONNECTIONS,
      projection,
      '#70e0b8',
      2.5,
    )
    drawPoints(
      context,
      frame.leftHand,
      projection,
      '#d9fff1',
      2.5,
    )

    drawConnections(
      context,
      frame.rightHand,
      HAND_CONNECTIONS,
      projection,
      '#ffbd59',
      2.5,
    )
    drawPoints(
      context,
      frame.rightHand,
      projection,
      '#fff1d8',
      2.5,
    )
  }, [frame, videoRef])

  return (
    <canvas
      ref={canvasRef}
      className="landmark-overlay"
      aria-hidden="true"
    />
  )
}