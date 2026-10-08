import { FlaskConical, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../api'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import type { CrewResult, Side, WhatIfResult, WhatIfSummary } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

const DIAL_LABEL: Record<string, string> = {
  press: 'Pressing intensity',
  tempo: 'Tempo',
  directness: 'Directness',
  width: 'Width',
  line_height: 'Defensive line height',
  counter: 'Counter-attack urge',
}

export default function WhatIfPanel() {
  const { pkg, clock } = useMatch()
  const { persona, lang, options } = useSettings()
  const { time } = useClock(clock, 1)
  const [side, setSide] = useState<Side>('home')
  const currentMinute = Math.min(85, Math.max(5, Math.round(time / 60)))
  const [minute, setMinute] = useState<number>(currentMinute > 5 ? currentMinute : 60)
  const team = pkg.meta.teams[side]

  // Tactics in force at the chosen minute: start from the plan, apply changes made before it.
  const baseline = useMemo(() => {
    const dna: Record<string, number | string> = { ...team.dna }
    for (const e of pkg.events) {
      if (e.ts > minute * 60) break
      if (e.type === 'tactical_change' && e.team === side && e.changes) Object.assign(dna, e.changes)
    }
    return dna
  }, [pkg.events, team.dna, minute, side])

  const [changes, setChanges] = useState<Record<string, number | string>>({})
  const [runs, setRuns] = useState(200)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ result: WhatIfResult; explanation?: CrewResult } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const value = (k: string) => (k in changes ? changes[k] : baseline[k])
  const changed = Object.keys(changes).filter((k) => changes[k] !== baseline[k])

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const payload = Object.fromEntries(changed.map((k) => [k, changes[k]]))
      setRes(await api.whatif(pkg.meta.id, { team: side, from_minute: minute, changes: payload, runs, persona, lang }))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scroll-thin -mr-2 h-full space-y-4 overflow-y-auto pr-2 text-sm">
      <p className="text-ink-300">
        Change a team's tactics at any minute. We replay the match to that point, then simulate the rest hundreds of
        times with and without the change - same random draws for both, so the difference is the tactics, not luck.
      </p>
      <div className="flex flex-wrap gap-2">
        {(['home', 'away'] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s)
              setChanges({})
              setRes(null)
            }}
            className={`rounded-lg border px-3 py-1.5 ${side === s ? 'border-mint-500 bg-mint-500/10' : 'border-ink-700'}`}
          >
            {pkg.meta.teams[s].name}
          </button>
        ))}
      </div>
      <label className="block">
        <div className="flex justify-between text-xs text-ink-400">
          <span>Make the change at minute</span>
          <span className="font-semibold text-ink-100">{minute}'</span>
        </div>
        <input type="range" min={5} max={88} value={minute} onChange={(e) => setMinute(+e.target.value)} className="w-full" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {(options?.dials ?? Object.keys(DIAL_LABEL)).map((k) => {
          const v = Number(value(k))
          const base = Number(baseline[k])
          return (
            <label key={k} className="block">
              <div className="flex justify-between text-xs">
                <span className="text-ink-400">{DIAL_LABEL[k] ?? k}</span>
                <span className={v !== base ? 'font-semibold text-mint-400' : 'text-ink-300'}>
                  {v.toFixed(2)}
                  {v !== base && <span className="text-ink-400"> (was {base.toFixed(2)})</span>}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={v}
                onChange={(e) => setChanges((c) => ({ ...c, [k]: +e.target.value }))}
                className="w-full"
              />
            </label>
          )
        })}
        <label className="block">
          <div className="text-xs text-ink-400">Formation</div>
          <select
            value={String(value('formation'))}
            onChange={(e) => setChanges((c) => ({ ...c, formation: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5"
          >
            {(options?.formations ?? []).map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="text-xs text-ink-400">Simulations</div>
          <select value={runs} onChange={(e) => setRuns(+e.target.value)} className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5">
            {[100, 200, 400].map((r) => (
              <option key={r} value={r}>
                {r} x 2
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        onClick={run}
        disabled={busy || changed.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-mint-500 py-2.5 font-semibold text-ink-950 hover:bg-mint-400 disabled:opacity-40"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
        {busy ? `Simulating ${runs * 2} match endings...` : changed.length ? `Run what-if (${changed.join(', ')})` : 'Change a dial to start'}
      </button>
      {error && <div className="text-rose-400">{error}</div>}
      {res && <WhatIfResultView res={res.result} explanation={res.explanation} />}
    </div>
  )
}

function WhatIfResultView({ res, explanation }: { res: WhatIfResult; explanation?: CrewResult }) {
  const verdictColor = res.verdict === 'helps' ? 'text-mint-400' : res.verdict === 'hurts' ? 'text-rose-400' : 'text-amber-400'
  const [lo, hi] = res.expected_points_delta_95ci
  return (
    <div className="animate-rise space-y-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3.5">
      <div className="flex items-center justify-between">
        <div className="font-semibold">
          {res.team} from {res.from_minute}'
        </div>
        <div className={`font-display text-xl font-semibold uppercase ${verdictColor}`}>{res.verdict}</div>
      </div>
      <OutcomeBar label="As played" s={res.as_played} />
      <OutcomeBar label="With change" s={res.with_change} />
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Exp. points" a={res.as_played.expected_points} b={res.with_change.expected_points} />
        <Stat label="xG for" a={res.as_played.xg_for_rest_of_match} b={res.with_change.xg_for_rest_of_match} />
        <Stat label="xG against" a={res.as_played.xg_against_rest_of_match} b={res.with_change.xg_against_rest_of_match} invert />
      </div>
      <div className="text-xs text-ink-400">
        Expected points change {res.expected_points_delta >= 0 ? '+' : ''}
        {res.expected_points_delta} (95% interval {lo} to {hi}) · {res.runs} paired simulations in {res.seconds}s
      </div>
      {explanation && (
        <div className="border-t border-ink-700 pt-3">
          <StoryText text={explanation.text} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <VerifiedBadge verdict={explanation.verdict} mode={explanation.mode} />
            <TraceButton trace={explanation.trace} title={`What-if: ${res.team} from ${res.from_minute}'`} />
          </div>
        </div>
      )}
    </div>
  )
}

function OutcomeBar({ label, s }: { label: string; s: WhatIfSummary }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-400">
        <span>{label}</span>
        <span>
          W {s.win_pct}% · D {s.draw_pct}% · L {s.loss_pct}%
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-ink-700">
        <div className="bg-mint-500" style={{ width: `${s.win_pct}%` }} />
        <div className="bg-ink-400" style={{ width: `${s.draw_pct}%` }} />
        <div className="bg-rose-400" style={{ width: `${s.loss_pct}%` }} />
      </div>
    </div>
  )
}

function Stat({ label, a, b, invert = false }: { label: string; a: number; b: number; invert?: boolean }) {
  const better = invert ? b < a : b > a
  return (
    <div className="rounded-lg bg-ink-800 p-2">
      <div className="text-ink-400">{label}</div>
      <div className="font-display text-lg">
        {a} <span className="text-ink-400">&rarr;</span>{' '}
        <span className={b === a ? '' : better ? 'text-mint-400' : 'text-rose-400'}>{b}</span>
      </div>
    </div>
  )
}
