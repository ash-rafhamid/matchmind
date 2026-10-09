import { useEffect, useState } from 'react'
import { api } from '../api'
import { useSettings } from '../lib/settings'
import type { MatchSummary } from '../types'

export default function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.matches().then(setMatches).catch((e) => setError(String(e)))
  }, [])

  return (
    <div>
      <section className="grid gap-10 border-b border-rule py-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <div className="rise">
          <div className="label text-signal">The lead</div>
          <h1 className="display mt-3 text-[44px] leading-[0.98] font-semibold sm:text-[68px]">
            Every match, <span className="italic-wonk font-normal">explained.</span>
            <br />
            Every decision, <span className="italic-wonk font-normal">simulated.</span>
          </h1>
          <p className="body-copy mt-6 max-w-[60ch] text-[18px]">
            MatchMind is a crew of AI agents that watches a football match, works out <em>why</em> each key moment
            happened, and writes it for the reader in front of it: a casual fan, an analyst, an eight-year-old, a coach,
            or someone listening to audio description, in ten languages. Ask it anything. Ask it <em>what if</em>, and it
            replays the rest of the match hundreds of times to find out.
          </p>
          <p className="mt-4 max-w-[60ch] text-[15px] text-ink-3 italic">
            Nothing reaches the page unchecked: every number, name, minute and scoreline is verified against the match
            data by deterministic code before you see it.
          </p>
        </div>
        <CrewDiagram />
      </section>

      <section className="py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display text-[32px] font-semibold">Today's fixtures</h2>
          <span className="label">Synthetic matches from a calibrated simulator · 10 Hz tracking</span>
        </div>
        {error && <p className="mt-6 text-signal">The press room is unreachable: {error}</p>}
        {!matches && !error && <p className="mt-6 text-ink-3 italic typing">Setting the type</p>}
        <ol className="mt-4 border-t-2 border-ink">
          {matches?.map((m, i) => (
            <Fixture key={m.id} m={m} i={i} onOpen={onOpen} />
          ))}
        </ol>
      </section>

      <ScenarioLab onOpen={onOpen} />
    </div>
  )
}

function Fixture({ m, i, onOpen }: { m: MatchSummary; i: number; onOpen: (id: string) => void }) {
  return (
    <li className="rise border-b border-rule" style={{ animationDelay: `${i * 80}ms` }}>
      <button
        onClick={() => onOpen(m.id)}
        className="group grid w-full grid-cols-[1fr_auto_1fr] items-center gap-x-4 gap-y-2 px-1 py-7 text-left transition-colors hover:bg-paper-2 sm:gap-x-10 sm:px-4"
      >
        <div className="col-span-3 flex items-center justify-between">
          <span className="num text-[11px] text-ink-3">No. {String(i + 1).padStart(2, '0')}</span>
          <span className="label">{m.featured ? 'Featured · ' : ''}{m.competition}</span>
        </div>
        <TeamName team={m.home} align="right" />
        <div className="display text-center text-[52px] leading-none font-semibold tabular-nums sm:text-[76px]">
          {m.score.home}
          <span className="px-2 text-ink-4 sm:px-3">–</span>
          {m.score.away}
        </div>
        <TeamName team={m.away} align="left" />
        <div className="col-span-3 mt-2 flex flex-wrap items-baseline justify-between gap-3">
          {m.blurb ? <p className="max-w-[70ch] text-[16px] text-ink-2 italic">{m.blurb}</p> : <span />}
          <span className="link group-hover:text-signal">Read the match &rarr;</span>
        </div>
      </button>
    </li>
  )
}

function TeamName({ team, align }: { team: MatchSummary['home']; align: 'left' | 'right' }) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className={`flex items-center gap-3 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {align === 'left' && <Swatch team={team} />}
        <span className="display truncate text-[22px] leading-tight font-semibold sm:text-[34px]">{team.name}</span>
        {align === 'right' && <Swatch team={team} />}
      </div>
    </div>
  )
}

function Swatch({ team }: { team: { primary: string; secondary: string } }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 border border-ink" aria-hidden>
      <span className="h-full w-1/2" style={{ background: team.primary }} />
      <span className="h-full w-1/2" style={{ background: team.secondary }} />
    </span>
  )
}

/** "How the crew works" drawn as an editorial infographic. */
function CrewDiagram() {
  const box = (x: number, y: number, w: number, title: string, sub: string, accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height={46} fill={accent ? '#141310' : '#f2eee3'} stroke="#141310" strokeWidth="1.2" />
      <text x={x + w / 2} y={y + 20} textAnchor="middle" className="svg-cond" fill={accent ? '#f2eee3' : '#141310'}>
        {title}
      </text>
      <text x={x + w / 2} y={y + 36} textAnchor="middle" className="svg-ital" fill={accent ? '#e1d9c6' : '#77705f'}>
        {sub}
      </text>
    </g>
  )
  const arrow = (d: string, dashed = false, color = '#141310') => (
    <path d={d} fill="none" stroke={color} strokeWidth="1.2" strokeDasharray={dashed ? '4 3' : undefined} markerEnd={`url(#arr-${color === '#141310' ? 'ink' : 'sig'})`} />
  )
  return (
    <figure className="rise self-start" style={{ animationDelay: '120ms' }}>
      <div className="label">Fig. A — The crew, in order of play</div>
      <svg viewBox="0 0 520 300" className="mt-3 w-full" role="img" aria-label="Producer briefs the Analyst and Tactician in parallel; the Storyteller writes; a code fact-checker sends drafts back until they are verified.">
        <style>{`.svg-cond{font:600 13px 'Barlow Condensed',sans-serif;letter-spacing:.12em;text-transform:uppercase}.svg-ital{font:italic 12px 'Fraunces Variable',serif}.svg-mono{font:500 10px 'JetBrains Mono Variable',monospace}`}</style>
        <defs>
          <marker id="arr-ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#141310" />
          </marker>
          <marker id="arr-sig" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#e3361b" />
          </marker>
        </defs>
        {box(4, 107, 96, 'Producer', 'frames it')}
        {box(140, 40, 110, 'Analyst', 'the numbers')}
        {box(140, 174, 110, 'Tactician', 'the why')}
        {box(290, 107, 110, 'Storyteller', 'writes for you')}
        {box(290, 236, 110, 'Fact-checker', 'pure code', true)}
        {arrow('M100,122 C120,122 120,63 138,63')}
        {arrow('M100,138 C120,138 120,197 138,197')}
        {arrow('M250,63 C270,63 270,122 288,122')}
        {arrow('M250,197 C270,197 270,138 288,138')}
        {arrow('M345,153 L345,234')}
        {arrow('M290,262 C262,262 262,168 288,146', true, '#e3361b')}
        <text x="254" y="284" textAnchor="end" className="svg-ital" fill="#e3361b">rejected drafts go back, with reasons</text>
        {arrow('M400,259 L438,259')}
        <text x="444" y="254" className="svg-cond" fill="#141310">You</text>
        <text x="444" y="270" className="svg-mono" fill="#1d6a46">✓ verified</text>
        <text x="140" y="22" className="svg-mono" fill="#77705f">IN PARALLEL · MICROSOFT AGENT FRAMEWORK</text>
        <text x="410" y="124" className="svg-mono" fill="#77705f">5 audiences</text>
        <text x="410" y="138" className="svg-mono" fill="#77705f">10 languages</text>
      </svg>
      <figcaption className="mt-2 border-t border-rule pt-2 text-[14px] text-ink-3 italic">
        Questions go to a Host agent that queries the match through MCP tools, consults the Tactician and can run what-if
        simulations; its answers are checked by the same code.
      </figcaption>
    </figure>
  )
}

/** Build-your-own fixture, written as a sentence. */
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
  const homeTeam = options?.teams[home]
  const awayTeam = options?.teams[away]

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

  const pressWord = press >= 0.8 ? 'ferociously' : press >= 0.6 ? 'hard' : press >= 0.4 ? 'moderately' : 'barely'

  return (
    <section className="border-t-2 border-ink py-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <div className="label text-signal">Scenario lab</div>
          <h2 className="display mt-2 text-[32px] leading-tight font-semibold">Set your own fixture.</h2>
          <p className="mt-3 text-[15px] text-ink-3 italic">
            A brand-new synthetic match - every event, 10 Hz tracking and full analytics - simulated in about ten seconds.
          </p>
        </div>
        <div>
          <p className="display text-[24px] leading-[1.7] text-ink-2 sm:text-[30px]">
            <select value={home} onChange={(e) => setHome(e.target.value)} className="inline-select" aria-label="Home team">
              {teams.map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name}
                </option>
              ))}
            </select>{' '}
            host{' '}
            <select value={away} onChange={(e) => setAway(e.target.value)} className="inline-select" aria-label="Away team">
              {teams.map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name}
                </option>
              ))}
            </select>
            .{' '}
            {switchOn ? (
              <>
                At minute{' '}
                <input type="number" min={10} max={85} value={minute} onChange={(e) => setMinute(Math.max(10, Math.min(85, +e.target.value)))} className="inline-input" aria-label="Minute of the switch" />
                , the home side switch to{' '}
                <select value={formation} onChange={(e) => setFormation(e.target.value)} className="inline-select" aria-label="New formation">
                  {(options?.formations ?? ['3-4-3']).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>{' '}
                and press <span className="italic-wonk text-signal">{pressWord}</span>.
              </>
            ) : (
              <>Both coaches stick to their plans.</>
            )}
          </p>
          <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            {switchOn ? (
              <label className="block">
                <span className="label">Pressing intensity · <span className="num text-ink">{press.toFixed(2)}</span></span>
                <input type="range" min={0} max={1} step={0.05} value={press} onChange={(e) => setPress(+e.target.value)} />
              </label>
            ) : (
              <span />
            )}
            <label className="flex items-center gap-2 text-[15px] text-ink-2 italic">
              <input type="checkbox" checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} /> with a tactical switch
            </label>
          </div>
          {homeTeam && awayTeam && (
            <p className="mt-3 num text-[11px] text-ink-3 uppercase">
              {homeTeam.formation} · {homeTeam.traits.join(', ') || 'balanced'} &nbsp;/&nbsp; {awayTeam.formation} ·{' '}
              {awayTeam.traits.join(', ') || 'balanced'}
            </p>
          )}
          <div className="mt-6 flex items-center gap-4">
            <button onClick={create} disabled={busy || home === away} className="btn btn-solid">
              {busy ? <span className="typing">Simulating</span> : <>Kick off &rarr;</>}
            </button>
            {home === away && <span className="text-[14px] text-signal italic">A club cannot play itself.</span>}
            {error && <span className="text-[14px] text-signal">{error}</span>}
          </div>
        </div>
      </div>
    </section>
  )
}
