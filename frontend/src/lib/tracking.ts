import { api, type TrackingChunk } from '../api'

const CHUNK_SECONDS = 60
/** A player or ball moving further than this between two 10 Hz frames is a cut (e.g. the interval), not motion. */
const CUT_METRES = 4

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

/** Lazily loads 60-second tracking chunks and interpolates positions for any time. */
export class TrackingStore {
  private chunks = new Map<number, TrackingChunk | 'loading'>()
  private readonly matchId: string

  constructor(matchId: string) {
    this.matchId = matchId
  }

  private ensure(idx: number) {
    if (idx < 0 || this.chunks.has(idx)) return
    this.chunks.set(idx, 'loading')
    api
      .tracking(this.matchId, idx * CHUNK_SECONDS, CHUNK_SECONDS)
      .then((c) => this.chunks.set(idx, c))
      .catch(() => this.chunks.delete(idx))
  }

  /** Warm the cache around a time (call before seeking or replaying). */
  prefetch(t: number) {
    const idx = Math.floor(Math.max(0, t) / CHUNK_SECONDS)
    this.ensure(idx)
    this.ensure(idx + 1)
  }

  /** Ball position and height only - cheap enough to sample many times per frame for the trail. */
  ballAt(t: number): [number, number, number] | null {
    if (t < 0) return null
    const c = this.chunks.get(Math.floor(t / CHUNK_SECONDS))
    if (!c || c === 'loading' || c.frames === 0) return null
    const local = Math.max(0, (t - c.start) * c.hz)
    const f0 = Math.min(Math.floor(local), c.frames - 1)
    const f1 = Math.min(f0 + 1, c.frames - 1)
    const a = local - f0
    const s = c.scale
    const b0 = f0 * 2
    const b1 = f1 * 2
    if (Math.hypot(c.ball[b1] - c.ball[b0], c.ball[b1 + 1] - c.ball[b0 + 1]) / s > CUT_METRES * 1.5) return null
    return [
      (c.ball[b0] + (c.ball[b1] - c.ball[b0]) * a) / s,
      (c.ball[b0 + 1] + (c.ball[b1 + 1] - c.ball[b0 + 1]) * a) / s,
      c.ball_z ? (c.ball_z[f0] + (c.ball_z[f1] - c.ball_z[f0]) * a) / s : 0,
    ]
  }

  frameAt(t: number): Frame | null {
    t = Math.max(0, t)
    const idx = Math.floor(t / CHUNK_SECONDS)
    this.ensure(idx)
    if (t - idx * CHUNK_SECONDS > CHUNK_SECONDS * 0.5) this.ensure(idx + 1)
    const c = this.chunks.get(idx)
    if (!c || c === 'loading' || c.frames === 0) return null
    const local = Math.max(0, (t - c.start) * c.hz)
    const f0 = Math.min(Math.floor(local), c.frames - 1)
    const f1 = Math.min(f0 + 1, c.frames - 1)
    const a = local - f0
    const n = c.players.length
    const s = c.scale
    const x = new Float32Array(n)
    const y = new Float32Array(n)
    for (let j = 0; j < n; j++) {
      const i0 = (f0 * n + j) * 2
      const i1 = (f1 * n + j) * 2
      const x0 = c.xy[i0]
      const x1 = c.xy[i1]
      const y0 = c.xy[i0 + 1]
      const y1 = c.xy[i1 + 1]
      if (x0 < 0 || x1 < 0) {
        x[j] = NaN
        y[j] = NaN
        continue
      }
      const cut = Math.hypot(x1 - x0, y1 - y0) / s > CUT_METRES
      const w = cut ? (a < 0.5 ? 0 : 1) : a
      x[j] = (x0 + (x1 - x0) * w) / s
      y[j] = (y0 + (y1 - y0) * w) / s
    }
    const b0 = f0 * 2
    const b1 = f1 * 2
    const bcut = Math.hypot(c.ball[b1] - c.ball[b0], c.ball[b1 + 1] - c.ball[b0 + 1]) / s > CUT_METRES * 1.5
    const wb = bcut ? (a < 0.5 ? 0 : 1) : a
    const ball: [number, number] = [
      (c.ball[b0] + (c.ball[b1] - c.ball[b0]) * wb) / s,
      (c.ball[b0 + 1] + (c.ball[b1 + 1] - c.ball[b0 + 1]) * wb) / s,
    ]
    const z = c.ball_z ? (c.ball_z[f0] + (c.ball_z[f1] - c.ball_z[f0]) * a) / s : 0
    const owner = c.on_ball ? c.on_ball[a < 0.5 ? f0 : f1] : -1
    return { ids: c.players, teams: c.teams, x, y, ball, ballZ: z, owner }
  }
}
