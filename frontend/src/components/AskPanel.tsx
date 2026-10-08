import { Loader2, Send } from 'lucide-react'
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
    'Who ran the most, and who was fastest?',
    `What if ${away.name} had pressed much higher from the 60th minute?`,
    `Which team controlled the second half, and why?`,
  ]

  const send = async (question: string) => {
    if (!question.trim() || busy) return
    setQ('')
    setBusy(true)
    const idx = turns.length
    setTurns((t) => [...t, { q: question }])
    try {
      const a = await api.ask(pkg.meta.id, question, persona, lang)
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, a } : x)))
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, error: String((e as Error).message ?? e) } : x)))
    } finally {
      setBusy(false)
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="scroll-thin -mr-2 flex-1 space-y-3 overflow-y-auto pr-2">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-ink-300">
              Ask the crew anything about this match. The Host agent pulls numbers through MCP tools, consults the
              Tactician, can run what-if simulations - and the fact-checker verifies the answer.
            </p>
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="block w-full rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2 text-left text-sm hover:border-mint-500/50">
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-8 rounded-xl rounded-br-sm bg-ink-700 px-3 py-2 text-sm">{t.q}</div>
            <div className="mr-4 rounded-xl rounded-bl-sm border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm">
              {t.a ? (
                <>
                  <StoryText text={t.a.answer} />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <VerifiedBadge verdict={t.a.verdict} />
                    <TraceButton trace={t.a.trace} title={t.q} />
                  </div>
                </>
              ) : t.error ? (
                <span className="text-rose-400">{t.error}</span>
              ) : (
                <span className="flex items-center gap-2 text-ink-400">
                  <Loader2 size={14} className="animate-spin" /> Host is calling tools...
                </span>
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
        className="mt-3 flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-1.5"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Why did..., Who..., What if..."
          className="flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-ink-400"
          maxLength={400}
          aria-label="Question for the crew"
        />
        <button disabled={busy || q.trim().length < 3} className="rounded-lg bg-mint-500 p-2 text-ink-950 disabled:opacity-40" aria-label="Send">
          <Send size={15} />
        </button>
      </form>
    </div>
  )
}
