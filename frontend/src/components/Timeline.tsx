import { useMemo, useRef, useState } from 'react'
import { formatClock, useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { teamInk } from '../lib/ui'

const H = 96
const MID = 48

/** The match as a printed ruler: minute ticks, momentum above/below the line, events as glyphs, a red playhead. */
export default function Timeline() {
  const { pkg, clock, name } = useMatch()
  const { time } = useClock(clock, 12)
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const dur = pkg.meta.duration_s
  const half = pkg.meta.period_lengths_s['1']
  const { home, away } = pkg.meta.teams
  const hc = teamInk(home)
  const ac = teamInk(away)
  const X = (ts: number) => (ts / dur) * 1000

  const { homePath, awayPath, markers, ticks } = useMemo(() => {
    const pts = pkg.analytics.momentum.map((r) => ({ x: X(r.minute * 60 + 30), v: r.momentum }))
    const area = (sign: 1 | -1) => {
      let d = `M0,${MID}`
      for (const p of pts) {
        const v = sign === 1 ? Math.max(0, p.v) : Math.min(0, p.v)
        d += ` L${p.x.toFixed(1)},${(MID - v * 34).toFixed(1)}`
      }
      return d + ` L1000,${MID} Z`
    }
    const markers = pkg.events.filter((e) => ['goal', 'card', 'tactical_change', 'substitution'].includes(e.type))
    const ticks: { x: number; label?: string; major: boolean }[] = []
    for (let m = 0; m <= 45; m += 5) ticks.push({ x: X(m * 60), label: m % 15 === 0 && m > 0 && m < 45 ? `${m}'` : undefined, major: m % 15 === 0 })
    for (let m = 50; m <= 90; m += 5) ticks.push({ x: X(half + (m - 45) * 60), label: m % 15 === 0 && m < 90 ? `${m}'` : undefined, major: m % 15 === 0 })
    return { homePath: area(1), awayPath: area(-1), markers, ticks }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg, dur, half])

  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur))
  }
  const hovered = hover !== null ? markers.find((e) => Math.abs(X(e.ts) - X(hover)) < 6) : undefined

  return (
    <div className="select-none">
      <div className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 1000 ${H}`}
          preserveAspectRatio="none"
          className="block h-24 w-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            ;(e.target as Element).setPointerCapture?.(e.pointerId)
            clock.seek(tAt(e.clientX))
          }}
          onPointerMove={(e) => {
            setHover(tAt(e.clientX))
            if (e.buttons === 1) clock.seek(tAt(e.clientX))
          }}
          onPointerLeave={() => setHover(null)}
          role="slider"
          tabIndex={0}
          aria-label="Match timeline - click or drag to move through the match"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatClock(time, half)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') clock.seek(time + 30)
            if (e.key === 'ArrowLeft') clock.seek(time - 30)
          }}
        >
          <path d={homePath} fill={hc} fillOpacity="0.32" />
          <path d={awayPath} fill={ac} fillOpacity="0.32" />
          <line x1="0" x2="1000" y1={MID} y2={MID} stroke="#141310" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {ticks.map((t, i) => (
            <line key={i} x1={t.x} x2={t.x} y1={MID - (t.major ? 7 : 3.5)} y2={MID + (t.major ? 7 : 3.5)} stroke="#141310" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={X(half)} x2={X(half)} y1="4" y2={H - 4} stroke="#141310" strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {markers.map((e) => {
            const x = X(e.ts)
            const y = e.team === 'home' ? 9 : H - 9
            const c = e.team === 'home' ? hc : ac
            if (e.type === 'goal') return <circle key={e.id} cx={x} cy={y} r="5.5" fill={c} stroke="#141310" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            if (e.type === 'card') return <rect key={e.id} x={x - 2.5} y={y - 5} width="5" height="10" fill={e.outcome === 'yellow' ? '#e8b923' : '#e3361b'} stroke="#141310" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
            if (e.type === 'tactical_change') return <rect key={e.id} x={x - 4} y={y - 4} width="8" height="8" transform={`rotate(45 ${x} ${y})`} fill="none" stroke="#141310" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            return <line key={e.id} x1={x} x2={x} y1={y - 4} y2={y + 4} stroke="#77705f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          })}
          {hover !== null && <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="#141310" strokeOpacity="0.3" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          <line x1={X(time)} x2={X(time)} y1="0" y2={H} stroke="#e3361b" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="pointer-events-none absolute top-0 left-0 h-full w-full">
          {ticks
            .filter((t) => t.label)
            .map((t, i) => (
              <span key={i} className="absolute num text-[10px] text-ink-3" style={{ left: `${t.x / 10}%`, top: `${MID + 9}px`, transform: 'translateX(-50%)' }}>
                {t.label}
              </span>
            ))}
          <span className="absolute num text-[10px] text-ink-2" style={{ left: `${X(half) / 10}%`, top: `${MID + 9}px`, transform: 'translateX(4px)' }}>
            HT
          </span>
          {hover !== null && (
            <span className="absolute -top-6 bg-ink px-1.5 py-0.5 num text-[10px] whitespace-nowrap text-paper" style={{ left: `${X(hover) / 10}%`, transform: 'translateX(-50%)' }}>
              {formatClock(hover, half)}
              {hovered && ` · ${hovered.type === 'tactical_change' ? 'tactical change' : hovered.type === 'card' ? `${hovered.outcome} card` : hovered.type}${hovered.player ? ` · ${name(hovered.player)}` : ''}`}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 num text-[10px] text-ink-3 uppercase">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4" style={{ background: hc, opacity: 0.5 }} /> {home.short} on top
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4" style={{ background: ac, opacity: 0.5 }} /> {away.short} on top
        </span>
        <span>● goal</span>
        <span>▮ card</span>
        <span>◇ tactical change</span>
        <span>| substitution</span>
      </div>
    </div>
  )
}
