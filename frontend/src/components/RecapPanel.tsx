import { Loader2, Newspaper } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import type { CrewResult } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

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

  if (error) return <div className="text-sm text-rose-400">{error}</div>
  if (!recap)
    return (
      <div className="flex items-center gap-2 text-sm text-ink-400">
        <Loader2 size={14} className="animate-spin" /> Analyst, Tactician and Storyteller are writing the full-time package...
      </div>
    )
  const data = recap.data
  return (
    <div className="scroll-thin -mr-2 h-full space-y-4 overflow-y-auto pr-2">
      <div className="flex items-center gap-2 text-xs tracking-wider text-ink-400 uppercase">
        <Newspaper size={14} /> Full-time report
      </div>
      {data?.headline && <h3 className="font-display text-2xl leading-tight font-semibold">{data.headline}</h3>}
      <StoryText text={data?.article ?? recap.text} className="text-sm text-ink-100" />
      {data?.social?.length ? (
        <div className="space-y-2">
          <div className="text-xs tracking-wider text-ink-400 uppercase">Social posts</div>
          {data.social.map((s, i) => (
            <div key={i} className="rounded-xl border border-ink-700 bg-ink-900/60 p-3 text-sm">
              <StoryText text={s} />
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <VerifiedBadge verdict={recap.verdict} mode={recap.mode} />
        <TraceButton trace={recap.trace} title="Full-time recap" />
      </div>
    </div>
  )
}
