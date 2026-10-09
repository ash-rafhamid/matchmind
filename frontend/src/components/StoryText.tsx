import { Fragment } from 'react'
import { useMatch } from '../lib/match'

/** Crew text with [#id] evidence tags set as footnote markers; each one replays that event on the pitch. */
export default function StoryText({ text, className = '' }: { text: string; className?: string }) {
  const { focusEvidence, eventsById } = useMatch()
  const parts = text.split(/(\s*\[#\d+\])/g)
  return (
    <p className={`body-copy whitespace-pre-line ${className}`}>
      {parts.map((part, i) => {
        const m = part.match(/^\s*\[#(\d+)\]$/)
        if (!m) return <Fragment key={i}>{part}</Fragment>
        const id = Number(m[1])
        const ev = eventsById.get(id)
        return (
          <button key={i} className="footnote" title={ev ? `Replay the ${ev.type} at ${ev.clock}` : 'Replay this moment'} onClick={() => focusEvidence([id], true)}>
            {ev?.clock ?? `#${id}`}
          </button>
        )
      })}
    </p>
  )
}
