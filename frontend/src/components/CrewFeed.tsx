import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import { speak, speechAvailable, stopSpeaking } from '../lib/speech'
import { teamInk } from '../lib/ui'
import type { CrewResult, Moment } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

const KICKER: Record<Moment['type'], string> = {
  goal: 'Goal',
  big_chance: 'Big chance',
  save: 'Save',
  red_card: 'Sent off',
  tactical_change: 'Tactical switch',
  momentum: 'Momentum',
}

/** The live blog: key moments appear as the replay reaches them, newest first. */
export default function CrewFeed() {
  const { pkg, clock } = useMatch()
  const { time } = useClock(clock, 2)
  const [spoilers, setSpoilers] = useState(false)
  const moments = pkg.analytics.moments
  const visible = useMemo(() => (spoilers ? moments : moments.filter((m) => m.ts <= time + 1)).slice().reverse(), [moments, time, spoilers])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <span className="label">
          <span className="num text-ink">{visible.length}</span> of <span className="num">{moments.length}</span> key moments
        </span>
        <button onClick={() => setSpoilers((s) => !s)} className="link">
          {spoilers ? 'Follow the replay' : 'Show every moment'}
        </button>
      </div>
      {visible.length === 0 && (
        <div className="flex flex-1 flex-col items-start justify-center border-t border-rule py-10">
          <p className="display text-[26px] leading-snug italic-wonk">The crew is in the press box.</p>
          <p className="mt-2 max-w-[38ch] text-[15px] text-ink-3">
            Press play. Each key moment is reported here as the replay reaches it, written for you and checked before it
            is printed.
          </p>
        </div>
      )}
      <div className="scroll-ink -mr-3 flex-1 overflow-y-auto pr-3">
        {visible.map((m) => (
          <Entry key={m.id} moment={m} />
        ))}
      </div>
    </div>
  )
}

function Entry({ moment }: { moment: Moment }) {
  const { pkg, clock, focusEvidence } = useMatch()
  const { persona, lang } = useSettings()
  const [story, setStory] = useState<CrewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const team = pkg.meta.teams[moment.team]
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
    clock.replay(Math.max(0, first - 3), moment.ts + 3, 1)
  }

  return (
    <article className="rise grid grid-cols-[52px_1fr] gap-4 border-t border-rule py-5">
      <div className="pt-1">
        <div className={`num text-[17px] leading-none font-semibold ${isGoal ? 'text-signal' : 'text-ink'}`}>{moment.clock}</div>
        <div className="mt-2 h-8 w-[3px]" style={{ background: teamInk(team) }} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className={`label ${isGoal ? 'text-signal' : ''}`}>
          {KICKER[moment.type] ?? moment.type} · {moment.team_name}
        </div>
        <h3 className={`display mt-1 leading-snug font-semibold ${isGoal ? 'text-[22px]' : 'text-[18px]'}`}>{moment.title}</h3>
        <div className="mt-2">
          {story ? (
            <div className="ink-in">
              <StoryText text={story.text} />
            </div>
          ) : error ? (
            <p className="text-[14px] text-signal">{error}</p>
          ) : (
            <p className="typing text-[15px] text-ink-3 italic">The crew is writing</p>
          )}
        </div>
        <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {story && <VerifiedBadge verdict={story.verdict} mode={story.mode} />}
          {moment.evidence.length > 0 && (
            <button onClick={replay} className="link">
              Replay
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
              className="link"
            >
              {speaking ? 'Stop' : 'Listen'}
            </button>
          )}
          {story && <TraceButton trace={story.trace} title={`${moment.clock} ${moment.title}`} />}
        </footer>
      </div>
    </article>
  )
}
