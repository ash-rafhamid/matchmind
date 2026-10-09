import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { formatClock, useClock } from '../lib/clock'
import { lastEventIndex, scoreAt, useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import { onPrimary, surname } from '../lib/ui'
import type { CameraMode } from '../scene/Stadium'
import type { CrewResult, MatchEvent, Moment } from '../types'
import StoryText from './StoryText'
import Timeline from './Timeline'
import { VerifiedBadge } from './Trace'

/** Top-left score bug, as on a TV broadcast. */
export function ScoreBug() {
  const { pkg, clock } = useMatch()
  const { time, playing } = useClock(clock, 6)
  const { home, away } = pkg.meta.teams
  const score = scoreAt(pkg.events, time)
  const ended = time >= pkg.meta.duration_s - 0.5
  const half = pkg.meta.period_lengths_s['1']
  const status = ended ? 'FT' : time < 0.5 ? 'KO' : formatClock(time, half)
  const block = (t: typeof home) => (
    <div className="flex items-center gap-2 px-3" style={{ background: t.primary, color: onPrimary(t) }}>
      <span className="xp text-[17px]">{t.short}</span>
    </div>
  )
  return (
    <div className="flex h-10 items-stretch shadow-[0_6px_24px_rgba(0,0,0,0.35)]" aria-live="polite" aria-label={`${home.name} ${score.home}, ${away.name} ${score.away}, ${status}`}>
      <div className="cut-l flex items-center bg-ink pr-3 pl-5">
        <span className="h-4 w-1.5 -skew-x-[18deg] bg-volt" />
      </div>
      {block(home)}
      <div className="plate xp flex min-w-[78px] items-center justify-center px-3 text-[20px] tab-num">
        {score.home}
        <span className="px-1.5 text-ink-4">-</span>
        {score.away}
      </div>
      {block(away)}
      <div className="cut-r flex min-w-[78px] items-center justify-center gap-2 bg-ink pr-5 pl-3 text-volt">
        {playing && !ended && <span className="live-pip" />}
        <span className="xp text-[16px] tab-num">{status}</span>
      </div>
    </div>
  )
}

const CAMS: [CameraMode, string][] = [
  ['director', 'AI director'],
  ['broadcast', 'TV'],
  ['tactical', 'Tactical'],
  ['goal', 'Goal cam'],
  ['follow', 'Follow'],
]

export function CameraSwitch({ mode, onMode }: { mode: CameraMode; onMode: (m: CameraMode) => void }) {
  return (
    <div className="seg cut-both pl-2 shadow-[0_6px_24px_rgba(0,0,0,0.3)]" role="group" aria-label="Camera">
      <span className="cond self-center pr-2 pl-1 text-[11px] text-ink-3">Camera</span>
      {CAMS.map(([m, label]) => (
        <button key={m} aria-pressed={mode === m} onClick={() => onMode(m)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** Fires `onCross` for each event the playhead passes while playing (not when seeking). */
export function useCrossings(events: MatchEvent[] | Moment[], onCross: (e: MatchEvent | Moment) => void) {
  const { clock } = useMatch()
  useEffect(() => {
    let last = clock.time
    return clock.subscribe(() => {
      const now = clock.time
      if (clock.playing && now > last && now - last < 30) {
        for (const e of events) if (e.ts > last && e.ts <= now) onCross(e)
      }
      last = now
    })
  }, [clock, events, onCross])
}

/** Broadcast lower third: the crew's verified take on the moment that just happened. */
export function LowerThird({ moment, onDone, onOpen }: { moment: Moment; onDone: () => void; onOpen: () => void }) {
  const { pkg } = useMatch()
  const { persona, lang } = useSettings()
  const [story, setStory] = useState<CrewResult | null>(null)
  const team = pkg.meta.teams[moment.team]
  const isGoal = moment.type === 'goal'

  useEffect(() => {
    let alive = true
    api.story(pkg.meta.id, moment.id, persona, lang).then((s) => alive && setStory(s)).catch(() => undefined)
    const t = window.setTimeout(onDone, 14000)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [pkg.meta.id, moment.id, persona, lang, onDone])

  return (
    <div className="wipe-up pointer-events-auto max-w-[760px] shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
      <div className="flex items-stretch">
        <div className="cut-l flex items-center px-4 py-1.5" style={{ background: isGoal ? 'var(--color-flare)' : 'var(--color-ink)', color: isGoal ? '#fff' : 'var(--color-volt)' }}>
          <span className="xp text-[15px] tab-num">{moment.clock}</span>
        </div>
        <div className="flex items-center gap-2 px-3" style={{ background: team.primary, color: onPrimary(team) }}>
          <span className="cond">{team.short}</span>
        </div>
        <div className="plate cut-r flex min-w-0 flex-1 items-center pr-6 pl-3">
          <span className="xp truncate text-[15px]">{moment.title}</span>
        </div>
      </div>
      <div className="plate px-5 pt-3 pb-3">
        {story ? (
          <div className="fade-in">
            <StoryText text={story.text} className="line-clamp-3 !text-[15px]" />
            <div className="mt-2 flex items-center gap-4">
              <VerifiedBadge verdict={story.verdict} mode={story.mode} />
              <button onClick={onOpen} className="act ml-auto">
                Full story &rarr;
              </button>
            </div>
          </div>
        ) : (
          <p className="working cond text-ink-3">The crew is writing</p>
        )}
      </div>
    </div>
  )
}

/** Full-stage takeover when a goal goes in. */
export function GoalTakeover({ goal }: { goal: MatchEvent }) {
  const { pkg, name } = useMatch()
  const team = pkg.meta.teams[goal.team]
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden">
      <div className="wipe absolute inset-y-[30%] -right-10 -left-10 -skew-y-3" style={{ background: team.primary }} />
      <div className="wipe relative text-center" style={{ color: onPrimary(team), animationDelay: '0.12s' }}>
        <div className="xp text-[min(18vw,190px)] leading-[0.8]">Goal</div>
        <div className="mt-3 cond text-[18px] opacity-90">
          {surname(name(goal.player))} · {goal.clock} · {team.name}
        </div>
      </div>
    </div>
  )
}

const SPEEDS = [1, 4, 8, 16, 32]
const ACTION: Record<string, string> = {
  pass: 'Pass', carry: 'Carry', shot: 'Shot', interception: 'Interception', tackle: 'Tackle', save: 'Save',
  clearance: 'Clearance', block: 'Block', foul: 'Foul', card: 'Card', offside: 'Offside', goal: 'Goal',
}

/** Bottom bar of the stage: play, speed, the match timeline, and what is happening right now. */
export function Transport() {
  const { pkg, clock, name } = useMatch()
  const { time, playing, speed } = useClock(clock, 6)
  const shown = useMemo(() => pkg.events.filter((e) => e.type in ACTION), [pkg.events])
  const idx = lastEventIndex(shown, time)
  const cur = idx >= 0 && time - shown[idx].ts < 3 ? shown[idx] : null

  return (
    <div className="plate">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-2.5 sm:px-4">
        <button className="btn btn-volt !px-5 !py-2" onClick={() => clock.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'} <span>{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button className="act" onClick={() => clock.seek(0)}>
          ↺ Kick-off
        </button>
        <div className="seg" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={speed === s} onClick={() => clock.setSpeed(s)} className="tab-num">
              {s}×
            </button>
          ))}
        </div>
        <div className="ml-auto flex min-h-[22px] items-center gap-2 text-[13px]">
          {cur && (
            <>
              <span className="cond text-ink-3">{ACTION[cur.type]}</span>
              <span className="font-semibold">
                {surname(name(cur.player))}
                {cur.receiver ? ` → ${surname(name(cur.receiver))}` : ''}
              </span>
              {cur.outcome && !['complete', 'success'].includes(cur.outcome) && <span className="text-ink-3">({cur.outcome.replace('_', ' ')})</span>}
            </>
          )}
        </div>
      </div>
      <div className="px-3 pt-1 pb-2 sm:px-4">
        <Timeline />
      </div>
    </div>
  )
}
