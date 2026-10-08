import { Activity, CircleDot, Eye, EyeOff, Hand, Loader2, RotateCcw, Settings2, Square, Target, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import { speak, speechAvailable, stopSpeaking } from '../lib/speech'
import type { CrewResult, Moment } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

const ICON: Record<Moment['type'], typeof Target> = {
  goal: CircleDot,
  big_chance: Target,
  save: Hand,
  red_card: Square,
  tactical_change: Settings2,
  momentum: Activity,
}

export default function CrewFeed() {
  const { pkg, clock } = useMatch()
  const { time } = useClock(clock, 2)
  const [spoilers, setSpoilers] = useState(false)
  const moments = pkg.analytics.moments
  const visible = useMemo(
    () => (spoilers ? moments : moments.filter((m) => m.ts <= time + 1)).slice().reverse(),
    [moments, time, spoilers],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-400">
        <span>
          {visible.length} of {moments.length} key moments
        </span>
        <button onClick={() => setSpoilers((s) => !s)} className="flex items-center gap-1 hover:text-ink-100">
          {spoilers ? <EyeOff size={13} /> : <Eye size={13} />}
          {spoilers ? 'Follow the replay' : 'Show all moments'}
        </button>
      </div>
      {visible.length === 0 && (
        <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">
          Press play - the crew reports key moments as they happen.
        </div>
      )}
      <div className="scroll-thin -mr-2 flex-1 space-y-3 overflow-y-auto pr-2">
        {visible.map((m) => (
          <MomentCard key={m.id} moment={m} />
        ))}
      </div>
    </div>
  )
}

function MomentCard({ moment }: { moment: Moment }) {
  const { pkg, clock, focusEvidence } = useMatch()
  const { persona, lang } = useSettings()
  const [story, setStory] = useState<CrewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const team = pkg.meta.teams[moment.team]
  const Icon = ICON[moment.type] ?? Activity
  const isGoal = moment.type === 'goal'

  useEffect(() => {
    let alive = true
    setStory(null)
    setError(null)
    api
      .story(pkg.meta.id, moment.id, persona, lang)
      .then((s) => alive && setStory(s))
      .catch((e) => alive && setError(String(e.message ?? e)))
    return () => {
      alive = false
    }
  }, [pkg.meta.id, moment.id, persona, lang])

  const replay = () => {
    const first = moment.evidence.length ? Math.min(...moment.evidence.map((id) => pkg.events.find((e) => e.id === id)?.ts ?? moment.ts)) : moment.ts
    focusEvidence(moment.evidence, false)
    clock.replay(Math.max(0, first - 2), moment.ts + 3, 1)
  }

  return (
    <article
      className={`animate-rise rounded-xl border p-3.5 ${isGoal ? 'border-mint-500/40 bg-mint-500/5' : 'border-ink-700 bg-ink-900/60'}`}
      style={{ borderLeft: `4px solid ${team.primary.toLowerCase() === '#1d1d1d' ? team.secondary : team.primary}` }}
    >
      <header className="flex items-center gap-2">
        <Icon size={16} className={isGoal ? 'text-mint-400' : 'text-sky-400'} />
        <span className="font-display text-lg font-semibold tabular-nums">{moment.clock}</span>
        <span className="truncate text-sm font-semibold">{moment.title}</span>
      </header>
      <div className="mt-2 text-sm text-ink-100">
        {story ? (
          <StoryText text={story.text} />
        ) : error ? (
          <span className="text-rose-400">{error}</span>
        ) : (
          <span className="flex items-center gap-2 text-ink-400">
            <Loader2 size={14} className="animate-spin" /> The crew is on it...
          </span>
        )}
      </div>
      <footer className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {story && <VerifiedBadge verdict={story.verdict} mode={story.mode} />}
        {moment.evidence.length > 0 && (
          <button onClick={replay} className="flex items-center gap-1 text-[11px] text-ink-300 hover:text-mint-400">
            <RotateCcw size={12} /> Replay build-up
          </button>
        )}
        {speechAvailable && story && (
          <button
            onClick={() => {
              if (speaking) {
                stopSpeaking()
                setSpeaking(false)
              } else {
                setSpeaking(true)
                speak(story.text, lang, () => setSpeaking(false))
              }
            }}
            className="flex items-center gap-1 text-[11px] text-ink-300 hover:text-mint-400"
          >
            <Volume2 size={12} /> {speaking ? 'Stop' : 'Listen'}
          </button>
        )}
        {story && <TraceButton trace={story.trace} title={`${moment.clock} ${moment.title}`} />}
      </footer>
    </article>
  )
}
