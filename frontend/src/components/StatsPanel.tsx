import { useMemo, useState } from 'react'
import { useMatch } from '../lib/match'
import { onPrimary, teamInk } from '../lib/ui'
import type { Side } from '../types'

const ROWS: [string, string, (v: number) => string][] = [
  ['xg', 'Expected goals', (v) => v.toFixed(2)],
  ['shots', 'Shots', String],
  ['shots_on_target', 'On target', String],
  ['big_chances', 'Big chances', String],
  ['possession_pct', 'Possession %', String],
  ['pass_accuracy_pct', 'Pass accuracy %', String],
  ['field_tilt_pct', 'Field tilt %', String],
  ['progressive_passes', 'Progressive passes', String],
  ['box_touches', 'Touches in the box', String],
  ['high_turnovers', 'High turnovers', String],
  ['ppda', 'PPDA (lower = more press)', (v) => (v == null ? '–' : String(v))],
  ['corners', 'Corners', String],
  ['fouls', 'Fouls', String],
]

/** The numbers, set like an almanac: mirrored figures, hairline bars, an xG race, the player table, pass networks. */
export default function StatsPanel() {
  const { pkg } = useMatch()
  const [period, setPeriod] = useState<'full' | 'first_half' | 'second_half'>('full')
  const stats = pkg.analytics.team_stats[period]
  const { home, away } = pkg.meta.teams
  const hc = teamInk(home)
  const ac = teamInk(away)
  return (
    <div className="scroll-ink -mr-3 h-full overflow-y-auto pr-3">
      <div className="flex gap-4 border-b border-rule">
        {(['full', 'first_half', 'second_half'] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} aria-selected={period === p} className="tab !py-1.5 !text-[13px]">
            {p === 'full' ? 'Match' : p === 'first_half' ? 'First half' : 'Second half'}
          </button>
        ))}
      </div>

      <table className="mt-3 w-full">
        <thead>
          <tr>
            <th className="w-16 pb-2 text-left label" style={{ color: hc }}>
              {home.short}
            </th>
            <th />
            <th className="w-16 pb-2 text-right label" style={{ color: ac }}>
              {away.short}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([k, label, fmt]) => {
            const a = Number(stats.home[k] ?? 0)
            const b = Number(stats.away[k] ?? 0)
            const invert = k === 'ppda' || k === 'fouls'
            const total = (a || 0) + (b || 0)
            const share = total ? a / total : 0.5
            const homeLeads = invert ? a < b : a > b
            const awayLeads = invert ? b < a : b > a
            return (
              <tr key={k} className="border-t border-rule">
                <td className={`py-2 num text-[14px] ${homeLeads ? 'font-semibold text-ink' : 'text-ink-2'}`}>{fmt(stats.home[k])}</td>
                <td className="px-2 py-2">
                  <div className="text-center text-[13px] text-ink-2 italic">{label}</div>
                  <div className="mt-1 flex h-[3px] gap-[2px]">
                    <div style={{ width: `${(invert ? 1 - share : share) * 100}%`, background: hc }} />
                    <div className="flex-1" style={{ background: ac }} />
                  </div>
                </td>
                <td className={`py-2 text-right num text-[14px] ${awayLeads ? 'font-semibold text-ink' : 'text-ink-2'}`}>{fmt(stats.away[k])}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <XgRace />
      <PlayerTable />
      <section className="mt-8">
        <div className="label label-ink">Pass networks</div>
        <p className="mt-1 text-[13px] text-ink-3 italic">Average positions; lines are passing pairs, thicker = more passes.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <PassNetwork side="home" />
          <PassNetwork side="away" />
        </div>
      </section>
    </div>
  )
}

function XgRace() {
  const { pkg, focusEvidence } = useMatch()
  const { home, away } = pkg.meta.teams
  const tl = pkg.analytics.xg_timeline
  const dur = pkg.meta.duration_s
  const half = pkg.meta.period_lengths_s['1']
  const maxXg = Math.max(0.5, ...tl.map((r) => Math.max(r.home_cum, r.away_cum))) * 1.12
  const Y = (v: number) => 104 - (v / maxXg) * 96
  const path = (side: Side) => {
    let d = `M0,${Y(0)}`
    let last = 0
    for (const r of tl) {
      const x = (r.ts / dur) * 320
      const v = side === 'home' ? r.home_cum : r.away_cum
      d += ` L${x.toFixed(1)},${Y(last).toFixed(1)} L${x.toFixed(1)},${Y(v).toFixed(1)}`
      last = v
    }
    return d + ` L320,${Y(last).toFixed(1)}`
  }
  const final = tl.length ? tl[tl.length - 1] : { home_cum: 0, away_cum: 0 }
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <div className="label label-ink">The xG race</div>
        <span className="num text-[11px] text-ink-3">
          {home.short} {final.home_cum.toFixed(2)} · {away.short} {final.away_cum.toFixed(2)}
        </span>
      </div>
      <svg viewBox="0 0 320 116" className="mt-2 w-full overflow-visible">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="320" y1={Y(maxXg * f)} y2={Y(maxXg * f)} stroke="#14131014" />
        ))}
        <line x1="0" x2="320" y1="104" y2="104" stroke="#141310" />
        <line x1={(half / dur) * 320} x2={(half / dur) * 320} y1="6" y2="104" stroke="#141310" strokeDasharray="2 3" strokeOpacity="0.5" />
        <text x={(half / dur) * 320 + 3} y="12" fontSize="8" fill="#77705f" fontFamily="JetBrains Mono Variable">HT</text>
        <path d={path('home')} fill="none" stroke={teamInk(home)} strokeWidth="1.8" />
        <path d={path('away')} fill="none" stroke={teamInk(away)} strokeWidth="1.8" strokeDasharray="5 2" />
        {tl
          .filter((r) => r.outcome === 'goal')
          .map((r) => {
            const v = r.team === 'home' ? r.home_cum : r.away_cum
            return (
              <circle key={r.event_id} cx={(r.ts / dur) * 320} cy={Y(v)} r="4.5" fill={teamInk(pkg.meta.teams[r.team])} stroke="#141310" strokeWidth="1" className="cursor-pointer" onClick={() => focusEvidence([r.event_id], true)}>
                <title>{`${r.clock} goal, xG ${r.xg} - click to replay`}</title>
              </circle>
            )
          })}
      </svg>
      <p className="mt-1 text-[12px] text-ink-3 italic">
        Solid {home.name}, dashed {away.name}. Dots are goals; click one to replay it.
      </p>
    </section>
  )
}

function PlayerTable() {
  const { pkg, name } = useMatch()
  const [sort, setSort] = useState('rating')
  const rows = useMemo(() => {
    const team = (pid: string) => (pkg.meta.teams.home.starters.includes(pid) || pkg.meta.teams.home.bench.includes(pid) ? 'home' : 'away')
    return Object.entries(pkg.analytics.player_stats)
      .filter(([, s]) => (s.minutes ?? 0) > 1)
      .map(([pid, s]) => ({ pid, side: team(pid) as Side, ...s }) as Record<string, number> & { pid: string; side: Side })
      .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0))
      .slice(0, 14)
  }, [pkg, sort])
  const cols: [string, string, string][] = [
    ['rating', 'Rtg', 'Match rating'],
    ['goals', 'G', 'Goals'],
    ['xg', 'xG', 'Expected goals'],
    ['xa', 'xA', 'Expected assists'],
    ['key_passes', 'KP', 'Key passes'],
    ['distance_km', 'km', 'Distance covered'],
    ['top_speed_kmh', 'km/h', 'Top speed'],
    ['sprints', 'Spr', 'Sprints'],
  ]
  return (
    <section className="mt-8">
      <div className="label label-ink">The players</div>
      <p className="mt-1 text-[13px] text-ink-3 italic">Events and 10 Hz tracking combined. Click a column to sort.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-ink">
              <th className="py-1.5 text-left font-normal label">Player</th>
              {cols.map(([k, l, title]) => (
                <th key={k} title={title} className="cursor-pointer px-1 py-1.5 text-right font-normal">
                  <button onClick={() => setSort(k)} className={`label ${sort === k ? 'text-signal' : 'hover:text-ink'}`}>
                    {l}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const team = pkg.meta.teams[r.side]
              return (
                <tr key={r.pid} className="border-b border-rule hover:bg-paper-2">
                  <td className="max-w-40 truncate py-1.5">
                    <span className="mr-2 inline-grid h-4 w-4 place-items-center num text-[8px]" style={{ background: team.primary, color: onPrimary(team) }}>
                      {team.players.find((p) => p.id === r.pid)?.number}
                    </span>
                    {name(r.pid)}
                  </td>
                  {cols.map(([k]) => (
                    <td key={k} className={`px-1 text-right num ${sort === k ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                      {r[k] ?? 0}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PassNetwork({ side }: { side: Side }) {
  const { pkg, name } = useMatch()
  const team = pkg.meta.teams[side]
  const net = pkg.analytics.pass_networks[side]
  const numbers = new Map(team.players.map((p) => [p.id, p.number]))
  const pos = new Map(net.nodes.map((n) => [n.player, n]))
  const maxEdge = Math.max(1, ...net.edges.map((e) => e.count))
  const maxNode = Math.max(1, ...net.nodes.map((n) => n.passes))
  const ink = teamInk(team)
  return (
    <figure>
      <svg viewBox="-2 -2 109 72" className="w-full">
        <rect x="-1.5" y="-1.5" width="108" height="71" fill="#c9cfac" />
        <g fill="none" stroke="#faf7ee" strokeWidth="0.35">
          <rect x="0" y="0" width="105" height="68" />
          <line x1="52.5" x2="52.5" y1="0" y2="68" />
          <circle cx="52.5" cy="34" r="9.15" />
          <rect x="0" y="13.84" width="16.5" height="40.32" />
          <rect x="88.5" y="13.84" width="16.5" height="40.32" />
        </g>
        {net.edges.map((e, i) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          if (!a || !b) return null
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#141310" strokeOpacity={0.15 + 0.6 * (e.count / maxEdge)} strokeWidth={0.3 + 1.8 * (e.count / maxEdge)} />
        })}
        {net.nodes.map((n) => (
          <g key={n.player}>
            <circle cx={n.x} cy={n.y} r={1.7 + 2.4 * (n.passes / maxNode)} fill={team.primary} stroke="#141310" strokeWidth="0.35">
              <title>{`${name(n.player)}: ${n.passes} passes`}</title>
            </circle>
            <text x={n.x} y={n.y + 0.9} fontSize="2.5" textAnchor="middle" fill={onPrimary(team)} fontFamily="JetBrains Mono Variable" fontWeight="600">
              {numbers.get(n.player)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 text-[12px] italic" style={{ color: ink }}>
        {team.name} · {team.dna.formation}
        {side === 'home' ? ' · attacking →' : ' · attacking ←'}
      </figcaption>
    </figure>
  )
}
