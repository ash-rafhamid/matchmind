import { Bot, Languages, UserRound } from 'lucide-react'
import { useSettings } from '../lib/settings'

export default function Header({ onHome }: { onHome: () => void }) {
  const { persona, lang, setPersona, setLang, options, health } = useSettings()
  const ai = health?.ai
  return (
    <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <button onClick={onHome} className="group flex items-center gap-2.5 text-left">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="font-display text-2xl leading-none font-semibold tracking-wide">
              Match<span className="text-mint-400">Mind</span>
            </div>
            <div className="text-[11px] text-ink-400">The AI match crew that explains why - and simulates what if</div>
          </div>
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            title={ai?.enabled ? `Agents run on ${ai.provider} (${ai.model})` : 'No model configured - verified template narration'}
            className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs sm:flex ${
              ai?.enabled ? 'border-mint-500/40 bg-mint-500/10 text-mint-400' : 'border-amber-400/40 bg-amber-400/10 text-amber-400'
            }`}
          >
            <Bot size={14} />
            {ai ? (ai.enabled ? `${ai.provider} · ${ai.model}` : 'Template mode') : '...'}
          </span>
          <label className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-3 py-1 text-xs">
            <UserRound size={14} className="text-ink-400" />
            <select value={persona} onChange={(e) => setPersona(e.target.value)} className="bg-transparent outline-none" aria-label="Audience">
              {Object.entries(options?.personas ?? { fan: 'Casual fan' }).map(([k, v]) => (
                <option key={k} value={k} className="bg-ink-900">
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-3 py-1 text-xs">
            <Languages size={14} className="text-ink-400" />
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="bg-transparent outline-none" aria-label="Language">
              {Object.entries(options?.languages ?? { en: 'English' }).map(([k, v]) => (
                <option key={k} value={k} className="bg-ink-900">
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </header>
  )
}
