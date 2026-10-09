import { useMemo, useState } from 'react'
import { api } from '../api'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import { teamInk } from '../lib/ui'
import type { CrewResult, Side, WhatIfResult, WhatIfSummary } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

const DIAL: Record<string, [string, string, string]> = {
  press: ['Pressing', 'sit off', 'hunt the ball'],
  tempo: ['Tempo', 'patient', 'quick'],
  directness: ['Directness', 'short passing', 'long balls'],
  width: ['Width', 'narrow', 'wide'],
  line_height: ['Defensive line', 'deep', 'high'],
  counter: ['Counter-attacks', 'rarely', 'at every chance'],
}

/** The what-if lab: change a team's tactics from any minute, replay the rest of the match hundreds of times. */
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
    setRes(null)
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
    <div className="scroll-ink -mr-3 h-full overflow-y-auto pr-3">
      <p className="display text-[22px] leading-[1.6] text-ink-2">
        What if{' '}
        <select
          value={side}
          onChange={(e) => {
            setSide(e.target.value as Side)
            setChanges({})
            setRes(null)
          }}
          className="inline-select"
          aria-label="Team"
        >
          <option value="home">{pkg.meta.teams.home.name}</option>
          <option value="away">{pkg.meta.teams.away.name}</option>
        </select>{' '}
        had changed things at minute{' '}
        <input type="number" min={5} max={88} value={minute} onChange={(e) => setMinute(Math.max(5, Math.min(88, +e.target.value || 5)))} className="inline-input" aria-label="Minute" />
        , switching to{' '}
        <select value={String(value('formation'))} onChange={(e) => setChanges((c) => ({ ...c, formation: e.target.value }))} className="inline-select" aria-label="Formation">
          {(options?.formations ?? []).map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        ?
      </p>
      <p className="mt-2 text-[14px] text-ink-3 italic">
        We replay the match to that minute, then play the rest out {runs} times as it was and {runs} times with your change -
        same random draws for both, so the difference is the tactics, not luck.
      </p>

      <div className="mt-5 border-t border-ink">
        {(options?.dials ?? Object.keys(DIAL)).map((k) => {
          const [label, lo, hi] = DIAL[k] ?? [k, 'low', 'high']
          const v = Number(value(k))
          const base = Number(baseline[k])
          const moved = Math.abs(v - base) > 1e-9
          return (
            <label key={k} className="grid grid-cols-[120px_1fr_70px] items-center gap-3 border-b border-rule py-2.5">
              <span className={`label ${moved ? 'text-signal' : 'label-ink'}`}>{label}</span>
              <span className="block">
                <span className="relative block">
                  <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => setChanges((c) => ({ ...c, [k]: +e.target.value }))} aria-label={label} />
                  {moved && <span className="pointer-events-none absolute top-[5px] h-3 w-px bg-ink-3" style={{ left: `calc(${base * 100}% - ${base * 12}px + 6px)` }} title="as played" />}
                </span>
                <span className="flex justify-between text-[11px] text-ink-3 italic">
                  <span>{lo}</span>
                  <span>{hi}</span>
                </span>
              </span>
              <span className="text-right num text-[13px]">
                {v.toFixed(2)}
                {moved && <span className="block text-[10px] text-ink-3">was {base.toFixed(2)}</span>}
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button onClick={run} disabled={busy || changed.length === 0} className="btn btn-solid">
          {busy ? <span className="typing">Playing {runs * 2} endings</span> : <>Simulate &rarr;</>}
        </button>
        <label className="label flex items-center gap-2">
          Runs
          <select value={runs} onChange={(e) => setRuns(+e.target.value)} className="inline-select num !text-[13px] !not-italic">
            {[100, 200, 400].map((r) => (
              <option key={r} value={r}>
                {r} × 2
              </option>
            ))}
          </select>
        </label>
        {changed.length === 0 && <span className="text-[14px] text-ink-3 italic">Move a dial or change the shape to begin.</span>}
      </div>
      {error && <p className="mt-3 text-[14px] text-signal">{error}</p>}
      {res && <Result res={res.result} explanation={res.explanation} />}
    </div>
  )
}

function Result({ res, explanation }: { res: WhatIfResult; explanation?: CrewResult }) {
  const { pkg } = useMatch()
  const [lo, hi] = res.expected_points_delta_95ci
  const color = res.verdict === 'helps' ? 'text-proof' : res.verdict === 'hurts' ? 'text-signal' : 'text-ink-2'
  const c = teamInk(pkg.meta.teams[res.side])
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
  return (
    <section className="rise mt-6 border-t-2 border-ink pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="label">The verdict</div>
          <div className="display mt-1 text-[20px] leading-snug font-semibold">
            {res.team}, from {res.from_minute}'
          </div>
          <div className="mt-1 num text-[11px] text-ink-3">
            score then {Object.values(res.score_at_minute).join('–')} · {res.runs} paired runs · {res.seconds}s
          </div>
        </div>
        <span className={`stamp stamp-in shrink-0 text-[15px] ${color}`}>{res.verdict}</span>
      </div>

      <div className="mt-5 space-y-3">
        <Bar label="As played" s={res.as_played} color={c} />
        <Bar label="With your change" s={res.with_change} color={c} />
      </div>

      <table className="mt-5 w-full text-[14px]">
        <tbody>
          {(
            [
              ['Expected points', res.as_played.expected_points, res.with_change.expected_points, false],
              ['xG for, rest of match', res.as_played.xg_for_rest_of_match, res.with_change.xg_for_rest_of_match, false],
              ['xG against, rest of match', res.as_played.xg_against_rest_of_match, res.with_change.xg_against_rest_of_match, true],
            ] as [string, number, number, boolean][]
          ).map(([label, a, b, invert]) => {
            const d = Math.round((b - a) * 100) / 100
            const good = invert ? d < 0 : d > 0
            return (
              <tr key={label} className="border-b border-rule">
                <td className="py-2 italic">{label}</td>
                <td className="py-2 text-right num">{a}</td>
                <td className="px-2 py-2 text-center text-ink-4">&rarr;</td>
                <td className="py-2 text-right num font-semibold">{b}</td>
                <td className={`w-16 py-2 text-right num text-[12px] ${d === 0 ? 'text-ink-3' : good ? 'text-proof' : 'text-signal'}`}>{sign(d)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 num text-[11px] text-ink-3">
        Change in expected points {sign(res.expected_points_delta)} · 95% interval {lo} to {hi}
      </p>
      {explanation && (
        <div className="mt-5 border-t border-rule pt-4">
          <div className="label">The Tactician's reading</div>
          <StoryText text={explanation.text} className="mt-2" />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <VerifiedBadge verdict={explanation.verdict} mode={explanation.mode} />
            <TraceButton trace={explanation.trace} title={`What if: ${res.team} from ${res.from_minute}'`} />
          </div>
        </div>
      )}
    </section>
  )
}

function Bar({ label, s, color }: { label: string; s: WhatIfSummary; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] italic">{label}</span>
        <span className="num text-[11px] text-ink-3">
          W {s.win_pct}% · D {s.draw_pct}% · L {s.loss_pct}%
        </span>
      </div>
      <div className="mt-1 flex h-4 border border-ink">
        <div style={{ width: `${s.win_pct}%`, background: color }} title={`Win ${s.win_pct}%`} />
        <div
          style={{ width: `${s.draw_pct}%`, backgroundImage: 'repeating-linear-gradient(45deg, #141310 0 1px, transparent 1px 5px)' }}
          title={`Draw ${s.draw_pct}%`}
        />
        <div className="flex-1 bg-paper-3" title={`Loss ${s.loss_pct}%`} />
      </div>
    </div>
  )
}
