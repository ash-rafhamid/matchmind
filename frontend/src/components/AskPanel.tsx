import { useRef, useState } from 'react'
import { api } from '../api'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import type { AskResult } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

interface Turn {
  q: string
  a?: AskResult
  error?: string
}

/** Questions to the Host agent, who looks things up through the match-data tools and answers with proof. */
export default function AskPanel() {
  const { pkg } = useMatch()
  const { persona, lang, t } = useSettings()
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { home, away } = pkg.meta.teams
  const firstGoal = pkg.analytics.moments.find((m) => m.type === 'goal')
  const suggestions = [
    firstGoal ? t('ask.q1', { team: firstGoal.team_name }) : t('ask.q1b', { team: home.name }),
    t('ask.q2'),
    t('ask.q3', { team: away.name }),
    t('ask.q4'),
  ]

  const scroll = () => setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 40)
  const send = async (question: string) => {
    if (question.trim().length < 3 || busy) return
    setQ('')
    setBusy(true)
    const idx = turns.length
    setTurns((t) => [...t, { q: question }])
    scroll()
    try {
      const a = await api.ask(pkg.meta.id, question, persona, lang)
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, a } : x)))
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, error: String((e as Error).message ?? e) } : x)))
    } finally {
      setBusy(false)
      scroll()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="scroll-slim flex-1 overflow-y-auto px-5 pt-4">
        {turns.length === 0 && (
          <div>
            <div className="xp text-[26px] leading-[0.95]">
              {t('ask.title1')}
              <br />
              <span className="xp-light">{t('ask.title2')}</span>
            </div>
            <p className="mt-3 text-[14px] text-ink-3">
              {t('ask.intro')}
            </p>
            <ul className="mt-5">
              {suggestions.map((s, i) => (
                <li key={s}>
                  <button onClick={() => send(s)} className="group flex w-full items-center gap-3 border-t border-line py-3 text-left text-[14.5px] font-medium hover:bg-concrete">
                    <span className="cond w-6 text-ink-4 tab-num group-hover:text-ink">0{i + 1}</span>
                    <span className="flex-1">{s}</span>
                    <span className="pe-1 text-ink-4 transition-transform group-hover:translate-x-1 group-hover:text-ink rtl:rotate-180">→</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="wipe-up pb-6">
            <div className="flex justify-end">
              <p className="cut-l max-w-[88%] bg-ink py-2.5 ps-6 pe-4 text-[14.5px] font-medium text-white">{turn.q}</p>
            </div>
            <div className="mt-3">
              <div className="cond text-[11px] text-ink-3">{t('ask.host')} · {turn.a ? t('ask.answered') : t('ask.working')}</div>
              {turn.a ? (
                <div className="fade-in mt-1">
                  <StoryText text={turn.a.answer} />
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <VerifiedBadge verdict={turn.a.verdict} />
                    <TraceButton trace={turn.a.trace} title={turn.q} />
                  </div>
                </div>
              ) : turn.error ? (
                <p className="mt-1 text-[13px] text-flare">{turn.error}</p>
              ) : (
                <p className="working mt-1 text-[14px] text-ink-3">{t('ask.calling')}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(q)
        }}
        className="flex items-stretch gap-0 border-t border-line p-3"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ask.placeholder')} className="field" maxLength={400} aria-label="Your question for the crew" />
        <button disabled={busy || q.trim().length < 3} className="btn btn-volt shrink-0 !px-5">
          {t('ask.send')}
        </button>
      </form>
    </div>
  )
}
