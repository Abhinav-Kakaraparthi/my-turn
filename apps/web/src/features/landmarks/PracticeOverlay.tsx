import { useEffect, useRef, type RefObject } from 'react'
import type { LandmarkFrame } from './landmarkWorker.types'
import { PRACTICE_CHANNEL_COUNT } from './practiceReference'
import './PracticeOverlay.css'

type PracticeOverlayProps = {
  enabled: boolean
  frame: LandmarkFrame | null
  targetFrame: Float32Array | null
  videoRef: RefObject<HTMLVideoElement | null>
}

type Projection = {
  cropX: number
  cropY: number
  renderedHeight: number
  renderedWidth: number
  width: number
}

type ReferenceTransform = {
  currentAnchorX: number
  currentAnchorY: number
  scale: number
  targetAnchorX: number
  targetAnchorY: number
}

const LEFT_HAND_OFFSET = 40
const POSE_OFFSET = 61
const RIGHT_HAND_OFFSET = 73
const LEFT_MOUTH_CORNER = 61
const RIGHT_MOUTH_CORNER = 291
const TARGET_LEFT_MOUTH_CORNER = 0
const TARGET_RIGHT_MOUTH_CORNER = 10
const MIDDLE_FINGER_MCP = 9

const HAND_CONNECTIONS = [
  [0, 1],[1, 2],[2, 3],[3, 4],
  [0, 5],[5, 6],[6, 7],[7, 8],
  [5, 9],[9, 10],[10, 11],[11, 12],
  [9, 13],[13, 14],[14, 15],[15, 16],
  [13, 17],[0, 17],[17, 18],[18, 19],[19, 20],
] as const

const POSE_CONNECTIONS = [
  [0, 1],
  [0, 2],[2, 4],
  [1, 3],[3, 5],
] as const

const OUTER_LIP_CONNECTIONS = Array.from(
  { length: 20 },
  (_, index) => [index, (index + 1) % 20] as const,
)

const INNER_LIP_CONNECTIONS = Array.from(
  { length: 20 },
  (_, index) => [20 + index, 20 + ((index + 1) % 20)] as const,
)

const ARROW_LANDMARKS = [0, 4, 8, 12, 16, 20] as const

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

function projectNormalizedPoint(
  normalizedX: number,
  normalizedY: number,
  projection: Projection,
) {
  const unmirroredX =
    normalizedX * projection.renderedWidth - projection.cropX

  return {
    x: projection.width - unmirroredX,
    y: normalizedY * projection.renderedHeight - projection.cropY,
  }
}

function readRawPoint(coordinates: Float32Array, index: number) {
  const offset = index * 2

  if (offset + 1 >= coordinates.length) {
    return null
  }

  const x = coordinates[offset]
  const y = coordinates[offset + 1]

  return Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : null
}

function readTargetPoint(
  targetFrame: Float32Array,
  landmarkOffset: number,
) {
  const offset = landmarkOffset * PRACTICE_CHANNEL_COUNT

  if (targetFrame[offset + 3] !== 1) {
    return null
  }

  const x = targetFrame[offset]
  const y = targetFrame[offset + 1]

  return Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : null
}

function midpoint(
  left: { x: number; y: number },
  right: { x: number; y: number },
) {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  }
}

function pointDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function createReferenceTransforms(
  frame: LandmarkFrame,
  targetFrame: Float32Array,
) {
  const leftShoulder = readRawPoint(frame.pose, 11)
  const rightShoulder = readRawPoint(frame.pose, 12)
  const targetLeftShoulder = readTargetPoint(
    targetFrame,
    POSE_OFFSET,
  )
  const targetRightShoulder = readTargetPoint(
    targetFrame,
    POSE_OFFSET + 1,
  )
  const leftMouth = readRawPoint(frame.face, LEFT_MOUTH_CORNER)
  const rightMouth = readRawPoint(frame.face, RIGHT_MOUTH_CORNER)
  const targetLeftMouth = readTargetPoint(
    targetFrame,
    TARGET_LEFT_MOUTH_CORNER,
  )
  const targetRightMouth = readTargetPoint(
    targetFrame,
    TARGET_RIGHT_MOUTH_CORNER,
  )

  if (
    !leftShoulder ||
    !rightShoulder ||
    !targetLeftShoulder ||
    !targetRightShoulder ||
    !leftMouth ||
    !rightMouth ||
    !targetLeftMouth ||
    !targetRightMouth
  ) {
    return null
  }

  const currentShoulderWidth = pointDistance(
    leftShoulder,
    rightShoulder,
  )
  const targetShoulderWidth = pointDistance(
    targetLeftShoulder,
    targetRightShoulder,
  )
  const currentMouthWidth = pointDistance(leftMouth, rightMouth)
  const targetMouthWidth = pointDistance(
    targetLeftMouth,
    targetRightMouth,
  )

  if (
    currentShoulderWidth < 0.0001 ||
    targetShoulderWidth < 0.0001 ||
    currentMouthWidth < 0.0001 ||
    targetMouthWidth < 0.0001
  ) {
    return null
  }

  const currentMouthCenter = midpoint(leftMouth, rightMouth)
  const targetMouthCenter = midpoint(
    targetLeftMouth,
    targetRightMouth,
  )
  const bodyScale = currentShoulderWidth / targetShoulderWidth
  const mouthScale = currentMouthWidth / targetMouthWidth

  return {
    body: {
      currentAnchorX: currentMouthCenter.x,
      currentAnchorY: currentMouthCenter.y,
      scale: bodyScale,
      targetAnchorX: targetMouthCenter.x,
      targetAnchorY: targetMouthCenter.y,
    },
    mouth: {
      currentAnchorX: currentMouthCenter.x,
      currentAnchorY: currentMouthCenter.y,
      scale: mouthScale,
      targetAnchorX: targetMouthCenter.x,
      targetAnchorY: targetMouthCenter.y,
    },
  }
}

function projectTargetPoint(
  targetFrame: Float32Array,
  landmarkOffset: number,
  transform: ReferenceTransform,
  projection: Projection,
) {
  const point = readTargetPoint(targetFrame, landmarkOffset)

  if (!point) {
    return null
  }

  return projectNormalizedPoint(
    transform.currentAnchorX +
      (point.x - transform.targetAnchorX) * transform.scale,
    transform.currentAnchorY +
      (point.y - transform.targetAnchorY) * transform.scale,
    projection,
  )
}

function mapTargetPoint(
  targetFrame: Float32Array,
  landmarkOffset: number,
  transform: ReferenceTransform,
) {
  const point = readTargetPoint(targetFrame, landmarkOffset)

  if (!point) {
    return null
  }

  return {
    x:
      transform.currentAnchorX +
      (point.x - transform.targetAnchorX) * transform.scale,
    y:
      transform.currentAnchorY +
      (point.y - transform.targetAnchorY) * transform.scale,
  }
}

function createHandTransform(
  frame: LandmarkFrame,
  targetFrame: Float32Array,
  handOffset: number,
  bodyTransform: ReferenceTransform,
) {
  const currentHand =
    handOffset === RIGHT_HAND_OFFSET
      ? frame.rightHand
      : frame.leftHand
  const currentWrist = readRawPoint(currentHand, 0)
  const currentMiddleMcp = readRawPoint(
    currentHand,
    MIDDLE_FINGER_MCP,
  )
  const targetWrist = readTargetPoint(targetFrame, handOffset)
  const targetMiddleMcp = readTargetPoint(
    targetFrame,
    handOffset + MIDDLE_FINGER_MCP,
  )
  const targetWristPosition = mapTargetPoint(
    targetFrame,
    handOffset,
    bodyTransform,
  )

  if (
    !currentWrist ||
    !currentMiddleMcp ||
    !targetWrist ||
    !targetMiddleMcp ||
    !targetWristPosition
  ) {
    return bodyTransform
  }

  const currentHandScale = pointDistance(
    currentWrist,
    currentMiddleMcp,
  )
  const targetHandScale = pointDistance(
    targetWrist,
    targetMiddleMcp,
  )

  if (currentHandScale < 0.0001 || targetHandScale < 0.0001) {
    return bodyTransform
  }

  return {
    currentAnchorX: targetWristPosition.x,
    currentAnchorY: targetWristPosition.y,
    scale: currentHandScale / targetHandScale,
    targetAnchorX: targetWrist.x,
    targetAnchorY: targetWrist.y,
  }
}

function drawTargetConnections(
  context: CanvasRenderingContext2D,
  targetFrame: Float32Array,
  landmarkOffset: number,
  connections: readonly (readonly [number, number])[],
  transform: ReferenceTransform,
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
    const start = projectTargetPoint(
      targetFrame,
      landmarkOffset + startIndex,
      transform,
      projection,
    )
    const end = projectTargetPoint(
      targetFrame,
      landmarkOffset + endIndex,
      transform,
      projection,
    )

    if (!start || !end) {
      return
    }

    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
  })

  context.stroke()
}

function drawTargetPoints(
  context: CanvasRenderingContext2D,
  targetFrame: Float32Array,
  landmarkOffset: number,
  count: number,
  transform: ReferenceTransform,
  projection: Projection,
  color: string,
  radius: number,
) {
  context.beginPath()
  context.fillStyle = color

  for (let index = 0; index < count; index += 1) {
    const point = projectTargetPoint(
      targetFrame,
      landmarkOffset + index,
      transform,
      projection,
    )

    if (!point) {
      continue
    }

    context.moveTo(point.x + radius, point.y)
    context.arc(point.x, point.y, radius, 0, Math.PI * 2)
  }

  context.fill()
}

function countValidTargetHand(
  targetFrame: Float32Array,
  handOffset: number,
) {
  let count = 0

  for (let index = 0; index < 21; index += 1) {
    const offset = (handOffset + index) * PRACTICE_CHANNEL_COUNT

    if (targetFrame[offset + 3] === 1) {
      count += 1
    }
  }

  return count
}

function drawArrow(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const headLength = 8

  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x, end.y)
  context.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 6),
    end.y - headLength * Math.sin(angle - Math.PI / 6),
  )
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 6),
    end.y - headLength * Math.sin(angle + Math.PI / 6),
  )
  context.stroke()
}

function drawCorrectionArrows(
  context: CanvasRenderingContext2D,
  frame: LandmarkFrame,
  targetFrame: Float32Array,
  transform: ReferenceTransform,
  projection: Projection,
) {
  const leftCount = countValidTargetHand(
    targetFrame,
    LEFT_HAND_OFFSET,
  )
  const rightCount = countValidTargetHand(
    targetFrame,
    RIGHT_HAND_OFFSET,
  )
  const handOffset =
    rightCount >= leftCount ? RIGHT_HAND_OFFSET : LEFT_HAND_OFFSET
  const currentHand =
    handOffset === RIGHT_HAND_OFFSET
      ? frame.rightHand
      : frame.leftHand

  context.lineCap = 'round'
  context.lineWidth = 2
  context.strokeStyle = 'rgba(255, 105, 90, 0.92)'

  ARROW_LANDMARKS.forEach((index) => {
    const current = readRawPoint(currentHand, index)
    const target = projectTargetPoint(
      targetFrame,
      handOffset + index,
      transform,
      projection,
    )

    if (!current || !target) {
      return
    }

    const currentProjected = projectNormalizedPoint(
      current.x,
      current.y,
      projection,
    )
    const separation = Math.hypot(
      target.x - currentProjected.x,
      target.y - currentProjected.y,
    )

    if (separation > 12) {
      drawArrow(context, currentProjected, target)
    }
  })
}

export function PracticeOverlay({
  enabled,
  frame,
  targetFrame,
  videoRef,
}: PracticeOverlayProps) {
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

    if (
      !enabled ||
      !frame ||
      !targetFrame ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return
    }

    const transforms = createReferenceTransforms(frame, targetFrame)

    if (!transforms) {
      return
    }

    const projection = createProjection(video, width, height)
    const targetColor = 'rgba(72, 238, 177, 0.82)'
    const targetPointColor = 'rgba(220, 255, 243, 0.96)'

    drawTargetConnections(
      context,
      targetFrame,
      0,
      [...OUTER_LIP_CONNECTIONS, ...INNER_LIP_CONNECTIONS],
      transforms.mouth,
      projection,
      targetColor,
      2,
    )
    drawTargetConnections(
      context,
      targetFrame,
      POSE_OFFSET,
      POSE_CONNECTIONS,
      transforms.body,
      projection,
      targetColor,
      3,
    )

    const handTransforms = new Map<number, ReferenceTransform>()

    ;[LEFT_HAND_OFFSET, RIGHT_HAND_OFFSET].forEach((handOffset) => {
      const handTransform = createHandTransform(
        frame,
        targetFrame,
        handOffset,
        transforms.body,
      )

      handTransforms.set(handOffset, handTransform)

      drawTargetConnections(
        context,
        targetFrame,
        handOffset,
        HAND_CONNECTIONS,
        handTransform,
        projection,
        targetColor,
        4,
      )
      drawTargetPoints(
        context,
        targetFrame,
        handOffset,
        21,
        handTransform,
        projection,
        targetPointColor,
        3,
      )
    })

    drawCorrectionArrows(
      context,
      frame,
      targetFrame,
      handTransforms.get(
        countValidTargetHand(targetFrame, RIGHT_HAND_OFFSET) >=
          countValidTargetHand(targetFrame, LEFT_HAND_OFFSET)
          ? RIGHT_HAND_OFFSET
          : LEFT_HAND_OFFSET,
      ) ?? transforms.body,
      projection,
    )
  }, [enabled, frame, targetFrame, videoRef])

  return (
    <canvas
      ref={canvasRef}
      className="practice-overlay"
      aria-hidden="true"
    />
  )
}
