import { useEffect, useState } from 'react'
import Header from './components/Header'
import Home from './pages/Home'
import MatchView from './pages/MatchView'

function readRoute(): string | null {
  const m = window.location.hash.match(/^#\/match\/([\w-]+)/)
  return m ? m[1] : null
}

export default function App() {
  const [matchId, setMatchId] = useState<string | null>(readRoute)

  useEffect(() => {
    const onHash = () => setMatchId(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const open = (id: string | null) => {
    window.location.hash = id ? `#/match/${id}` : '#/'
  }

  return (
    <div className="flex min-h-full flex-col">
      <Header onHome={() => open(null)} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-8 sm:px-6">
        {matchId ? <MatchView key={matchId} matchId={matchId} /> : <Home onOpen={open} />}
      </main>
      <footer className="px-6 pb-6 text-center text-xs text-ink-400">
        All teams, players and matches are synthetic. Built with Microsoft Agent Framework, Microsoft Foundry, MCP and
        Azure Container Apps.
      </footer>
    </div>
  )
}
