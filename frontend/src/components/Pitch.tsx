import { useEffect, useMemo, useRef } from 'react'
import { lastEventIndex, useMatch } from '../lib/match'
import { TrackingStore } from '../lib/tracking'
import type { MatchEvent } from '../types'

const L = 105
const W = 68
const PAD = 3

const ACTION_LABEL: Record<string, string> = {
  pass: 'Pass', carry: 'Carry', shot: 'Shot', interception: 'Interception', tackle: 'Tackle', save: 'Save',
  clearance: 'Clearance', block: 'Block', foul: 'Foul', pressure: 'Pressure', card: 'Card', offside: 'Offside',
}

export default function Pitch() {
  const { pkg, clock, highlight, eventsById, name } = useMatch()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const store = useMemo(() => new TrackingStore(pkg.meta.id), [pkg.meta.id])
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
    const ballEvents = pkg.events.filter((e) => ['pass', 'carry', 'shot', 'interception', 'tackle', 'save', 'clearance', 'block'].includes(e.type))
    let raf = 0
    let scale = 1

    const resize = () => {
      const w = wrapRef.current!.clientWidth
      const dpr = window.devicePixelRatio || 1
      scale = w / (L + PAD * 2)
      const h = (W + PAD * 2) * scale
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const P = (x: number, y: number): [number, number] => [(x + PAD) * scale, (y + PAD) * scale]

    const drawPitch = () => {
      const [w, h] = [(L + PAD * 2) * scale, (W + PAD * 2) * scale]
      ctx.fillStyle = '#0d2e25'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 12; i++) {
        if (i % 2) continue
        const [x0] = P((L / 12) * i, 0)
        ctx.fillStyle = '#0f3529'
        ctx.fillRect(x0, PAD * scale, (L / 12) * scale, W * scale)
      }
      ctx.strokeStyle = 'rgba(220,255,240,0.55)'
      ctx.lineWidth = Math.max(1, scale * 0.12)
      const rect = (x: number, y: number, rw: number, rh: number) => {
        const [a, b] = P(x, y)
        ctx.strokeRect(a, b, rw * scale, rh * scale)
      }
      rect(0, 0, L, W)
      ctx.beginPath()
      ctx.moveTo(...P(L / 2, 0))
      ctx.lineTo(...P(L / 2, W))
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(...P(L / 2, W / 2), 9.15 * scale, 0, Math.PI * 2)
      ctx.stroke()
      for (const left of [true, false]) {
        const x16 = left ? 0 : L - 16.5
        const x6 = left ? 0 : L - 5.5
        rect(x16, W / 2 - 20.16, 16.5, 40.32)
        rect(x6, W / 2 - 9.16, 5.5, 18.32)
        const spot = left ? 11 : L - 11
        ctx.beginPath()
        ctx.arc(...P(spot, W / 2), 9.15 * scale, left ? -0.93 : Math.PI - 0.93, left ? 0.93 : Math.PI + 0.93)
        ctx.stroke()
        ctx.fillStyle = 'rgba(220,255,240,0.6)'
        ctx.beginPath()
        ctx.arc(...P(spot, W / 2), 0.25 * scale, 0, Math.PI * 2)
        ctx.fill()
        const gx = left ? -1.6 : L
        rect(gx, W / 2 - 3.66, 1.6, 7.32)
      }
      ctx.fillStyle = 'rgba(220,255,240,0.35)'
      ctx.font = `${Math.max(9, scale * 1.6)}px Inter`
      ctx.fillText(`${home.short} attack  >`, ...P(L - 20, -0.9))
    }

    const arrow = (x0: number, y0: number, x1: number, y1: number, color: string, dashed = false) => {
      const [a, b] = P(x0, y0)
      const [c, d] = P(x1, y1)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = Math.max(1.5, scale * 0.28)
      ctx.setLineDash(dashed ? [scale * 0.8, scale * 0.6] : [])
      ctx.beginPath()
      ctx.moveTo(a, b)
      ctx.lineTo(c, d)
      ctx.stroke()
      ctx.setLineDash([])
      const ang = Math.atan2(d - b, c - a)
      const s = scale * 1.4
      ctx.beginPath()
      ctx.moveTo(c, d)
      ctx.lineTo(c - s * Math.cos(ang - 0.45), d - s * Math.sin(ang - 0.45))
      ctx.lineTo(c - s * Math.cos(ang + 0.45), d - s * Math.sin(ang + 0.45))
      ctx.closePath()
      ctx.fill()
    }

    const drawHighlights = () => {
      const evs = highlightRef.current
      evs.forEach((e, i) => {
        const team = e.team === 'home' ? home : away
        const color = team.primary.toLowerCase() === '#1d1d1d' ? team.secondary : team.primary
        if ((e.type === 'pass' || e.type === 'carry' || e.type === 'clearance') && e.end_x !== undefined) {
          arrow(e.x, e.y, e.end_x, e.end_y!, color, e.type === 'carry')
        } else if (e.type === 'shot') {
          const gx = e.team === 'home' ? L : 0
          arrow(e.x, e.y, e.end_x ?? gx, e.end_y ?? W / 2, '#fbbf24', true)
          const [a, b] = P(e.x, e.y)
          ctx.fillStyle = '#fbbf24'
          ctx.font = `600 ${Math.max(10, scale * 1.7)}px Inter`
          ctx.fillText(`xG ${e.xg?.toFixed(2)}`, a + scale, b - scale)
        } else {
          const [a, b] = P(e.x, e.y)
          ctx.strokeStyle = '#7dd3fc'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(a, b, scale * 2, 0, Math.PI * 2)
          ctx.stroke()
        }
        const [a, b] = P(e.x, e.y)
        ctx.fillStyle = 'rgba(7,11,22,0.85)'
        ctx.beginPath()
        ctx.arc(a, b, scale * 1.1, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#e7ecfb'
        ctx.font = `700 ${Math.max(8, scale * 1.2)}px Inter`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(i + 1), a, b)
        ctx.textAlign = 'start'
        ctx.textBaseline = 'alphabetic'
      })
    }

    const draw = () => {
      const t = clock.time
      drawPitch()
      drawHighlights()
      const frame = store.frameAt(t)
      const idx = lastEventIndex(ballEvents, t)
      const current = idx >= 0 ? ballEvents[idx] : null
      const onBall = current && t - current.ts < current.dur + 0.6 ? current.player : null
      if (frame) {
        for (let j = 0; j < frame.ids.length; j++) {
          if (Number.isNaN(frame.x[j])) continue
          const team = frame.teams[j] === 'home' ? home : away
          const [a, b] = P(frame.x[j], frame.y[j])
          const r = Math.max(5, scale * 1.25)
          if (frame.ids[j] === onBall) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(a, b, r + 3, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.fillStyle = team.primary
          ctx.strokeStyle = team.secondary
          ctx.lineWidth = Math.max(1.5, scale * 0.25)
          ctx.beginPath()
          ctx.arc(a, b, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = team.secondary
          ctx.font = `700 ${Math.max(7, r * 0.95)}px Inter`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(numbers.get(frame.ids[j]) ?? ''), a, b + 0.5)
        }
        ctx.textAlign = 'start'
        ctx.textBaseline = 'alphabetic'
        const [bx, by] = P(frame.ball[0], frame.ball[1])
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.beginPath()
        ctx.arc(bx + 2, by + 2, Math.max(3, scale * 0.6), 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(bx, by, Math.max(3, scale * 0.6), 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillStyle = 'rgba(231,236,251,0.6)'
        ctx.font = '13px Inter'
        ctx.fillText('Loading tracking...', ...P(L / 2 - 8, W / 2 + 4))
      }
      if (current && t - current.ts < 4) {
        const label = `${ACTION_LABEL[current.type] ?? current.type} - ${name(current.player)}${
          current.receiver ? ` > ${name(current.receiver)}` : ''
        }${current.outcome && current.type !== 'pass' ? ` (${current.outcome.replace('_', ' ')})` : ''}`
        ctx.font = `600 ${Math.max(11, scale * 1.6)}px Inter`
        const w = ctx.measureText(label).width + 16
        const [a, b] = P(1, 1.5)
        ctx.fillStyle = 'rgba(7,11,22,0.72)'
        ctx.beginPath()
        ctx.roundRect(a, b, w, Math.max(20, scale * 2.8), 8)
        ctx.fill()
        ctx.fillStyle = '#e7ecfb'
        ctx.fillText(label, a + 8, b + Math.max(14, scale * 1.9))
      }
      raf = requestAnimationFrame(draw)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapRef.current!)
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [pkg, clock, store, numbers, name])

  return (
    <div ref={wrapRef} className="w-full overflow-hidden rounded-xl">
      <canvas ref={canvasRef} className="block" aria-label="Animated pitch view of the match" />
    </div>
  )
}
