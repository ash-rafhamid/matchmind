import { useEffect, useMemo, useRef, useState } from 'react'
import { formatClock, useClock } from '../lib/clock'
import { useMatch } from '../lib/match'

const H = 56
const MID = 28

/** The match as a scrubber: momentum as a waveform in club colours, events as glyphs, a flare playhead. */
export default function Timeline() {
  const { pkg, clock, name } = useMatch()
  const { time } = useClock(clock, 2)
  const ref = useRef<SVGSVGElement>(null)
  const head = useRef<SVGRectElement>(null)
  const shade = useRef<SVGRectElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const dur = pkg.meta.duration_s
  const half = pkg.meta.period_lengths_s['1']
  const { home, away } = pkg.meta.teams
  const X = (ts: number) => (ts / dur) * 1000

  const { bars, markers, ticks } = useMemo(() => {
    const bars = pkg.analytics.momentum.map((r) => ({ x: X(r.minute * 60), w: X(60) - 1.2, v: r.momentum }))
    const markers = pkg.events.filter((e) => ['goal', 'card', 'tactical_change'].includes(e.type))
    const ticks = [15, 30, 45, 60, 75, 90].map((m) => ({ x: m <= 45 ? X(m * 60) : X(half + (m - 45) * 60), label: m === 45 ? 'HT' : `${m}'` }))
    return { bars, markers, ticks }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg, dur, half])

  // the playhead follows the clock directly, without re-rendering the whole timeline
  useEffect(
    () =>
      clock.subscribe(() => {
        const x = Math.max(0, (clock.time / dur) * 1000)
        head.current?.setAttribute('x', String(x - 1.5))
        shade.current?.setAttribute('width', String(x))
      }),
    [clock, dur],
  )

  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur))
  }
  const near = hover !== null ? markers.find((e) => Math.abs(X(e.ts) - X(hover)) < 7) : undefined

  return (
    <div className="relative select-none">
      <svg
        ref={ref}
        viewBox={`0 0 1000 ${H}`}
        preserveAspectRatio="none"
        className="block h-14 w-full cursor-pointer touch-none"
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
        aria-label="Match timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={formatClock(time, half)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') clock.seek(time + 30)
          if (e.key === 'ArrowLeft') clock.seek(time - 30)
        }}
      >
        <rect ref={shade} x="0" y="0" width={Math.max(0, X(time))} height={H} fill="#0b0c0e" fillOpacity="0.04" />
        {bars.map((b, i) => {
          const h = Math.max(1.5, Math.abs(b.v) * 24)
          const isHome = b.v >= 0
          return <rect key={i} x={b.x} width={b.w} y={isHome ? MID - h : MID} height={h} fill={isHome ? home.primary : away.primary} fillOpacity={X(time) >= b.x ? 0.95 : 0.35} />
        })}
        <line x1="0" x2="1000" y1={MID} y2={MID} stroke="#0b0c0e" strokeOpacity="0.25" vectorEffect="non-scaling-stroke" />
        {ticks.map((t) => (
          <line key={t.label} x1={t.x} x2={t.x} y1={t.label === 'HT' ? 0 : MID - 4} y2={t.label === 'HT' ? H : MID + 4} stroke="#0b0c0e" strokeOpacity={t.label === 'HT' ? 0.35 : 0.25} strokeDasharray={t.label === 'HT' ? '2 3' : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        {markers.map((e) => {
          const x = X(e.ts)
          const y = e.team === 'home' ? 6 : H - 6
          if (e.type === 'goal') return <rect key={e.id} x={x - 4} y={y - 4} width="8" height="8" fill="#ff4d2e" transform={`rotate(45 ${x} ${y})`} />
          if (e.type === 'card') return <rect key={e.id} x={x - 2} y={y - 4.5} width="4" height="9" fill={e.outcome === 'yellow' ? '#f5c518' : '#ff4d2e'} />
          return <rect key={e.id} x={x - 3.5} y={y - 3.5} width="7" height="7" fill="none" stroke="#0b0c0e" strokeWidth="1.3" vectorEffect="non-scaling-stroke" transform={`rotate(45 ${x} ${y})`} />
        })}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="#0b0c0e" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />}
        <rect ref={head} x={X(time) - 1.5} y="0" width="3" height={H} fill="#ff4d2e" />
      </svg>
      <div className="pointer-events-none absolute inset-0">
        {ticks.map((t) => (
          <span key={t.label} className="absolute bottom-0 cond text-[10px] text-ink-3" style={{ left: `${t.x / 10}%`, transform: 'translateX(4px)' }}>
            {t.label}
          </span>
        ))}
        {hover !== null && (
          <span className="absolute -top-7 bg-ink px-2 py-0.5 cond text-[11px] whitespace-nowrap text-volt" style={{ left: `${X(hover) / 10}%`, transform: 'translateX(-50%)' }}>
            {formatClock(hover, half)}
            {near &&
              ` · ${near.type === 'tactical_change' ? 'tactical change' : near.type === 'card' ? `${near.outcome} card` : 'goal'}${near.player ? ` · ${name(near.player)}` : ''}`}
          </span>
        )}
      </div>
    </div>
  )
}
