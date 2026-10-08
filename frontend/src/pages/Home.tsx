import { FlaskConical, Loader2, PlayCircle, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useSettings } from '../lib/settings'
import type { MatchSummary } from '../types'

function Crest({ color, accent, label }: { color: string; accent: string; label: string }) {
  return (
    <div
      className="grid h-12 w-12 place-items-center rounded-xl font-display text-lg font-bold shadow-lg"
      style={{ background: color, color: accent, boxShadow: `0 0 0 2px ${accent}33` }}
    >
      {label}
    </div>
  )
}

export default function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.matches().then(setMatches).catch((e) => setError(String(e)))
  }, [])

  return (
    <div className="space-y-8 pt-6">
      <section className="grid items-center gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="animate-rise">
          <h1 className="font-display text-4xl leading-tight font-semibold sm:text-5xl">
            Every match, explained.
            <br />
            <span className="text-mint-400">Every decision, simulated.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-ink-300">
            MatchMind is a crew of AI agents that watches a football match, explains <em>why</em> each key moment
            happened, writes it for the fan in front of it - in their language, at their level, even as audio
            description - and answers <em>what if</em> by re-simulating the rest of the match hundreds of times.
            Every number it says is checked against the data before you see it.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            {[
              [Workflow, 'Multi-agent workflow (Agent Framework)'],
              [ShieldCheck, 'Deterministic fact-checking'],
              [FlaskConical, 'Monte Carlo what-if lab'],
              [Sparkles, '5 audiences x 10 languages'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Workflow
              return (
                <span key={label as string} className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-ink-300">
                  <I size={14} className="text-mint-400" /> {label as string}
                </span>
              )
            })}
          </div>
        </div>
        <CrewDiagram />
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-2xl font-semibold tracking-wide">Matchday</h2>
          <span className="text-xs text-ink-400">Synthetic matches from our calibrated simulator</span>
        </div>
        {error && <div className="panel p-4 text-rose-400">Could not reach the API: {error}</div>}
        {!matches && !error && (
          <div className="flex items-center gap-2 text-ink-400">
            <Loader2 className="animate-spin" size={16} /> Loading fixtures...
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {matches?.map((m, i) => (
            <button
              key={m.id}
              onClick={() => onOpen(m.id)}
              className="panel group animate-rise p-5 text-left transition hover:-translate-y-0.5 hover:border-mint-500/60"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center justify-between text-[11px] tracking-wider text-ink-400 uppercase">
                <span>{m.competition}</span>
                {m.featured && <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-mint-400">Featured</span>}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Crest color={m.home.primary} accent={m.home.secondary} label={m.home.short} />
                  <div className="truncate font-medium">{m.home.name}</div>
                </div>
                <div className="font-display text-3xl font-bold tabular-nums">
                  {m.score.home}<span className="px-1 text-ink-400">-</span>{m.score.away}
                </div>
                <div className="flex min-w-0 items-center justify-end gap-3">
                  <div className="truncate text-right font-medium">{m.away.name}</div>
                  <Crest color={m.away.primary} accent={m.away.secondary} label={m.away.short} />
                </div>
              </div>
              {m.blurb && <p className="mt-4 text-sm text-ink-300">{m.blurb}</p>}
              <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-mint-400 opacity-80 group-hover:opacity-100">
                <PlayCircle size={16} /> Watch with the crew
              </div>
            </button>
          ))}
        </div>
      </section>

      <ScenarioLab onOpen={onOpen} />
    </div>
  )
}

function CrewDiagram() {
  const steps = [
    ['Producer', 'frames the moment', 'text-ink-300'],
    ['Analyst', 'picks the numbers', 'text-sky-400'],
    ['Tactician', 'explains why', 'text-sky-400'],
    ['Storyteller', 'writes for you', 'text-mint-400'],
    ['Fact-checker', 'verifies every claim', 'text-amber-400'],
  ]
  return (
    <div className="panel animate-rise p-5" style={{ animationDelay: '120ms' }}>
      <div className="mb-3 text-xs tracking-wider text-ink-400 uppercase">How the crew works</div>
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-center text-xs">
        <Box {...{ name: steps[0][0], role: steps[0][1], color: steps[0][2] }} />
        <Arrow />
        <div className="space-y-2">
          <Box name={steps[1][0]} role={steps[1][1]} color={steps[1][2]} />
          <Box name={steps[2][0]} role={steps[2][1]} color={steps[2][2]} />
        </div>
        <Arrow />
        <div className="space-y-2">
          <Box name={steps[3][0]} role={steps[3][1]} color={steps[3][2]} />
          <Box name={steps[4][0]} role={steps[4][1]} color={steps[4][2]} />
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-400">
        Analyst and Tactician run in parallel. A draft that cites any number, name, minute or event not in the data is
        sent back with the exact problems - and never reaches the viewer. Questions go to a Host agent that queries the
        match through MCP tools and can run what-if simulations.
      </p>
    </div>
  )
}

function Box({ name, role, color }: { name: string; role: string; color: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-2 py-2">
      <div className={`font-semibold ${color}`}>{name}</div>
      <div className="text-[10px] text-ink-400">{role}</div>
    </div>
  )
}

function Arrow() {
  return <div className="text-ink-600">&rarr;</div>
}

function ScenarioLab({ onOpen }: { onOpen: (id: string) => void }) {
  const { options } = useSettings()
  const teams = options ? Object.entries(options.teams) : []
  const [home, setHome] = useState('RED')
  const [away, setAway] = useState('HAR')
  const [switchOn, setSwitchOn] = useState(true)
  const [minute, setMinute] = useState(60)
  const [press, setPress] = useState(0.9)
  const [formation, setFormation] = useState('3-4-3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const script = switchOn
        ? [{ minute, side: 'home', changes: { press, formation }, label: `Switch to ${formation}, press ${press}` }]
        : []
      const res = await api.scenario({ home, away, script })
      onOpen(res.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="text-mint-400" size={18} />
        <h2 className="font-display text-2xl font-semibold tracking-wide">Scenario lab</h2>
        <span className="text-xs text-ink-400">Generate a brand-new synthetic match - events, 10 Hz tracking and analytics in ~10 s</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
        <TeamSelect label="Home" value={home} onChange={setHome} teams={teams} />
        <TeamSelect label="Away" value={away} onChange={setAway} teams={teams} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} />
          Home tactical switch
        </label>
        {switchOn && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">at minute {minute}</span>
              <input type="range" min={10} max={85} value={minute} onChange={(e) => setMinute(+e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">press {press.toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.05} value={press} onChange={(e) => setPress(+e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">formation</span>
              <select value={formation} onChange={(e) => setFormation(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1">
                {(options?.formations ?? []).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button
          onClick={create}
          disabled={busy || home === away}
          className="ml-auto flex items-center gap-2 rounded-xl bg-mint-500 px-4 py-2 font-semibold text-ink-950 transition hover:bg-mint-400 disabled:opacity-50"
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          {busy ? 'Simulating...' : 'Generate match'}
        </button>
      </div>
      {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}
    </section>
  )
}

function TeamSelect({ label, value, onChange, teams }: { label: string; value: string; onChange: (v: string) => void; teams: [string, { name: string; traits: string[]; formation: string }][] }) {
  const team = teams.find(([id]) => id === value)?.[1]
  return (
    <label className="flex min-w-48 flex-col gap-1">
      <span className="text-xs text-ink-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5">
        {teams.map(([id, t]) => (
          <option key={id} value={id}>
            {t.name}
          </option>
        ))}
      </select>
      {team && <span className="text-[11px] text-ink-400">{team.formation} · {team.traits.join(', ')}</span>}
    </label>
  )
}
