import type { PlaybackClock } from './clock'
import type { TrackingStore } from './tracking'
import type { MatchEvent, MatchPackage, Side } from '../types'

/*
 * Highlights, the way TV cuts them: the build-up to every big moment plays at
 * real speed, the edit cuts between clips behind a wipe, and every goal gets a
 * slow-motion replay from the goal camera.
 */

export interface Clip {
  start: number
  end: number
  kind: string
  team: Side | null
  title: string
  clock: string
  goal?: MatchEvent
  /** The analytics moment this clip shows, if any (for the crew's commentary). */
  moment?: string
}

export type ReelPhase = 'off' | 'clip' | 'cut' | 'replay' | 'done'

export interface ReelState {
  phase: ReelPhase
  index: number
  total: number
  clip: Clip | null
  next: Clip | null
  /** During a cut: are we going to a replay or to the next clip? */
  cutTo: 'replay' | 'next' | null
  /** Which camera the replay uses. */
  angle: ReplayAngle
}

export type ReplayAngle = 'goal' | 'closeup'

const MOMENT_TYPES = new Set(['goal', 'big_chance', 'save', 'red_card', 'tactical_change'])

export function buildReel(pkg: MatchPackage): Clip[] {
  const half = pkg.meta.period_lengths_s['1']
  const dur = pkg.meta.duration_s
  const goals = pkg.events.filter((e) => e.type === 'goal')
  const raw: Clip[] = [{ start: 0, end: 18, kind: 'kickoff', team: null, title: 'Kick-off', clock: "1'" }]
  for (const m of pkg.analytics.moments) {
    if (!MOMENT_TYPES.has(m.type)) continue
    const goal = m.type === 'goal' ? goals.find((g) => Math.abs(g.ts - m.ts) < 4) : undefined
    raw.push({ start: m.ts - 16, end: m.ts + (goal ? 5 : 6), kind: m.type, team: m.team, title: m.title, clock: m.clock, goal, moment: m.id })
  }
  for (const e of pkg.events) {
    if (e.type === 'shot' && (e.xg ?? 0) >= 0.15 && e.outcome !== 'goal')
      raw.push({ start: e.ts - 12, end: e.ts + 4, kind: 'chance', team: e.team, title: 'Chance', clock: e.clock })
  }
  raw.push({ start: half, end: half + 12, kind: 'kickoff', team: null, title: 'Second half', clock: "46'" })
  raw.push({ start: dur - 14, end: dur, kind: 'fulltime', team: null, title: 'Full time', clock: 'FT' })
  raw.sort((a, b) => a.start - b.start)
  // merge clips that overlap or nearly touch; a goal inside a merged clip keeps its replay
  const out: Clip[] = []
  for (const c of raw) {
    c.start = Math.max(0, c.start)
    c.end = Math.min(dur, c.end)
    const last = out[out.length - 1]
    if (last && c.start <= last.end + 5 && !(last.goal && c.goal)) {
      last.end = Math.max(last.end, c.end)
      if (c.goal) last.goal = c.goal
      if (rank(c.kind) > rank(last.kind)) Object.assign(last, { kind: c.kind, team: c.team, title: c.title, clock: c.clock, moment: c.moment ?? last.moment })
      else if (!last.moment && c.moment) last.moment = c.moment
    } else out.push({ ...c })
  }
  return out
}

function rank(kind: string): number {
  return ['kickoff', 'chance', 'save', 'tactical_change', 'big_chance', 'red_card', 'goal', 'fulltime'].indexOf(kind)
}

export class ReelDirector {
  private clock: PlaybackClock
  private store: TrackingStore
  readonly clips: Clip[]
  private idx = 0
  private phase: ReelPhase = 'off'
  private cutTo: 'replay' | 'next' | null = null
  private expected = 0
  private timer = 0
  private unsub: (() => void) | null = null
  private listeners = new Set<(s: ReelState) => void>()
  /** Speed used inside clips (the replay always runs slower). */
  speed = 1
  /** Replay a goal once per angle, one after the other. */
  angles: ReplayAngle[] = ['goal']
  private angleIdx = 0
  onExit: (() => void) | null = null

  constructor(clock: PlaybackClock, store: TrackingStore, clips: Clip[]) {
    this.clock = clock
    this.store = store
    this.clips = clips
  }

  state(): ReelState {
    return {
      phase: this.phase,
      index: this.idx,
      total: this.clips.length,
      clip: this.clips[this.idx] ?? null,
      next: this.clips[this.idx + 1] ?? null,
      cutTo: this.phase === 'cut' ? this.cutTo : null,
      angle: this.angles[this.angleIdx] ?? 'goal',
    }
  }

  subscribe(fn: (s: ReelState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    const s = this.state()
    this.listeners.forEach((fn) => fn(s))
  }

  /** Start (or resume) the reel at the clip containing the playhead, or the next one. */
  start() {
    const t = this.clock.time
    this.expected = t // the playhead is where we start from, not a jump
    let i = this.clips.findIndex((c) => t < c.end)
    if (i < 0) i = 0
    this.idx = i
    this.unsub?.()
    this.unsub = this.clock.subscribe(this.onTick)
    const c = this.clips[i]
    if (t < c.start || t >= c.end) this.go(c.start)
    this.phase = 'clip'
    this.clock.setSpeed(this.speed)
    this.prefetchNext()
    this.clock.play()
    this.emit()
  }

  stop() {
    this.unsub?.()
    this.unsub = null
    clearTimeout(this.timer)
    this.phase = 'off'
    if (this.clock.speed < 1) this.clock.setSpeed(1)
    this.emit()
  }

  private go(t: number) {
    this.expected = t
    this.clock.seek(t)
  }

  private prefetchNext() {
    const n = this.clips[this.idx + 1]
    if (n) this.store.prefetch(n.start)
    const c = this.clips[this.idx]
    if (c?.goal) this.store.prefetch(c.goal.ts - 5)
  }

  private onTick = () => {
    if (this.phase === 'off' || this.phase === 'cut' || this.phase === 'done') return
    const t = this.clock.time
    // a jump the reel did not make (the viewer scrubbed or replayed something): hand back control
    if (Math.abs(t - this.expected) > 3) {
      this.stop()
      this.onExit?.()
      return
    }
    this.expected = t
    // a speed the viewer picked on the transport carries over to the next clips (the replay's own 0.5 does not)
    if (this.phase === 'clip' || (this.phase === 'replay' && this.clock.speed !== 0.5)) this.speed = this.clock.speed
    const c = this.clips[this.idx]
    if (this.phase === 'clip' && t >= c.end - 0.05) {
      if (c.goal) {
        this.angleIdx = 0
        this.replay(c.goal)
      } else this.cut()
    } else if (this.phase === 'replay' && c.goal && t >= c.goal.ts + 1.0) {
      if (this.angleIdx + 1 < this.angles.length) {
        this.angleIdx += 1
        this.replay(c.goal)
      } else this.cut()
    }
  }

  private replay(goal: MatchEvent) {
    this.phase = 'cut'
    this.cutTo = 'replay'
    this.clock.pause()
    this.emit()
    this.timer = window.setTimeout(() => {
      this.go(goal.ts - 4.5)
      this.phase = 'replay'
      this.clock.setSpeed(0.5)
      this.clock.play()
      this.emit()
    }, 700)
  }

  private cut() {
    if (this.idx >= this.clips.length - 1) {
      this.phase = 'done'
      this.clock.pause()
      this.clock.setSpeed(this.speed)
      this.emit()
      return
    }
    this.phase = 'cut'
    this.cutTo = 'next'
    this.clock.pause()
    this.emit()
    this.timer = window.setTimeout(() => {
      this.idx += 1
      this.go(this.clips[this.idx].start)
      this.phase = 'clip'
      this.clock.setSpeed(this.speed)
      this.prefetchNext()
      this.clock.play()
      this.emit()
    }, 900)
  }
}

/** The front page trailer: every goal, built up live, celebrated, then replayed from more than one angle. */
export function buildTrailer(pkg: MatchPackage): Clip[] {
  return pkg.events
    .filter((e) => e.type === 'goal')
    .map((g) => {
      const m = pkg.analytics.moments.find((x) => x.type === 'goal' && Math.abs(x.ts - g.ts) < 4)
      return { start: Math.max(0, g.ts - 13), end: g.ts + 8, kind: 'goal', team: g.team, title: m?.title ?? 'Goal', clock: g.clock, goal: g, moment: m?.id }
    })
}

const BALL = new Set(['pass', 'carry', 'shot', 'interception', 'tackle', 'save', 'clearance', 'block'])

/** A stoppage in the full match, handled the way TV does: replay the incident, then back for the restart. */
export interface Break {
  from: number
  /** Where live play picks up again, a few seconds before the restart. */
  resume: number
  restart: MatchEvent
  replay: { from: number; to: number; angle: ReplayAngle; dir: 1 | -1 } | null
}

export function buildBreaks(pkg: MatchPackage): Break[] {
  const ball = pkg.events.filter((e) => BALL.has(e.type))
  const fouls = pkg.events.filter((e) => e.type === 'foul')
  const out: Break[] = []
  for (let i = 0; i + 1 < ball.length; i++) {
    const a = ball[i]
    const b = ball[i + 1]
    const end = a.ts + (a.dur ?? 0)
    const goal = a.type === 'shot' && a.outcome === 'goal'
    const foul = goal ? undefined : fouls.find((f) => f.ts > a.ts && f.ts < b.ts)
    // set pieces get a few seconds to see the taker over the ball
    const resume = b.ts - (b.set_piece && b.set_piece !== 'throw_in' && b.set_piece !== 'goal_kick' ? 5 : 3.5)
    let from = end + 3.5
    let replay: Break['replay'] = null
    if (goal) {
      from = end + 8 // the celebration plays out first
      replay = { from: a.ts - 4.5, to: end + 1.2, angle: 'goal', dir: a.team === 'home' ? 1 : -1 }
    } else if (foul) {
      from = foul.ts + 3.2 // the challenge, the fall, the whistle
      replay = { from: foul.ts - 3.5, to: foul.ts + 1.6, angle: 'closeup', dir: foul.team === 'home' ? 1 : -1 }
    }
    if (resume - from > 4) out.push({ from, resume, restart: b, replay })
  }
  return out
}

export interface BreakState {
  phase: 'live' | 'replay'
  brk: Break | null
  /** Counts every edit (into a replay, back to live), so the page can mark each one. */
  cuts: number
}

/** Runs the full match like a TV director: at a stoppage, replay what happened in slow motion, then cut back. */
export class BreakDirector {
  private clock: PlaybackClock
  private store: TrackingStore
  private breaks: Break[]
  private phase: 'live' | 'replay' = 'live'
  private brk: Break | null = null
  private handled: Break | null = null
  private base = 1
  private expected = 0
  private cuts = 0
  private listeners = new Set<(s: BreakState) => void>()
  private unsub: () => void

  constructor(clock: PlaybackClock, store: TrackingStore, breaks: Break[]) {
    this.clock = clock
    this.store = store
    this.breaks = breaks
    this.unsub = clock.subscribe(this.onTick)
  }

  subscribe(fn: (s: BreakState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  stop() {
    this.unsub()
    if (this.phase === 'replay') this.clock.setSpeed(this.base)
    this.phase = 'live'
  }

  private emit() {
    const s = { phase: this.phase, brk: this.brk, cuts: this.cuts }
    this.listeners.forEach((fn) => fn(s))
  }

  private go(t: number) {
    this.expected = t
    this.clock.seek(t)
  }

  private onTick = () => {
    const c = this.clock
    const t = c.time
    if (this.phase === 'replay') {
      if (Math.abs(t - this.expected) > 2.5) {
        // the viewer moved the playhead: leave the replay where they put it
        this.phase = 'live'
        c.setSpeed(this.base)
        this.emit()
        return
      }
      this.expected = t
      if (this.brk?.replay && t >= this.brk.replay.to) {
        this.phase = 'live'
        c.setSpeed(this.base)
        this.cuts += 1
        this.go(this.brk.resume)
        this.emit()
      }
      return
    }
    if (this.handled && t < this.handled.from - 1) this.handled = null
    if (!c.playing) return
    const b = this.breaks.find((k) => t >= k.from && t < k.resume)
    if (!b || b === this.handled) return
    this.handled = b
    this.brk = b
    this.store.prefetch(b.resume)
    this.cuts += 1
    if (b.replay) {
      this.base = c.speed
      this.phase = 'replay'
      this.store.prefetch(b.replay.from)
      this.go(b.replay.from)
      c.setSpeed(0.5)
    } else {
      this.go(b.resume)
    }
    this.emit()
  }
}
