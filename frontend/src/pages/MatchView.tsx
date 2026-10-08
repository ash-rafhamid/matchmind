import { BarChart3, FlaskConical, Loader2, MessageCircleQuestion, Newspaper, Radio, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import AskPanel from '../components/AskPanel'
import CrewFeed from '../components/CrewFeed'
import Pitch from '../components/Pitch'
import RecapPanel from '../components/RecapPanel'
import Scoreboard from '../components/Scoreboard'
import StatsPanel from '../components/StatsPanel'
import Timeline from '../components/Timeline'
import WhatIfPanel from '../components/WhatIfPanel'
import { PlaybackClock } from '../lib/clock'
import { MatchCtx, type MatchCtxValue, useMatch } from '../lib/match'
import type { MatchPackage, Side } from '../types'

const TABS = [
  ['live', 'Live crew', Radio],
  ['ask', 'Ask', MessageCircleQuestion],
  ['whatif', 'What-if lab', FlaskConical],
  ['stats', 'Stats', BarChart3],
  ['recap', 'Recap', Newspaper],
] as const

type Tab = (typeof TABS)[number][0]

export default function MatchView({ matchId }: { matchId: string }) {
  const [pkg, setPkg] = useState<MatchPackage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.match(matchId).then(setPkg).catch((e) => setError(String(e.message ?? e)))
  }, [matchId])

  if (error) return <div className="panel mt-6 p-6 text-rose-400">Could not load match: {error}</div>
  if (!pkg)
    return (
      <div className="mt-10 flex items-center justify-center gap-2 text-ink-400">
        <Loader2 className="animate-spin" size={18} /> Loading match...
      </div>
    )
  return <LoadedMatch pkg={pkg} />
}

function LoadedMatch({ pkg }: { pkg: MatchPackage }) {
  const clock = useMemo(() => new PlaybackClock(pkg.meta.duration_s), [pkg.meta.duration_s])
  const [highlight, setHighlight] = useState<number[]>([])
  const [tab, setTab] = useState<Tab>('live')
  const eventsById = useMemo(() => new Map(pkg.events.map((e) => [e.id, e])), [pkg.events])

  useEffect(() => () => clock.destroy(), [clock])

  const focusEvidence = useCallback(
    (ids: number[], play = false) => {
      const evs = ids.map((id) => eventsById.get(id)).filter(Boolean)
      if (!evs.length) return
      setHighlight(ids)
      const first = Math.min(...evs.map((e) => e!.ts))
      const last = Math.max(...evs.map((e) => e!.ts + e!.dur))
      if (play) clock.replay(Math.max(0, first - 2), last + 2, 1)
      else clock.seek(Math.max(0, first - 1))
    },
    [clock, eventsById],
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

  return (
    <MatchCtx.Provider value={value}>
      <div className="grid gap-4 pt-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,1fr)]">
        <section className="panel space-y-3 p-3 sm:p-4">
          <Scoreboard />
          <div className="relative">
            <Pitch />
            {highlight.length > 0 && (
              <button
                onClick={() => setHighlight([])}
                className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-ink-950/80 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-800"
              >
                <X size={12} /> Clear highlight ({highlight.length} events)
              </button>
            )}
          </div>
          <Timeline />
          <TeamStrip />
        </section>

        <section className="panel flex min-h-[560px] flex-col p-3 sm:p-4 xl:h-[calc(100vh-110px)] xl:sticky xl:top-[84px]">
          <nav className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-ink-700 bg-ink-900 p-1" role="tablist">
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold whitespace-nowrap ${
                  tab === id ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            {tab === 'live' && <CrewFeed />}
            {tab === 'ask' && <AskPanel />}
            {tab === 'whatif' && <WhatIfPanel />}
            {tab === 'stats' && <StatsPanel />}
            {tab === 'recap' && <RecapPanel />}
          </div>
        </section>
      </div>
    </MatchCtx.Provider>
  )
}

function TeamStrip() {
  const { pkg } = useMatch()
  return (
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      {(['home', 'away'] as Side[]).map((s) => {
        const t = pkg.meta.teams[s]
        return (
          <div key={s} className="rounded-xl border border-ink-700 bg-ink-900/50 p-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: t.primary, boxShadow: `0 0 0 2px ${t.secondary}` }} />
              <span className="font-semibold">{t.name}</span>
              <span className="text-ink-400">
                {t.dna.formation} · coach {t.coach}
              </span>
            </div>
            <div className="mt-1.5 text-ink-400">{t.traits.join(' · ') || 'balanced'}</div>
          </div>
        )
      })}
    </div>
  )
}

