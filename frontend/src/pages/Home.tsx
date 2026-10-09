import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { formatClock, PlaybackClock, useClock } from '../lib/clock'
import { scoreAt } from '../lib/match'
import { useSettings, useT } from '../lib/settings'
import { TrackingStore } from '../lib/tracking'
import { onPrimary } from '../lib/ui'
import type { MatchPackage, MatchSummary } from '../types'

const Miniature = lazy(() => import('../components/Miniature'))

export default function Home() {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hero, setHero] = useState<MatchPackage | null>(null)
  const t = useT()

  useEffect(() => {
    // the hero match and the fixture list load in parallel
    api.match('kin-wes-133').then(setHero).catch(() => undefined)
    api
      .matches()
      .then(setMatches)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <div>
      <Hero pkg={hero} />

      <section className="mx-auto max-w-[1480px] px-4 py-14 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="xp text-[40px] sm:text-[56px]">
            {t('home.fixtures')}<span className="xp-light"> {t('home.pickMatch')}</span>
          </h2>
          <span className="cond text-ink-3">{t('home.fixturesNote')}</span>
        </div>
        {error && <p className="mt-6 text-flare">{t('home.apiDown')}: {error}</p>}
        {!matches && !error && <p className="working mt-6 cond text-ink-3">{t('home.loadingFixtures')}</p>}
        <div className="mt-6 grid gap-[2px] bg-line">
          {matches?.map((m, i) => (
            <Fixture key={m.id} m={m} i={i} />
          ))}
        </div>
      </section>

      <Rundown />
      <ScenarioLab />

      <footer className="bg-ink px-4 py-6 text-white/50 sm:px-8">
        <div className="mx-auto flex max-w-[1480px] flex-wrap justify-between gap-2 cond text-[11px]">
          <span>{t('app.footerSynthetic')}</span>
          <span>Microsoft Agent Framework · Microsoft Foundry · MCP · Azure Container Apps</span>
        </div>
      </footer>
    </div>
  )
}

/** The front page is the product: a featured match playing live in the miniature stadium. */
function Hero({ pkg }: { pkg: MatchPackage | null }) {
  const clock = useMemo(() => (pkg ? new PlaybackClock(pkg.meta.duration_s) : null), [pkg])
  const store = useMemo(() => (pkg ? new TrackingStore(pkg.meta.id) : null), [pkg])
  const t = useT()

  useEffect(() => {
    if (!clock || !pkg || !store) return
    // start just before the first goal, at a gentle 3x, and loop
    const firstGoal = pkg.events.find((e) => e.type === 'goal')
    const start = Math.max(0, (firstGoal?.ts ?? 300) - 40)
    store.prefetch(start)
    clock.seek(start)
    clock.setSpeed(3)
    const t = window.setTimeout(() => clock.play(), 600)
    const loop = clock.subscribe(() => {
      if (!clock.playing && clock.time >= pkg.meta.duration_s - 1) {
        clock.seek(start)
        clock.play()
      }
    })
    return () => {
      clearTimeout(t)
      loop()
      clock.destroy()
    }
  }, [clock, pkg, store])

  return (
    <section className="relative h-[calc(100vh-52px)] min-h-[560px] overflow-hidden bg-ink">
      {pkg && clock && store ? (
        <Suspense fallback={null}>
          <Miniature pkg={pkg} store={store} clock={clock} mode="director" className="absolute inset-0" />
        </Suspense>
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <p className="working cond text-volt">{t('app.loadingStadium')}</p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(11,12,14,0.78)_0%,rgba(11,12,14,0.35)_38%,transparent_62%),linear-gradient(0deg,rgba(11,12,14,0.55)_0%,transparent_35%)]" />
      {pkg && clock && <OnAir pkg={pkg} clock={clock} />}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-10 sm:px-10 sm:pb-14">
        <div className="pointer-events-auto max-w-[760px] text-white">
          <div className="flex items-stretch">
            <span className="cut-l bg-volt px-3 py-1 cond text-ink">{t('home.badge')}</span>
            <span className="cut-r bg-white px-3 py-1 cond text-ink">Inside the Game</span>
          </div>
          <h1 className="xp mt-5 text-[40px] leading-[0.88] md:text-[60px] xl:text-[84px]">
            {t('home.title1')}
            <br />
            <span className="text-volt">{t('home.title2')}</span>
          </h1>
          <p className="mt-5 hidden max-w-[56ch] text-[16px] leading-relaxed text-white/80 sm:block lg:text-[17px]">
            {t('home.body')}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            {pkg && (
              <a href={`#/match/${pkg.meta.id}`} className="btn btn-volt !px-7 !py-3.5 !text-[15px]">
                {t('home.watch')}
              </a>
            )}
            <button onClick={() => window.scrollTo({ top: window.innerHeight - 40, behavior: 'smooth' })} className="act !text-white/80 hover:!text-white">
              {t('home.allFixtures')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function OnAir({ pkg, clock }: { pkg: MatchPackage; clock: PlaybackClock }) {
  const { time } = useClock(clock, 4)
  const score = scoreAt(pkg.events, time)
  const { home, away } = pkg.meta.teams
  const t = useT()
  return (
    <div className="absolute top-4 right-4 flex h-9 items-stretch shadow-[0_6px_24px_rgba(0,0,0,0.35)] sm:top-6 sm:right-6">
      <span className="cut-l flex items-center gap-2 bg-flare pr-3 pl-4 cond text-white">
        <span className="live-pip !bg-white" /> {t('home.onAir')}
      </span>
      <span className="flex items-center px-3 xp text-[14px]" style={{ background: home.primary, color: onPrimary(home) }}>
        {home.short}
      </span>
      <span className="plate flex items-center px-3 xp text-[16px] tab-num">
        {score.home}-{score.away}
      </span>
      <span className="flex items-center px-3 xp text-[14px]" style={{ background: away.primary, color: onPrimary(away) }}>
        {away.short}
      </span>
      <span className="cut-r flex items-center bg-ink pr-4 pl-3 xp text-[13px] text-volt tab-num">{formatClock(time, pkg.meta.period_lengths_s['1'])}</span>
    </div>
  )
}

function Fixture({ m, i }: { m: MatchSummary; i: number }) {
  const t = useT()
  return (
    <a href={`#/match/${m.id}`} className="group plate grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 gap-y-3 px-4 py-6 transition-colors hover:bg-ink hover:text-white sm:gap-x-8 sm:px-8">
      <div className="flex min-w-0 items-center justify-end gap-3">
        <span className="xp truncate text-right text-[18px] sm:text-[30px]">{m.home.name}</span>
        <span className="h-9 w-3 shrink-0 -skew-x-[14deg]" style={{ background: m.home.primary }} />
      </div>
      <div className="xp text-center text-[40px] tab-num sm:text-[64px]">
        {m.score.home}
        <span className="xp-light px-2 text-ink-4 group-hover:text-white/40">-</span>
        {m.score.away}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-9 w-3 shrink-0 -skew-x-[14deg]" style={{ background: m.away.primary }} />
        <span className="xp truncate text-[18px] sm:text-[30px]">{m.away.name}</span>
      </div>
      <div className="col-span-3 flex flex-wrap items-center justify-between gap-3">
        <span className="cond text-ink-3 group-hover:text-white/50">
          {String(i + 1).padStart(2, '0')} · {m.competition}
        </span>
        {m.blurb && <span className="text-[14px] text-ink-2 group-hover:text-white/80">{m.blurb}</span>}
        <span className="cut-both bg-ink px-3 py-1 cond text-volt group-hover:bg-volt group-hover:text-ink">{t('home.watchShort')}</span>
      </div>
    </a>
  )
}

/** How the crew works, laid out like a TV rundown with timecodes. */
function Rundown() {
  const t = useT()
  const rows: [string, string, string, string][] = ['00.0', '00.2', '03.1', '04.6', '05.0'].map((tc, i) => [
    tc,
    t(`home.r${i + 1}.who`),
    t(`home.r${i + 1}.kind`),
    t(`home.r${i + 1}.what`),
  ])
  return (
    <section className="bg-ink text-white">
      <div className="mx-auto max-w-[1480px] px-4 py-14 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="xp text-[40px] sm:text-[56px]">
            {t('home.rundown')}<span className="xp-light text-white/40"> {t('home.rundownSub')}</span>
          </h2>
          <span className="cond text-white/40">Microsoft Agent Framework · Microsoft Foundry · MCP</span>
        </div>
        <ol className="mt-8">
          {rows.map(([tc, who, kind, what], i) => (
            <li key={tc} className="grid grid-cols-[70px_1fr] items-baseline gap-x-6 gap-y-1 border-t border-white/10 py-5 sm:grid-cols-[90px_minmax(0,320px)_150px_1fr]">
              <span className={`xp text-[18px] tab-num ${i === rows.length - 1 ? 'text-volt' : 'text-white/45'}`}>{tc}</span>
              <span className={`xp text-[22px] sm:text-[26px] ${i === rows.length - 1 ? 'text-volt' : ''}`}>{who}</span>
              <span className="col-start-2 cond text-white/45 sm:col-start-auto">{kind}</span>
              <span className="col-start-2 text-[15px] text-white/75 sm:col-start-auto">{what}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-[80ch] text-[14px] text-white/50">
          {t('home.rundownNote')}
        </p>
      </div>
    </section>
  )
}

/** Build a new synthetic match, written as a sentence. */
function ScenarioLab() {
  const { options, t } = useSettings()
  const teams = options ? Object.entries(options.teams) : []
  const [home, setHome] = useState('RED')
  const [away, setAway] = useState('HAR')
  const [switchOn, setSwitchOn] = useState(true)
  const [minute, setMinute] = useState(60)
  const [press, setPress] = useState(0.9)
  const [formation, setFormation] = useState('3-4-3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const script = switchOn ? [{ minute, side: 'home', changes: { press, formation }, label: `Switch to ${formation}, press ${press}` }] : []
      const res = await api.scenario({ home, away, script })
      window.location.hash = `#/match/${res.id}`
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const pressWord = t(`home.press.${press >= 0.8 ? 4 : press >= 0.6 ? 3 : press >= 0.4 ? 2 : 1}`)

  return (
    <section className="mx-auto max-w-[1480px] px-4 py-14 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <h2 className="xp text-[40px] leading-[0.9] sm:text-[56px]">
            {t('home.scenario')}
            <br />
            <span className="xp-light">{t('home.lab')}</span>
          </h2>
          <p className="mt-4 max-w-[38ch] text-[15px] text-ink-3">
            {t('home.scenarioNote')}
          </p>
        </div>
        <div className="plate p-6 sm:p-8">
          <p className="text-[22px] leading-[1.9] font-medium sm:text-[28px]">
            <select value={home} onChange={(e) => setHome(e.target.value)} className="pick" aria-label="Home team">
              {teams.map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name}
                </option>
              ))}
            </select>{' '}
            {t('home.host')}{' '}
            <select value={away} onChange={(e) => setAway(e.target.value)} className="pick" aria-label="Away team">
              {teams.map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name}
                </option>
              ))}
            </select>
            .{' '}
            {switchOn ? (
              <>
                {t('home.atMinute')}{' '}
                <input type="number" min={10} max={85} value={minute} onChange={(e) => setMinute(Math.max(10, Math.min(85, +e.target.value || 10)))} className="pick-num" aria-label="Minute of the switch" />
                {t('home.coachGoes')}{' '}
                <select value={formation} onChange={(e) => setFormation(e.target.value)} className="pick" aria-label="New formation">
                  {(options?.formations ?? ['3-4-3']).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>{' '}
                {t('home.andTell')} <span className="bg-volt px-1">{pressWord}</span>.
              </>
            ) : (
              <>{t('home.stickToPlans')}</>
            )}
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            {switchOn ? (
              <label className="block">
                <span className="cond text-ink-3">
                  {t('home.pressing')} · <span className="text-ink tab-num">{press.toFixed(2)}</span>
                </span>
                <input type="range" min={0} max={1} step={0.05} value={press} onChange={(e) => setPress(+e.target.value)} />
              </label>
            ) : (
              <span />
            )}
            <label className="flex items-center gap-2 text-[14px] text-ink-2">
              <input type="checkbox" checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} /> {t('home.tacticalSwitch')}
            </label>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button onClick={create} disabled={busy || home === away} className="btn btn-volt !px-7 !py-3">
              {busy ? <span className="working">{t('home.simulating')}</span> : t('home.kickOff')}
            </button>
            {home === away && <span className="text-[14px] text-flare">{t('home.sameClub')}</span>}
            {error && <span className="text-[14px] text-flare">{error}</span>}
          </div>
        </div>
      </div>
    </section>
  )
}
