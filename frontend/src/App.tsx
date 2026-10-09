import { useEffect, useState } from 'react'
import Header from './components/Header'
import Home from './pages/Home'
import MatchView from './pages/MatchView'
import Studio from './pages/Studio'

type Route = { page: 'home' } | { page: 'match' | 'studio'; id: string }

function readRoute(): Route {
  const m = window.location.hash.match(/^#\/(match|studio)\/([\w-]+)/)
  return m ? { page: m[1] as 'match' | 'studio', id: m[2] } : { page: 'home' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const open = (id: string | null) => {
    window.location.hash = id ? `#/match/${id}` : '#/'
  }

  if (route.page === 'studio') return <Studio key={route.id} matchId={route.id} />

  return (
    <div className="flex min-h-full flex-col">
      <Header onHome={() => open(null)} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-8 sm:px-6">
        {route.page === 'match' ? <MatchView key={route.id} matchId={route.id} /> : <Home onOpen={open} />}
      </main>
      <footer className="px-6 pb-6 text-center text-xs text-ink-400">
        All teams, players and matches are synthetic. Built with Microsoft Agent Framework, Microsoft Foundry, MCP and
        Azure Container Apps.
      </footer>
    </div>
  )
}
