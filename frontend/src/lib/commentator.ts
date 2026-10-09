import { api } from '../api'
import type { CommentaryLine } from '../types'
import type { PlaybackClock } from './clock'
import { speak as browserSpeak, speechAvailable, stopSpeaking } from './speech'

const SILENT = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA=='
const AHEAD = 22 // seconds of calls fetched ahead of the playhead

/**
 * The match commentator. Follows the playhead, picks the call that matters most when several happen at once,
 * and says it in an Azure AI Speech neural voice (the browser's own voice if that is unavailable).
 * Big moments are followed by the crew's verified analysis, read out.
 */
export class Commentator {
  private matchId: string
  private lang: string
  private clock: PlaybackClock
  private lines: CommentaryLine[] = []
  private serverVoice = false
  private audio = new Audio()
  private urls = new Map<string, Promise<string | null>>()
  private last = -1
  private sayingPrio = -1
  private sayingId = ''
  private lastSpoke = 0
  private pausedByClock = false
  private story: string | null = null
  private loading = 0
  private unsub: () => void
  private disposed = false
  enabled = true
  replaying = false
  onDuck: ((on: boolean) => void) | null = null

  constructor(matchId: string, lang: string, clock: PlaybackClock) {
    this.matchId = matchId
    this.lang = lang
    this.clock = clock
    this.audio.preload = 'auto'
    this.audio.onended = () => this.finished()
    this.audio.onerror = () => this.finished()
    api
      .commentary(matchId, lang)
      .then((r) => {
        this.lines = r.lines
        this.serverVoice = r.voice
      })
      .catch(() => undefined)
    this.unsub = clock.subscribe(this.tick)
  }

  /** Call from a click (Play): lets the page play sound later. */
  unlock() {
    if (this.audio.src) return
    this.audio.src = SILENT
    this.audio.play().catch(() => undefined)
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!on) this.hush()
  }

  /** The crew's take on a moment, read after the call that is being made now. */
  moment(momentId: string, persona: string) {
    if (!this.enabled || !this.serverVoice) return
    this.story = `/api/matches/${this.matchId}/moments/${momentId}/voice.mp3?persona=${persona}&lang=${this.lang}`
    const url = this.story
    // fetch now, so it is ready when the call ends
    this.urls.set(url, this.fetchAudio(url))
    if (!this.playing()) this.playStory()
  }

  dispose() {
    this.disposed = true
    this.unsub()
    this.hush()
    for (const p of this.urls.values()) void p.then((u) => u && URL.revokeObjectURL(u))
    this.urls.clear()
  }

  // ------------------------------------------------------------------ internals

  private playing(): boolean {
    return (!this.audio.paused && !this.audio.ended && this.audio.src !== SILENT) || this.pausedByClock
  }

  private hush() {
    this.audio.pause()
    this.pausedByClock = false
    this.sayingPrio = -1
    this.story = null
    if (speechAvailable) stopSpeaking()
    this.onDuck?.(false)
  }

  private tick = () => {
    if (this.disposed) return
    const c = this.clock
    const t = c.time
    const prev = this.last
    this.last = t
    // pause the voice with the match, and pick up again when it plays
    if (!c.playing) {
      if (!this.audio.paused) {
        this.audio.pause()
        this.pausedByClock = true
      }
      return
    }
    if (this.pausedByClock) {
      this.pausedByClock = false
      void this.audio.play().catch(() => undefined)
    }
    if (!this.enabled || this.replaying || c.speed > 2.01) return
    if (prev < 0 || t < prev || t - prev > 2) return // a jump: nothing to say about what was skipped
    this.prefetch(t)
    let best: CommentaryLine | null = null
    for (let i = this.firstAfter(prev); i < this.lines.length && this.lines[i].ts <= t; i++) {
      const l = this.lines[i]
      if (!best || l.prio > best.prio) best = l
    }
    if (!best) return
    const busy = this.playing()
    if (busy) {
      if (best.prio >= 3 && best.prio > this.sayingPrio) this.say(best)
      return
    }
    const quiet = performance.now() - this.lastSpoke
    if (best.prio >= 1 || quiet > 6000) this.say(best)
  }

  private firstAfter(t: number): number {
    let lo = 0
    let hi = this.lines.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.lines[mid].ts <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private lineUrl(l: CommentaryLine): string {
    return `/api/matches/${this.matchId}/commentary/${l.id}.mp3?lang=${this.lang}`
  }

  private prefetch(t: number) {
    if (!this.serverVoice) return
    for (let i = this.firstAfter(t); i < this.lines.length && this.lines[i].ts < t + AHEAD && this.loading < 3; i++) {
      const l = this.lines[i]
      if (l.prio < 1 && l.ts > t + 8) continue // fillers only just in time
      const url = this.lineUrl(l)
      if (this.urls.has(url)) continue
      this.urls.set(url, this.fetchAudio(url))
    }
    // keep memory small: forget calls well behind the playhead
    if (this.urls.size > 120) {
      for (const [k, v] of this.urls) {
        if (this.urls.size <= 80) break
        this.urls.delete(k)
        void v.then((u) => u && URL.revokeObjectURL(u))
      }
    }
  }

  private async fetchAudio(url: string): Promise<string | null> {
    this.loading++
    try {
      const r = await fetch(url)
      if (!r.ok) return null
      return URL.createObjectURL(await r.blob())
    } catch {
      return null
    } finally {
      this.loading--
    }
  }

  private say(l: CommentaryLine) {
    this.sayingPrio = l.prio
    this.sayingId = l.id
    this.lastSpoke = performance.now()
    if (!this.serverVoice) {
      this.browser(l.text)
      return
    }
    const url = this.lineUrl(l)
    let p = this.urls.get(url)
    if (!p) {
      p = this.fetchAudio(url)
      this.urls.set(url, p)
    }
    const asked = performance.now()
    void p.then((blob) => {
      if (this.disposed || this.sayingId !== l.id || !this.enabled) return
      if (!blob) return this.browser(l.text)
      if (performance.now() - asked > 1500 && l.prio < 4) return // too late to say it now
      this.play(blob)
    })
  }

  private play(src: string) {
    this.audio.src = src
    this.audio.currentTime = 0
    this.onDuck?.(true)
    void this.audio.play().catch(() => this.finished())
  }

  private browser(text: string) {
    if (!speechAvailable) return
    this.onDuck?.(true)
    browserSpeak(text, this.lang, () => this.finished())
  }

  private finished() {
    this.sayingPrio = -1
    if (this.story && this.enabled) {
      this.playStory()
      return
    }
    this.onDuck?.(false)
  }

  private playStory() {
    const url = this.story
    if (!url) return
    this.story = null
    const p = this.urls.get(url) ?? this.fetchAudio(url)
    this.sayingPrio = 2.5
    this.sayingId = url
    void p.then((blob) => {
      if (!blob || this.disposed || !this.enabled || this.sayingId !== url) return
      this.play(blob)
    })
  }
}
