import { useEffect, useRef } from 'react'
import type { PlaybackClock } from '../lib/clock'
import type { TrackingStore } from '../lib/tracking'
import { Stadium, type CameraMode } from '../scene/Stadium'
import type { MatchEvent, MatchPackage } from '../types'

interface Props {
  pkg: MatchPackage
  store: TrackingStore
  clock: PlaybackClock
  mode: CameraMode
  highlights?: MatchEvent[]
  /** Direction of the goal being replayed (1 = right), or null when not replaying. */
  replay?: 1 | -1 | null
  crowd?: boolean
  className?: string
}

/** React shell around the three.js stadium. The scene runs its own render loop off the playback clock. */
export default function Miniature({ pkg, store, clock, mode, highlights = [], replay = null, crowd = true, className = '' }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const stadium = useRef<Stadium | null>(null)
  const latest = useRef({ mode, highlights, replay })
  latest.current = { mode, highlights, replay }

  useEffect(() => {
    const names = pkg.meta.player_names
    const s = new Stadium(host.current!, pkg, store, clock, { name: (pid) => names[pid] ?? pid, crowd })
    // apply whatever the page asked for before the stadium existed
    s.setMode(latest.current.mode)
    s.setHighlights(latest.current.highlights)
    s.setReplay(latest.current.replay)
    stadium.current = s
    return () => {
      s.dispose()
      stadium.current = null
    }
  }, [pkg, store, clock, crowd])

  useEffect(() => stadium.current?.setMode(mode), [mode])
  useEffect(() => stadium.current?.setHighlights(highlights), [highlights])
  useEffect(() => stadium.current?.setReplay(replay), [replay])

  return <div ref={host} className={`relative h-full w-full overflow-hidden ${className}`} aria-label="Live 3D reconstruction of the match" role="img" />
}
