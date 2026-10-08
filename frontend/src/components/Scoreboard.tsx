import { Pause, Play, Rewind } from 'lucide-react'
import { formatClock, useClock } from '../lib/clock'
import { scoreAt, useMatch } from '../lib/match'

const SPEEDS = [1, 4, 8, 16, 32]

export default function Scoreboard() {
  const { pkg, clock } = useMatch()
  const { time, playing, speed } = useClock(clock, 6)
  const { home, away } = pkg.meta.teams
  const firstHalf = pkg.meta.period_lengths_s['1']
  const score = scoreAt(pkg.events, time)
  const ended = time >= pkg.meta.duration_s - 0.5
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-stretch overflow-hidden rounded-xl border border-ink-700 font-display text-xl font-semibold">
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: home.primary, color: home.secondary }}>
          {home.short}
        </div>
        <div className="flex items-center bg-ink-900 px-3 tabular-nums">
          {score.home} - {score.away}
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: away.primary, color: away.secondary }}>
          {away.short}
        </div>
        <div className="flex min-w-20 items-center justify-center gap-1.5 bg-ink-800 px-3 text-mint-400 tabular-nums">
          {playing && <span className="live-dot h-2 w-2 rounded-full bg-rose-400" />}
          {ended ? 'FT' : formatClock(time, firstHalf)}
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
        <button className="rounded-lg p-1.5 hover:bg-ink-700" onClick={() => clock.seek(0)} title="Back to kick-off" aria-label="Back to kick-off">
          <Rewind size={16} />
        </button>
        <button className="rounded-lg bg-mint-500 p-1.5 text-ink-950 hover:bg-mint-400" onClick={() => clock.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => clock.setSpeed(s)}
            className={`rounded-lg px-2 py-1 text-xs font-semibold ${speed === s ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:bg-ink-700'}`}
          >
            {s}x
          </button>
        ))}
      </div>
      <div className="ml-auto hidden text-right text-xs text-ink-400 md:block">
        <div>{pkg.meta.competition}</div>
        <div>
          {home.dna.formation} {home.name} vs {away.name} {away.dna.formation}
        </div>
      </div>
    </div>
  )
}
