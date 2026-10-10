import { useEffect, useRef, useState } from 'react'
import { NATIVE, useSettings } from '../lib/settings'

const PERSONAS = ['fan', 'analyst', 'kid', 'coach', 'audio']

/** The slim broadcast bar: wordmark, the model on air, and one clear button for language and audience. */
export default function Header() {
  const { persona, lang, setPersona, setLang, options, health, t } = useSettings()
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const ai = health?.ai
  const langs = Object.keys(options?.languages ?? NATIVE)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center gap-4 bg-ink px-4 text-white sm:px-6">
      <a href="#/" className="flex items-center gap-2.5" aria-label="MatchMind home">
        <span className="flex h-6 items-stretch gap-[3px]" aria-hidden>
          <span className="w-2.5 -skew-x-[18deg] bg-volt" />
          <span className="w-2.5 -skew-x-[18deg] bg-white" />
        </span>
        <span className="xp text-[19px]">MatchMind</span>
      </a>
      <span className="hidden cond text-white/45 lg:inline">{t('app.tagline')}</span>
      <div className="ms-auto flex items-center gap-4">
        <span className="hidden items-center gap-2 cond text-white/55 md:flex">
          <span className={ai?.enabled ? 'live-pip !bg-volt' : 'inline-block h-2 w-2 bg-white/30'} />
          {ai ? (ai.enabled ? `${ai.model} · Microsoft Foundry` : 'template mode') : '...'}
        </span>
        <div className="relative" ref={panel}>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="cut-both flex items-center gap-2 whitespace-nowrap bg-white/10 py-1.5 ps-4 pe-4 text-[13px] hover:bg-white/20"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
            </svg>
            <span className="font-semibold">{NATIVE[lang] ?? lang}</span>
            <span className="hidden text-white/50 sm:inline">·</span>
            <span className="hidden text-white/80 sm:inline">{t(`persona.${persona}`)}</span>
            <span className="text-volt">▾</span>
          </button>
          {open && (
            <div className="wipe-up absolute end-0 top-[calc(100%+10px)] w-[min(92vw,560px)] bg-white text-ink shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
              <div className="bg-ink px-5 py-3 text-white">
                <div className="cond text-volt">{t('settings.button')}</div>
                <div className="xp mt-1 text-[17px]">{t('settings.title')}</div>
              </div>
              <div className="grid gap-5 p-5 sm:grid-cols-2">
                <div>
                  <div className="cond text-ink-3">{t('settings.language')}</div>
                  <p className="mt-1 text-[12px] text-ink-3">{t('settings.languageHelp')}</p>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    {langs.map((l) => (
                      <button
                        key={l}
                        onClick={() => setLang(l)}
                        className={`px-3 py-2 text-start text-[14px] font-semibold ${lang === l ? 'bg-ink text-volt' : 'bg-concrete hover:bg-concrete-2'}`}
                        lang={l}
                      >
                        {NATIVE[l] ?? l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="cond text-ink-3">{t('settings.audience')}</div>
                  <p className="mt-1 text-[12px] text-ink-3">{t('settings.audienceHelp')}</p>
                  <div className="mt-2 grid gap-1">
                    {PERSONAS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPersona(p)}
                        className={`px-3 py-2 text-start ${persona === p ? 'bg-ink text-white' : 'bg-concrete hover:bg-concrete-2'}`}
                      >
                        <div className={`text-[14px] font-semibold ${persona === p ? 'text-volt' : ''}`}>{t(`persona.${p}`)}</div>
                        <div className={`text-[12px] ${persona === p ? 'text-white/70' : 'text-ink-3'}`}>{t(`persona.${p}.desc`)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end border-t border-line px-5 py-3">
                <button onClick={() => setOpen(false)} className="btn btn-volt">
                  {t('settings.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
