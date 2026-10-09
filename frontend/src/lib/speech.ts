import { stripTags } from './ui'

const VOICE_LANG: Record<string, string> = {
  en: 'en-GB', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', de: 'de-DE', ar: 'ar-SA', hi: 'hi-IN', bn: 'bn-IN', sw: 'sw-KE', ja: 'ja-JP',
}

export const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window

/** Read text aloud with the browser's speech engine (evidence tags are skipped). */
export function speak(text: string, lang: string, onEnd?: () => void): void {
  if (!speechAvailable) return
  window.speechSynthesis.cancel()
  const clean = stripTags(text)
  const u = new SpeechSynthesisUtterance(clean)
  u.lang = VOICE_LANG[lang] ?? 'en-GB'
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === u.lang)
  if (voice) u.voice = voice
  u.rate = 1.04
  u.onend = () => onEnd?.()
  window.speechSynthesis.speak(u)
}

export function stopSpeaking(): void {
  if (speechAvailable) window.speechSynthesis.cancel()
}
