/** Small helpers shared by the programme-style UI. */

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** A team colour that stays readable as text/lines on the paper background. */
export function teamInk(team: { primary: string; secondary: string }): string {
  return luminance(team.primary) > 0.55 ? team.secondary : team.primary
}

/** Shirt number colour on top of the primary colour. */
export function onPrimary(team: { primary: string; secondary: string }): string {
  const a = luminance(team.primary)
  const b = luminance(team.secondary)
  const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  if (contrast >= 3) return team.secondary
  return a > 0.4 ? '#141310' : '#f2eee3'
}

export const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi']

/**
 * Evidence tags as the model sometimes writes them - "[#40, #45]", "[#391-#398]" - split into one tag per event;
 * tags that are not event ids at all ("[#90+2]" is a minute) are dropped.
 */
export function tidyTags(text: string): string {
  return text
    .replace(/\[\s*#?\d+(?:\s*(?:[,;\-\u2013]|to|and|&)\s*#?\d+)+\s*\]/g, (m) => (m.match(/\d+/g) ?? []).map((n) => `[#${n}]`).join(' '))
    .replace(/\s*\[#(?!\d+\])[^\]\n]{0,40}\]/g, '')
}

/** The text without any evidence tags, for copying and reading aloud. */
export function stripTags(text: string): string {
  return tidyTags(text).replace(/\s*\[#\d+\]/g, '').replace(/\s+/g, ' ').trim()
}

/** Surname for compact labels ("Jonah Lindqvist" -> "Lindqvist"). */
export const surname = (full: string) => full.split(' ').slice(-1)[0] ?? full

type T = (key: string, vars?: Record<string, string | number>) => string

/** Moment titles come from the analytics in English; rebuild them from translated templates. */
export function momentTitle(m: { type: string; title: string; team_name: string }, t: T): string {
  const team = m.team_name
  let g: RegExpMatchArray | null
  if (m.type === 'goal' && (g = m.title.match(/^GOAL - (.+?) \(/))) return t(m.title.endsWith('from the spot') ? 'title.goal_pen' : 'title.goal', { player: g[1], team })
  if (m.type === 'big_chance' && (g = m.title.match(/^Big chance (saved|missed) - (.+)$/))) return t(g[1] === 'saved' ? 'title.chance_saved' : 'title.chance_missed', { player: g[2] })
  if (m.type === 'save' && (g = m.title.match(/^Fine save by (.+)$/))) return t('title.save', { player: g[1] })
  if (m.type === 'red_card' && (g = m.title.match(/^Red card - (.+)$/))) return t('title.red_card', { player: g[1] })
  if (m.type === 'tactical_change') return t('title.tactical_change', { team })
  if (m.type === 'momentum') return t('title.momentum', { team })
  return m.title
}
