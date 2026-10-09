import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useClock } from '../lib/clock'
import { useMatch } from '../lib/match'
import { useSettings, useT } from '../lib/settings'
import { speak, speechAvailable, stopSpeaking } from '../lib/speech'
import { momentTitle, onPrimary } from '../lib/ui'
import type { CrewResult, Moment } from '../types'
import StoryText from './StoryText'
import { TraceButton, VerifiedBadge } from './Trace'

/** The crew's running commentary: key moments appear as the replay reaches them, newest first. */
export default function CrewFeed({ focus }: { focus?: string | null }) {
  const { pkg, clock } = useMatch()
  const { time } = useClock(clock, 2)
  const [all, setAll] = useState(false)
  const t = useT()
  const moments = pkg.analytics.moments
  const visible = useMemo(() => (all ? moments : moments.filter((m) => m.ts <= time + 1)).slice().reverse(), [moments, time, all])

  useEffect(() => {
    if (focus) document.getElementById(`moment-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-2.5">
        <span className="cond text-ink-3">
          <span className="text-ink tab-num">{visible.length}</span>/{moments.length} {t('feed.moments')}
        </span>
        <div className="seg">
          <button aria-pressed={!all} onClick={() => setAll(false)}>
            {t('feed.follow')}
          </button>
          <button aria-pressed={all} onClick={() => setAll(true)}>
            {t('feed.all')}
          </button>
        </div>
      </div>
      {visible.length === 0 && (
        <div className="flex flex-1 flex-col justify-center px-6 pb-10">
          <div className="xp text-[30px] leading-[0.95]">
            {t('feed.pressPlay')}
            <br />
            <span className="xp-light">{t('feed.ready')}</span>
          </div>
          <p className="mt-4 max-w-[34ch] text-[14px] text-ink-3">
            {t('feed.empty')}
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
  const { persona, lang, t } = useSettings()
  const [story, setStory] = useState<CrewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const team = pkg.meta.teams[moment.team]
  const isGoal = moment.type === 'goal'

  // only ask for a story once its entry is (nearly) on screen
  const ref = useRef<HTMLElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setSeen(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  useEffect(() => {
    if (!seen) return
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
  }, [pkg.meta.id, moment.id, persona, lang, seen])

  const replay = () => {
    const first = moment.evidence.length ? Math.min(...moment.evidence.map((id) => pkg.events.find((e) => e.id === id)?.ts ?? moment.ts)) : moment.ts
    focusEvidence(moment.evidence, false)
    clock.replay(Math.max(0, first - 3), moment.ts + 3, 1)
  }

  return (
    <article ref={ref} id={`moment-${moment.id}`} className="wipe-up border-t border-line px-5 py-5">
      <div className="flex items-stretch">
        <span className="cut-l flex items-center px-2.5 xp text-[13px] tab-num" style={isGoal ? { background: 'var(--color-flare)', color: '#fff' } : { background: 'var(--color-ink)', color: 'var(--color-volt)' }}>
          {moment.clock}
        </span>
        <span className="cut-r flex items-center pr-4 pl-2 cond text-[11px]" style={{ background: team.primary, color: onPrimary(team) }}>
          {t(`kicker.${moment.type}`)}
        </span>
      </div>
      <h3 className={`mt-2.5 leading-tight font-bold ${isGoal ? 'xp text-[19px]' : 'text-[17px] [font-stretch:110%]'}`}>{momentTitle(moment, t)}</h3>
      <div className="mt-2">
        {story ? (
          <div className="fade-in">
            <StoryText text={story.text} />
          </div>
        ) : error ? (
          <p className="text-[13px] text-flare">{error}</p>
        ) : (
          <p className="working cond text-ink-3">{t('match.crewWriting')}</p>
        )}
      </div>
      <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {story && <VerifiedBadge verdict={story.verdict} mode={story.mode} />}
        {moment.evidence.length > 0 && (
          <button onClick={replay} className="act">
            {t('feed.replay')}
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
            {speaking ? t('feed.stop') : t('feed.listen')}
          </button>
        )}
        {story && <TraceButton trace={story.trace} title={`${moment.clock} ${momentTitle(moment, t)}`} />}
      </footer>
    </article>
  )
}
