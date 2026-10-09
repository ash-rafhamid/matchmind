import { useEffect, useState } from 'react'
import { api } from '../api'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import type { CrewResult } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

/** The full-time report, set like the back page: headline, byline, drop cap, then the posts for the wire. */
export default function RecapPanel() {
  const { pkg } = useMatch()
  const { persona, lang } = useSettings()
  const [recap, setRecap] = useState<CrewResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRecap(null)
    setError(null)
    api
      .recap(pkg.meta.id, persona, lang)
      .then((r) => alive && setRecap(r))
      .catch((e) => alive && setError(String(e.message ?? e)))
    return () => {
      alive = false
    }
  }, [pkg.meta.id, persona, lang])

  if (error) return <p className="text-[14px] text-signal">{error}</p>
  if (!recap) return <p className="typing text-[15px] text-ink-3 italic">Analyst, Tactician and Storyteller are filing the report</p>
  const data = recap.data
  const { home, away } = pkg.meta.teams
  return (
    <div className="ink-in scroll-ink -mr-3 h-full overflow-y-auto pr-3">
      <div className="label text-signal">Full-time report</div>
      {data?.headline && <h2 className="display mt-2 text-[30px] leading-[1.08] font-semibold">{data.headline}</h2>}
      <p className="mt-3 border-y border-rule py-2 text-[13px] text-ink-3 italic">
        {home.name} {pkg.meta.score.home}–{pkg.meta.score.away} {away.name} · By the MatchMind crew: Analyst, Tactician and
        Storyteller, proofed by code
      </p>
      <StoryText text={data?.article ?? recap.text} className="dropcap mt-4" />
      {data?.social?.length ? (
        <section className="mt-6">
          <div className="label label-ink">For the wire</div>
          <ol className="mt-2 border-t border-ink">
            {data.social.map((s, i) => (
              <li key={i} className="grid grid-cols-[42px_1fr] gap-2 border-b border-dashed border-ink-4 py-3">
                <span className="num text-[11px] text-ink-3">
                  {i + 1}/{data.social.length}
                </span>
                <StoryText text={s} className="!text-[15px]" />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 pb-4">
        <VerifiedBadge verdict={recap.verdict} mode={recap.mode} />
        <TraceButton trace={recap.trace} title="Full-time report" />
      </div>
    </div>
  )
}
