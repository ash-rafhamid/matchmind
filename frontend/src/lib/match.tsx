import { createContext, useContext } from 'react'
import type { MatchEvent, MatchPackage, Side } from '../types'
import type { PlaybackClock } from './clock'

export interface MatchCtxValue {
  pkg: MatchPackage
  clock: PlaybackClock
  eventsById: Map<number, MatchEvent>
  highlight: number[]
  /** Show these events on the pitch and jump the replay to them. */
  focusEvidence: (ids: number[], play?: boolean) => void
  clearHighlight: () => void
  name: (playerId?: string | null) => string
  teamName: (side: Side) => string
}

export const MatchCtx = createContext<MatchCtxValue | null>(null)

export function useMatch(): MatchCtxValue {
  const v = useContext(MatchCtx)
  if (!v) throw new Error('MatchCtx missing')
  return v
}

/** Index of the last event with ts <= t (events sorted by ts). */
export function lastEventIndex(events: MatchEvent[], t: number): number {
  let lo = 0
  let hi = events.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].ts <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export function scoreAt(events: MatchEvent[], t: number): Record<Side, number> {
  let score: Record<Side, number> = { home: 0, away: 0 }
  for (const e of events) {
    if (e.ts > t) break
    if (e.type === 'goal' && e.score) score = e.score
  }
  return score
}
