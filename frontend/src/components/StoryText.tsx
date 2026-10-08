import { Fragment } from 'react'
import { useMatch } from '../lib/match'

/** Renders crew text, turning [#id] evidence tags into chips that replay the event on the pitch. */
export default function StoryText({ text, className = '' }: { text: string; className?: string }) {
  const { focusEvidence, eventsById } = useMatch()
  const parts = text.split(/(\[#\d+\])/g)
  return (
    <p className={`leading-relaxed whitespace-pre-line ${className}`}>
      {parts.map((part, i) => {
        const m = part.match(/^\[#(\d+)\]$/)
        if (!m) return <Fragment key={i}>{part}</Fragment>
        const id = Number(m[1])
        const ev = eventsById.get(id)
        return (
          <button
            key={i}
            className="chip-evidence"
            title={ev ? `Replay: ${ev.type} at ${ev.clock}` : 'Evidence'}
            onClick={() => focusEvidence([id], true)}
          >
            &#9654; {ev?.clock ?? `#${id}`}
          </button>
        )
      })}
    </p>
  )
}
