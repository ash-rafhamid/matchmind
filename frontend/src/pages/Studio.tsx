import { CheckCircle2, CircleDot, Copy, Play, Radio, Settings2, Square, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings'
import { speak, speechAvailable, stopSpeaking } from '../lib/speech'

/**
 * Broadcast overlay for studios and streamers: a 1920x1080 graphics layer driven by the live
 * Server-Sent Events feed. Add `clean=1` for an OBS browser source (no controls), `bg=green`
 * for chroma key.
 */

interface TeamInfo {
  name: string
  short: string
  primary: string
  secondary: string
}

interface Lower {
  id: string
  type: string
  clock: string
  title: string
  team: 'home' | 'away'
  text?: string
  verified?: boolean
  numbers?: number
  mode?: string
}

interface Ticker {
  id: number
  label: string
}

function params(): URLSearchParams {
  const q = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(q)
}

const clean = (s: string) => s.replace(/\[#\d+\]/g, '').replace(/\s+/g, ' ').trim()

export default function Studio({ matchId }: { matchId: string }) {
  const settings = useSettings()
  const p = params()
  const cleanMode = p.get('clean') === '1'
  const bg = p.get('bg') ?? 'dark'
  const [persona, setPersona] = useState(p.get('persona') ?? settings.persona)
  const [lang, setLang] = useState(p.get('lang') ?? settings.lang)
  const [speed, setSpeed] = useState(Number(p.get('speed') ?? 8))
  const [voice, setVoice] = useState(p.get('voice') === '1')
  const [running, setRunning] = useState(cleanMode)
  const [teams, setTeams] = useState<Record<'home' | 'away', TeamInfo> | null>(null)
  const [clock, setClock] = useState({ clock: "0'", score: { home: 0, away: 0 } })
  const [lower, setLower] = useState<Lower | null>(null)
  const [goalFlash, setGoalFlash] = useState<string | null>(null)
  const [ticker, setTicker] = useState<Ticker[]>([])
  const [ended, setEnded] = useState(false)
  const [scale, setScale] = useState(1)
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, (window.innerHeight - (cleanMode ? 0 : 64)) / 1080))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [cleanMode])

  useEffect(() => {
    if (!running) return
    setEnded(false)
    setLower(null)
    setTicker([])
    const es = new EventSource(`/api/matches/${matchId}/live?persona=${persona}&lang=${lang}&speed=${speed}`)
    es.addEventListener('meta', (e) => setTeams(JSON.parse((e as MessageEvent).data).teams))
    es.addEventListener('clock', (e) => setClock(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('event', (e) => {
      const ev = JSON.parse((e as MessageEvent).data)
      const label =
        ev.type === 'goal'
          ? `${ev.clock} GOAL ${ev.player} (${ev.team_name})`
          : ev.type === 'card'
            ? `${ev.clock} ${ev.outcome === 'yellow' ? 'Yellow' : 'Red'} card - ${ev.player}`
            : ev.type === 'substitution'
              ? `${ev.clock} ${ev.team_name}: ${ev.on} on for ${ev.off}`
              : ev.type === 'tactical_change'
                ? `${ev.clock} ${ev.team_name}: ${ev.note}`
                : ev.type === 'save'
                  ? `${ev.clock} Save by ${ev.player}`
                  : ev.type === 'period_end'
                    ? `${ev.clock} ${ev.note}`
                    : null
      if (label) setTicker((t) => [{ id: ev.id, label }, ...t].slice(0, 6))
      if (ev.type === 'goal') {
        setGoalFlash(ev.team_name)
        setTimeout(() => setGoalFlash(null), 2600)
      }
    })
    es.addEventListener('moment', (e) => {
      const m = JSON.parse((e as MessageEvent).data)
      setLower({ id: m.id, type: m.type, clock: m.clock, title: m.title, team: m.team })
    })
    es.addEventListener('story', (e) => {
      const s = JSON.parse((e as MessageEvent).data)
      setLower((l) =>
        l && l.id === s.moment_id
          ? { ...l, text: clean(s.text), verified: s.verdict?.passed, numbers: s.verdict?.checked_numbers, mode: s.mode }
          : l,
      )
      if (voiceRef.current) speak(s.text, lang)
    })
    es.addEventListener('end', () => {
      setEnded(true)
      es.close()
    })
    es.onerror = () => es.close()
    return () => {
      es.close()
      stopSpeaking()
    }
  }, [running, matchId, persona, lang, speed])

  const color = (t: TeamInfo) => (t.primary.toLowerCase() === '#1d1d1d' ? t.secondary : t.primary)
  const obsUrl = `${window.location.origin}/#/studio/${matchId}?clean=1&bg=green&persona=${persona}&lang=${lang}&speed=${speed}${voice ? '&voice=1' : ''}`
  const background = bg === 'green' ? '#00b140' : bg === 'transparent' ? 'transparent' : 'radial-gradient(circle at 30% 20%, #16244d, #070b16 70%)'

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-ink-950">
      {!cleanMode && (
        <div className="flex h-16 items-center gap-3 border-b border-ink-700 bg-ink-900 px-4 text-sm">
          <Radio size={16} className="text-rose-400" />
          <span className="font-display text-lg font-semibold">Studio overlay</span>
          <span className="hidden text-xs text-ink-400 lg:inline">Live SSE feed · graphics layer for OBS / broadcast</span>
          <select value={persona} onChange={(e) => setPersona(e.target.value)} className="ml-auto rounded-lg border border-ink-700 bg-ink-850 px-2 py-1" aria-label="Audience">
            {Object.entries(settings.options?.personas ?? { fan: 'Casual fan' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-850 px-2 py-1" aria-label="Language">
            {Object.entries(settings.options?.languages ?? { en: 'English' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} className="rounded-lg border border-ink-700 bg-ink-850 px-2 py-1" aria-label="Speed">
            {[1, 4, 8, 16, 32].map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
          {speechAvailable && (
            <button onClick={() => setVoice((v) => !v)} className="rounded-lg border border-ink-700 p-1.5" title="Read insights aloud" aria-label="Toggle voice">
              {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          )}
          <button onClick={() => navigator.clipboard?.writeText(obsUrl)} className="flex items-center gap-1 rounded-lg border border-ink-700 px-2 py-1" title={obsUrl}>
            <Copy size={14} /> OBS URL
          </button>
          <button onClick={() => setRunning((r) => !r)} className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 font-semibold text-ink-950">
            {running ? <Square size={14} /> : <Play size={14} />} {running ? 'Stop' : 'Go live'}
          </button>
        </div>
      )}

      <div className="relative mx-auto overflow-hidden" style={{ width: 1920 * scale, height: 1080 * scale }}>
      <div
        className="absolute top-0 left-0"
        style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: '0 0', background }}
      >
        {!running && !cleanMode && (
          <div className="absolute inset-0 grid place-items-center text-center text-ink-300">
            <div>
              <Settings2 size={48} className="mx-auto mb-4 text-mint-400" />
              <div className="font-display text-5xl font-semibold text-ink-100">Studio overlay</div>
              <p className="mt-3 text-2xl">Pick audience and language, then press <b>Go live</b>.</p>
              <p className="mt-2 text-xl text-ink-400">Use the OBS URL as a browser source (1920x1080) over your match feed.</p>
            </div>
          </div>
        )}

        {teams && (
          <div className="absolute top-12 left-14 flex items-stretch overflow-hidden rounded-xl font-display text-[44px] font-semibold shadow-2xl">
            <div className="flex items-center px-6" style={{ background: teams.home.primary, color: teams.home.secondary }}>{teams.home.short}</div>
            <div className="flex items-center bg-[#0b1020] px-7 text-white tabular-nums">{clock.score.home} - {clock.score.away}</div>
            <div className="flex items-center px-6" style={{ background: teams.away.primary, color: teams.away.secondary }}>{teams.away.short}</div>
            <div className="flex min-w-36 items-center justify-center gap-3 bg-[#131c33] px-6 text-[#2ee6a6] tabular-nums">
              {!ended && <span className="live-dot h-4 w-4 rounded-full bg-rose-500" />}
              {ended ? 'FT' : clock.clock}
            </div>
          </div>
        )}

        {teams && (
          <div className="absolute top-14 right-14 flex items-center gap-3 rounded-full bg-black/55 px-6 py-3 text-2xl text-white backdrop-blur">
            <img src="/favicon.svg" alt="" className="h-9 w-9" /> Match<span className="-ml-3 text-[#2ee6a6]">Mind</span> AI crew
          </div>
        )}

        {goalFlash && teams && (
          <div className="animate-rise absolute inset-x-0 top-[38%] text-center">
            <div className="inline-block rounded-3xl bg-black/70 px-20 py-8 backdrop-blur">
              <div className="font-display text-[150px] leading-none font-bold tracking-wider text-white">GOAL</div>
              <div className="mt-2 font-display text-5xl text-[#2ee6a6]">{goalFlash}</div>
            </div>
          </div>
        )}

        {lower && teams && (
          <div key={lower.id} className="animate-rise absolute right-14 bottom-28 left-14 overflow-hidden rounded-2xl bg-[#0b1020]/90 shadow-2xl backdrop-blur" style={{ borderLeft: `14px solid ${color(teams[lower.team])}` }}>
            <div className="flex items-center gap-4 bg-white/5 px-8 py-4">
              <CircleDot size={36} className="text-[#2ee6a6]" />
              <span className="font-display text-4xl font-semibold text-[#2ee6a6] tabular-nums">{lower.clock}</span>
              <span className="font-display text-4xl font-semibold text-white">{lower.title}</span>
              {lower.text && lower.verified && (
                <span className="ml-auto flex items-center gap-2 rounded-full bg-[#14c98a]/20 px-4 py-1.5 text-xl text-[#2ee6a6]">
                  <CheckCircle2 size={22} /> Fact-checked{lower.numbers ? ` · ${lower.numbers} numbers` : ''}
                </span>
              )}
            </div>
            <div className="min-h-28 px-8 py-5 text-[30px] leading-snug text-[#e7ecfb]">
              {lower.text ?? <span className="text-[#7f90b8]">The crew is analysing this moment...</span>}
            </div>
          </div>
        )}

        {ticker.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 flex h-16 items-center gap-10 overflow-hidden bg-black/75 px-14 text-2xl whitespace-nowrap text-white">
            <span className="rounded bg-[#2ee6a6] px-3 py-0.5 font-display text-xl font-semibold text-black">LIVE</span>
            {ticker.map((t) => (
              <span key={t.id} className="animate-rise">{t.label}</span>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
