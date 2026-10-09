import { useMemo, useState } from 'react'
import { useMatch } from '../lib/match'
import { onPrimary } from '../lib/ui'
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
  ['ppda', 'PPDA (lower = more press)', (v) => (v == null ? '-' : String(v))],
  ['corners', 'Corners', String],
  ['fouls', 'Fouls', String],
]

/** The match centre: team comparison, the xG race, the players (events + tracking) and pass networks. */
export default function StatsPanel() {
  const { pkg } = useMatch()
  const [period, setPeriod] = useState<'full' | 'first_half' | 'second_half'>('full')
  const stats = pkg.analytics.team_stats[period]
  const { home, away } = pkg.meta.teams
  return (
    <section className="mx-auto max-w-[1480px] px-4 py-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="xp text-[40px] sm:text-[56px]">
          Match centre<span className="xp-light"> / numbers</span>
        </h2>
        <div className="seg" role="tablist">
          {(['full', 'first_half', 'second_half'] as const).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}>
              {p === 'full' ? 'Match' : p === 'first_half' ? '1st half' : '2nd half'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="plate p-5">
          <div className="flex items-stretch justify-between">
            <span className="cut-r px-3 py-1 xp text-[14px]" style={{ background: home.primary, color: onPrimary(home) }}>
              {home.short}
            </span>
            <span className="cond self-center text-ink-3">Team comparison</span>
            <span className="cut-l px-3 py-1 xp text-[14px]" style={{ background: away.primary, color: onPrimary(away) }}>
              {away.short}
            </span>
          </div>
          <div className="mt-3">
            {ROWS.map(([k, label, fmt]) => {
              const a = Number(stats.home[k] ?? 0)
              const b = Number(stats.away[k] ?? 0)
              const invert = k === 'ppda' || k === 'fouls'
              const total = (a || 0) + (b || 0)
              const share = total ? a / total : 0.5
              const homeLeads = invert ? a < b : a > b
              const awayLeads = invert ? b < a : b > a
              return (
                <div key={k} className="border-t border-line py-2">
                  <div className="flex items-baseline justify-between">
                    <span className={`w-14 text-[15px] tab-num ${homeLeads ? 'font-bold' : 'text-ink-3'}`}>{fmt(stats.home[k])}</span>
                    <span className="cond text-[11px] text-ink-3">{label}</span>
                    <span className={`w-14 text-right text-[15px] tab-num ${awayLeads ? 'font-bold' : 'text-ink-3'}`}>{fmt(stats.away[k])}</span>
                  </div>
                  <div className="mt-1.5 flex h-1.5 gap-[3px]">
                    <div style={{ width: `${(invert ? 1 - share : share) * 100}%`, background: home.primary, opacity: homeLeads ? 1 : 0.45 }} />
                    <div className="flex-1" style={{ background: away.primary, opacity: awayLeads ? 1 : 0.45 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="grid gap-6">
          <XgRace />
          <PlayerTable />
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <PassNetwork side="home" />
        <PassNetwork side="away" />
      </div>
    </section>
  )
}

function XgRace() {
  const { pkg, focusEvidence } = useMatch()
  const { home, away } = pkg.meta.teams
  const tl = pkg.analytics.xg_timeline
  const dur = pkg.meta.duration_s
  const half = pkg.meta.period_lengths_s['1']
  const maxXg = Math.max(0.5, ...tl.map((r) => Math.max(r.home_cum, r.away_cum))) * 1.12
  const Y = (v: number) => 150 - (v / maxXg) * 140
  const path = (side: Side) => {
    let d = `M0,${Y(0)}`
    let last = 0
    for (const r of tl) {
      const x = (r.ts / dur) * 600
      const v = side === 'home' ? r.home_cum : r.away_cum
      d += ` L${x.toFixed(1)},${Y(last).toFixed(1)} L${x.toFixed(1)},${Y(v).toFixed(1)}`
      last = v
    }
    return d + ` L600,${Y(last).toFixed(1)}`
  }
  const final = tl.length ? tl[tl.length - 1] : { home_cum: 0, away_cum: 0 }
  return (
    <div className="plate p-5">
      <div className="flex items-baseline justify-between">
        <span className="cond text-ink-3">The xG race · click a goal to replay it</span>
        <span className="xp text-[16px] tab-num">
          {final.home_cum.toFixed(2)} <span className="xp-light text-ink-4">/</span> {final.away_cum.toFixed(2)}
        </span>
      </div>
      <svg viewBox="0 0 600 160" className="mt-3 w-full overflow-visible">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="600" y1={Y(maxXg * f)} y2={Y(maxXg * f)} stroke="#0b0c0e" strokeOpacity="0.07" />
        ))}
        <line x1="0" x2="600" y1="150" y2="150" stroke="#0b0c0e" />
        <line x1={(half / dur) * 600} x2={(half / dur) * 600} y1="6" y2="150" stroke="#0b0c0e" strokeDasharray="2 4" strokeOpacity="0.4" />
        <text x={(half / dur) * 600 + 4} y="14" fontSize="10" fill="#6b717b" fontWeight="700">
          HT
        </text>
        <path d={path('home')} fill="none" stroke={home.primary} strokeWidth="3" />
        <path d={path('away')} fill="none" stroke={away.primary} strokeWidth="3" />
        {tl
          .filter((r) => r.outcome === 'goal')
          .map((r) => {
            const v = r.team === 'home' ? r.home_cum : r.away_cum
            const x = (r.ts / dur) * 600
            const y = Y(v)
            return (
              <g key={r.event_id} className="cursor-pointer" onClick={() => focusEvidence([r.event_id], true)}>
                <rect x={x - 6} y={y - 6} width="12" height="12" fill="#ff4d2e" transform={`rotate(45 ${x} ${y})`} />
                <title>{`${r.clock} goal, xG ${r.xg} - click to replay`}</title>
              </g>
            )
          })}
      </svg>
      <div className="mt-2 flex gap-5 text-[12px] font-semibold">
        <span className="flex items-center gap-2">
          <span className="h-1 w-5" style={{ background: home.primary }} /> {home.name}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1 w-5" style={{ background: away.primary }} /> {away.name}
        </span>
      </div>
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
      .map(([pid, s]) => ({ pid, side: team(pid) as Side, ...s }) as Record<string, number> & { pid: string; side: Side })
      .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0))
      .slice(0, 12)
  }, [pkg, sort])
  const cols: [string, string, string][] = [
    ['rating', 'Rtg', 'Match rating'],
    ['goals', 'G', 'Goals'],
    ['xg', 'xG', 'Expected goals'],
    ['xa', 'xA', 'Expected assists'],
    ['key_passes', 'KP', 'Key passes'],
    ['distance_km', 'km', 'Distance covered (tracking)'],
    ['top_speed_kmh', 'km/h', 'Top speed (tracking)'],
    ['sprints', 'Spr', 'Sprints (tracking)'],
  ]
  return (
    <div className="plate p-5">
      <span className="cond text-ink-3">The players · events + 10 Hz tracking · sort by any column</span>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="pb-2 text-left font-normal" />
              {cols.map(([k, l, title]) => (
                <th key={k} title={title} className="px-1 pb-2 text-right font-normal">
                  <button onClick={() => setSort(k)} className={`cond text-[11px] ${sort === k ? 'bg-ink px-1.5 text-volt' : 'text-ink-3 hover:text-ink'}`}>
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
                <tr key={r.pid} className="border-t border-line hover:bg-concrete">
                  <td className="max-w-44 truncate py-2 pr-2">
                    <span className="mr-2 inline-grid h-5 w-6 place-items-center text-[10px] font-bold tab-num" style={{ background: team.primary, color: onPrimary(team) }}>
                      {team.players.find((p) => p.id === r.pid)?.number}
                    </span>
                    <span className="font-semibold">{name(r.pid)}</span>
                  </td>
                  {cols.map(([k]) => (
                    <td key={k} className={`px-1 text-right tab-num ${sort === k ? 'font-bold' : 'text-ink-2'}`}>
                      {r[k] ?? 0}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
  return (
    <figure className="plate p-5">
      <div className="flex items-stretch justify-between">
        <span className="cut-r px-3 py-1 xp text-[13px]" style={{ background: team.primary, color: onPrimary(team) }}>
          {team.name}
        </span>
        <span className="cond self-center text-ink-3">
          Pass network · {team.dna.formation} · attacking {side === 'home' ? '→' : '←'}
        </span>
      </div>
      <svg viewBox="-3 -3 111 74" className="mt-3 w-full">
        <rect x="-3" y="-3" width="111" height="74" fill="#3f7d34" />
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={i * 11.67} y="0" width="5.83" height="68" fill="#4a8a3c" />
        ))}
        <g fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="0.35">
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
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeOpacity={0.2 + 0.7 * (e.count / maxEdge)} strokeWidth={0.3 + 1.9 * (e.count / maxEdge)} />
        })}
        {net.nodes.map((n) => (
          <g key={n.player}>
            <circle cx={n.x} cy={n.y} r={1.9 + 2.3 * (n.passes / maxNode)} fill={team.primary} stroke="#0b0c0e" strokeWidth="0.4">
              <title>{`${name(n.player)}: ${n.passes} passes`}</title>
            </circle>
            <text x={n.x} y={n.y + 0.95} fontSize="2.6" textAnchor="middle" fill={onPrimary(team)} fontWeight="800">
              {numbers.get(n.player)}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  )
}
