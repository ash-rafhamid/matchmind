import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings'
import { speak, speechAvailable, stopSpeaking } from '../lib/speech'
import { onPrimary } from '../lib/ui'

/**
 * Broadcast graphics for studios and streamers: a 1920x1080 layer driven by the live
 * Server-Sent Events feed. `clean=1` hides the controls (OBS browser source),
 * `bg=green` gives a chroma-key background, `bg=transparent` a clear one.
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
}

interface Ticker {
  id: number
  label: string
}

const KICKER: Record<string, string> = {
  goal: 'Goal', big_chance: 'Big chance', save: 'Save', red_card: 'Sent off', tactical_change: 'Tactical switch', momentum: 'Momentum',
}

function params(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '')
}

const strip = (s: string) => s.replace(/\s*\[#\d+\]/g, '').replace(/\s+/g, ' ').trim()

export default function Studio({ matchId }: { matchId: string }) {
  const settings = useSettings()
  const p = params()
  const cleanMode = p.get('clean') === '1'
  const bg = p.get('bg') ?? 'turf'
  const [persona, setPersona] = useState(p.get('persona') ?? settings.persona)
  const [lang, setLang] = useState(p.get('lang') ?? settings.lang)
  const [speed, setSpeed] = useState(Number(p.get('speed') ?? 8))
  const [voice, setVoice] = useState(p.get('voice') === '1')
  const [running, setRunning] = useState(cleanMode)
  const [teams, setTeams] = useState<Record<'home' | 'away', TeamInfo> | null>(null)
  const [clock, setClock] = useState({ clock: "1'", score: { home: 0, away: 0 } })
  const [lower, setLower] = useState<Lower | null>(null)
  const [goalFlash, setGoalFlash] = useState<string | null>(null)
  const [ticker, setTicker] = useState<Ticker[]>([])
  const [ended, setEnded] = useState(false)
  const [copied, setCopied] = useState(false)
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
          ? `${ev.clock}  GOAL  ${ev.player} · ${ev.team_name}`
          : ev.type === 'card'
            ? `${ev.clock}  ${ev.outcome === 'yellow' ? 'Yellow' : 'Red'} card · ${ev.player}`
            : ev.type === 'substitution'
              ? `${ev.clock}  ${ev.team_name}: ${ev.on} on, ${ev.off} off`
              : ev.type === 'tactical_change'
                ? `${ev.clock}  ${ev.team_name}: ${ev.note}`
                : ev.type === 'save'
                  ? `${ev.clock}  Save · ${ev.player}`
                  : ev.type === 'period_end'
                    ? `${ev.clock}  ${ev.note}`
                    : null
      if (label) setTicker((t) => [{ id: ev.id, label }, ...t].slice(0, 5))
      if (ev.type === 'goal') {
        setGoalFlash(ev.team_name)
        setTimeout(() => setGoalFlash(null), 2800)
      }
    })
    es.addEventListener('moment', (e) => {
      const m = JSON.parse((e as MessageEvent).data)
      setLower({ id: m.id, type: m.type, clock: m.clock, title: m.title, team: m.team })
    })
    es.addEventListener('story', (e) => {
      const s = JSON.parse((e as MessageEvent).data)
      setLower((l) => (l && l.id === s.moment_id ? { ...l, text: strip(s.text), verified: s.verdict?.passed, numbers: s.verdict?.checked_numbers } : l))
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

  const obsUrl = `${window.location.origin}/#/studio/${matchId}?clean=1&bg=green&persona=${persona}&lang=${lang}&speed=${speed}${voice ? '&voice=1' : ''}`
  const background = bg === 'green' ? '#00b140' : bg === 'transparent' ? 'transparent' : 'repeating-linear-gradient(90deg, #3f7d34 0 120px, #4a8a3c 120px 240px)'

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-ink">
      {!cleanMode && (
        <div className="flex h-16 items-center gap-5 bg-ink px-5 text-white">
          <a href={`#/match/${matchId}`} className="act !text-white/70 hover:!text-white">
            ← Match
          </a>
          <span className="xp text-[18px]">
            Studio<span className="xp-light text-white/50"> / overlay</span>
          </span>
          <span className="hidden cond text-white/40 xl:inline">Live SSE feed · 1920×1080 graphics layer</span>
          <span className="ml-auto text-[14px] text-white/70">
            For{' '}
            <select value={persona} onChange={(e) => setPersona(e.target.value)} className="pick text-white" aria-label="Audience">
              {Object.entries(settings.options?.personas ?? { fan: 'Casual fan' }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>{' '}
            in{' '}
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="pick text-white" aria-label="Language">
              {Object.entries(settings.options?.languages ?? { en: 'English' }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>{' '}
            at{' '}
            <select value={speed} onChange={(e) => setSpeed(+e.target.value)} className="pick text-white" aria-label="Speed">
              {[1, 4, 8, 16, 32].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </span>
          {speechAvailable && (
            <label className="flex items-center gap-1.5 cond text-white/60">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voice
            </label>
          )}
          <button
            onClick={() => {
              navigator.clipboard?.writeText(obsUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="act !text-white/70 hover:!text-white"
            title={obsUrl}
          >
            {copied ? '✓ Copied' : 'Copy OBS URL'}
          </button>
          <button onClick={() => setRunning((r) => !r)} className="btn btn-volt">
            {running ? '■ Stop' : '● Go live'}
          </button>
        </div>
      )}

      <div className="relative mx-auto overflow-hidden" style={{ width: 1920 * scale, height: 1080 * scale }}>
        <div className="absolute top-0 left-0" style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: '0 0', background }}>
          {!running && !cleanMode && (
            <div className="absolute inset-0 grid place-items-center text-center text-white">
              <div>
                <div className="flex justify-center">
                  <span className="cut-both bg-volt px-6 py-2 cond text-[22px] text-ink">Studio overlay</span>
                </div>
                <div className="xp mt-8 text-[120px]">
                  Ready for <span className="text-volt">air.</span>
                </div>
                <p className="mt-6 text-[30px] text-white/80">Choose the audience and language, then press Go live.</p>
                <p className="mt-2 text-[24px] text-white/55">Add the OBS URL as a 1920×1080 browser source over your match feed.</p>
              </div>
            </div>
          )}

          {teams && (
            <div className="absolute top-14 left-16 flex h-[78px] items-stretch shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
              <div className="cut-l flex items-center bg-ink pr-6 pl-10">
                <span className="h-9 w-4 -skew-x-[18deg] bg-volt" />
              </div>
              <div className="flex items-center px-7 xp text-[38px]" style={{ background: teams.home.primary, color: onPrimary(teams.home) }}>
                {teams.home.short}
              </div>
              <div className="flex min-w-[170px] items-center justify-center bg-white px-7 xp text-[48px] tab-num">
                {clock.score.home}
                <span className="xp-light px-3 text-ink-4">-</span>
                {clock.score.away}
              </div>
              <div className="flex items-center px-7 xp text-[38px]" style={{ background: teams.away.primary, color: onPrimary(teams.away) }}>
                {teams.away.short}
              </div>
              <div className="cut-r flex min-w-[170px] items-center justify-center gap-4 bg-ink pr-10 pl-6 text-volt">
                {!ended && <span className="live-pip !h-4 !w-4" />}
                <span className="xp text-[34px] tab-num">{ended ? 'FT' : clock.clock}</span>
              </div>
            </div>
          )}

          {teams && (
            <div className="absolute top-16 right-16 flex items-stretch">
              <span className="cut-l flex items-center gap-3 bg-ink py-3 pr-5 pl-8 xp text-[26px] text-white">
                <span className="flex h-7 gap-1">
                  <span className="w-3 -skew-x-[18deg] bg-volt" />
                  <span className="w-3 -skew-x-[18deg] bg-white" />
                </span>
                MatchMind
              </span>
              <span className="cut-r flex items-center bg-volt pr-8 pl-4 cond text-[18px] text-ink">AI crew · fact-checked</span>
            </div>
          )}

          {goalFlash && teams && (
            <div className="absolute inset-0 grid place-items-center overflow-hidden">
              <div className="wipe absolute inset-y-[28%] -right-20 -left-20 -skew-y-3 bg-flare" />
              <div className="wipe relative text-center text-white" style={{ animationDelay: '0.12s' }}>
                <div className="xp text-[240px] leading-[0.8]">Goal</div>
                <div className="mt-6 cond text-[34px]">{goalFlash}</div>
              </div>
            </div>
          )}

          {lower && teams && (
            <div key={lower.id} className="wipe-up absolute right-16 bottom-32 left-16 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
              <div className="flex h-[70px] items-stretch">
                <span className="cut-l flex items-center px-8 xp text-[34px] tab-num" style={lower.type === 'goal' ? { background: 'var(--color-flare)', color: '#fff' } : { background: 'var(--color-ink)', color: 'var(--color-volt)' }}>
                  {lower.clock}
                </span>
                <span className="flex items-center px-6 cond text-[22px]" style={{ background: teams[lower.team].primary, color: onPrimary(teams[lower.team]) }}>
                  {KICKER[lower.type] ?? lower.type}
                </span>
                <span className="cut-r flex min-w-0 flex-1 items-center bg-white pr-12 pl-6 xp text-[32px]">
                  <span className="truncate">{lower.title}</span>
                </span>
              </div>
              <div className="bg-white px-10 pt-5 pb-6">
                <p className="text-[30px] leading-snug text-ink-2">{lower.text ?? <span className="working cond text-[24px] text-ink-3">The crew is writing</span>}</p>
                {lower.text && lower.verified && (
                  <span className="cut-both mt-4 inline-block bg-ink px-4 py-1 cond text-[18px] text-volt">✓ Fact-checked{lower.numbers ? ` · ${lower.numbers} figures` : ''}</span>
                )}
              </div>
            </div>
          )}

          {ticker.length > 0 && teams && (
            <div className="absolute inset-x-0 bottom-0 flex h-[72px] items-center gap-12 overflow-hidden bg-ink px-16 whitespace-nowrap">
              <span className="cut-both bg-flare px-5 py-1 cond text-[22px] text-white">Live</span>
              {ticker.map((t) => (
                <span key={t.id} className="fade-in text-[24px] font-semibold text-white">
                  {t.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
