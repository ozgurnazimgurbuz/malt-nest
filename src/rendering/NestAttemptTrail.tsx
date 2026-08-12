import { useEffect, useRef } from 'react'
import { partRotationOrigin, type GeometryPart } from '../geometry'
import { ATTEMPT_FADE_MS, type TimedNestAttempt } from '../ui/liveNestTrace'

type Props = {
  attempts: TimedNestAttempt[]
  parts: GeometryPart[]
  sheetWidth: number
  sheetHeight: number
}

export function NestAttemptTrail({
  attempts,
  parts,
  sheetWidth,
  sheetHeight,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let context: CanvasRenderingContext2D | null = null
    try {
      context = canvas.getContext('2d')
    } catch {
      return
    }
    if (!context) return

    const partMap = new Map(parts.map((part) => [part.id, part]))
    let frame = 0
    let width = 0
    let height = 0

    const draw = (now: number) => {
      try {
        context.clearRect(0, 0, width, height)
        let visible = false
        for (const attempt of attempts) {
          const age = now - attempt.receivedAtMs
          if (age < 0 || age >= ATTEMPT_FADE_MS) continue
          const part = partMap.get(attempt.partId)
          if (!part) continue
          const origin = partRotationOrigin(part.outer.points)
          context.globalAlpha = 1 - age / ATTEMPT_FADE_MS
          context.fillStyle =
            attempt.verdict === 'accepted' ? '#22c55e' : '#ef4444'
          context.beginPath()
          context.arc(
            ((origin.x + attempt.x) / sheetWidth) * width,
            ((origin.y + attempt.y) / sheetHeight) * height,
            2.5,
            0,
            Math.PI * 2,
          )
          context.fill()
          visible = true
        }
        context.globalAlpha = 1
        if (visible) frame = requestAnimationFrame(draw)
      } catch {
        // Debug rendering must never affect nesting.
      }
    }

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      const scale = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      context.setTransform(scale, 0, 0, scale, 0, 0)
      if (frame) cancelAnimationFrame(frame)
      draw(performance.now())
    }

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    resize()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [attempts, parts, sheetWidth, sheetHeight])

  return <canvas ref={canvasRef} className="nest-attempt-trail" aria-hidden="true" />
}
