import { api, type TrackingChunk } from '../api'

const CHUNK_SECONDS = 60

export interface Frame {
  ids: string[]
  teams: string[]
  /** metres; NaN when the player is not on the pitch */
  x: Float32Array
  y: Float32Array
  ball: [number, number]
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

  frameAt(t: number): Frame | null {
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
    const x = new Float32Array(n)
    const y = new Float32Array(n)
    for (let j = 0; j < n; j++) {
      const i0 = (f0 * n + j) * 2
      const i1 = (f1 * n + j) * 2
      const x0 = c.xy[i0]
      const x1 = c.xy[i1]
      if (x0 < 0 || x1 < 0) {
        x[j] = NaN
        y[j] = NaN
        continue
      }
      x[j] = (x0 + (x1 - x0) * a) / c.scale
      y[j] = (c.xy[i0 + 1] + (c.xy[i1 + 1] - c.xy[i0 + 1]) * a) / c.scale
    }
    const b0 = f0 * 2
    const b1 = f1 * 2
    const ball: [number, number] = [
      (c.ball[b0] + (c.ball[b1] - c.ball[b0]) * a) / c.scale,
      (c.ball[b0 + 1] + (c.ball[b1 + 1] - c.ball[b0 + 1]) * a) / c.scale,
    ]
    return { ids: c.players, teams: c.teams, x, y, ball }
  }
}
