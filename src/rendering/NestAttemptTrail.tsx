import { useEffect, useRef } from 'react'
import { partRotationOrigin, type GeometryPart } from '../geometry'
import type { NestAttempt } from '../nesting'
import {
  ATTEMPT_FADE_MS,
  type LiveNestPlayback,
  type LiveNestPlaybackSink,
} from '../ui/liveNestTrace'

type Props = {
  playback: LiveNestPlayback
  parts: GeometryPart[]
  sheetWidth: number
  sheetHeight: number
}

type DisplayedAttempt = {
  attempt: NestAttempt
  displayedAtMs: number
}

export function NestAttemptTrail({
  playback,
  parts,
  sheetWidth,
  sheetHeight,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let context: CanvasRenderingContext2D | null
    try {
      context = canvas.getContext('2d')
    } catch {
      playback.cancel()
      return
    }
    if (!context) {
      playback.cancel()
      return
    }

    const sources = new Map(
      parts.map((part) => [
        part.id,
        { part, origin: partRotationOrigin(part.outer.points) },
      ]),
    )
    const trail: DisplayedAttempt[] = []
    let current: NestAttempt | null = null
    let activeSheet: number | undefined
    let width = 0
    let height = 0

    const traceRing = (
      points: GeometryPart['outer']['points'],
      attempt: NestAttempt,
      origin: { x: number; y: number },
      cosine: number,
      sine: number,
    ) => {
      if (points.length === 0) return
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index]!
        const localX = point.x - origin.x
        const localY = point.y - origin.y
        const x =
          ((origin.x + localX * cosine - localY * sine + attempt.x) /
            sheetWidth) *
          width
        const y =
          ((origin.y + localX * sine + localY * cosine + attempt.y) /
            sheetHeight) *
          height
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
    }

    const draw = (now: number) => {
      context.clearRect(0, 0, width, height)
      let write = 0
      let visible = false
      for (let read = 0; read < trail.length; read += 1) {
        const displayed = trail[read]!
        const age = now - displayed.displayedAtMs
        if (age >= ATTEMPT_FADE_MS) continue
        trail[write] = displayed
        write += 1
        if (age < 0) continue
        const source = sources.get(displayed.attempt.partId)
        if (!source) continue
        context.globalAlpha = 1 - age / ATTEMPT_FADE_MS
        context.fillStyle =
          displayed.attempt.verdict === 'accepted' ? '#22c55e' : '#ef4444'
        context.beginPath()
        context.arc(
          ((source.origin.x + displayed.attempt.x) / sheetWidth) * width,
          ((source.origin.y + displayed.attempt.y) / sheetHeight) * height,
          2.5,
          0,
          Math.PI * 2,
        )
        context.fill()
        visible = true
      }
      trail.length = write
      context.globalAlpha = 1

      const source = current ? sources.get(current.partId) : undefined
      if (source && current) {
        const radians = (current.rotation * Math.PI) / 180
        const cosine = Math.cos(radians)
        const sine = Math.sin(radians)
        context.save()
        context.fillStyle = 'rgba(250, 204, 21, 0.12)'
        context.strokeStyle = '#facc15'
        context.lineWidth = 0.7
        context.setLineDash([3, 2])
        context.beginPath()
        traceRing(source.part.outer.points, current, source.origin, cosine, sine)
        for (const hole of source.part.holes) {
          traceRing(hole.points, current, source.origin, cosine, sine)
        }
        context.fill('evenodd')
        context.stroke()
        context.restore()
      }

      return visible
    }

    const sink: LiveNestPlaybackSink = {
      renderAttempt(attempt, displayedAtMs) {
        if (activeSheet !== attempt.sheetIndex) {
          trail.length = 0
          activeSheet = attempt.sheetIndex
        }
        trail.push({ attempt, displayedAtMs })
        current = attempt
        return draw(displayedAtMs)
      },
      renderCommit(_placements, sheetIndex, now) {
        current = null
        if (sheetIndex !== undefined && activeSheet !== sheetIndex) {
          trail.length = 0
          activeSheet = sheetIndex
        }
        return draw(now)
      },
      renderIdle(now) {
        current = null
        return draw(now)
      },
      clear() {
        trail.length = 0
        current = null
        activeSheet = undefined
        context.clearRect(0, 0, width, height)
      },
    }

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      const scale = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      context.setTransform(scale, 0, 0, scale, 0, 0)
      draw(performance.now())
    }

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    resize()
    const detach = playback.attach(sink)

    return () => {
      detach()
      observer?.disconnect()
    }
  }, [playback, parts, sheetWidth, sheetHeight])

  return <canvas ref={canvasRef} className="nest-attempt-trail" aria-hidden="true" />
}
