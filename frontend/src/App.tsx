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

  if (route.page === 'studio') return <Studio key={route.id} matchId={route.id} />
  return (
    <div className="min-h-screen">
      <Header />
      {route.page === 'match' ? <MatchView key={route.id} matchId={route.id} /> : <Home />}
    </div>
  )
}
