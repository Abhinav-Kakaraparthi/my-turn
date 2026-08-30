import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadPracticeReference,
  type LoadedPracticeReference,
} from './practiceCatalog'
import {
  PRACTICE_CHANNEL_COUNT,
  PRACTICE_FRAME_COUNT,
  PRACTICE_VALUES_PER_FRAME,
} from './practiceReference'

type SignReferencePlayerProps = {
  sign: string
}

type Point = {
  x: number
  y: number
}

type Bounds = {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

type Projection = Bounds & {
  height: number
  mirror: boolean
  padding: number
  scale: number
  width: number
  xOffset: number
  yOffset: number
}

const LEFT_HAND_OFFSET = 40
const POSE_OFFSET = 61
const RIGHT_HAND_OFFSET = 73

const HAND_CONNECTIONS = [
  [0, 1],[1, 2],[2, 3],[3, 4],
  [0, 5],[5, 6],[6, 7],[7, 8],
  [5, 9],[9, 10],[10, 11],[11, 12],
  [9, 13],[13, 14],[14, 15],[15, 16],
  [13, 17],[0, 17],[17, 18],[18, 19],[19, 20],
] as const

const POSE_CONNECTIONS = [
  [0, 1],[0, 2],[2, 4],[1, 3],[3, 5],
  [4, 6],[4, 8],[4, 10],[5, 7],[5, 9],[5, 11],
] as const

const OUTER_LIP_CONNECTIONS = Array.from(
  { length: 20 },
  (_, index) => [index, (index + 1) % 20] as const,
)
const INNER_LIP_CONNECTIONS = Array.from(
  { length: 20 },
  (_, index) => [20 + index, 20 + ((index + 1) % 20)] as const,
)

function readFramePoint(
  frame: Float32Array,
  landmarkIndex: number,
): Point | null {
  const offset = landmarkIndex * PRACTICE_CHANNEL_COUNT

  if (frame[offset + 3] !== 1) {
    return null
  }

  const x = frame[offset]
  const y = frame[offset + 1]

  return Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : null
}

function readSequencePoint(
  values: Float32Array,
  frameIndex: number,
  landmarkIndex: number,
) {
  const frameOffset = frameIndex * PRACTICE_VALUES_PER_FRAME
  return readFramePoint(
    values.subarray(
      frameOffset,
      frameOffset + PRACTICE_VALUES_PER_FRAME,
    ),
    landmarkIndex,
  )
}

function percentile(values: number[], fraction: number) {
  const index = Math.floor((values.length - 1) * fraction)
  return values[Math.max(0, Math.min(values.length - 1, index))]
}

function calculateBounds(values: Float32Array): Bounds {
  const xValues: number[] = []
  const yValues: number[] = []

  for (
    let offset = 0;
    offset < values.length;
    offset += PRACTICE_CHANNEL_COUNT
  ) {
    if (values[offset + 3] !== 1) {
      continue
    }

    const x = values[offset]
    const y = values[offset + 1]

    if (Number.isFinite(x) && Number.isFinite(y)) {
      xValues.push(x)
      yValues.push(y)
    }
  }

  if (xValues.length === 0 || yValues.length === 0) {
    return { maxX: 2, maxY: 2, minX: -2, minY: -2 }
  }

  xValues.sort((left, right) => left - right)
  yValues.sort((left, right) => left - right)

  const minX = percentile(xValues, 0.01)
  const maxX = percentile(xValues, 0.99)
  const minY = percentile(yValues, 0.01)
  const maxY = percentile(yValues, 0.99)

  return {
    maxX: maxX > minX ? maxX : minX + 1,
    maxY: maxY > minY ? maxY : minY + 1,
    minX,
    minY,
  }
}

function createProjection(
  bounds: Bounds,
  width: number,
  height: number,
  mirror: boolean,
): Projection {
  const padding = Math.min(width, height) * 0.1
  const dataWidth = bounds.maxX - bounds.minX
  const dataHeight = bounds.maxY - bounds.minY
  const scale = Math.min(
    (width - padding * 2) / dataWidth,
    (height - padding * 2) / dataHeight,
  )
  const renderedWidth = dataWidth * scale
  const renderedHeight = dataHeight * scale

  return {
    ...bounds,
    height,
    mirror,
    padding,
    scale,
    width,
    xOffset: (width - renderedWidth) / 2,
    yOffset: (height - renderedHeight) / 2,
  }
}

function projectPoint(point: Point, projection: Projection): Point {
  const rawX =
    projection.xOffset +
    (point.x - projection.minX) * projection.scale

  return {
    x: projection.mirror ? projection.width - rawX : rawX,
    y:
      projection.yOffset +
      (point.y - projection.minY) * projection.scale,
  }
}

function drawConnections(
  context: CanvasRenderingContext2D,
  frame: Float32Array,
  landmarkOffset: number,
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
    const start = readFramePoint(frame, landmarkOffset + startIndex)
    const end = readFramePoint(frame, landmarkOffset + endIndex)

    if (!start || !end) {
      return
    }

    const projectedStart = projectPoint(start, projection)
    const projectedEnd = projectPoint(end, projection)
    context.moveTo(projectedStart.x, projectedStart.y)
    context.lineTo(projectedEnd.x, projectedEnd.y)
  })

  context.stroke()
}

function drawPoints(
  context: CanvasRenderingContext2D,
  frame: Float32Array,
  landmarkOffset: number,
  count: number,
  projection: Projection,
  color: string,
) {
  context.beginPath()
  context.fillStyle = color

  for (let index = 0; index < count; index += 1) {
    const point = readFramePoint(frame, landmarkOffset + index)

    if (!point) {
      continue
    }

    const projected = projectPoint(point, projection)
    context.moveTo(projected.x + 2.5, projected.y)
    context.arc(projected.x, projected.y, 2.5, 0, Math.PI * 2)
  }

  context.fill()
}

function drawTrail(
  context: CanvasRenderingContext2D,
  values: Float32Array,
  frameIndex: number,
  landmarkIndex: number,
  projection: Projection,
  color: string,
) {
  let started = false
  context.beginPath()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = 2.5
  context.strokeStyle = color

  for (let index = 0; index <= frameIndex; index += 2) {
    const point = readSequencePoint(values, index, landmarkIndex)

    if (!point) {
      continue
    }

    const projected = projectPoint(point, projection)

    if (!started) {
      context.moveTo(projected.x, projected.y)
      started = true
    } else {
      context.lineTo(projected.x, projected.y)
    }
  }

  context.stroke()
}

function drawReference(
  canvas: HTMLCanvasElement,
  reference: LoadedPracticeReference,
  frameIndex: number,
  bounds: Bounds,
  mirror: boolean,
) {
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

  const projection = createProjection(bounds, width, height, mirror)
  const start = frameIndex * PRACTICE_VALUES_PER_FRAME
  const frame = reference.values.subarray(
    start,
    start + PRACTICE_VALUES_PER_FRAME,
  )

  drawTrail(
    context,
    reference.values,
    frameIndex,
    LEFT_HAND_OFFSET,
    projection,
    'rgba(255, 216, 94, 0.72)',
  )
  drawTrail(
    context,
    reference.values,
    frameIndex,
    RIGHT_HAND_OFFSET,
    projection,
    'rgba(255, 216, 94, 0.72)',
  )
  drawTrail(
    context,
    reference.values,
    frameIndex,
    LEFT_HAND_OFFSET + 4,
    projection,
    'rgba(255, 121, 111, 0.68)',
  )
  drawTrail(
    context,
    reference.values,
    frameIndex,
    RIGHT_HAND_OFFSET + 4,
    projection,
    'rgba(255, 121, 111, 0.68)',
  )

  drawConnections(
    context,
    frame,
    0,
    [...OUTER_LIP_CONNECTIONS, ...INNER_LIP_CONNECTIONS],
    projection,
    'rgba(255, 138, 164, 0.9)',
    2,
  )
  drawConnections(
    context,
    frame,
    POSE_OFFSET,
    POSE_CONNECTIONS,
    projection,
    'rgba(226, 236, 240, 0.82)',
    3,
  )
  drawConnections(
    context,
    frame,
    LEFT_HAND_OFFSET,
    HAND_CONNECTIONS,
    projection,
    'rgba(169, 158, 255, 0.95)',
    3,
  )
  drawConnections(
    context,
    frame,
    RIGHT_HAND_OFFSET,
    HAND_CONNECTIONS,
    projection,
    'rgba(99, 230, 181, 0.95)',
    3,
  )
  drawPoints(
    context,
    frame,
    LEFT_HAND_OFFSET,
    21,
    projection,
    '#e4e0ff',
  )
  drawPoints(
    context,
    frame,
    RIGHT_HAND_OFFSET,
    21,
    projection,
    '#dcfff2',
  )
}

export function SignReferencePlayer({ sign }: SignReferencePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [errorState, setErrorState] = useState<{
    message: string
    sign: string
  } | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [loadedState, setLoadedState] = useState<{
    reference: LoadedPracticeReference
    sign: string
  } | null>(null)
  const [mirror, setMirror] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    let mounted = true
    const resetTimer = window.setTimeout(() => {
      setFrameIndex(0)
      setPlaying(true)
    }, 0)

    void loadPracticeReference(sign)
      .then((reference) => {
        if (mounted) {
          setLoadedState({ reference, sign })
          setErrorState(null)
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setErrorState({
            message:
              error instanceof Error
                ? error.message
                : `The ${sign} animation could not be loaded.`,
            sign,
          })
        }
      })

    return () => {
      mounted = false
      window.clearTimeout(resetTimer)
    }
  }, [sign])

  const reference =
    loadedState?.sign === sign ? loadedState.reference : null
  const errorMessage =
    errorState?.sign === sign ? errorState.message : null
  const bounds = useMemo(
    () => reference ? calculateBounds(reference.values) : null,
    [reference],
  )

  useEffect(() => {
    if (!playing || !reference) {
      return
    }

    const interval = window.setInterval(() => {
      setFrameIndex((current) =>
        (current + 1) % PRACTICE_FRAME_COUNT,
      )
    }, Math.round(58 / speed))

    return () => {
      window.clearInterval(interval)
    }
  }, [playing, reference, speed])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas || !reference || !bounds) {
      return
    }

    drawReference(canvas, reference, frameIndex, bounds, mirror)
  }, [bounds, frameIndex, mirror, reference])

  return (
    <section className="sign-reference-player" aria-live="polite">
      <div className="sign-reference-player-heading">
        <div>
          <p className="section-label">Animated landmark reference</p>
          <h2>{sign}</h2>
        </div>
        <span>Frame {frameIndex + 1}/64</span>
      </div>

      <div className="sign-reference-canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label={`Animated landmark reference for ${sign}`}
        />

        {!reference && !errorMessage && (
          <p className="sign-reference-player-status">Loading {sign}…</p>
        )}

        {errorMessage && (
          <p className="sign-reference-player-error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>

      <div className="sign-reference-controls">
        <button
          type="button"
          disabled={!reference}
          onClick={() => setPlaying((current) => !current)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          disabled={!reference}
          onClick={() => {
            setFrameIndex(0)
            setPlaying(true)
          }}
        >
          Restart
        </button>
        <button
          type="button"
          aria-pressed={mirror}
          onClick={() => setMirror((current) => !current)}
        >
          {mirror ? 'Mirrored' : 'Original view'}
        </button>
        <label>
          <span>Speed</span>
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={1.5}>1.5×</option>
          </select>
        </label>
      </div>

      {reference && (
        <p className="sign-reference-source-detail">
          Derived landmark sequence · participant {reference.entry.participantId}
          {' · '}{reference.entry.sourceFrameCount} captured frames
        </p>
      )}
    </section>
  )
}
