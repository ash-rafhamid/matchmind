import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { formatClock, useClock } from '../lib/clock'
import { lastEventIndex, scoreAt, useMatch } from '../lib/match'
import { useSettings, useT } from '../lib/settings'
import { momentTitle, onPrimary, surname } from '../lib/ui'
import type { ReelState } from '../lib/reel'
import type { Atmosphere } from '../lib/sound'
import type { TrackingStore } from '../lib/tracking'
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

const CAMS: CameraMode[] = ['director', 'broadcast', 'tactical', 'goal', 'follow']

export function CameraSwitch({ mode, onMode }: { mode: CameraMode; onMode: (m: CameraMode) => void }) {
  const t = useT()
  return (
    <div className="seg cut-both pl-2 shadow-[0_6px_24px_rgba(0,0,0,0.3)]" role="group" aria-label="Camera">
      <span className="hidden cond self-center pe-2 ps-1 text-[11px] text-ink-3 sm:inline">{t('match.camera')}</span>
      {CAMS.map((m) => (
        <button key={m} aria-pressed={mode === m} onClick={() => onMode(m)}>
          {t(`cam.${m}`)}
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
  const { persona, lang, t } = useSettings()
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
          <span className="xp truncate text-[15px]">{momentTitle(moment, t)}</span>
        </div>
      </div>
      <div className="plate px-5 pt-3 pb-3">
        {story ? (
          <div className="fade-in">
            <StoryText text={story.text} className="line-clamp-3 !text-[15px]" />
            <div className="mt-2 flex items-center gap-4">
              <VerifiedBadge verdict={story.verdict} mode={story.mode} />
              <button onClick={onOpen} className="act ml-auto">
                {t('match.fullStory')}
              </button>
            </div>
          </div>
        ) : (
          <p className="working cond text-ink-3">{t('match.crewWriting')}</p>
        )}
      </div>
    </div>
  )
}

/** Full-stage takeover when a goal goes in. */
export function GoalTakeover({ goal }: { goal: MatchEvent }) {
  const { pkg, name } = useMatch()
  const t = useT()
  const team = pkg.meta.teams[goal.team]
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden">
      <div className="wipe absolute inset-y-[30%] -right-10 -left-10 -skew-y-3" style={{ background: team.primary }} />
      <div className="wipe relative text-center" style={{ color: onPrimary(team), animationDelay: '0.12s' }}>
        <div className="xp text-[min(18vw,190px)] leading-[0.8]">{t('match.goal')}</div>
        <div className="mt-3 cond text-[18px] opacity-90">
          {surname(name(goal.player))} · {goal.clock} · {team.name}
        </div>
      </div>
    </div>
  )
}

const ACTION = new Set(['pass', 'carry', 'shot', 'interception', 'tackle', 'save', 'clearance', 'block', 'foul', 'card', 'offside', 'goal'])

export type PlayMode = 'highlights' | 'full'

interface TransportProps {
  mode: PlayMode
  onMode: (m: PlayMode) => void
  onPlay: () => void
  reel: ReelState
  sound: boolean
  onSound: () => void
}

/** Bottom bar of the stage: highlights or the full match, play, speed, sound, the timeline, and what is happening now. */
export function Transport({ mode, onMode, onPlay, reel, sound, onSound }: TransportProps) {
  const { pkg, clock, name } = useMatch()
  const { time, playing, speed } = useClock(clock, 6)
  const t = useT()
  const shown = useMemo(() => pkg.events.filter((e) => ACTION.has(e.type)), [pkg.events])
  const idx = lastEventIndex(shown, time)
  const cur = idx >= 0 && time - shown[idx].ts < 3 ? shown[idx] : null
  const speeds = mode === 'highlights' ? [1, 2] : [1, 2, 4, 8, 16]
  const running = playing || reel.phase === 'cut'

  return (
    <div className="plate">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-2.5 sm:px-4">
        <button className="btn btn-volt min-w-[112px] !px-5 !py-2" onClick={onPlay} aria-label={running ? t('match.pause') : t('match.play')}>
          {running ? '❚❚' : '▶'} <span>{running ? t('match.pause') : t('match.play')}</span>
        </button>
        <div className="seg" role="group" aria-label={t('mode.help')} title={t('mode.help')}>
          <button aria-pressed={mode === 'highlights'} onClick={() => onMode('highlights')}>
            {t('mode.highlights')}
          </button>
          <button aria-pressed={mode === 'full'} onClick={() => onMode('full')}>
            {t('mode.full')}
          </button>
        </div>
        <div className="seg" role="group" aria-label="Speed">
          {speeds.map((s) => (
            <button key={s} aria-pressed={Math.abs(speed - s) < 0.01} onClick={() => clock.setSpeed(s)} className="tab-num">
              {s}×
            </button>
          ))}
        </div>
        <button className={`act ${sound ? '!text-ink' : ''}`} onClick={onSound} aria-pressed={sound}>
          {sound ? '🔊' : '🔈'} {sound ? t('sound.on') : t('sound.off')}
        </button>
        <div className="ms-auto flex min-h-[22px] items-center gap-2 text-[13px]">
          {clock.buffering ? (
            <span className="working cond text-ink-3">{t('buffering')}</span>
          ) : mode === 'highlights' && reel.clip && reel.phase !== 'off' ? (
            <span className="cond text-ink-3">{t('reel.clip', { n: reel.index + 1, total: reel.total })}</span>
          ) : null}
          {cur && !clock.buffering && (
            <>
              <span className="cond text-ink-3">{t(`act.${cur.type}`)}</span>
              <span className="font-semibold">
                {surname(name(cur.player))}
                {cur.receiver ? ` → ${surname(name(cur.receiver))}` : ''}
              </span>
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

/** While a dead-ball stretch fast-forwards: a small badge, the match keeps moving underneath. */
export function RestartCut({ to }: { to: MatchEvent }) {
  const t = useT()
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center sm:top-4">
      <div className="fade-in flex items-stretch shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        <span className="cut-l flex items-center bg-ink ps-4 pe-3 cond text-volt">⏩ 10×</span>
        <span className="cut-r flex items-center bg-white pe-5 ps-3 cond text-ink">
          {t('reel.restart')} {to.clock}
        </span>
      </div>
    </div>
  )
}

const CLIP_KEY: Record<string, string> = { kickoff: 'reel.kickoff', chance: 'reel.chance', fulltime: 'reel.fulltime' }

/** What the edit shows between clips: a wipe with the next moment, or the REPLAY bug over a slow-motion replay. */
export function ReelOverlay({ reel, onFull, onAgain }: { reel: ReelState; onFull: () => void; onAgain: () => void }) {
  const t = useT()
  if (reel.phase === 'replay')
    return (
      <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center sm:top-4">
        <div className="wipe flex items-stretch shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
          <span className="cut-l flex items-center bg-flare ps-5 pe-3 xp text-[18px] text-white">{t('reel.replay')}</span>
          <span className="cut-r flex items-center bg-ink pe-5 ps-3 cond text-volt">{t('reel.slowmo')} · 0.5×</span>
        </div>
      </div>
    )
  if (reel.phase === 'cut') {
    const isReplay = reel.cutTo === 'replay'
    const c = isReplay ? reel.clip : reel.next
    // never give away what is coming (no "GOAL" before the goal): just the minute and "next highlight"
    let label = ''
    if (isReplay) label = t('reel.replay')
    else if (c) label = c.kind === 'kickoff' && c.start > 60 ? t('reel.second_half') : c.kind === 'fulltime' ? t(CLIP_KEY.fulltime) : t('reel.next')
    return (
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        <div className="wipe absolute inset-0 bg-ink/85" />
        <div className="absolute inset-0 grid place-items-center">
          <div className="wipe flex items-stretch shadow-[0_12px_40px_rgba(0,0,0,0.5)]" style={{ animationDelay: '0.1s' }}>
            <span className="cut-l flex items-center bg-volt ps-6 pe-4 xp text-[clamp(22px,4vw,44px)] text-ink tab-num">{isReplay ? '↺' : c?.clock}</span>
            <span className="cut-r flex items-center bg-white pe-7 ps-4 xp text-[clamp(18px,3vw,34px)] text-ink">
              {label}
            </span>
          </div>
        </div>
      </div>
    )
  }
  if (reel.phase === 'done')
    return (
      <div className="absolute inset-0 z-20 grid place-items-center bg-ink/70">
        <div className="wipe-up text-center text-white">
          <div className="xp text-[clamp(28px,5vw,56px)]">{t('reel.done')}</div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={onFull} className="btn btn-volt">
              {t('reel.watchFull')} →
            </button>
            <button onClick={onAgain} className="btn">
              ↺ {t('reel.again')}
            </button>
          </div>
        </div>
      </div>
    )
  return null
}

/**
 * Stadium sound, driven by the match: tension from where the ball is, reactions to shots and goals,
 * and the referee's whistle at kick-offs, fouls, offsides, goals and full time.
 * The page owns the audio (it can only start after a click), this hook just plays the match into it.
 */
export function useAtmosphere(atm: { current: Atmosphere | null }, store: TrackingStore, replaying: { current: boolean }) {
  const { pkg, clock } = useMatch()
  const half = pkg.meta.period_lengths_s['1']
  const events = useMemo(
    () =>
      pkg.events.filter(
        (e) => ['shot', 'goal', 'period_start', 'period_end', 'card', 'foul', 'offside'].includes(e.type) || (e.type === 'pass' && e.set_piece === 'kickoff'),
      ),
    [pkg.events],
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      const a = atm.current
      const b = store.ballAt(clock.time)
      if (a && b) a.setTension(Math.max(0, (Math.abs(b[0] - 52.5) - 20) / 32))
    }, 300)
    return () => clearInterval(timer)
  }, [atm, clock, store])

  const onCross = useCallback(
    (e: MatchEvent | Moment) => {
      const a = atm.current
      const ev = e as MatchEvent
      if (!a) return
      if (ev.type === 'shot') {
        a.thud(0.9)
        if (ev.outcome !== 'goal') a.swell(0.25 + Math.min(0.5, (ev.xg ?? 0) * 1.4), 2.2)
      } else if (ev.type === 'goal') {
        a.swell(replaying.current ? 0.45 : 1, replaying.current ? 3 : 7)
        if (!replaying.current) window.setTimeout(() => a.whistle(false), 350)
      } else if (ev.type === 'pass') a.whistle(true) // kick-off
      else if (ev.type === 'period_end') {
        if (ev.ts > half + 60) a.fullTime()
        else a.whistle(true)
      } else if (ev.type === 'card' || ev.type === 'foul' || ev.type === 'offside') a.whistle(false)
    },
    [replaying, atm, half],
  )
  useCrossings(events, onCross)
}
