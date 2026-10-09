import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import AskPanel from '../components/AskPanel'
import { CameraSwitch, GoalTakeover, LowerThird, ScoreBug, Transport, useCrossings } from '../components/Broadcast'
import CrewFeed from '../components/CrewFeed'
import RecapPanel from '../components/RecapPanel'
import StatsPanel from '../components/StatsPanel'
import WhatIfPanel from '../components/WhatIfPanel'
import { PlaybackClock } from '../lib/clock'
import { MatchCtx, type MatchCtxValue, useMatch } from '../lib/match'
import { TrackingStore } from '../lib/tracking'
import { onPrimary } from '../lib/ui'
import type { CameraMode } from '../scene/Stadium'
import type { MatchEvent, MatchPackage, Moment, Side } from '../types'

const Miniature = lazy(() => import('../components/Miniature'))

const TABS = [
  ['live', 'Live'],
  ['ask', 'Ask'],
  ['whatif', 'What if'],
  ['recap', 'Report'],
] as const

type Tab = (typeof TABS)[number][0]

export default function MatchView({ matchId }: { matchId: string }) {
  const [pkg, setPkg] = useState<MatchPackage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.match(matchId).then(setPkg).catch((e) => setError(String(e.message ?? e)))
  }, [matchId])

  if (error) return <p className="p-10 text-flare">This match could not be found: {error}</p>
  if (!pkg)
    return (
      <div className="grid h-[calc(100vh-52px)] place-items-center bg-ink">
        <p className="working cond text-volt">Building the stadium</p>
      </div>
    )
  return <LoadedMatch pkg={pkg} />
}

function LoadedMatch({ pkg }: { pkg: MatchPackage }) {
  const clock = useMemo(() => new PlaybackClock(pkg.meta.duration_s), [pkg.meta.duration_s])
  const store = useMemo(() => new TrackingStore(pkg.meta.id), [pkg.meta.id])
  const [highlight, setHighlight] = useState<number[]>([])
  const [tab, setTab] = useState<Tab>('live')
  const [cam, setCam] = useState<CameraMode>('director')
  const [lower, setLower] = useState<Moment | null>(null)
  const [goal, setGoal] = useState<MatchEvent | null>(null)
  const [focusMoment, setFocusMoment] = useState<string | null>(null)
  const eventsById = useMemo(() => new Map(pkg.events.map((e) => [e.id, e])), [pkg.events])
  const goals = useMemo(() => pkg.events.filter((e) => e.type === 'goal'), [pkg.events])

  useEffect(() => () => clock.destroy(), [clock])
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
      <CrossingWatch goals={goals} onGoal={setGoal} onMoment={setLower} />
      <div className="grid xl:h-[calc(100vh-52px)] xl:grid-cols-[minmax(0,1fr)_440px]">
        <section id="stage" className="relative flex min-h-[560px] flex-col bg-ink xl:min-h-0">
          <div className="relative min-h-[340px] flex-1">
            <Suspense fallback={<p className="working absolute inset-0 grid place-items-center cond text-volt">Building the stadium</p>}>
              <Miniature pkg={pkg} store={store} clock={clock} mode={cam} highlights={highlightEvents} className="absolute inset-0" />
            </Suspense>
            <div className="stage-shade pointer-events-none absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-3 sm:p-4">
              <div className="pointer-events-auto">
                <ScoreBug />
              </div>
              <div className="pointer-events-auto flex flex-col items-end gap-2">
                <CameraSwitch mode={cam} onMode={setCam} />
                {highlight.length > 0 && (
                  <button onClick={() => setHighlight([])} className="cut-both bg-flare px-3 py-1 cond text-[11px] text-white">
                    Clear {highlight.length} marker{highlight.length > 1 ? 's' : ''} ✕
                  </button>
                )}
              </div>
            </div>
            {goal && <GoalTakeover key={goal.id} goal={goal} />}
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
          <Transport />
        </section>

        <aside className="plate flex min-h-[640px] min-w-0 flex-col xl:min-h-0">
          <div className="flex items-center justify-between bg-ink px-5 py-3 text-white">
            <span className="xp text-[17px]">
              The crew<span className="xp-light text-white/50"> / on air</span>
            </span>
            <span className="cond text-[10px] text-white/45">Producer · Analyst · Tactician · Storyteller · Fact-checker</span>
          </div>
          <nav className="flex border-b border-line" role="tablist" aria-label="Crew">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 py-3 cond text-[12px] transition-colors ${tab === id ? 'bg-volt text-ink' : 'text-ink-3 hover:bg-concrete hover:text-ink'}`}
              >
                {label}
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
              Studio overlay ↗
            </a>
            <a href={`/api/matches/${pkg.meta.id}/export.zip`} className="act">
              Dataset ↓
            </a>
            <a href="#centre" className="act">
              Numbers ↓
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

function CrossingWatch({ goals, onGoal, onMoment }: { goals: MatchEvent[]; onGoal: (g: MatchEvent | null) => void; onMoment: (m: Moment) => void }) {
  const { pkg } = useMatch()
  const onCrossGoal = useCallback(
    (e: MatchEvent | Moment) => {
      onGoal(e as MatchEvent)
      window.setTimeout(() => onGoal(null), 2600)
    },
    [onGoal],
  )
  const onCrossMoment = useCallback((m: MatchEvent | Moment) => onMoment(m as Moment), [onMoment])
  useCrossings(goals, onCrossGoal)
  useCrossings(pkg.analytics.moments, onCrossMoment)
  return null
}

function TeamSheets() {
  const { pkg } = useMatch()
  return (
    <section className="mx-auto grid max-w-[1480px] gap-6 px-4 pb-16 sm:px-8 md:grid-cols-2">
      {(['home', 'away'] as Side[]).map((s) => {
        const t = pkg.meta.teams[s]
        const byId = new Map(t.players.map((p) => [p.id, p]))
        return (
          <div key={s} className="plate p-5">
            <div className="flex items-stretch">
              <span className="cut-r px-3 py-1.5 xp text-[16px]" style={{ background: t.primary, color: onPrimary(t) }}>
                {t.name}
              </span>
              <span className="self-center pl-3 cond text-ink-3">
                {t.dna.formation} · coach {t.coach}
              </span>
            </div>
            <p className="mt-3 text-[13px] text-ink-3">{t.traits.length ? t.traits.join(' · ') : 'balanced'}</p>
            <ol className="mt-3 grid grid-cols-2 gap-x-6 text-[14px]">
              {t.starters.map((pid) => {
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
              <span className="cond mr-2">Bench</span>
              {t.bench.map((pid) => byId.get(pid)?.name).filter(Boolean).join(', ')}
            </p>
          </div>
        )
      })}
    </section>
  )
}
