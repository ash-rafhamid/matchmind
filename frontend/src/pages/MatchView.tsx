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
import { PlaybackClock, useClock } from '../lib/clock'
import { lastEventIndex, MatchCtx, type MatchCtxValue, useMatch } from '../lib/match'
import { TrackingStore } from '../lib/tracking'
import { ROMAN, surname } from '../lib/ui'
import type { MatchPackage, Side } from '../types'

const TABS = [
  ['live', 'Live'],
  ['ask', 'Ask'],
  ['whatif', 'What if'],
  ['stats', 'Numbers'],
  ['recap', 'Report'],
] as const

type Tab = (typeof TABS)[number][0]

export default function MatchView({ matchId }: { matchId: string }) {
  const [pkg, setPkg] = useState<MatchPackage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.match(matchId).then(setPkg).catch((e) => setError(String(e.message ?? e)))
  }, [matchId])

  if (error) return <p className="py-16 text-center text-signal">This match could not be found: {error}</p>
  if (!pkg) return <p className="typing py-16 text-center text-ink-3 italic">Setting the match in type</p>
  return <LoadedMatch pkg={pkg} />
}

function LoadedMatch({ pkg }: { pkg: MatchPackage }) {
  const clock = useMemo(() => new PlaybackClock(pkg.meta.duration_s), [pkg.meta.duration_s])
  const store = useMemo(() => new TrackingStore(pkg.meta.id), [pkg.meta.id])
  const [highlight, setHighlight] = useState<number[]>([])
  const [tab, setTab] = useState<Tab>('live')
  const eventsById = useMemo(() => new Map(pkg.events.map((e) => [e.id, e])), [pkg.events])

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

  return (
    <MatchCtx.Provider value={value}>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 num text-[11px] text-ink-3 uppercase">
        <a href="#/" className="link">
          &larr; All fixtures
        </a>
        <span>
          {pkg.meta.competition} · seed {pkg.meta.seed}
        </span>
        <span className="flex gap-4">
          <a href={`#/studio/${pkg.meta.id}`} target="_blank" rel="noreferrer" className="link">
            Studio overlay &#8599;
          </a>
          <a href={`/api/matches/${pkg.meta.id}/export.zip`} className="link">
            Dataset &darr;
          </a>
        </span>
      </div>
      <Scoreboard />
      <div className="double-rule" />

      <div className="grid gap-8 pt-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(400px,1fr)] xl:gap-10">
        <section className="min-w-0">
          <figure className="plate">
            <span className="crop-b" />
            <Pitch store={store} />
            {highlight.length > 0 && (
              <button onClick={() => setHighlight([])} className="link absolute top-5 right-5 bg-paper px-2 py-1">
                Clear {highlight.length} annotation{highlight.length > 1 ? 's' : ''} &times;
              </button>
            )}
          </figure>
          <Transport />
          <div className="mt-5">
            <Timeline />
          </div>
          <p className="mt-4 border-t border-rule pt-2 text-[13px] text-ink-3 italic">
            <span className="not-italic label mr-2">Fig. 1</span>
            Reconstruction from 10 Hz synthetic tracking. The ball lifts off its shadow when it is in the air; tails show
            the last 0.6 s of each run; the dashed line is the pass being played. Hover a player for their name.
          </p>
          <TeamSheets />
        </section>

        <aside className="flex min-h-[620px] min-w-0 flex-col xl:sticky xl:top-4 xl:h-[calc(100vh-32px)]">
          <nav className="flex gap-5 overflow-x-auto border-b border-ink" role="tablist" aria-label="Match sections">
            {TABS.map(([id, label], i) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="tab">
                <span className="roman">{ROMAN[i]}.</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 pt-4">
            {tab === 'live' && <CrewFeed />}
            {tab === 'ask' && <AskPanel />}
            {tab === 'whatif' && <WhatIfPanel />}
            {tab === 'stats' && <StatsPanel />}
            {tab === 'recap' && <RecapPanel />}
          </div>
        </aside>
      </div>
    </MatchCtx.Provider>
  )
}

const SPEEDS = [1, 4, 8, 16, 32]
const ACTION: Record<string, string> = {
  pass: 'Pass', carry: 'Carry', shot: 'Shot', interception: 'Interception', tackle: 'Tackle', save: 'Save',
  clearance: 'Clearance', block: 'Block', foul: 'Foul', card: 'Card', offside: 'Offside', goal: 'Goal',
}

function Transport() {
  const { pkg, clock, name } = useMatch()
  const { time, playing, speed } = useClock(clock, 6)
  const shown = useMemo(() => pkg.events.filter((e) => e.type in ACTION), [pkg.events])
  const idx = lastEventIndex(shown, time)
  const cur = idx >= 0 && time - shown[idx].ts < 3 ? shown[idx] : null
  const caption = cur
    ? `${ACTION[cur.type]} · ${surname(name(cur.player))}${cur.receiver ? ` → ${surname(name(cur.receiver))}` : ''}${
        cur.outcome && !['complete', 'success'].includes(cur.outcome) ? ` (${cur.outcome.replace('_', ' ')})` : ''
      }`
    : null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-rule py-3">
      <button className="btn btn-solid min-w-[108px] justify-center" onClick={() => clock.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button className="link" onClick={() => clock.seek(0)}>
        ↺ Kick-off
      </button>
      <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
        <span className="label mr-1">Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => clock.setSpeed(s)}
            aria-pressed={speed === s}
            className={`num px-1.5 py-0.5 text-[13px] ${speed === s ? 'bg-ink text-paper' : 'text-ink-3 hover:text-ink'}`}
          >
            ×{s}
          </button>
        ))}
      </div>
      <div className="ml-auto min-h-[1.5em] text-right text-[15px] text-ink-2 italic" aria-live="off">
        {caption}
      </div>
    </div>
  )
}

function TeamSheets() {
  const { pkg } = useMatch()
  return (
    <section className="mt-8">
      <div className="label label-ink">Team sheets</div>
      <div className="mt-3 grid gap-8 border-t border-ink pt-4 sm:grid-cols-2">
        {(['home', 'away'] as Side[]).map((s) => {
          const t = pkg.meta.teams[s]
          const byId = new Map(t.players.map((p) => [p.id, p]))
          return (
            <div key={s}>
              <div className="display text-[20px] font-semibold">{t.name}</div>
              <p className="mt-1 text-[14px] text-ink-3 italic">
                {t.dna.formation} under {t.coach}
                {t.traits.length ? ` - ${t.traits.join(', ')}` : ''}.
              </p>
              <ol className="mt-3 columns-2 gap-6 text-[14px]">
                {t.starters.map((pid) => {
                  const p = byId.get(pid)
                  return (
                    <li key={pid} className="flex gap-2 py-0.5">
                      <span className="num w-6 text-right text-ink-3">{p?.number}</span>
                      <span className="truncate">{p?.name}</span>
                    </li>
                  )
                })}
              </ol>
              <p className="mt-2 text-[13px] text-ink-3">
                <span className="label mr-1">Subs</span>
                {t.bench.map((pid) => byId.get(pid)?.name).filter(Boolean).join(', ')}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
