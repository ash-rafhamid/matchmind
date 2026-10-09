import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { useSettings } from '../lib/settings'
import { speak, speechAvailable, stopSpeaking } from '../lib/speech'
import { onPrimary } from '../lib/ui'
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

/** The crew's running commentary: key moments appear as the replay reaches them, newest first. */
export default function CrewFeed({ focus }: { focus?: string | null }) {
  const { pkg, clock } = useMatch()
  const { time } = useClock(clock, 2)
  const [all, setAll] = useState(false)
  const moments = pkg.analytics.moments
  const visible = useMemo(() => (all ? moments : moments.filter((m) => m.ts <= time + 1)).slice().reverse(), [moments, time, all])

  useEffect(() => {
    if (focus) document.getElementById(`moment-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-2.5">
        <span className="cond text-ink-3">
          <span className="text-ink tab-num">{visible.length}</span>/{moments.length} moments
        </span>
        <div className="seg">
          <button aria-pressed={!all} onClick={() => setAll(false)}>
            Follow replay
          </button>
          <button aria-pressed={all} onClick={() => setAll(true)}>
            All
          </button>
        </div>
      </div>
      {visible.length === 0 && (
        <div className="flex flex-1 flex-col justify-center px-6 pb-10">
          <div className="xp text-[30px] leading-[0.95]">
            Press play.
            <br />
            <span className="xp-light">The crew is ready.</span>
          </div>
          <p className="mt-4 max-w-[34ch] text-[14px] text-ink-3">
            Each key moment is written up here, for you, as the replay reaches it, and checked by code before it is shown.
          </p>
        </div>
      )}
      <div className="scroll-slim flex-1 overflow-y-auto">
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
    <article id={`moment-${moment.id}`} className="wipe-up border-t border-line px-5 py-5">
      <div className="flex items-stretch">
        <span className="cut-l flex items-center px-2.5 xp text-[13px] tab-num" style={isGoal ? { background: 'var(--color-flare)', color: '#fff' } : { background: 'var(--color-ink)', color: 'var(--color-volt)' }}>
          {moment.clock}
        </span>
        <span className="cut-r flex items-center pr-4 pl-2 cond text-[11px]" style={{ background: team.primary, color: onPrimary(team) }}>
          {KICKER[moment.type] ?? moment.type}
        </span>
      </div>
      <h3 className={`mt-2.5 leading-tight font-bold ${isGoal ? 'xp text-[19px]' : 'text-[17px] [font-stretch:110%]'}`}>{moment.title}</h3>
      <div className="mt-2">
        {story ? (
          <div className="fade-in">
            <StoryText text={story.text} />
          </div>
        ) : error ? (
          <p className="text-[13px] text-flare">{error}</p>
        ) : (
          <p className="working cond text-ink-3">The crew is writing</p>
        )}
      </div>
      <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {story && <VerifiedBadge verdict={story.verdict} mode={story.mode} />}
        {moment.evidence.length > 0 && (
          <button onClick={replay} className="act">
            ▶ Replay in 3D
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
            className="act"
          >
            {speaking ? '■ Stop' : '♪ Listen'}
          </button>
        )}
        {story && <TraceButton trace={story.trace} title={`${moment.clock} ${moment.title}`} />}
      </footer>
    </article>
  )
}
