import { formatClock, useClock } from '../lib/clock'
import { scoreAt, useMatch } from '../lib/match'
import { surname } from '../lib/ui'
import type { Side } from '../types'

/** The match set as a headline: names, the live score in big numerals, scorers so far, and the clock. */
export default function Scoreboard() {
  const { pkg, clock, name } = useMatch()
  const { time, playing } = useClock(clock, 6)
  const { home, away } = pkg.meta.teams
  const firstHalf = pkg.meta.period_lengths_s['1']
  const score = scoreAt(pkg.events, time)
  const ended = time >= pkg.meta.duration_s - 0.5
  const atHalf = Math.abs(time - firstHalf) < 1 && !playing
  const status = ended ? 'Full time' : time < 1 ? 'Kick-off' : atHalf ? 'Half time' : formatClock(time, firstHalf)

  const scorers = (side: Side) => {
    const goals = pkg.events.filter((e) => e.type === 'goal' && e.team === side && e.ts <= time)
    const by = new Map<string, string[]>()
    for (const g of goals) {
      const who = surname(name(g.player))
      by.set(who, [...(by.get(who) ?? []), g.clock])
    }
    return [...by.entries()].map(([who, mins]) => `${who} ${mins.join(', ')}`)
  }

  const side = (s: Side, align: 'left' | 'right') => {
    const t = pkg.meta.teams[s]
    const goals = scorers(s)
    return (
      <div className={`min-w-0 ${align === 'right' ? 'text-right' : 'text-left'}`}>
        <div className={`flex items-center gap-3 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          <span className="inline-flex h-6 w-6 shrink-0 border border-ink" aria-hidden>
            <span className="h-full w-1/2" style={{ background: t.primary }} />
            <span className="h-full w-1/2" style={{ background: t.secondary }} />
          </span>
          <h1 className="display text-[22px] leading-[1.05] font-semibold sm:text-[30px] lg:text-[40px]">{t.name}</h1>
        </div>
        <div className="mt-1 label">
          {t.dna.formation} · {t.coach}
        </div>
        <div className="mt-2 min-h-[1.5em] text-[15px] text-ink-2 italic">{goals.join(' · ')}</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-x-4 py-6 sm:gap-x-10">
      {side('home', 'right')}
      <div className="text-center">
        <div className="display text-[56px] leading-[0.85] font-semibold tabular-nums sm:text-[84px] lg:text-[104px]" aria-live="polite">
          {score.home}
          <span className="px-1 text-ink-4 sm:px-3">–</span>
          {score.away}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 num text-[13px] tracking-wide uppercase">
          {playing && !ended && <span className="live-dot" />}
          <span className={playing ? 'text-signal' : 'text-ink-2'}>{status}</span>
        </div>
      </div>
      {side('away', 'left')}
      <span className="sr-only">
        {home.name} {score.home}, {away.name} {score.away}
      </span>
    </div>
  )
}
