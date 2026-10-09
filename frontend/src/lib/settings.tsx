import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import en from '../i18n/en.json'
import type { Health, Options } from '../types'

type Dict = Record<string, string>

/** Every other language is a separate small file, fetched only when chosen. */
const LOADERS = import.meta.glob<Dict>(['../i18n/*.json', '!../i18n/en.json'], { import: 'default' })

/** Language names in their own script, for the language picker. */
export const NATIVE: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  de: 'Deutsch',
  ar: 'العربية',
  hi: 'हिन्दी',
  bn: 'বাংলা',
  sw: 'Kiswahili',
  ja: '日本語',
}

const RTL = new Set(['ar'])

interface Settings {
  persona: string
  lang: string
  setPersona: (p: string) => void
  setLang: (l: string) => void
  options: Options | null
  health: Health | null
  /** Translate an interface string; {placeholders} are filled from `vars`. */
  t: (key: string, vars?: Record<string, string | number>) => string
}

const Ctx = createContext<Settings | null>(null)

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState(() => stored('mm.persona', 'fan'))
  const [lang, setLangState] = useState(() => stored('mm.lang', 'en'))
  const [dict, setDict] = useState<Dict>(en)
  const [options, setOptions] = useState<Options | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api.options().then(setOptions).catch(() => undefined)
    api.health().then(setHealth).catch(() => undefined)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr'
    if (lang === 'en') {
      setDict(en)
      return
    }
    const load = LOADERS[`../i18n/${lang}.json`]
    let alive = true
    load?.()
      .then((d) => alive && setDict({ ...en, ...d }))
      .catch(() => alive && setDict(en))
    return () => {
      alive = false
    }
  }, [lang])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = dict[key] ?? (en as Dict)[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
      return s
    },
    [dict],
  )

  return (
    <Ctx.Provider
      value={{
        persona,
        lang,
        options,
        health,
        t,
        setPersona: (p) => {
          setPersonaState(p)
          save('mm.persona', p)
        },
        setLang: (l) => {
          setLangState(l)
          save('mm.lang', l)
        },
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useSettings(): Settings {
  const s = useContext(Ctx)
  if (!s) throw new Error('SettingsProvider missing')
  return s
}

/** Shorthand for components that only need translations. */
export function useT() {
  return useSettings().t
}
