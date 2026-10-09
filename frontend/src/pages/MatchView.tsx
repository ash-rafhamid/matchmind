import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import AskPanel from '../components/AskPanel'
import { CamCut, CameraSwitch, GoalTakeover, LowerThird, ReelOverlay, ReplayBug, ScoreBug, Transport, useAtmosphere, useCamCut, useCrossings, type PlayMode } from '../components/Broadcast'
import CrewFeed from '../components/CrewFeed'
import RecapPanel from '../components/RecapPanel'
import StatsPanel from '../components/StatsPanel'
import WhatIfPanel from '../components/WhatIfPanel'
import { PlaybackClock } from '../lib/clock'
import { MatchCtx, type MatchCtxValue, useMatch } from '../lib/match'
import { Commentator } from '../lib/commentator'
import { BreakDirector, buildBreaks, buildReel, ReelDirector, type BreakState, type ReelState } from '../lib/reel'
import { Atmosphere } from '../lib/sound'
import { TrackingStore } from '../lib/tracking'
import { useSettings, useT } from '../lib/settings'
import { onPrimary } from '../lib/ui'
import type { CameraMode } from '../scene/Stadium'
import type { MatchEvent, MatchPackage, Moment, Side } from '../types'

const Miniature = lazy(() => import('../components/Miniature'))

const TABS = ['live', 'ask', 'whatif', 'recap'] as const

type Tab = (typeof TABS)[number]

export default function MatchView({ matchId }: { matchId: string }) {
  const [pkg, setPkg] = useState<MatchPackage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const t = useT()

  useEffect(() => {
    api.match(matchId).then(setPkg).catch((e) => setError(String(e.message ?? e)))
  }, [matchId])

  if (error) return <p className="p-10 text-flare">{t('match.notFound')}: {error}</p>
  if (!pkg)
    return (
      <div className="grid h-[calc(100vh-52px)] place-items-center bg-ink">
        <p className="working cond text-volt">{t('app.loadingStadium')}</p>
      </div>
    )
  return <LoadedMatch pkg={pkg} />
}

function LoadedMatch({ pkg }: { pkg: MatchPackage }) {
  const clock = useMemo(() => new PlaybackClock(pkg.meta.duration_s), [pkg.meta.duration_s])
  const store = useMemo(() => new TrackingStore(pkg.meta.id, pkg.meta.version), [pkg.meta.id, pkg.meta.version])
  const [highlight, setHighlight] = useState<number[]>([])
  const [tab, setTab] = useState<Tab>('live')
  const [cam, setCam] = useState<CameraMode>('director')
  const { cut: camCut, onCut, pick: pickCam, flash } = useCamCut(setCam)
  const [lower, setLower] = useState<Moment | null>(null)
  const [goal, setGoal] = useState<MatchEvent | null>(null)
  const [focusMoment, setFocusMoment] = useState<string | null>(null)
  const eventsById = useMemo(() => new Map(pkg.events.map((e) => [e.id, e])), [pkg.events])
  const goals = useMemo(() => pkg.events.filter((e) => e.type === 'goal'), [pkg.events])
  const t = useT()

  useEffect(() => () => clock.destroy(), [clock])

  // like a video player: hold the clock while the next minute of tracking is still on its way
  useEffect(() => {
    clock.waitFor = (t) => store.ready(t)
    return () => {
      clock.waitFor = null
    }
  }, [clock, store])

  // highlights by default: the AI director cuts the match like TV, with goal replays
  const director = useMemo(() => new ReelDirector(clock, store, buildReel(pkg)), [clock, store, pkg])
  const [mode, setModeState] = useState<PlayMode>('full')
  const [reel, setReel] = useState<ReelState>(() => director.state())
  // sound is on by default; browsers only allow it to start from a click, so it starts with Play
  const [sound, setSoundState] = useState(() => {
    try {
      return localStorage.getItem('mm.sound') !== '0'
    } catch {
      return true
    }
  })
  const atm = useRef<Atmosphere | null>(null)
  const startAudio = () => {
    if (!atm.current) atm.current = new Atmosphere()
  }
  const setSound = (on: boolean) => {
    setSoundState(on)
    try {
      localStorage.setItem('mm.sound', on ? '1' : '0')
    } catch {
      /* private mode */
    }
    if (on) startAudio()
    else {
      atm.current?.close()
      atm.current = null
    }
  }
  useEffect(() => () => atm.current?.close(), [])
  // the crew's commentary read aloud when a moment comes up (on by default)
  const [voice, setVoiceState] = useState(() => {
    try {
      return localStorage.getItem('mm.voice') !== '0'
    } catch {
      return true
    }
  })
  const setVoice = (on: boolean) => {
    setVoiceState(on)
    try {
      localStorage.setItem('mm.voice', on ? '1' : '0')
    } catch {
      /* private mode */
    }
  }

  // full match: stoppages handled like TV - a slow-motion replay of the goal or the foul, then back for the restart
  const breaks = useMemo(() => buildBreaks(pkg), [pkg])
  const [brk, setBrk] = useState<BreakState>({ phase: 'live', brk: null, cuts: 0 })
  const replaying = useRef(false)
  replaying.current = reel.phase === 'replay' || (reel.phase === 'cut' && reel.cutTo === 'replay') || brk.phase === 'replay'

  // the commentator: play-by-play in a neural voice, and the crew's analysis after big moments
  const { lang, persona } = useSettings()
  const comm = useMemo(() => new Commentator(pkg.meta.id, lang, clock), [pkg.meta.id, lang, clock])
  useEffect(() => () => comm.dispose(), [comm])
  useEffect(() => comm.setEnabled(voice), [comm, voice])
  useEffect(() => {
    comm.replaying = replaying.current
  })
  useEffect(() => {
    comm.onDuck = (on) => atm.current?.duck(on)
  }, [comm])
  const onMoment = useCallback(
    (m: Moment) => {
      setLower(m)
      comm.moment(m.id, persona)
    },
    [comm, persona],
  )
  useEffect(() => director.subscribe(setReel), [director])
  useEffect(() => {
    director.onExit = () => setModeState('full')
    return () => director.stop()
  }, [director])

  const setMode = (m: PlayMode) => {
    setModeState(m)
    if (m === 'full') {
      director.stop()
    } else {
      clock.pause()
      director.start()
    }
  }
  useEffect(() => {
    if (mode !== 'full') return
    const bd = new BreakDirector(clock, store, breaks)
    const off = bd.subscribe((s) => {
      setBrk(s)
      flash(s.phase === 'replay' ? 'replay' : 'live')
    })
    return () => {
      off()
      bd.stop()
      setBrk({ phase: 'live', brk: null, cuts: 0 })
    }
  }, [mode, clock, store, breaks, flash])

  const onPlay = () => {
    if (sound) startAudio()
    comm.unlock()
    if (mode === 'highlights') {
      if (reel.phase === 'off' || reel.phase === 'done') director.start()
      else if (clock.playing) clock.pause()
      else clock.play()
    } else clock.toggle()
  }
  const brkReplay = brk.phase === 'replay' ? brk.brk?.replay ?? null : null
  const replayDir = brkReplay ? brkReplay.dir : reel.phase === 'replay' && reel.clip?.goal ? (reel.clip.goal.team === 'home' ? 1 : -1) : null
  const replayAngle = brkReplay ? brkReplay.angle : 'goal'
  useEffect(() => store.prefetch(0), [store])

  const focusEvidence = useCallback(
    (ids: number[], play = false) => {
      const evs = ids.map((id) => eventsById.get(id)).filter(Boolean)
      if (!evs.length) return
      setHighlight(ids)
      const first = Math.min(...evs.map((e) => e!.ts))
      const last = Math.max(...evs.map((e) => e!.ts + e!.dur))
      store.prefetch(first - 3)
      if (play) clock.replay(Math.max(0, first - 3), last + 2, 1)
      else clock.seek(Math.max(0, first - 1))
      if (window.innerWidth < 1280) document.getElementById('stage')?.scrollIntoView({ behavior: 'smooth' })
    },
    [clock, eventsById, store],
  )

  const value: MatchCtxValue = useMemo(
    () => ({
      pkg,
      clock,
      eventsById,
      highlight,
      focusEvidence,
      clearHighlight: () => setHighlight([]),
      name: (pid) => (pid ? pkg.meta.player_names[pid] ?? pid : ''),
      teamName: (side: Side) => pkg.meta.teams[side].name,
    }),
    [pkg, clock, eventsById, highlight, focusEvidence],
  )
  const highlightEvents = useMemo(() => highlight.map((id) => eventsById.get(id)).filter(Boolean) as MatchEvent[], [highlight, eventsById])

  return (
    <MatchCtx.Provider value={value}>
      <CrossingWatch goals={goals} onGoal={setGoal} onMoment={onMoment} muted={replaying} />
      <AtmosphereWatch atm={atm} store={store} replaying={replaying} />
      <div className="grid xl:h-[calc(100vh-52px)] xl:grid-cols-[minmax(0,1fr)_440px]">
        <section id="stage" className="relative flex min-h-[560px] flex-col bg-ink xl:min-h-0">
          <div className="relative min-h-[340px] flex-1">
            <Suspense fallback={<p className="working absolute inset-0 grid place-items-center cond text-volt">{t('app.loadingStadium')}</p>}>
              <Miniature pkg={pkg} store={store} clock={clock} mode={cam} highlights={highlightEvents} replay={replayDir} replayAngle={replayAngle} onCut={onCut} className="absolute inset-0" />
            </Suspense>
            <div className="stage-shade pointer-events-none absolute inset-0" />
            <CamCut cut={camCut} />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-3 sm:p-4">
              <div className="pointer-events-auto">
                <ScoreBug />
              </div>
              <div className="pointer-events-auto flex flex-col items-end gap-2">
                <CameraSwitch mode={cam} onMode={pickCam} />
                {highlight.length > 0 && (
                  <button onClick={() => setHighlight([])} className="cut-both bg-flare px-3 py-1 cond text-[11px] text-white">
                    {t('match.clearMarkers')}
                  </button>
                )}
              </div>
            </div>
            {goal && <GoalTakeover key={goal.id} goal={goal} />}
            {brkReplay && <ReplayBug />}
            {mode === 'highlights' && (
              <ReelOverlay
                reel={reel}
                onFull={() => setMode('full')}
                onAgain={() => {
                  clock.seek(0)
                  director.start()
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 sm:p-4">
              {lower && (
                <LowerThird
                  key={lower.id}
                  moment={lower}
                  onDone={() => setLower(null)}
                  onOpen={() => {
                    setTab('live')
                    setFocusMoment(lower.id)
                  }}
                />
              )}
            </div>
          </div>
          <Transport mode={mode} onMode={setMode} onPlay={onPlay} reel={reel} sound={sound} onSound={() => setSound(!sound)} voice={voice} onVoice={() => setVoice(!voice)} />
        </section>

        <aside className="plate flex min-h-[640px] min-w-0 flex-col xl:min-h-0">
          <div className="flex items-center justify-between bg-ink px-5 py-3 text-white">
            <span className="xp text-[17px]">
              {t('match.crew')}<span className="xp-light text-white/50"> {t('match.onAir')}</span>
            </span>
            <span className="hidden cond text-[10px] text-white/45 sm:inline">{t('match.crewList')}</span>
          </div>
          <nav className="flex border-b border-line" role="tablist" aria-label="Crew">
            {TABS.map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 py-3 cond text-[12px] transition-colors ${tab === id ? 'bg-volt text-ink' : 'text-ink-3 hover:bg-concrete hover:text-ink'}`}
              >
                {t(`tab.${id}`)}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            {tab === 'live' && <CrewFeed focus={focusMoment} />}
            {tab === 'ask' && <AskPanel />}
            {tab === 'whatif' && <WhatIfPanel />}
            {tab === 'recap' && <RecapPanel />}
          </div>
          <div className="flex items-center justify-between border-t border-line px-5 py-2.5">
            <a href={`#/studio/${pkg.meta.id}`} target="_blank" rel="noreferrer" className="act">
              {t('match.studio')}
            </a>
            <a href={`/api/matches/${pkg.meta.id}/export.zip`} className="act">
              {t('match.dataset')}
            </a>
            <a href="#centre" className="act">
              {t('match.numbers')}
            </a>
          </div>
        </aside>
      </div>
      <div id="centre">
        <StatsPanel />
        <TeamSheets />
      </div>
    </MatchCtx.Provider>
  )
}

/** Stadium sound has to live inside the match context, next to the other event watchers. */
function AtmosphereWatch({ atm, store, replaying }: { atm: { current: Atmosphere | null }; store: TrackingStore; replaying: { current: boolean } }) {
  useAtmosphere(atm, store, replaying)
  return null
}

function CrossingWatch({
  goals,
  onGoal,
  onMoment,
  muted,
}: {
  goals: MatchEvent[]
  onGoal: (g: MatchEvent | null) => void
  onMoment: (m: Moment) => void
  muted: { current: boolean }
}) {
  const { pkg } = useMatch()
  // during a replay the GOAL takeover and the caption have already been shown once
  const onCrossGoal = useCallback(
    (e: MatchEvent | Moment) => {
      if (muted.current) return
      onGoal(e as MatchEvent)
      window.setTimeout(() => onGoal(null), 2600)
    },
    [onGoal, muted],
  )
  const onCrossMoment = useCallback(
    (m: MatchEvent | Moment) => {
      if (!muted.current) onMoment(m as Moment)
    },
    [onMoment, muted],
  )
  useCrossings(goals, onCrossGoal)
  useCrossings(pkg.analytics.moments, onCrossMoment)
  return null
}

function TeamSheets() {
  const { pkg } = useMatch()
  const t = useT()
  return (
    <section className="mx-auto grid max-w-[1480px] gap-6 px-4 pb-16 sm:px-8 md:grid-cols-2">
      {(['home', 'away'] as Side[]).map((s) => {
        const team = pkg.meta.teams[s]
        const byId = new Map(team.players.map((p) => [p.id, p]))
        return (
          <div key={s} className="plate p-5">
            <div className="flex items-stretch">
              <span className="cut-r px-3 py-1.5 xp text-[16px]" style={{ background: team.primary, color: onPrimary(team) }}>
                {team.name}
              </span>
              <span className="self-center pl-3 cond text-ink-3">
                {team.dna.formation} · {t('stats.coach')} {team.coach}
              </span>
            </div>
            <p className="mt-3 text-[13px] text-ink-3">{team.traits.length ? team.traits.join(' · ') : t('stats.balanced')}</p>
            <ol className="mt-3 grid grid-cols-2 gap-x-6 text-[14px]">
              {team.starters.map((pid) => {
                const p = byId.get(pid)
                return (
                  <li key={pid} className="flex items-center gap-3 border-t border-line py-1.5">
                    <span className="w-6 text-right font-bold text-ink-3 tab-num">{p?.number}</span>
                    <span className="truncate font-medium">{p?.name}</span>
                    <span className="ml-auto cond text-[10px] text-ink-4">{p?.role}</span>
                  </li>
                )
              })}
            </ol>
            <p className="mt-3 text-[12px] text-ink-3">
              <span className="cond me-2">{t('stats.bench')}</span>
              {team.bench.map((pid) => byId.get(pid)?.name).filter(Boolean).join(', ')}
            </p>
          </div>
        )
      })}
    </section>
  )
}
