import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings'
import { speak, speechAvailable, stopSpeaking } from '../lib/speech'

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
  const bg = p.get('bg') ?? 'paper'
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
  const background =
    bg === 'green' ? '#00b140' : bg === 'transparent' ? 'transparent' : '#f2eee3 repeating-linear-gradient(90deg, #ebe5d6 0 120px, #f2eee3 120px 240px)'

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-paper">
      {!cleanMode && (
        <div className="flex h-16 items-center gap-5 border-b border-ink px-5">
          <a href={`#/match/${matchId}`} className="link">
            &larr; Match
          </a>
          <span className="display text-[22px] font-semibold">
            Studio <span className="italic-wonk font-normal text-signal">overlay</span>
          </span>
          <span className="hidden label xl:inline">Live SSE feed · 1920×1080 graphics layer</span>
          <span className="ml-auto text-[15px] text-ink-2">
            For{' '}
            <select value={persona} onChange={(e) => setPersona(e.target.value)} className="inline-select" aria-label="Audience">
              {Object.entries(settings.options?.personas ?? { fan: 'Casual fan' }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.toLowerCase()}
                </option>
              ))}
            </select>{' '}
            in{' '}
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="inline-select" aria-label="Language">
              {Object.entries(settings.options?.languages ?? { en: 'English' }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>{' '}
            at{' '}
            <select value={speed} onChange={(e) => setSpeed(+e.target.value)} className="inline-select" aria-label="Speed">
              {[1, 4, 8, 16, 32].map((s) => (
                <option key={s} value={s}>
                  ×{s}
                </option>
              ))}
            </select>
          </span>
          {speechAvailable && (
            <label className="label flex items-center gap-1.5">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voice
            </label>
          )}
          <button
            onClick={() => {
              navigator.clipboard?.writeText(obsUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="link"
            title={obsUrl}
          >
            {copied ? 'Copied ✓' : 'Copy OBS URL'}
          </button>
          <button onClick={() => setRunning((r) => !r)} className="btn btn-solid">
            {running ? '■ Stop' : '● Go live'}
          </button>
        </div>
      )}

      <div className="relative mx-auto overflow-hidden" style={{ width: 1920 * scale, height: 1080 * scale }}>
        <div className="absolute top-0 left-0" style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: '0 0', background }}>
          {!running && !cleanMode && (
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="label text-[22px] text-signal">Studio overlay</div>
                <div className="display mt-4 text-[96px] leading-none font-semibold">
                  Ready for <span className="italic-wonk font-normal">air.</span>
                </div>
                <p className="mt-6 text-[30px] text-ink-2 italic">Choose the audience and language, then press Go live.</p>
                <p className="mt-2 text-[24px] text-ink-3">Add the OBS URL as a 1920×1080 browser source over your match feed.</p>
              </div>
            </div>
          )}

          {teams && (
            <div className="absolute top-14 left-16 flex items-stretch shadow-[8px_8px_0_rgba(20,19,16,0.9)]">
              <div className="flex items-center gap-4 bg-ink px-7 font-cond text-[40px] font-semibold tracking-[0.12em] text-paper">
                <span className="h-9 w-3" style={{ background: teams.home.primary }} />
                {teams.home.short}
              </div>
              <div className="display flex items-center bg-paper px-8 text-[64px] leading-none font-semibold tabular-nums">
                {clock.score.home}
                <span className="px-3 text-ink-4">–</span>
                {clock.score.away}
              </div>
              <div className="flex items-center gap-4 bg-ink px-7 font-cond text-[40px] font-semibold tracking-[0.12em] text-paper">
                {teams.away.short}
                <span className="h-9 w-3" style={{ background: teams.away.primary }} />
              </div>
              <div className="flex min-w-[170px] items-center justify-center gap-3 bg-signal px-6 num text-[34px] text-paper">
                {!ended && <span className="live-dot !h-3 !w-3 !bg-paper" />}
                {ended ? 'FT' : clock.clock}
              </div>
            </div>
          )}

          {teams && (
            <div className="absolute top-16 right-16 text-right">
              <div className="display text-[44px] leading-none font-semibold">
                Match<span className="italic-wonk font-normal text-signal">Mind</span>
              </div>
              <div className="mt-1 label text-[16px] text-ink-2">AI crew · fact-checked live</div>
            </div>
          )}

          {goalFlash && teams && (
            <div className="rise absolute inset-x-0 top-[30%] text-center">
              <div className="inline-block bg-ink px-24 py-10 shadow-[14px_14px_0_#e3361b]">
                <div className="display text-[190px] leading-[0.85] font-semibold text-paper italic-wonk">Goal.</div>
                <div className="mt-4 label text-[34px] text-paper">{goalFlash}</div>
              </div>
            </div>
          )}

          {lower && teams && (
            <div key={lower.id} className="rise absolute right-16 bottom-32 left-16 bg-paper shadow-[10px_10px_0_rgba(20,19,16,0.9)]" style={{ borderLeft: `18px solid ${teams[lower.team].primary}` }}>
              <div className="flex items-center gap-6 border-b border-ink px-10 py-5">
                <span className={`num text-[44px] font-semibold ${lower.type === 'goal' ? 'text-signal' : ''}`}>{lower.clock}</span>
                <span className={`label text-[22px] ${lower.type === 'goal' ? 'text-signal' : 'label-ink'}`}>{KICKER[lower.type] ?? lower.type}</span>
                <span className="display truncate text-[42px] font-semibold">{lower.title}</span>
                {lower.text && lower.verified && (
                  <span className="stamp stamp-in ml-auto shrink-0 text-[20px] text-proof">
                    ✓ Fact-checked{lower.numbers ? ` · ${lower.numbers}` : ''}
                  </span>
                )}
              </div>
              <div className="min-h-32 px-10 py-6 text-[32px] leading-snug text-ink-2">
                {lower.text ?? <span className="typing text-ink-3 italic">The crew is writing</span>}
              </div>
            </div>
          )}

          {ticker.length > 0 && teams && (
            <div className="absolute inset-x-0 bottom-0 flex h-[72px] items-center gap-12 overflow-hidden bg-ink px-16 whitespace-nowrap">
              <span className="bg-signal px-4 py-1 label text-[22px] text-paper">Live</span>
              {ticker.map((t) => (
                <span key={t.id} className="rise num text-[24px] text-paper">
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
