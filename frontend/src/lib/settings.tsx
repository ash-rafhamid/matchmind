import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { Health, Options } from '../types'

interface Settings {
  persona: string
  lang: string
  setPersona: (p: string) => void
  setLang: (l: string) => void
  options: Options | null
  health: Health | null
}

const Ctx = createContext<Settings | null>(null)

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState(() => stored('mm.persona', 'fan'))
  const [lang, setLangState] = useState(() => stored('mm.lang', 'en'))
  const [options, setOptions] = useState<Options | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api.options().then(setOptions).catch(() => undefined)
    api.health().then(setHealth).catch(() => undefined)
  }, [])

  const save = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* private mode */
    }
  }

  return (
    <Ctx.Provider
      value={{
        persona,
        lang,
        options,
        health,
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
