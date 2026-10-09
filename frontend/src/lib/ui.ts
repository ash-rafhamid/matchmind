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

/** Surname for compact labels ("Jonah Lindqvist" -> "Lindqvist"). */
export const surname = (full: string) => full.split(' ').slice(-1)[0] ?? full
