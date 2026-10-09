import { useMemo, useState } from 'react'
import { api } from '../api'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import { onPrimary } from '../lib/ui'
import type { CrewResult, Side, WhatIfResult, WhatIfSummary } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

const DIAL: Record<string, [string, string, string]> = {
  press: ['Pressing', 'sit off', 'hunt the ball'],
  tempo: ['Tempo', 'patient', 'quick'],
  directness: ['Directness', 'short passing', 'long balls'],
  width: ['Width', 'narrow', 'wide'],
  line_height: ['Defensive line', 'deep', 'high'],
  counter: ['Counter-attacks', 'rarely', 'every chance'],
}

/** Change a team's tactics from any minute; the rest of the match is replayed hundreds of times. */
export default function WhatIfPanel() {
  const { pkg, clock } = useMatch()
  const { persona, lang, options } = useSettings()
  const { time } = useClock(clock, 1)
  const [side, setSide] = useState<Side>('home')
  const currentMinute = Math.min(85, Math.max(5, Math.round(time / 60)))
  const [minute, setMinute] = useState<number>(currentMinute > 5 ? currentMinute : 60)
  const team = pkg.meta.teams[side]

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
    <div className="scroll-slim h-full overflow-y-auto px-5 pt-4 pb-6">
      <div className="xp text-[26px] leading-[0.95]">
        What if<span className="xp-light">...</span>
      </div>
      <p className="mt-3 text-[16px] leading-[1.9] font-medium">
        <select
          value={side}
          onChange={(e) => {
            setSide(e.target.value as Side)
            setChanges({})
            setRes(null)
          }}
          className="pick"
          aria-label="Team"
        >
          <option value="home">{pkg.meta.teams.home.name}</option>
          <option value="away">{pkg.meta.teams.away.name}</option>
        </select>{' '}
        changed it at minute{' '}
        <input type="number" min={5} max={88} value={minute} onChange={(e) => setMinute(Math.max(5, Math.min(88, +e.target.value || 5)))} className="pick-num" aria-label="Minute" />
        , switching to{' '}
        <select value={String(value('formation'))} onChange={(e) => setChanges((c) => ({ ...c, formation: e.target.value }))} className="pick" aria-label="Formation">
          {(options?.formations ?? []).map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        ?
      </p>

      <div className="mt-4">
        {(options?.dials ?? Object.keys(DIAL)).map((k) => {
          const [label, lo, hi] = DIAL[k] ?? [k, 'low', 'high']
          const v = Number(value(k))
          const base = Number(baseline[k])
          const moved = Math.abs(v - base) > 1e-9
          return (
            <label key={k} className="grid grid-cols-[112px_1fr_56px] items-center gap-3 border-t border-line py-2">
              <span className={`cond ${moved ? 'text-ink' : 'text-ink-3'}`}>
                {moved && <span className="mr-1 inline-block h-2 w-2 bg-volt-2" />}
                {label}
              </span>
              <span className="block">
                <span className="relative block">
                  <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => setChanges((c) => ({ ...c, [k]: +e.target.value }))} aria-label={label} />
                  {moved && <span className="pointer-events-none absolute top-[3px] h-4 w-[2px] bg-flare" style={{ left: `calc(${base * 100}% - ${base * 14}px + 6px)` }} title="as played" />}
                </span>
                <span className="flex justify-between text-[11px] text-ink-4">
                  <span>{lo}</span>
                  <span>{hi}</span>
                </span>
              </span>
              <span className="text-right text-[13px] font-semibold tab-num">
                {v.toFixed(2)}
                {moved && <span className="block text-[10px] font-normal text-ink-3">was {base.toFixed(2)}</span>}
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button onClick={run} disabled={busy || changed.length === 0} className="btn btn-volt">
          {busy ? <span className="working">Playing {runs * 2} endings</span> : 'Simulate'}
        </button>
        <div className="seg" role="group" aria-label="Number of simulations">
          {[100, 200, 400].map((r) => (
            <button key={r} aria-pressed={runs === r} onClick={() => setRuns(r)} className="tab-num">
              {r}×2
            </button>
          ))}
        </div>
      </div>
      {changed.length === 0 && <p className="mt-2 text-[13px] text-ink-3">Move a dial or change the shape to begin.</p>}
      {error && <p className="mt-3 text-[13px] text-flare">{error}</p>}
      {res && <Result res={res.result} explanation={res.explanation} />}
    </div>
  )
}

function Result({ res, explanation }: { res: WhatIfResult; explanation?: CrewResult }) {
  const { pkg } = useMatch()
  const team = pkg.meta.teams[res.side]
  const [lo, hi] = res.expected_points_delta_95ci
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
  const banner = res.verdict === 'helps' ? 'bg-volt text-ink' : res.verdict === 'hurts' ? 'bg-flare text-white' : 'bg-ink text-white'
  return (
    <section className="wipe-up mt-6">
      <div className="flex items-stretch">
        <span className={`cut-l xp px-4 py-2 text-[18px] ${banner}`}>{res.verdict}</span>
        <span className="cut-r flex items-center pr-5 pl-3 cond" style={{ background: team.primary, color: onPrimary(team) }}>
          {team.short} from {res.from_minute}'
        </span>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">
        Score then {Object.values(res.score_at_minute).join('-')} · {res.runs} paired simulations · {res.seconds}s
      </p>

      <div className="mt-4 space-y-3">
        <Bar label="As played" s={res.as_played} color={team.primary} />
        <Bar label="With your change" s={res.with_change} color={team.primary} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-px bg-line">
        {(
          [
            ['Exp. points', res.as_played.expected_points, res.with_change.expected_points, false],
            ['xG for', res.as_played.xg_for_rest_of_match, res.with_change.xg_for_rest_of_match, false],
            ['xG against', res.as_played.xg_against_rest_of_match, res.with_change.xg_against_rest_of_match, true],
          ] as [string, number, number, boolean][]
        ).map(([label, a, b, invert]) => {
          const d = Math.round((b - a) * 100) / 100
          const good = invert ? d < 0 : d > 0
          return (
            <div key={label} className="bg-plate p-3">
              <div className="cond text-[10px] text-ink-3">{label}</div>
              <div className="xp mt-1 text-[20px] tab-num">{b}</div>
              <div className={`mt-0.5 text-[12px] font-semibold tab-num ${d === 0 ? 'text-ink-3' : good ? 'text-turf' : 'text-flare'}`}>
                {sign(d)} <span className="font-normal text-ink-3">from {a}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        Change in expected points {sign(res.expected_points_delta)} · 95% interval {lo} to {hi}
      </p>
      {explanation && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="cond text-ink-3">The Tactician's reading</div>
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
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-semibold">{label}</span>
        <span className="text-ink-3 tab-num">
          W {s.win_pct}% · D {s.draw_pct}% · L {s.loss_pct}%
        </span>
      </div>
      <div className="mt-1 flex h-3.5 gap-[2px]">
        <div style={{ width: `${s.win_pct}%`, background: color }} title={`Win ${s.win_pct}%`} />
        <div className="bg-ink-4" style={{ width: `${s.draw_pct}%` }} title={`Draw ${s.draw_pct}%`} />
        <div className="flex-1 bg-concrete-2" title={`Loss ${s.loss_pct}%`} />
      </div>
    </div>
  )
}
