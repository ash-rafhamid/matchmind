import { useSettings } from '../lib/settings'

/** The slim broadcast bar: wordmark, who you are reading as, and which model is on air. */
export default function Header() {
  const { persona, lang, setPersona, setLang, options, health } = useSettings()
  const ai = health?.ai
  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center gap-4 bg-ink px-4 text-white sm:px-6">
      <a href="#/" className="flex items-center gap-2.5" aria-label="MatchMind home">
        <span className="flex h-6 items-stretch gap-[3px]" aria-hidden>
          <span className="w-2.5 -skew-x-[18deg] bg-volt" />
          <span className="w-2.5 -skew-x-[18deg] bg-white" />
        </span>
        <span className="xp text-[19px]">MatchMind</span>
      </a>
      <span className="hidden cond text-white/45 lg:inline">The AI match crew · fact-checked by code</span>
      <div className="ml-auto flex items-center gap-5 text-[13px]">
        <span className="hidden items-center gap-2 cond text-white/60 md:flex" title={ai?.enabled ? `Agents run on ${ai.provider}` : 'No model configured: verified template narration'}>
          <span className={ai?.enabled ? 'live-pip !bg-volt' : 'inline-block h-2 w-2 bg-white/30'} />
          {ai ? (ai.enabled ? `${ai.model} on ${ai.provider.replace(' (Foundry)', '')}` : 'template mode') : '...'}
        </span>
        <span className="text-white/70">
          For{' '}
          <select value={persona} onChange={(e) => setPersona(e.target.value)} className="pick text-white" aria-label="Audience">
            {Object.entries(options?.personas ?? { fan: 'Casual fan' }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>{' '}
          in{' '}
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="pick text-white" aria-label="Language">
            {Object.entries(options?.languages ?? { en: 'English' }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </span>
      </div>
    </header>
  )
}
