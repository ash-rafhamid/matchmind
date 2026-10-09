/*
 * Stadium atmosphere, synthesised live with WebAudio (no recordings, nothing to license):
 * a crowd bed that rises as the ball nears a goal, an "ooh" on shots, a roar on goals,
 * the referee's whistle, and the thud of the ball on strikes.
 */

export class Atmosphere {
  private ctx: AudioContext
  private master: GainNode
  private bed: GainNode
  private bedFilter: BiquadFilterNode
  private noise: AudioBuffer
  private level = 0.25

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.0001
    this.master.connect(this.ctx.destination)
    this.master.gain.exponentialRampToValueAtTime(0.9, this.ctx.currentTime + 1.2)

    this.noise = this.makeNoise(4)
    // crowd bed: brown-ish noise through two vocal-range band-passes, slowly breathing
    const src = this.loop()
    this.bedFilter = this.ctx.createBiquadFilter()
    this.bedFilter.type = 'bandpass'
    this.bedFilter.frequency.value = 520
    this.bedFilter.Q.value = 0.7
    const hi = this.ctx.createBiquadFilter()
    hi.type = 'peaking'
    hi.frequency.value = 1400
    hi.gain.value = 4
    this.bed = this.ctx.createGain()
    this.bed.gain.value = this.level
    const lfo = this.ctx.createOscillator()
    const lfoGain = this.ctx.createGain()
    lfo.frequency.value = 0.13
    lfoGain.gain.value = 0.05
    lfo.connect(lfoGain).connect(this.bed.gain)
    lfo.start()
    src.connect(this.bedFilter).connect(hi).connect(this.bed).connect(this.master)
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = this.ctx.sampleRate * seconds
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        last = (last + 0.04 * w) / 1.04 // brown noise: warm, like thousands of distant voices
        d[i] = last * 3.2 + w * 0.08
      }
    }
    return buf
  }

  private loop(): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    s.loopStart = Math.random()
    s.start()
    return s
  }

  /** 0 (ball in midfield) .. 1 (ball in the box): the crowd rises with the danger. */
  setTension(x: number) {
    const target = 0.2 + 0.28 * Math.max(0, Math.min(1, x))
    this.level += (target - this.level) * 0.15
    const t = this.ctx.currentTime
    this.bed.gain.setTargetAtTime(this.level, t, 0.6)
    this.bedFilter.frequency.setTargetAtTime(480 + 260 * x, t, 0.8)
  }

  /** A swell of voices: small for a half-chance, huge for a goal. */
  swell(size: number, seconds: number) {
    const t = this.ctx.currentTime
    const src = this.loop()
    const f = this.ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(600, t)
    f.frequency.linearRampToValueAtTime(900 + 500 * size, t + 0.4)
    f.Q.value = 0.9
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.25 + 0.9 * size, t + 0.25 + 0.2 * size)
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    src.connect(f).connect(g).connect(this.master)
    src.stop(t + seconds + 0.1)
  }

  /** The referee's pea whistle: two close tones with a fast warble. */
  whistle(long = false) {
    const t = this.ctx.currentTime
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
    const end = t + (long ? 0.9 : 0.35)
    g.gain.setValueAtTime(0.18, end - 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, end)
    const trem = this.ctx.createOscillator()
    const tg = this.ctx.createGain()
    trem.frequency.value = 32
    tg.gain.value = 0.08
    trem.connect(tg).connect(g.gain)
    for (const hz of [2750, 2890]) {
      const o = this.ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz
      o.connect(g)
      o.start(t)
      o.stop(end)
    }
    trem.start(t)
    trem.stop(end)
    g.connect(this.master)
  }

  /** The ball being struck: a short, low thud. */
  thud(power = 0.5) {
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12 + 0.25 * power, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 0.16)
  }

  close() {
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(0.0001, t, 0.15)
    window.setTimeout(() => this.ctx.close(), 600)
  }
}
