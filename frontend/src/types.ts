export type Side = 'home' | 'away'

export interface Player {
  id: string
  name: string
  number: number
  role: string
}

export interface TeamDNA {
  formation: string
  press: number
  tempo: number
  directness: number
  width: number
  line_height: number
  counter: number
}

export interface Team {
  id: string
  name: string
  short: string
  primary: string
  secondary: string
  coach: string
  dna: TeamDNA
  traits: string[]
  players: Player[]
  starters: string[]
  bench: string[]
}

export interface Meta {
  id: string
  title: string
  seed: number
  teams: Record<Side, Team>
  player_names: Record<string, string>
  score: Record<Side, number>
  period_lengths_s: Record<'1' | '2', number>
  duration_s: number
  competition: string
  featured?: boolean
  /** Changes whenever the match data is regenerated. */
  version?: string
  tag?: string
  blurb?: string
}

export interface MatchEvent {
  id: number
  ts: number
  period: number
  minute: number
  clock: string
  team: Side
  type: string
  player: string | null
  x: number
  y: number
  end_x?: number
  end_y?: number
  dur: number
  chain: number
  tags: string[]
  outcome?: string
  receiver?: string
  xg?: number
  related?: number
  set_piece?: string
  pass_type?: string
  note?: string
  score?: Record<Side, number>
  player_on?: string
  player_off?: string
  changes?: Record<string, number | string>
}

export interface Moment {
  id: string
  type: 'goal' | 'big_chance' | 'save' | 'red_card' | 'tactical_change' | 'momentum'
  ts: number
  clock: string
  minute: number
  team: Side
  team_name: string
  title: string
  importance: number
  players: string[]
  facts: Record<string, any>
  evidence: number[]
}

export type TeamStats = Record<string, any>

export interface Analytics {
  team_stats: Record<'full' | 'first_half' | 'second_half', Record<Side, TeamStats>>
  player_stats: Record<string, Record<string, number>>
  momentum: { minute: number; home: number; away: number; momentum: number }[]
  xg_timeline: { ts: number; clock: string; team: Side; xg: number; outcome: string; home_cum: number; away_cum: number; event_id: number }[]
  pass_networks: Record<Side, { nodes: { player: string; x: number; y: number; passes: number }[]; edges: { from: string; to: string; count: number }[] }>
  moments: Moment[]
}

export interface MatchPackage {
  meta: Meta
  analytics: Analytics
  events: MatchEvent[]
}

export interface MatchSummary {
  id: string
  title: string
  score: Record<Side, number>
  competition: string
  home: { id: string; name: string; short: string; primary: string; secondary: string }
  away: { id: string; name: string; short: string; primary: string; secondary: string }
  featured: boolean
  blurb?: string
}

export interface TraceStep {
  agent: string
  kind: 'llm' | 'code' | 'rules' | 'tool'
  output?: string
  ms: number
  attempt?: number
  passed?: boolean
  tool?: string
  args?: Record<string, unknown>
}

export interface Verdict {
  passed: boolean
  issues: string[]
  checked_numbers: number
  checked_names: number
  evidence: number[]
}

export interface CrewResult {
  text: string
  data: { headline: string; article: string; social: string[] } | null
  verdict: Verdict
  trace: TraceStep[]
  mode: 'ai' | 'template' | 'error'
  cached?: boolean
}

export interface AskResult {
  answer: string
  verdict: Verdict | null
  trace: TraceStep[]
  mode: string
}

export interface WhatIfSummary {
  win_pct: number
  draw_pct: number
  loss_pct: number
  expected_points: number
  xg_for_rest_of_match: number
  xg_against_rest_of_match: number
  most_likely_finals: { score: string; pct: number }[]
}

export interface WhatIfResult {
  team: string
  side: Side
  from_minute: number
  score_at_minute: Record<string, number>
  tactics_before: Record<string, number | string>
  tactics_tested: Record<string, number | string>
  runs: number
  as_played: WhatIfSummary
  with_change: WhatIfSummary
  expected_points_delta: number
  expected_points_delta_95ci: [number, number]
  verdict: 'helps' | 'hurts' | 'no clear effect'
  method: string
  seconds: number
}

export interface Options {
  personas: Record<string, string>
  languages: Record<string, string>
  formations: string[]
  dials: string[]
  teams: Record<string, { name: string; short: string; primary: string; secondary: string; formation: string; traits: string[] }>
}

export interface Health {
  ok: boolean
  ai: { provider: string; model: string | null; enabled: boolean }
  matches: number
}

/** One play-by-play call the commentator can make (built on the server from the events). */
export interface CommentaryLine {
  id: string
  ts: number
  text: string
  /** 4 must be said, 0 only fills a silence. */
  prio: number
  excited: boolean
}
