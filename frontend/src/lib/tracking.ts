import { api, type TrackingChunk } from '../api'

const CHUNK_SECONDS = 60
/** A player or ball moving further than this between two 10 Hz frames is a cut (e.g. the interval), not motion. */
const CUT = 4

export interface Frame {
  ids: string[]
  teams: string[]
  /** metres; NaN when the player is not on the pitch */
  x: Float32Array
  y: Float32Array
  ball: [number, number]
  /** ball height in metres */
  ballZ: number
  /** column of the player in control of the ball, -1 when it is loose or in flight */
  owner: number
}

interface Chunk {
  hz: number
  start: number
  frames: number
  players: string[]
  teams: string[]
  xy: Int32Array
  ball: Int32Array
  ballZ: Int32Array
  owner: number[]
  scale: number
}

/** Undo the server's frame-to-frame delta encoding. */
function decode(c: TrackingChunk): Chunk {
  const n = c.players.length
  const xy = Int32Array.from(c.xy)
  const ball = Int32Array.from(c.ball)
  const ballZ = Int32Array.from(c.ball_z ?? [])
  if (c.enc === 'delta') {
    const row = n * 2
    for (let i = row; i < xy.length; i++) xy[i] += xy[i - row]
    for (let i = 2; i < ball.length; i++) ball[i] += ball[i - 2]
    for (let i = 1; i < ballZ.length; i++) ballZ[i] += ballZ[i - 1]
  }
  return { hz: c.hz, start: c.start, frames: c.frames, players: c.players, teams: c.teams, xy, ball, ballZ, owner: c.on_ball ?? [], scale: c.scale }
}

/** Catmull-Rom through four samples: smooth curves instead of straight 10 Hz segments. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** Lazily loads 60-second tracking chunks and interpolates positions for any time. */
export class TrackingStore {
  private chunks = new Map<number, Chunk | 'loading'>()
  private readonly matchId: string
  private out: Frame | null = null

  constructor(matchId: string) {
    this.matchId = matchId
  }

  private ensure(idx: number) {
    if (idx < 0 || this.chunks.has(idx)) return
    this.chunks.set(idx, 'loading')
    api
      .tracking(this.matchId, idx * CHUNK_SECONDS, CHUNK_SECONDS)
      .then((c) => this.chunks.set(idx, decode(c)))
      .catch(() => this.chunks.delete(idx))
  }

  /** Warm the cache around a time (call before seeking or replaying). */
  prefetch(t: number) {
    const idx = Math.floor(Math.max(0, t) / CHUNK_SECONDS)
    this.ensure(idx)
    this.ensure(idx + 1)
  }

  private chunk(t: number): Chunk | null {
    const c = this.chunks.get(Math.floor(t / CHUNK_SECONDS))
    return c && c !== 'loading' && c.frames > 0 ? c : null
  }

  /** Ball position and height only - cheap enough to sample several times per frame. */
  ballAt(t: number): [number, number, number] | null {
    if (t < 0) return null
    const c = this.chunk(t)
    if (!c) return null
    const local = Math.max(0, (t - c.start) * c.hz)
    const f0 = Math.min(Math.floor(local), c.frames - 1)
    const f1 = Math.min(f0 + 1, c.frames - 1)
    const a = local - f0
    const s = c.scale
    return [
      (c.ball[f0 * 2] + (c.ball[f1 * 2] - c.ball[f0 * 2]) * a) / s,
      (c.ball[f0 * 2 + 1] + (c.ball[f1 * 2 + 1] - c.ball[f0 * 2 + 1]) * a) / s,
      c.ballZ.length ? (c.ballZ[f0] + (c.ballZ[f1] - c.ballZ[f0]) * a) / s : 0,
    ]
  }

  /** Positions at time t. The returned object is reused between calls - copy it if you need to keep it. */
  frameAt(t: number): Frame | null {
    t = Math.max(0, t)
    const idx = Math.floor(t / CHUNK_SECONDS)
    this.ensure(idx)
    if (t - idx * CHUNK_SECONDS > CHUNK_SECONDS * 0.4) this.ensure(idx + 1)
    const c = this.chunk(t)
    if (!c) return null
    const n = c.players.length
    if (!this.out || this.out.ids !== c.players) {
      this.out = { ids: c.players, teams: c.teams, x: new Float32Array(n), y: new Float32Array(n), ball: [0, 0], ballZ: 0, owner: -1 }
    }
    const out = this.out
    const last = c.frames - 1
    const local = Math.max(0, (t - c.start) * c.hz)
    const f1 = Math.min(Math.floor(local), last)
    const f2 = Math.min(f1 + 1, last)
    const f0 = Math.max(f1 - 1, 0)
    const f3 = Math.min(f2 + 1, last)
    const a = local - f1
    const s = c.scale
    const xy = c.xy
    for (let j = 0; j < n; j++) {
      const i0 = (f0 * n + j) * 2
      const i1 = (f1 * n + j) * 2
      const i2 = (f2 * n + j) * 2
      const i3 = (f3 * n + j) * 2
      if (xy[i1] < 0 || xy[i2] < 0) {
        out.x[j] = NaN
        out.y[j] = NaN
        continue
      }
      const x1 = xy[i1]
      const y1 = xy[i1 + 1]
      const x2 = xy[i2]
      const y2 = xy[i2 + 1]
      if (Math.hypot(x2 - x1, y2 - y1) / s > CUT) {
        out.x[j] = (a < 0.5 ? x1 : x2) / s
        out.y[j] = (a < 0.5 ? y1 : y2) / s
        continue
      }
      // neighbours that are missing or across a cut fall back to the inner points
      const ok0 = xy[i0] >= 0 && Math.hypot(xy[i0] - x1, xy[i0 + 1] - y1) / s <= CUT
      const ok3 = xy[i3] >= 0 && Math.hypot(xy[i3] - x2, xy[i3 + 1] - y2) / s <= CUT
      const x0 = ok0 ? xy[i0] : x1
      const y0 = ok0 ? xy[i0 + 1] : y1
      const x3 = ok3 ? xy[i3] : x2
      const y3 = ok3 ? xy[i3 + 1] : y2
      out.x[j] = cr(x0, x1, x2, x3, a) / s
      out.y[j] = cr(y0, y1, y2, y3, a) / s
    }
    const b1 = f1 * 2
    const b2 = f2 * 2
    const bcut = Math.hypot(c.ball[b2] - c.ball[b1], c.ball[b2 + 1] - c.ball[b1 + 1]) / s > CUT * 1.5
    const wb = bcut ? (a < 0.5 ? 0 : 1) : a
    out.ball[0] = (c.ball[b1] + (c.ball[b2] - c.ball[b1]) * wb) / s
    out.ball[1] = (c.ball[b1 + 1] + (c.ball[b2 + 1] - c.ball[b1 + 1]) * wb) / s
    out.ballZ = c.ballZ.length ? (c.ballZ[f1] + (c.ballZ[f2] - c.ballZ[f1]) * a) / s : 0
    out.owner = c.owner.length ? c.owner[a < 0.5 ? f1 : f2] : -1
    return out
  }
}
