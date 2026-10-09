import { useEffect, useState } from 'react'
import { api } from '../api'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import type { CrewResult } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

/** The full-time package: headline, report and ready-to-post social copy. */
export default function RecapPanel() {
  const { pkg } = useMatch()
  const { persona, lang, t } = useSettings()
  const [recap, setRecap] = useState<CrewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

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

  if (error) return <p className="px-5 pt-4 text-[13px] text-flare">{error}</p>
  if (!recap) return <p className="working px-5 pt-4 text-[14px] text-ink-3">{t('recap.filing')}</p>
  const data = recap.data
  const { home, away } = pkg.meta.teams
  return (
    <div className="fade-in scroll-slim h-full overflow-y-auto px-5 pt-4 pb-6">
      <div className="flex items-stretch">
        <span className="cut-l bg-ink px-3 py-1 cond text-volt">{t('recap.fullTime')}</span>
        <span className="cut-r bg-concrete px-3 py-1 xp text-[13px] tab-num">
          {home.short} {pkg.meta.score.home}-{pkg.meta.score.away} {away.short}
        </span>
      </div>
      {data?.headline && <h2 className="xp mt-4 text-[24px] leading-[1.02]">{data.headline}</h2>}
      <StoryText text={data?.article ?? recap.text} className="mt-4" />
      {data?.social?.length ? (
        <section className="mt-6">
          <div className="cond text-ink-3">{t('recap.ready')}</div>
          <ol className="mt-2">
            {data.social.map((s, i) => (
              <li key={i} className="border-t border-line py-3">
                <StoryText text={s} className="!text-[14px]" />
                <button
                  className="act mt-1"
                  onClick={() => {
                    navigator.clipboard?.writeText(s.replace(/\s*\[#\d+\]/g, ''))
                    setCopied(i)
                    setTimeout(() => setCopied(null), 1400)
                  }}
                >
                  {copied === i ? t('recap.copied') : t('recap.copy')}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <VerifiedBadge verdict={recap.verdict} mode={recap.mode} />
        <TraceButton trace={recap.trace} title="Full-time report" />
      </div>
    </div>
  )
}
