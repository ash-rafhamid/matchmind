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

/** Questions to the Host agent, set as an interview: the question as a pull quote, the answer as copy. */
export default function AskPanel() {
  const { pkg } = useMatch()
  const { persona, lang } = useSettings()
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { home, away } = pkg.meta.teams
  const firstGoal = pkg.analytics.moments.find((m) => m.type === 'goal')
  const suggestions = [
    firstGoal ? `Why did ${firstGoal.team_name} score the first goal?` : `How did ${home.name} try to create chances?`,
    'Who was the best player, and why?',
    `What if ${away.name} had pressed much higher from the 60th minute?`,
    'Who ran the most, and who was the fastest?',
  ]

  const send = async (question: string) => {
    if (question.trim().length < 3 || busy) return
    setQ('')
    setBusy(true)
    const idx = turns.length
    setTurns((t) => [...t, { q: question }])
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 30)
    try {
      const a = await api.ask(pkg.meta.id, question, persona, lang)
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, a } : x)))
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, error: String((e as Error).message ?? e) } : x)))
    } finally {
      setBusy(false)
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 60)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="scroll-ink -mr-3 flex-1 overflow-y-auto pr-3">
        {turns.length === 0 && (
          <div>
            <p className="display text-[24px] leading-snug">
              Put a question to the <span className="italic-wonk">crew.</span>
            </p>
            <p className="mt-2 text-[15px] text-ink-3">
              The Host agent looks things up through the match-data tools (MCP), consults the Tactician, can run what-if
              simulations, and its answer is fact-checked like everything else.
            </p>
            <ul className="mt-5 border-t border-ink">
              {suggestions.map((s) => (
                <li key={s} className="border-b border-rule">
                  <button onClick={() => send(s)} className="group flex w-full items-baseline gap-3 py-3 text-left text-[16px] hover:text-signal">
                    <span className="num text-[12px] text-signal">Q.</span>
                    <span className="flex-1 italic">{s}</span>
                    <span className="text-ink-4 transition-transform group-hover:translate-x-1 group-hover:text-signal">&rarr;</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="rise border-b border-rule py-5 first:pt-0">
            <blockquote className="relative pl-7">
              <span className="display absolute -top-2 left-0 text-[44px] leading-none text-signal" aria-hidden>
                &ldquo;
              </span>
              <p className="display text-[20px] leading-snug italic-wonk">{t.q}</p>
            </blockquote>
            <div className="mt-3 pl-7">
              {t.a ? (
                <div className="ink-in">
                  <StoryText text={t.a.answer} />
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <VerifiedBadge verdict={t.a.verdict} />
                    <TraceButton trace={t.a.trace} title={t.q} />
                  </div>
                </div>
              ) : t.error ? (
                <p className="text-[14px] text-signal">{t.error}</p>
              ) : (
                <p className="typing text-[15px] text-ink-3 italic">The Host is looking it up</p>
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
        className="mt-3 flex items-end gap-3 border-t border-ink pt-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Why did..., Who..., What if..."
          className="field text-[17px]"
          maxLength={400}
          aria-label="Your question for the crew"
        />
        <button disabled={busy || q.trim().length < 3} className="btn btn-solid shrink-0">
          Ask &rarr;
        </button>
      </form>
    </div>
  )
}
