import { useEffect, useMemo, useRef } from 'react'
import { lastEventIndex, useMatch } from '../lib/match'
import { TrackingStore } from '../lib/tracking'
import { onPrimary, surname, teamInk } from '../lib/ui'
import type { MatchEvent } from '../types'

/*
 * The pitch as a living diagram: a printed pitch, players with short motion tails,
 * a ball that lifts off its shadow, the intended pass drawn as a dashed line,
 * and the player on the ball annotated like a figure in a tactics notebook.
 */

const L = 105
const W = 68
const PAD_X = 3
const PAD_TOP = 5
const PAD_BOTTOM = 3

const GRASS = '#c9cfac'
const GRASS_STRIPE = '#c1c8a2'
const LINE = 'rgba(250,247,238,0.92)'
const INK = '#141310'
const PAPER = '#f2eee3'
const SIGNAL = '#e3361b'

const BALL_TYPES = new Set(['pass', 'carry', 'shot', 'interception', 'tackle', 'save', 'clearance', 'block'])

export default function Pitch({ store }: { store: TrackingStore }) {
  const { pkg, clock, highlight, eventsById, name } = useMatch()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const numbers = useMemo(() => {
    const m = new Map<string, number>()
    for (const side of ['home', 'away'] as const) for (const p of pkg.meta.teams[side].players) m.set(p.id, p.number)
    return m
  }, [pkg.meta.teams])
  const highlightRef = useRef<MatchEvent[]>([])
  highlightRef.current = highlight.map((id) => eventsById.get(id)).filter(Boolean) as MatchEvent[]

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const home = pkg.meta.teams.home
    const away = pkg.meta.teams.away
    const style = {
      home: { fill: home.primary, text: onPrimary(home), ink: teamInk(home) },
      away: { fill: away.primary, text: onPrimary(away), ink: teamInk(away) },
    }
    const ballEvents = pkg.events.filter((e) => BALL_TYPES.has(e.type))
    let raf = 0
    let k = 1 // pixels per metre
    let cssW = 0
    let cssH = 0

    const resize = () => {
      cssW = wrapRef.current!.clientWidth
      const dpr = window.devicePixelRatio || 1
      k = cssW / (L + PAD_X * 2)
      cssH = (W + PAD_TOP + PAD_BOTTOM) * k
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const P = (x: number, y: number): [number, number] => [(x + PAD_X) * k, (y + PAD_TOP) * k]
    const px = (m: number) => m * k

    const drawPitch = () => {
      ctx.clearRect(0, 0, cssW, cssH)
      const [x0, y0] = P(0, 0)
      ctx.fillStyle = GRASS
      ctx.fillRect(x0 - px(1.5), y0 - px(1.5), px(L + 3), px(W + 3))
      ctx.fillStyle = GRASS_STRIPE
      for (let i = 0; i < 14; i += 2) ctx.fillRect(x0 + px((L / 14) * i), y0, px(L / 14), px(W))

      ctx.strokeStyle = LINE
      ctx.lineWidth = Math.max(1, px(0.14))
      const rect = (x: number, y: number, w: number, h: number) => {
        const [a, b] = P(x, y)
        ctx.strokeRect(a, b, px(w), px(h))
      }
      rect(0, 0, L, W)
      ctx.beginPath()
      ctx.moveTo(...P(L / 2, 0))
      ctx.lineTo(...P(L / 2, W))
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(...P(L / 2, W / 2), px(9.15), 0, Math.PI * 2)
      ctx.stroke()
      const dot = (x: number, y: number) => {
        ctx.fillStyle = LINE
        ctx.beginPath()
        ctx.arc(...P(x, y), Math.max(1.2, px(0.22)), 0, Math.PI * 2)
        ctx.fill()
      }
      dot(L / 2, W / 2)
      for (const left of [true, false]) {
        rect(left ? 0 : L - 16.5, W / 2 - 20.16, 16.5, 40.32)
        rect(left ? 0 : L - 5.5, W / 2 - 9.16, 5.5, 18.32)
        const spot = left ? 11 : L - 11
        dot(spot, W / 2)
        ctx.beginPath()
        ctx.arc(...P(spot, W / 2), px(9.15), left ? -0.927 : Math.PI - 0.927, left ? 0.927 : Math.PI + 0.927)
        ctx.stroke()
        // the goal: posts, a net drawn as fine hatching
        const gx = left ? -1.8 : L
        const [ga, gb] = P(gx, W / 2 - 3.66)
        ctx.save()
        ctx.strokeStyle = 'rgba(20,19,16,0.25)'
        ctx.lineWidth = 0.6
        for (let i = 0; i <= 8; i++) {
          ctx.beginPath()
          ctx.moveTo(ga, gb + (px(7.32) * i) / 8)
          ctx.lineTo(ga + px(1.8), gb + (px(7.32) * i) / 8)
          ctx.stroke()
        }
        ctx.restore()
        ctx.strokeStyle = LINE
        ctx.lineWidth = Math.max(1.5, px(0.2))
        ctx.strokeRect(ga, gb, px(1.8), px(7.32))
        ctx.lineWidth = Math.max(1, px(0.14))
        // corner arcs
        for (const cy of [0, W]) {
          ctx.beginPath()
          const start = left ? (cy === 0 ? 0 : -Math.PI / 2) : cy === 0 ? Math.PI / 2 : Math.PI
          ctx.arc(...P(left ? 0 : L, cy), px(1), start, start + Math.PI / 2)
          ctx.stroke()
        }
      }

      // attacking directions, set in the margin like figure labels
      ctx.font = `600 ${Math.max(10, px(1.75))}px "Barlow Condensed", sans-serif`
      ctx.textBaseline = 'alphabetic'
      const ly = (PAD_TOP - 1.6) * k
      ctx.fillStyle = style.home.ink
      ctx.textAlign = 'left'
      ctx.fillText(`${home.short}  ATTACK  →`, P(0, 0)[0], ly)
      ctx.fillStyle = style.away.ink
      ctx.textAlign = 'right'
      ctx.fillText(`←  ${away.short}  ATTACK`, P(L, 0)[0], ly)
      ctx.textAlign = 'left'
    }

    const arrow = (x0: number, y0: number, x1: number, y1: number, color: string, opts: { dash?: number[]; width?: number; head?: boolean } = {}) => {
      const [a, b] = P(x0, y0)
      const [c, d] = P(x1, y1)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = opts.width ?? Math.max(1.4, px(0.22))
      ctx.setLineDash(opts.dash ?? [])
      ctx.beginPath()
      ctx.moveTo(a, b)
      ctx.lineTo(c, d)
      ctx.stroke()
      ctx.setLineDash([])
      if (opts.head === false) return
      const ang = Math.atan2(d - b, c - a)
      const s = Math.max(6, px(1.3))
      ctx.beginPath()
      ctx.moveTo(c, d)
      ctx.lineTo(c - s * Math.cos(ang - 0.4), d - s * Math.sin(ang - 0.4))
      ctx.lineTo(c - s * Math.cos(ang + 0.4), d - s * Math.sin(ang + 0.4))
      ctx.closePath()
      ctx.fill()
    }

    const tag = (x: number, y: number, text: string, bg: string, fg: string) => {
      const [a, b] = P(x, y)
      ctx.font = `600 ${Math.max(10, px(1.55))}px "Barlow Condensed", sans-serif`
      const w = ctx.measureText(text).width + 10
      const h = Math.max(15, px(2.3))
      const lx = a + px(1.6)
      const ly = b - px(2.9)
      ctx.strokeStyle = bg
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a + px(0.8), b - px(0.8))
      ctx.lineTo(lx, ly + h)
      ctx.stroke()
      ctx.fillStyle = bg
      ctx.fillRect(lx, ly, w, h)
      ctx.fillStyle = fg
      ctx.textBaseline = 'middle'
      ctx.fillText(text, lx + 5, ly + h / 2 + 0.5)
      ctx.textBaseline = 'alphabetic'
    }

    const drawHighlights = () => {
      highlightRef.current.forEach((e, i) => {
        const tx = e.end_x ?? (e.team === 'home' ? L : 0)
        const ty = e.end_y ?? W / 2
        if (['pass', 'carry', 'clearance', 'shot'].includes(e.type)) {
          arrow(e.x, e.y, tx, ty, SIGNAL, { dash: e.type === 'carry' ? [5, 4] : undefined })
          if (e.type === 'shot' && e.xg !== undefined) {
            const [a, b] = P(e.x, e.y)
            ctx.font = `500 ${Math.max(10, px(1.45))}px "JetBrains Mono Variable", monospace`
            ctx.fillStyle = SIGNAL
            ctx.fillText(`xG ${e.xg.toFixed(2)}`, a + px(1.6), b + px(3))
          }
        }
        const [a, b] = P(e.x, e.y)
        const r = Math.max(8, px(1.3))
        ctx.fillStyle = PAPER
        ctx.strokeStyle = SIGNAL
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(a, b, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = SIGNAL
        ctx.font = `600 ${Math.max(9, r)}px "JetBrains Mono Variable", monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(i + 1), a, b + 0.5)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      })
    }

    const draw = () => {
      const t = clock.time
      drawPitch()
      drawHighlights()
      const frame = store.frameAt(t)
      if (!frame) {
        ctx.fillStyle = INK
        ctx.font = `italic ${Math.max(13, px(2))}px "Fraunces Variable", serif`
        ctx.textAlign = 'center'
        ctx.fillText('Setting the plate…', ...P(L / 2, W / 2 + 6))
        ctx.textAlign = 'left'
        raf = requestAnimationFrame(draw)
        return
      }

      // the intended pass, while the ball is travelling
      const idx = lastEventIndex(ballEvents, t)
      const cur = idx >= 0 ? ballEvents[idx] : null
      if (cur && (cur.type === 'pass' || cur.type === 'clearance') && cur.end_x !== undefined && t <= cur.ts + cur.dur) {
        const nxt = ballEvents[idx + 1]
        const ex = nxt && nxt.ts - (cur.ts + cur.dur) < 0.6 ? nxt.x : cur.end_x
        const ey = nxt && nxt.ts - (cur.ts + cur.dur) < 0.6 ? nxt.y : cur.end_y!
        arrow(cur.x, cur.y, ex, ey, 'rgba(20,19,16,0.45)', { dash: [4, 4], width: 1.2 })
      }

      // motion tails: where each player was over the last 0.6 s
      const past = store.frameAt(t - 0.6)
      const mid = store.frameAt(t - 0.3)
      const r = Math.max(5.5, px(1.2))
      const hover = hoverRef.current
      let hovered = -1
      let hoverDist = 2.5
      for (let j = 0; j < frame.ids.length; j++) {
        const x = frame.x[j]
        if (Number.isNaN(x)) continue
        const side = frame.teams[j] as 'home' | 'away'
        if (past && mid && !Number.isNaN(past.x[j])) {
          const d = Math.hypot(x - past.x[j], frame.y[j] - past.y[j])
          if (d > 0.4 && d < 9) {
            ctx.strokeStyle = style[side].ink
            ctx.globalAlpha = 0.28
            ctx.lineCap = 'round'
            ctx.lineWidth = r * 1.1
            ctx.beginPath()
            ctx.moveTo(...P(past.x[j], past.y[j]))
            ctx.lineTo(...P(mid.x[j], mid.y[j]))
            ctx.lineTo(...P(x, frame.y[j]))
            ctx.stroke()
            ctx.globalAlpha = 1
            ctx.lineCap = 'butt'
          }
        }
        if (hover) {
          const d = Math.hypot(hover.x - x, hover.y - frame.y[j])
          if (d < hoverDist) {
            hoverDist = d
            hovered = j
          }
        }
      }

      // players: a misregistered ink shadow under each disc, like a two-colour print
      for (let j = 0; j < frame.ids.length; j++) {
        const x = frame.x[j]
        if (Number.isNaN(x)) continue
        const side = frame.teams[j] as 'home' | 'away'
        const [a, b] = P(x, frame.y[j])
        ctx.fillStyle = 'rgba(20,19,16,0.22)'
        ctx.beginPath()
        ctx.arc(a + r * 0.22, b + r * 0.28, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = style[side].fill
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.arc(a, b, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        if (j === frame.owner) {
          ctx.strokeStyle = SIGNAL
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(a, b, r + 3.5, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = style[side].text
        ctx.font = `600 ${Math.max(7, r * 0.92)}px "JetBrains Mono Variable", monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(numbers.get(frame.ids[j]) ?? ''), a, b + 0.5)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      }

      // the ball: a dotted trail, a shadow on the grass, and the ball lifted by its height
      const trail: [number, number][] = []
      for (let s = 1; s <= 10; s++) {
        const p = store.ballAt(t - s * 0.1)
        if (!p) break
        trail.push([p[0], p[1] - p[2] * 0.5])
      }
      trail.forEach(([x, y], i) => {
        ctx.fillStyle = `rgba(20,19,16,${0.38 * (1 - i / trail.length)})`
        ctx.beginPath()
        ctx.arc(...P(x, y), Math.max(1, px(0.22)), 0, Math.PI * 2)
        ctx.fill()
      })
      const [bx, by] = frame.ball
      const z = frame.ballZ
      const br = Math.max(3.5, px(0.62)) * (1 + Math.min(z, 12) * 0.035)
      ctx.fillStyle = `rgba(20,19,16,${Math.max(0.12, 0.34 - z * 0.018)})`
      ctx.beginPath()
      ctx.ellipse(...P(bx + 0.15, by + 0.2), br * (1 + z * 0.05), br * 0.6 * (1 + z * 0.05), 0, 0, Math.PI * 2)
      ctx.fill()
      const [ba, bb] = P(bx, by - z * 0.5)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(ba, bb, br, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = INK
      ctx.beginPath()
      ctx.arc(ba - br * 0.2, bb - br * 0.15, br * 0.32, 0, Math.PI * 2)
      ctx.fill()
      if (z > 1.2) {
        ctx.font = `500 ${Math.max(9, px(1.25))}px "JetBrains Mono Variable", monospace`
        ctx.fillStyle = INK
        ctx.fillText(`${z.toFixed(1)} m`, ba + br + 4, bb - 2)
      }

      // annotations: the player on the ball, and whoever the reader is pointing at
      if (frame.owner >= 0 && !Number.isNaN(frame.x[frame.owner])) {
        const j = frame.owner
        tag(frame.x[j], frame.y[j], surname(name(frame.ids[j])).toUpperCase(), INK, PAPER)
      }
      if (hovered >= 0 && hovered !== frame.owner) {
        const j = hovered
        const side = frame.teams[j] as 'home' | 'away'
        tag(frame.x[j], frame.y[j], `${numbers.get(frame.ids[j]) ?? ''} ${name(frame.ids[j])}`, style[side].ink, PAPER)
      }
      raf = requestAnimationFrame(draw)
    }

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      hoverRef.current = { x: (ev.clientX - rect.left) / k - PAD_X, y: (ev.clientY - rect.top) / k - PAD_TOP }
    }
    const onLeave = () => (hoverRef.current = null)

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapRef.current!)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [pkg, clock, store, numbers, name])

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} className="block" aria-label="Animated reconstruction of the match: players, ball and passes" />
    </div>
  )
}
