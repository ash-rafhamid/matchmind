import type { AskResult, CrewResult, Health, MatchPackage, MatchSummary, Options, WhatIfResult } from './types'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* keep status text */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json() as Promise<T>
}

export interface TrackingChunk {
  hz: number
  start: number
  frames: number
  players: string[]
  teams: string[]
  xy: number[]
  ball: number[]
  ball_z?: number[]
  on_ball?: number[]
  enc?: 'delta'
  scale: number
}

export const api = {
  health: () => call<Health>('/api/health'),
  options: () => call<Options>('/api/options'),
  matches: () => call<MatchSummary[]>('/api/matches'),
  match: (id: string) => call<MatchPackage>(`/api/matches/${id}`),
  tracking: (id: string, start: number, seconds: number) =>
    call<TrackingChunk>(`/api/matches/${id}/tracking?start=${start}&seconds=${seconds}&hz=10&enc=delta`),
  story: (id: string, momentId: string, persona: string, lang: string) =>
    call<CrewResult>(`/api/matches/${id}/moments/${momentId}/story?persona=${persona}&lang=${lang}`),
  recap: (id: string, persona: string, lang: string) =>
    call<CrewResult>(`/api/matches/${id}/recap?persona=${persona}&lang=${lang}`),
  ask: (id: string, question: string, persona: string, lang: string) =>
    call<AskResult>(`/api/matches/${id}/ask`, { method: 'POST', body: JSON.stringify({ question, persona, lang }) }),
  whatif: (id: string, body: { team: string; from_minute: number; changes: Record<string, number | string>; runs: number; persona: string; lang: string }) =>
    call<{ result: WhatIfResult; explanation?: CrewResult }>(`/api/matches/${id}/whatif`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  scenario: (body: { home: string; away: string; seed?: number; script: { minute: number; side: string; changes: Record<string, number | string>; label: string }[] }) =>
    call<{ id: string; score: Record<string, number>; title: string }>('/api/scenarios', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
