import { useMemo, useRef } from 'react'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'

const H = 84
const MID = 40

export default function Timeline() {
  const { pkg, clock } = useMatch()
  const { time } = useClock(clock, 10)
  const ref = useRef<SVGSVGElement>(null)
  const dur = pkg.meta.duration_s
  const half = pkg.meta.period_lengths_s['1']
  const { home, away } = pkg.meta.teams
  const homeColor = home.primary.toLowerCase() === '#1d1d1d' ? home.secondary : home.primary
  const awayColor = away.primary.toLowerCase() === '#1d1d1d' ? away.secondary : away.primary

  const { homePath, awayPath, markers } = useMemo(() => {
    const mom = pkg.analytics.momentum
    const pts = mom.map((r) => ({ x: (r.minute * 60 + 30) / dur, v: r.momentum }))
    const area = (sign: 1 | -1) => {
      let d = `M0,${MID}`
      for (const p of pts) {
        const v = sign === 1 ? Math.max(0, p.v) : Math.min(0, p.v)
        d += ` L${(p.x * 1000).toFixed(1)},${(MID - v * 32).toFixed(1)}`
      }
      return d + ` L1000,${MID} Z`
    }
    const markers = pkg.events
      .filter((e) => e.type === 'goal' || (e.type === 'card' && e.outcome !== 'yellow') || e.type === 'tactical_change' || e.type === 'substitution' || (e.type === 'card' && e.outcome === 'yellow'))
      .map((e) => ({ e, x: (e.ts / dur) * 1000 }))
    return { homePath: area(1), awayPath: area(-1), markers }
  }, [pkg, dur])

  const seekFromEvent = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    clock.seek(((clientX - r.left) / r.width) * dur)
  }

  return (
    <div className="select-none">
      <svg
        ref={ref}
        viewBox={`0 0 1000 ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full cursor-pointer"
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          seekFromEvent(e.clientX)
        }}
        onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e.clientX)}
        role="slider"
        aria-label="Match timeline"
        aria-valuemin={0}
        aria-valuemax={dur}
        aria-valuenow={time}
      >
        <rect x="0" y="0" width="1000" height={H} fill="#0b1020" />
        <path d={homePath} fill={homeColor} fillOpacity="0.55" />
        <path d={awayPath} fill={awayColor} fillOpacity="0.55" />
        <line x1="0" x2="1000" y1={MID} y2={MID} stroke="#2a3a63" strokeWidth="1" />
        <line x1={(half / dur) * 1000} x2={(half / dur) * 1000} y1="0" y2={H} stroke="#7f90b8" strokeDasharray="3 3" strokeWidth="1" />
        {markers.map(({ e, x }) => {
          const y = e.team === 'home' ? 8 : H - 8
          if (e.type === 'goal')
            return <circle key={e.id} cx={x} cy={y} r="5" fill="#ffffff" stroke="#0b1020" strokeWidth="1.5" />
          if (e.type === 'card')
            return <rect key={e.id} x={x - 2.5} y={y - 4} width="5" height="8" fill={e.outcome === 'yellow' ? '#fbbf24' : '#ef4444'} />
          if (e.type === 'tactical_change')
            return <rect key={e.id} x={x - 4} y={y - 4} width="8" height="8" transform={`rotate(45 ${x} ${y})`} fill="#7dd3fc" />
          return <line key={e.id} x1={x} x2={x} y1={y - 4} y2={y + 4} stroke="#a9b6d6" strokeWidth="1.5" />
        })}
        <rect x={(time / dur) * 1000 - 1} y="0" width="2" height={H} fill="#2ee6a6" />
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: homeColor }} /> {home.name} momentum</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: awayColor }} /> {away.name} momentum</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-white" /> goal</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rotate-45 bg-sky-400" /> tactical change</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-1.5 bg-amber-400" /> card</span>
        <span className="ml-auto">Click or drag to scrub</span>
      </div>
    </div>
  )
}
