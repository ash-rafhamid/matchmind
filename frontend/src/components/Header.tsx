import { useSettings } from '../lib/settings'

/** The masthead: wordmark, edition line, and the reader's audience + language as a sentence. */
export default function Header({ onHome }: { onHome: () => void }) {
  const { persona, lang, setPersona, setLang, options, health } = useSettings()
  const ai = health?.ai
  return (
    <header className="mx-auto w-full max-w-[1480px] px-4 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-rule py-2 num text-[11px] tracking-wide text-ink-3 uppercase">
        <span>Vol. I · Northbridge League · Every club, player and match is synthetic</span>
        <span className="flex items-center gap-2" title={ai?.enabled ? `Agents run on ${ai.provider}` : 'No model configured - verified template narration'}>
          <span className={ai?.enabled ? 'live-dot' : 'inline-block h-[7px] w-[7px] rounded-full bg-ink-4'} />
          {ai ? (ai.enabled ? `Crew on duty · ${ai.provider} · ${ai.model}` : 'Template edition · no model') : 'Checking the crew'}
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-5 pb-4">
        <button onClick={onHome} className="group text-left" aria-label="MatchMind home">
          <div className="display text-[44px] leading-[0.9] font-semibold sm:text-[56px]">
            Match<span className="italic-wonk font-normal text-signal">Mind</span>
          </div>
          <div className="mt-2 label">The match, explained by an AI crew · fact-checked by code</div>
        </button>

        <div className="text-[17px] text-ink-2 sm:text-[19px]">
          Reading as{' '}
          <select value={persona} onChange={(e) => setPersona(e.target.value)} className="inline-select" aria-label="Audience">
            {Object.entries(options?.personas ?? { fan: 'Casual fan' }).map(([k, v]) => (
              <option key={k} value={k}>
                {v.toLowerCase()}
              </option>
            ))}
          </select>{' '}
          in{' '}
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="inline-select" aria-label="Language">
            {Object.entries(options?.languages ?? { en: 'English' }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="double-rule" />
    </header>
  )
}
