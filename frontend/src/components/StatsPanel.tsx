import { useMemo, useState } from 'react'
import { useMatch } from '../lib/match'
import type { Side } from '../types'

const ROWS: [string, string, (v: any) => string][] = [
  ['xg', 'Expected goals (xG)', (v) => v.toFixed(2)],
  ['shots', 'Shots', String],
  ['shots_on_target', 'On target', String],
  ['big_chances', 'Big chances', String],
  ['possession_pct', 'Possession %', (v) => `${v}`],
  ['pass_accuracy_pct', 'Pass accuracy %', (v) => `${v}`],
  ['field_tilt_pct', 'Field tilt %', (v) => `${v}`],
  ['progressive_passes', 'Progressive passes', String],
  ['box_touches', 'Touches in the box', String],
  ['high_turnovers', 'High turnovers', String],
  ['ppda', 'PPDA (lower = more pressing)', (v) => (v == null ? '-' : String(v))],
  ['corners', 'Corners', String],
  ['fouls', 'Fouls', String],
]

const color = (c: { primary: string; secondary: string }) => (c.primary.toLowerCase() === '#1d1d1d' ? c.secondary : c.primary)

export default function StatsPanel() {
  const { pkg } = useMatch()
  const [period, setPeriod] = useState<'full' | 'first_half' | 'second_half'>('full')
  const stats = pkg.analytics.team_stats[period]
  const { home, away } = pkg.meta.teams
  return (
    <div className="scroll-thin -mr-2 h-full space-y-5 overflow-y-auto pr-2 text-sm">
      <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1 text-xs">
        {(['full', 'first_half', 'second_half'] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`flex-1 rounded-lg py-1 ${period === p ? 'bg-ink-600' : 'text-ink-400'}`}>
            {p === 'full' ? 'Match' : p === 'first_half' ? '1st half' : '2nd half'}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        <div className="flex justify-between text-xs font-semibold">
          <span style={{ color: color(home) }}>{home.name}</span>
          <span style={{ color: color(away) }}>{away.name}</span>
        </div>
        {ROWS.map(([k, label, fmt]) => {
          const a = stats.home[k] ?? 0
          const b = stats.away[k] ?? 0
          const invert = k === 'ppda' || k === 'fouls'
          const total = (Number(a) || 0) + (Number(b) || 0)
          const share = total ? (Number(a) || 0) / total : 0.5
          return (
            <div key={k}>
              <div className="flex justify-between text-xs">
                <span className="w-12 font-semibold tabular-nums">{fmt(a)}</span>
                <span className="text-ink-400">{label}</span>
                <span className="w-12 text-right font-semibold tabular-nums">{fmt(b)}</span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div style={{ width: `${(invert ? 1 - share : share) * 100}%`, background: color(home) }} />
                <div className="flex-1" style={{ background: color(away), opacity: 0.85 }} />
              </div>
            </div>
          )
        })}
      </div>
      <XgRace />
      <PlayerTable />
      <div>
        <div className="mb-2 text-xs tracking-wider text-ink-400 uppercase">Pass networks</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <PassNetwork side="home" />
          <PassNetwork side="away" />
        </div>
      </div>
    </div>
  )
}

function XgRace() {
  const { pkg, focusEvidence } = useMatch()
  const { home, away } = pkg.meta.teams
  const tl = pkg.analytics.xg_timeline
  const dur = pkg.meta.duration_s
  const maxXg = Math.max(0.5, ...tl.map((r) => Math.max(r.home_cum, r.away_cum))) * 1.1
  const path = (side: Side) => {
    let d = 'M0,100'
    let last = 0
    for (const r of tl) {
      const x = (r.ts / dur) * 300
      const v = side === 'home' ? r.home_cum : r.away_cum
      d += ` L${x.toFixed(1)},${(100 - (last / maxXg) * 100).toFixed(1)} L${x.toFixed(1)},${(100 - (v / maxXg) * 100).toFixed(1)}`
      last = v
    }
    return d + ` L300,${(100 - (last / maxXg) * 100).toFixed(1)}`
  }
  return (
    <div>
      <div className="mb-2 text-xs tracking-wider text-ink-400 uppercase">xG race · dots are goals</div>
      <svg viewBox="0 0 300 108" className="w-full rounded-lg bg-ink-900">
        <path d={path('home')} fill="none" stroke={color(home)} strokeWidth="2" />
        <path d={path('away')} fill="none" stroke={color(away)} strokeWidth="2" />
        {tl
          .filter((r) => r.outcome === 'goal')
          .map((r) => {
            const v = r.team === 'home' ? r.home_cum : r.away_cum
            return (
              <circle
                key={r.event_id}
                cx={(r.ts / dur) * 300}
                cy={100 - (v / maxXg) * 100}
                r="4"
                fill="#fff"
                stroke={color(pkg.meta.teams[r.team])}
                strokeWidth="2"
                className="cursor-pointer"
                onClick={() => focusEvidence([r.event_id], true)}
              >
                <title>{`${r.clock} goal (xG ${r.xg})`}</title>
              </circle>
            )
          })}
      </svg>
    </div>
  )
}

function PlayerTable() {
  const { pkg, name } = useMatch()
  const [sort, setSort] = useState('rating')
  const rows = useMemo(() => {
    const team = (pid: string) => (pkg.meta.teams.home.starters.includes(pid) || pkg.meta.teams.home.bench.includes(pid) ? 'home' : 'away')
    return Object.entries(pkg.analytics.player_stats)
      .filter(([, s]) => (s.minutes ?? 0) > 1)
      .map(([pid, s]) => ({ pid, side: team(pid) as Side, ...s }))
      .sort((a, b) => ((b as any)[sort] ?? 0) - ((a as any)[sort] ?? 0))
      .slice(0, 12)
  }, [pkg, sort])
  const cols: [string, string][] = [
    ['rating', 'Rtg'],
    ['goals', 'G'],
    ['xg', 'xG'],
    ['xa', 'xA'],
    ['key_passes', 'KP'],
    ['distance_km', 'km'],
    ['top_speed_kmh', 'km/h'],
    ['sprints', 'Spr'],
  ]
  return (
    <div>
      <div className="mb-2 text-xs tracking-wider text-ink-400 uppercase">Players · tracking + events</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-ink-400">
            <th className="py-1 text-left font-normal">Player</th>
            {cols.map(([k, l]) => (
              <th key={k} className="cursor-pointer px-1 text-right font-normal hover:text-ink-100" onClick={() => setSort(k)}>
                {l}
                {sort === k && ' v'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pid} className="border-t border-ink-700/60">
              <td className="max-w-36 truncate py-1">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: color(pkg.meta.teams[r.side]) }} />
                {name(r.pid)}
              </td>
              {cols.map(([k]) => (
                <td key={k} className="px-1 text-right tabular-nums">
                  {(r as any)[k] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const c = color(team)
  return (
    <div>
      <div className="mb-1 text-xs" style={{ color: c }}>
        {team.name} · {team.dna.formation}
      </div>
      <svg viewBox="-2 -2 109 72" className="w-full rounded-lg bg-[#0d2e25]">
        <rect x="0" y="0" width="105" height="68" fill="none" stroke="rgba(220,255,240,0.35)" strokeWidth="0.4" />
        <line x1="52.5" x2="52.5" y1="0" y2="68" stroke="rgba(220,255,240,0.35)" strokeWidth="0.4" />
        {net.edges.map((e, i) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          if (!a || !b) return null
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeOpacity={0.25 + 0.6 * (e.count / maxEdge)} strokeWidth={0.4 + 2.2 * (e.count / maxEdge)} />
        })}
        {net.nodes.map((n) => (
          <g key={n.player}>
            <circle cx={n.x} cy={n.y} r={1.6 + 2.6 * (n.passes / maxNode)} fill={team.primary} stroke={team.secondary} strokeWidth="0.5">
              <title>{`${name(n.player)}: ${n.passes} passes`}</title>
            </circle>
            <text x={n.x} y={n.y + 1} fontSize="2.6" textAnchor="middle" fill={team.secondary} fontWeight="700">
              {numbers.get(n.player)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
