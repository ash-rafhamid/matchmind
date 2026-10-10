import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api } from '../api'
import { CamCut, CameraSwitch, useCamCut } from '../components/Broadcast'
import { formatClock, PlaybackClock, useClock } from '../lib/clock'
import { scoreAt } from '../lib/match'
import { useSettings, useT } from '../lib/settings'
import { buildTrailer, ReelDirector, type ReelState } from '../lib/reel'
import { TrackingStore } from '../lib/tracking'
import { momentTitle, onPrimary, stripTags } from '../lib/ui'
import type { CameraMode } from '../scene/Stadium'
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
  const store = useMemo(() => (pkg ? new TrackingStore(pkg.meta.id, pkg.meta.version) : null), [pkg])
  const t = useT()

  const [reel, setReel] = useState<ReelState | null>(null)
  const [replayDir, setReplayDir] = useState<1 | -1 | null>(null)
  // the AI director cuts every goal like a trailer; any camera can be picked
  const [cam, setCam] = useState<CameraMode>('director')
  const { cut, onCut, pick, flash } = useCamCut(setCam)

  useEffect(() => {
    if (!clock || !pkg || !store) return
    // the front page is a trailer on a loop: each goal built up live from several cameras, the celebration,
    // then the goal again in slow motion from behind the net and from the side
    clock.waitFor = (time) => store.ready(time)
    const director = new ReelDirector(clock, store, buildTrailer(pkg))
    director.angles = ['goal', 'closeup']
    const unsub = director.subscribe((s) => {
      setReel(s)
      setReplayDir(s.phase === 'replay' && s.clip?.goal ? (s.clip.goal.team === 'home' ? 1 : -1) : null)
      if (s.phase === 'cut') flash(s.cutTo === 'replay' ? 'replay' : 'live')
      if (s.phase === 'done') window.setTimeout(() => (clock.seek(0), director.start()), 1500)
    })
    director.onExit = () => director.start()
    store.prefetch(0)
    const t = window.setTimeout(() => director.start(), 400)
    return () => {
      clearTimeout(t)
      unsub()
      director.stop()
      clock.destroy()
    }
  }, [clock, pkg, store, flash])

  return (
    <section className="relative h-[calc(100vh-52px)] min-h-[560px] overflow-hidden bg-ink">
      {pkg && clock && store ? (
        <Suspense fallback={null}>
          <Miniature pkg={pkg} store={store} clock={clock} mode={cam} tour={cam === 'director'} onCut={onCut} replay={replayDir} replayAngle={reel?.angle ?? 'goal'} className="absolute inset-0" />
        </Suspense>
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <p className="working cond text-volt">{t('app.loadingStadium')}</p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(11,12,14,0.78)_0%,rgba(11,12,14,0.35)_38%,transparent_62%),linear-gradient(0deg,rgba(11,12,14,0.55)_0%,transparent_35%)]" />
      <CamCut cut={cut} />
      {pkg && clock && (
        <div className="absolute top-4 right-4 z-[7] flex flex-col items-end gap-2 sm:top-6 sm:right-6">
          <OnAir pkg={pkg} clock={clock} replay={reel?.phase === 'replay'} />
          <CameraSwitch mode={cam} onMode={pick} />
        </div>
      )}
      {pkg && clock && <HeroCommentary pkg={pkg} clock={clock} reel={reel} />}
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

function OnAir({ pkg, clock, replay }: { pkg: MatchPackage; clock: PlaybackClock; replay: boolean }) {
  const { time } = useClock(clock, 4)
  const score = scoreAt(pkg.events, time)
  const { home, away } = pkg.meta.teams
  const t = useT()
  return (
    <div className="flex h-9 items-stretch shadow-[0_6px_24px_rgba(0,0,0,0.35)]">
      <span className="cut-l flex items-center gap-2 bg-flare pr-3 pl-4 cond text-white">
        <span className="live-pip !bg-white" /> {replay ? t('reel.replay') : t('home.onAir')}
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

/** The crew's verified commentary on the highlight being shown - only once it has happened on screen. */
function HeroCommentary({ pkg, clock, reel }: { pkg: MatchPackage; clock: PlaybackClock; reel: ReelState | null }) {
  const { persona, lang, t } = useSettings()
  const { time } = useClock(clock, 2)
  const id = reel?.clip?.moment
  const moment = id ? pkg.analytics.moments.find((m) => m.id === id) : undefined
  const [story, setStory] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    api
      .story(pkg.meta.id, id, persona, lang)
      .then((s) => alive && setStory({ id, text: stripTags(s.text), ok: !!s.verdict?.passed }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [pkg.meta.id, id, persona, lang])
  const show = !!moment && story?.id === moment.id && (reel?.phase === 'replay' || (reel?.phase === 'clip' && time >= moment.ts + 1))
  if (!show || !moment || !story) return null
  return (
    <div key={moment.id} className="wipe-up pointer-events-none absolute right-10 bottom-14 z-[7] hidden w-[440px] shadow-[0_10px_40px_rgba(0,0,0,0.35)] xl:block">
      <div className="flex items-stretch">
        <span className="cut-l flex items-center bg-volt ps-4 pe-3 cond text-ink">🎙 {t('home.crewLive')}</span>
        <span className="flex items-center bg-ink px-3 xp text-[13px] text-volt tab-num">{moment.clock}</span>
        <span className="plate cut-r flex min-w-0 flex-1 items-center pe-5 ps-3">
          <span className="xp truncate text-[14px]">{momentTitle(moment, t)}</span>
        </span>
      </div>
      <div className="plate px-4 py-3">
        <p className="line-clamp-4 text-[14px] leading-snug">{story.text}</p>
        {story.ok && <p className="mt-2 cond text-[11px] text-ink-3">✓ {t('home.factChecked')}</p>}
      </div>
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
/** Build your own match: two clubs, and the home coach's plan, laid out like a broadcast match-setup screen. */
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
  const homeName = options?.teams[home]?.name ?? ''
  const fill = (v: number, lo: number, hi: number) => ({ '--fill': `${((v - lo) / (hi - lo)) * 100}%` }) as CSSProperties

  return (
    <section className="mx-auto max-w-[1480px] px-4 py-14 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <h2 className="xp text-[40px] leading-[0.9] sm:text-[56px]">
            {t('home.scenario')}
            <br />
            <span className="xp-light">{t('home.lab')}</span>
          </h2>
          <p className="mt-4 max-w-[38ch] text-[15px] text-ink-3">{t('home.scenarioNote')}</p>
        </div>
        <div className="plate shadow-[0_10px_40px_rgba(11,12,14,0.08)]">
          {/* the fixture */}
          <div className="grid items-center gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:p-7">
            <TeamPick label={t('lab.home')} id={home} onChange={setHome} teams={teams} />
            <span className="text-center xp text-[20px] text-ink-4">{t('lab.vs')}</span>
            <TeamPick label={t('lab.away')} id={away} onChange={setAway} teams={teams} right />
          </div>
          {/* the home coach's plan */}
          <div className="border-t border-line px-5 py-5 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="cond text-ink-3">{t('lab.plan')}</span>
              <button role="switch" aria-checked={switchOn} onClick={() => setSwitchOn(!switchOn)} className="flex items-center gap-2.5 cond text-[12px] text-ink-2">
                <span className={`relative h-5 w-10 transition-colors ${switchOn ? 'bg-ink' : 'bg-concrete-2'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 transition-all ${switchOn ? 'left-[22px] bg-volt' : 'left-0.5 bg-white'}`} />
                </span>
                {t('home.tacticalSwitch')}
              </button>
            </div>
            {switchOn && (
              <div className="fade-in mt-5 grid gap-x-8 gap-y-6 md:grid-cols-2">
                <label className="block">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="cond text-ink-3">{t('lab.minute')}</span>
                    <span className="xp text-[26px] leading-none tab-num">{minute}'</span>
                  </span>
                  <input type="range" min={10} max={85} step={1} value={minute} onChange={(e) => setMinute(+e.target.value)} className="fill mt-2" style={fill(minute, 10, 85)} />
                </label>
                <label className="block">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="cond text-ink-3">{t('home.pressing')}</span>
                    <span className="cut-both bg-volt px-2.5 py-0.5 cond text-[12px] text-ink">{pressWord}</span>
                  </span>
                  <input type="range" min={0} max={1} step={0.05} value={press} onChange={(e) => setPress(+e.target.value)} className="fill mt-2" style={fill(press, 0, 1)} />
                </label>
                <div className="md:col-span-2">
                  <span className="cond text-ink-3">{t('lab.shape')}</span>
                  <div className="seg mt-2 flex flex-wrap bg-concrete" role="group" aria-label={t('lab.shape')}>
                    {(options?.formations ?? ['3-4-3']).map((f) => (
                      <button key={f} aria-pressed={formation === f} onClick={() => setFormation(f)} className="tab-num !text-[13px]">
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* what will happen, and kick off */}
          <div className="flex flex-wrap items-center gap-4 bg-ink px-5 py-4 sm:px-7">
            <p className="min-w-[220px] flex-1 text-[15px] leading-snug text-white/85">
              {switchOn ? t('lab.summary', { minute, team: homeName, formation, press: pressWord }) : t('home.stickToPlans')}
            </p>
            <button onClick={create} disabled={busy || home === away} className="btn btn-volt !px-7 !py-3">
              {busy ? <span className="working">{t('home.simulating')}</span> : t('home.kickOff')}
            </button>
          </div>
          {(home === away || error) && <p className="px-5 py-3 text-[14px] text-flare sm:px-7">{home === away ? t('home.sameClub') : error}</p>}
        </div>
      </div>
    </section>
  )
}

type TeamOption = [string, { name: string; primary: string; formation: string; traits: string[] }]

/** A club picker that looks like a broadcast caption: club colour, name, shape and style. */
function TeamPick({ label, id, onChange, teams, right = false }: { label: string; id: string; onChange: (id: string) => void; teams: TeamOption[]; right?: boolean }) {
  const team = teams.find(([k]) => k === id)?.[1]
  return (
    <label className={`relative flex min-w-0 items-stretch bg-concrete transition-colors focus-within:outline-2 focus-within:outline-flare hover:bg-concrete-2 ${right ? 'sm:flex-row-reverse sm:text-right' : ''}`}>
      <span className="w-2.5 shrink-0" style={{ background: team?.primary ?? 'var(--color-ink-4)' }} />
      <span className="min-w-0 flex-1 px-4 py-3">
        <span className="block cond text-[11px] text-ink-3">{label}</span>
        <span className="block truncate xp text-[20px] leading-tight sm:text-[24px]">
          {team?.name ?? '…'} <span className="text-[13px] text-ink-4">▼</span>
        </span>
        <span className="block truncate text-[12px] text-ink-3">{team ? [team.formation, ...team.traits.slice(0, 2)].join(' · ') : ''}</span>
      </span>
      <select value={id} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label}>
        {teams.map(([k, tm]) => (
          <option key={k} value={k}>
            {tm.name}
          </option>
        ))}
      </select>
    </label>
  )
}
