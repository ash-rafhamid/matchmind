import { useEffect, useState } from 'react'

/** Match playback clock. Lives outside React so the pitch can redraw at 60 fps without re-rendering the app. */
export class PlaybackClock {
  time = 0
  playing = false
  speed = 1
  /** True while playback is held because the data for the next moments has not arrived yet. */
  buffering = false
  /** Return false to hold the clock (like a video player buffering) until data for time t is ready. */
  waitFor: ((t: number) => boolean) | null = null
  readonly duration: number
  private listeners = new Set<() => void>()
  private last = 0
  private raf = 0
  private stopAt: number | null = null

  constructor(duration: number) {
    this.duration = duration
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  private tick = (now: number) => {
    if (!this.playing) return
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const next = Math.min(this.duration, this.time + dt * this.speed)
    const ready = !this.waitFor || this.waitFor(next)
    if (ready !== !this.buffering) {
      this.buffering = !ready
      this.emit()
    }
    if (!ready) {
      this.raf = requestAnimationFrame(this.tick)
      return
    }
    this.time = next
    if (this.stopAt !== null && this.time >= this.stopAt) {
      this.time = this.stopAt
      this.stopAt = null
      this.playing = false
    }
    if (this.time >= this.duration) this.playing = false
    this.emit()
    if (this.playing) this.raf = requestAnimationFrame(this.tick)
  }

  play() {
    if (this.playing) return
    if (this.time >= this.duration) this.time = 0
    this.playing = true
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
    this.emit()
  }

  pause() {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(this.duration, t))
    this.emit()
  }

  setSpeed(s: number) {
    this.speed = s
    this.emit()
  }

  /** Play a window at a given speed, then pause - used for "replay this moment". */
  replay(from: number, to: number, speed = 1) {
    this.seek(from)
    this.speed = speed
    this.stopAt = to
    this.pause()
    this.play()
  }

  destroy() {
    this.pause()
    this.listeners.clear()
  }
}

/** Subscribe to the clock, re-rendering at most `fps` times per second. */
export function useClock(clock: PlaybackClock, fps = 8) {
  const [snap, setSnap] = useState({ time: clock.time, playing: clock.playing, speed: clock.speed })
  useEffect(() => {
    let last = 0
    let timer: number | undefined
    const update = () => setSnap({ time: clock.time, playing: clock.playing, speed: clock.speed })
    const unsub = clock.subscribe(() => {
      const now = performance.now()
      if (now - last >= 1000 / fps || !clock.playing) {
        last = now
        update()
      } else if (timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined
          last = performance.now()
          update()
        }, 1000 / fps)
      }
    })
    return () => {
      unsub()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [clock, fps])
  return snap
}

export function formatClock(ts: number, firstHalf: number): string {
  if (ts < firstHalf) {
    const m = Math.floor(ts / 60)
    return m >= 45 ? `45+${m - 44}'` : `${m + 1}'`
  }
  const m = Math.floor((ts - firstHalf) / 60)
  return m >= 45 ? `90+${m - 44}'` : `${m + 46}'`
}
