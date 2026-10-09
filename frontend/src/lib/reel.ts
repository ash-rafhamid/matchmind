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
}

const MOMENT_TYPES = new Set(['goal', 'big_chance', 'save', 'red_card', 'tactical_change'])

export function buildReel(pkg: MatchPackage): Clip[] {
  const half = pkg.meta.period_lengths_s['1']
  const dur = pkg.meta.duration_s
  const goals = pkg.events.filter((e) => e.type === 'goal')
  const raw: Clip[] = [{ start: 0, end: 18, kind: 'kickoff', team: null, title: 'Kick-off', clock: "1'" }]
  for (const m of pkg.analytics.moments) {
    if (!MOMENT_TYPES.has(m.type)) continue
    const goal = m.type === 'goal' ? goals.find((g) => Math.abs(g.ts - m.ts) < 4) : undefined
    raw.push({ start: m.ts - 16, end: m.ts + (goal ? 5 : 6), kind: m.type, team: m.team, title: m.title, clock: m.clock, goal })
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
      if (rank(c.kind) > rank(last.kind)) Object.assign(last, { kind: c.kind, team: c.team, title: c.title, clock: c.clock })
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
    if (c?.goal) this.store.prefetch(c.goal.ts - 7)
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
    const c = this.clips[this.idx]
    if (this.phase === 'clip' && t >= c.end - 0.05) {
      if (c.goal) this.replay(c.goal)
      else this.cut()
    } else if (this.phase === 'replay' && c.goal && t >= c.goal.ts + 1.2) {
      this.cut()
    }
  }

  private replay(goal: MatchEvent) {
    this.phase = 'cut'
    this.cutTo = 'replay'
    this.clock.pause()
    this.emit()
    this.timer = window.setTimeout(() => {
      this.go(goal.ts - 6.5)
      this.phase = 'replay'
      this.clock.setSpeed(0.4)
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
