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
    const onHash = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const open = (id: string | null) => {
    window.location.hash = id ? `#/match/${id}` : '#/'
  }

  if (route.page === 'studio') return <Studio key={route.id} matchId={route.id} />

  return (
    <div className="flex min-h-screen flex-col">
      <Header onHome={() => open(null)} />
      <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-16 sm:px-8">
        {route.page === 'match' ? <MatchView key={route.id} matchId={route.id} /> : <Home onOpen={open} />}
      </main>
      <footer className="mx-auto w-full max-w-[1480px] px-4 pb-8 sm:px-8">
        <div className="double-rule pt-3" />
        <div className="flex flex-wrap justify-between gap-2 num text-[11px] text-ink-3 uppercase">
          <span>Printed on synthetic data · no real league data, players or footage</span>
          <span>Microsoft Agent Framework · Microsoft Foundry · MCP · Azure Container Apps</span>
        </div>
      </footer>
    </div>
  )
}
