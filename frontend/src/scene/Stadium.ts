import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js'
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js'
import type { PlaybackClock } from '../lib/clock'
import type { TrackingStore } from '../lib/tracking'
import type { MatchEvent, MatchPackage, Side } from '../types'

/*
 * "Matchday Miniature": the synthetic match as a living tabletop stadium.
 *
 * Pitch coordinates (x 0..105 towards the away goal, y 0..68 across) map to
 * three.js as X = x - 52.5, Z = y - 34, Y = height. The main camera sits on
 * the y = 68 touchline, so the home side attacks to the right, as on TV.
 *
 * Performance: every body part of all 30 footballers is one InstancedMesh
 * (about ten draw calls for every player on the pitch), the scene only renders
 * when it is on screen and something changed, and quality steps down
 * automatically on slower machines.
 */

export type CameraMode = 'director' | 'broadcast' | 'tactical' | 'goal' | 'follow'

const L = 105
const W = 68
const FIG = 1.22 // figures are scaled up a little so they read at broadcast distance
const HIP = 0.98
const THIGH = 0.46
const SHIN = 0.46
const SHOULDER = 1.44
const UPPER_ARM = 0.29
const BALL_R = 0.36
const STRIDE = 1.9 // metres per full running cycle (two steps)
const SKIN = ['#f1c9a5', '#e0b18a', '#c68f63', '#9c6a46', '#6e4a33', '#4f3324']
const HAIR = ['#1b1612', '#2e2219', '#4a3424', '#7a5634', '#c9a25e', '#111111']
const BALL_TYPES = new Set(['pass', 'carry', 'shot', 'interception', 'tackle', 'save', 'clearance', 'block'])

const toX = (x: number) => x - L / 2
const toZ = (y: number) => y - W / 2

interface Body {
  side: Side
  x: number
  z: number
  heading: number
  phase: number
  amp: number
  speed: number
  has: boolean
}

interface Shot {
  ts: number
  dir: 1 | -1
  goal: boolean
}

export interface StadiumOptions {
  name: (pid: string) => string
  crowd?: boolean
  /** Called whenever the camera cuts to a different shot (not on the very first frame). */
  onCut?: (shot: string) => void
}

/** One body part for all players, drawn in a single call. */
class Part {
  mesh: THREE.InstancedMesh
  constructor(geo: THREE.BufferGeometry, count: number, scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.75 }), count)
    this.mesh.castShadow = true
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(this.mesh)
  }
}

type PartName = 'torso' | 'shorts' | 'neck' | 'head' | 'hair' | 'thighs' | 'shins' | 'boots' | 'upperArms' | 'foreArms' | 'hands'
const SINGLE: PartName[] = ['torso', 'shorts', 'neck', 'head', 'hair']
const PAIRED: PartName[] = ['thighs', 'shins', 'boots', 'upperArms', 'foreArms', 'hands']

/** A body shape turned on a lathe: [radius, height] from the bottom up. */
function lathe(profile: [number, number][], segments = 16): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments)
}

const TOUR: ['broadcast' | 'follow' | 'tactical' | 'goal', number][] = [
  ['broadcast', 9],
  ['follow', 7],
  ['broadcast', 7],
  ['tactical', 6],
  ['broadcast', 7],
  ['goal', 6],
]
const TOUR_LENGTH = TOUR.reduce((a, [, d]) => a + d, 0)

const tmpM = new THREE.Matrix4()
const tmpB = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpV = new THREE.Vector3()
const tmpS = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)
const POOL = Array.from({ length: 16 }, () => new THREE.Matrix4())
const tmpLook = new THREE.Vector3()
const tmpNdc = new THREE.Vector3()

export class Stadium {
  private container: HTMLElement
  private pkg: MatchPackage
  private store: TrackingStore
  private clock: PlaybackClock
  private opts: StadiumOptions

  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private composer: EffectComposer
  private hPass: ShaderPass
  private vPass: ShaderPass
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(22, 16 / 9, 1, 900)
  private sun!: THREE.DirectionalLight
  private raf = 0
  private ro: ResizeObserver
  private io: IntersectionObserver
  private onScreen = true
  private disposed = false

  private ids: string[] = []
  private bodies: Body[] = []
  private parts!: Record<PartName, Part>
  private ball!: THREE.Mesh
  private ballMark!: THREE.Mesh
  private ring!: THREE.Mesh
  private passArc: THREE.Mesh | null = null
  private passKey = -1
  private arMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
  private shotMat = new THREE.MeshBasicMaterial({ color: 0xff4d2e, transparent: true, opacity: 0.95, depthWrite: false })
  private highlightGroup = new THREE.Group()
  private ownerTag: CSS2DObject
  private hoverTag: CSS2DObject
  private xgTag: CSS2DObject
  private tagText = new Map<CSS2DObject, string>()
  private crowd: THREE.InstancedMesh | null = null
  private crowdBase: { m: THREE.Matrix4; side: Side | 'n' }[] = []
  /** A goal celebration, tied to match time: [from, until). Rewinding for a replay goes back before it. */
  private cheer: { side: Side; from: number; until: number } | null = null
  private ballEvents: MatchEvent[]
  private shots: Shot[]
  /** When each goal's ball crosses the line, in match time. */
  private goalsIn: { side: Side; from: number }[]

  private mode: CameraMode = 'director'
  private tour = false
  private override: { shot: 'replay'; dir: 1 | -1 } | null = null
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private focus = new THREE.Vector3()
  private focusY = 0.5
  private lastCut = ''
  private pointer: THREE.Vector2 | null = null
  private pointerMoved = false
  private raycaster = new THREE.Raycaster()
  private hoverIdx = -1

  private lastMatchT = -1
  private lastNow = 0
  private idleFrames = 0
  private wasReady = false
  private quality = 0
  private frameTimes: number[] = []

  constructor(container: HTMLElement, pkg: MatchPackage, store: TrackingStore, clock: PlaybackClock, opts: StadiumOptions) {
    this.container = container
    this.pkg = pkg
    this.store = store
    this.clock = clock
    this.opts = opts

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    container.appendChild(this.labels.domElement)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.hPass = new ShaderPass(HorizontalTiltShiftShader)
    this.vPass = new ShaderPass(VerticalTiltShiftShader)
    this.composer.addPass(this.hPass)
    this.composer.addPass(this.vPass)
    this.composer.addPass(new ShaderPass(GRADE))
    this.composer.addPass(new OutputPass())

    this.ballEvents = pkg.events.filter((e) => BALL_TYPES.has(e.type))
    this.goalsIn = pkg.events.filter((e) => e.type === 'shot' && e.outcome === 'goal').map((e) => ({ side: e.team, from: e.ts + e.dur }))
    this.shots = pkg.events
      .filter((e) => e.type === 'shot' && (e.outcome === 'goal' || e.outcome === 'saved' || (e.xg ?? 0) >= 0.12))
      .map((e) => ({ ts: e.ts, dir: e.team === 'home' ? 1 : -1, goal: e.outcome === 'goal' }))

    this.buildWorld()
    this.buildBall()
    this.buildFigures()
    this.scene.add(this.highlightGroup)
    this.ownerTag = this.tag('mm-tag mm-tag-owner')
    this.hoverTag = this.tag('mm-tag mm-tag-hover')
    this.xgTag = this.tag('mm-tag mm-tag-xg')

    // start a notch lower on small or very dense screens
    const dpr = window.devicePixelRatio || 1
    this.setQuality((navigator.hardwareConcurrency ?? 8) <= 4 || dpr > 2 ? 1 : 0)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.io = new IntersectionObserver(
      (entries) => {
        this.onScreen = entries[0]?.isIntersecting ?? true
        this.idleFrames = 0
      },
      { threshold: 0.01 },
    )
    this.io.observe(container)
    this.resize()
    this.renderer.domElement.addEventListener('pointermove', this.onPointer)
    this.renderer.domElement.addEventListener('pointerleave', this.onLeave)
    this.raf = requestAnimationFrame(this.loop)
  }

  // ------------------------------------------------------------------ public

  setMode(mode: CameraMode) {
    this.mode = mode
    this.idleFrames = 0
  }

  /** The front page's AI director also tours the other angles between the big moments. */
  setTour(on: boolean) {
    this.tour = on
    this.idleFrames = 0
  }

  /** Take the camera for a replay (low, behind the goal being scored in), or give it back. */
  setReplay(dir: 1 | -1 | null) {
    this.override = dir ? { shot: 'replay', dir } : null
    this.idleFrames = 0
  }

  /** Draw evidence events into the scene as numbered AR markers and arrows. */
  setHighlights(events: MatchEvent[]) {
    for (const c of [...this.highlightGroup.children]) {
      this.highlightGroup.remove(c)
      if (c instanceof CSS2DObject) c.element.remove()
      if (c instanceof THREE.Mesh) c.geometry.dispose()
    }
    events.forEach((e, i) => {
      const start = new THREE.Vector3(toX(e.x), 0.08, toZ(e.y))
      if (e.end_x !== undefined && ['pass', 'carry', 'clearance', 'shot'].includes(e.type)) {
        const end = new THREE.Vector3(toX(e.end_x), e.type === 'shot' ? 1.2 : 0.08, toZ(e.end_y!))
        this.highlightGroup.add(this.arc(start, end, e.type === 'shot' ? 2.2 : 0.4, this.shotMat, 0.13))
      }
      const el = document.createElement('div')
      el.className = 'mm-marker'
      el.textContent = String(i + 1)
      const obj = new CSS2DObject(el)
      obj.position.copy(start).setY(0.3)
      this.highlightGroup.add(obj)
    })
    this.idleFrames = 0
  }

  /** Debugging: draw the exact moment t once, whatever the visibility, with the camera settled. */
  debugRender(t: number) {
    this.clock.seek(t)
    const f = this.store.frameAt(t)
    for (let k = 0; k < 3; k++) {
      if (f) this.place(f, t, k === 0 ? 0 : 0.1, 1)
      this.lastCut = ''
      this.updateCamera(t, f, 1)
    }
    this.composer.render()
    this.labels.render(this.scene, this.camera)
    return f ? { ball: [...f.ball], owner: f.owner >= 0 ? f.ids[f.owner] : null } : null
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.io.disconnect()
    this.renderer.domElement.removeEventListener('pointermove', this.onPointer)
    this.renderer.domElement.removeEventListener('pointerleave', this.onLeave)
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose()
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => {
          ;(m as THREE.MeshStandardMaterial).map?.dispose()
          m.dispose()
        })
      }
    })
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }

  // ------------------------------------------------------------------ quality

  /** 0 = full, 1 = lighter resolution, 2 = no tilt-shift, 3 = no shadows. */
  private setQuality(level: number) {
    this.quality = level
    const dpr = window.devicePixelRatio || 1
    const ratio = [Math.min(dpr, 1.75), Math.min(dpr, 1.25), 1, 0.85][level]
    this.renderer.setPixelRatio(ratio)
    this.composer.setPixelRatio(ratio)
    const tilt = level < 2
    this.hPass.enabled = tilt
    this.vPass.enabled = tilt
    this.sun.castShadow = level < 3
    const size = level === 0 ? 2048 : 1024
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    this.resize()
  }

  private watchFrameRate(ms: number) {
    this.frameTimes.push(ms)
    if (this.frameTimes.length < 90) return
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    this.frameTimes = []
    if (avg > 24 && this.quality < 3) this.setQuality(this.quality + 1)
  }

  // ------------------------------------------------------------------ world

  private buildWorld() {
    const s = this.scene
    s.background = new THREE.Color('#bfcad0')
    s.fog = new THREE.Fog('#bfcad0', 220, 520)

    s.add(new THREE.HemisphereLight('#e8f2ff', '#3f4a32', 1.1))
    const sun = new THREE.DirectionalLight('#fff0d8', 2.6)
    sun.position.set(-55, 90, 45)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = -95
    sc.right = 95
    sc.top = 75
    sc.bottom = -75
    sc.near = 10
    sc.far = 260
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
    s.add(sun)
    this.sun = sun

    const table = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: '#7d8b80', roughness: 1 }))
    table.rotation.x = -Math.PI / 2
    table.position.y = -0.05
    table.receiveShadow = true
    s.add(table)

    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + 12, W + 12), new THREE.MeshStandardMaterial({ map: grassTexture(this.renderer), roughness: 0.92 }))
    pitch.rotation.x = -Math.PI / 2
    pitch.receiveShadow = true
    s.add(pitch)

    this.buildGoals()
    this.buildStands()
    this.buildBoards()
    this.buildPylons()

    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.32, 48), this.arMat)
    ring.rotation.x = -Math.PI / 2
    ring.renderOrder = 2
    ring.visible = false
    s.add(ring)
    this.ring = ring
  }

  private buildGoals() {
    const post = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 })
    const net = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 })
    for (const dir of [-1, 1]) {
      const g = new THREE.Group()
      const x = dir * (L / 2)
      const r = 0.09
      const cyl = (len: number) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), post)
      for (const z of [-3.66, 3.66]) {
        const p = cyl(2.44)
        p.position.set(x, 1.22, z)
        p.castShadow = true
        g.add(p)
      }
      const bar = cyl(7.32)
      bar.rotation.x = Math.PI / 2
      bar.position.set(x, 2.44, 0)
      bar.castShadow = true
      g.add(bar)
      const pts: number[] = []
      const depth = 2.0 * dir
      for (let i = 0; i <= 12; i++) {
        const z = -3.66 + (7.32 * i) / 12
        pts.push(x, 2.44, z, x + depth, 1.6, z, x + depth, 1.6, z, x + depth, 0, z)
      }
      for (let j = 0; j <= 5; j++) {
        const yy = (2.44 * j) / 5
        const back = 1.6 * (j / 5)
        pts.push(x + depth, back, -3.66, x + depth, back, 3.66)
        pts.push(x, yy, -3.66, x + depth, Math.min(yy, 1.6), -3.66, x, yy, 3.66, x + depth, Math.min(yy, 1.6), 3.66)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      g.add(new THREE.LineSegments(geo, net))
      this.scene.add(g)
    }
  }

  private buildStands() {
    const { home, away } = this.pkg.meta.teams
    const concrete = new THREE.MeshStandardMaterial({ color: '#d7d3c8', roughness: 0.95 })
    const roofMat = new THREE.MeshStandardMaterial({ color: '#eceae4', roughness: 0.6, metalness: 0.1 })
    const step = 1.5
    const rise = 1.05
    const gap = 9
    const seats: { pos: THREE.Vector3; rotY: number; side: Side | 'n' }[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

    const stand = (length: number, along: 'x' | 'z', sign: 1 | -1, half: number, homeShare: number, tiers = 9, roofed = true) => {
      // one stepped block per stand instead of one per tier
      const shape = new THREE.Shape()
      shape.moveTo(0, 0)
      for (let t = 0; t < tiers; t++) {
        shape.lineTo(t * step, 0.6 + t * rise)
        shape.lineTo((t + 1) * step, 0.6 + t * rise)
      }
      shape.lineTo(tiers * step, 0)
      shape.lineTo(0, 0)
      const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
      geo.translate(0, 0, -length / 2)
      const block = new THREE.Mesh(geo, concrete)
      const d0 = half + gap
      if (along === 'x') {
        block.rotation.y = sign === -1 ? Math.PI / 2 : -Math.PI / 2
        block.position.set(0, 0, sign * d0)
      } else {
        block.rotation.y = sign === 1 ? 0 : Math.PI
        block.position.set(sign * d0, 0, 0)
      }
      block.receiveShadow = true
      this.scene.add(block)
      for (let t = 0; t < tiers; t++) {
        const dist = d0 + t * step + step * 0.5
        const h = 0.6 + t * rise
        const n = Math.floor(length / 0.95)
        for (let i = 0; i < n; i++) {
          if (rnd() < 0.08) continue
          const a = -length / 2 + (i + 0.5) * (length / n)
          const p = along === 'x' ? new THREE.Vector3(a, h + 0.3, sign * dist) : new THREE.Vector3(sign * dist, h + 0.3, a)
          const r = rnd()
          const side: Side | 'n' = r < homeShare ? 'home' : r < homeShare + (1 - homeShare) * 0.8 ? 'away' : 'n'
          seats.push({ pos: p, rotY: along === 'x' ? 0 : Math.PI / 2, side })
        }
      }
      if (!roofed) return
      const dist = d0 + tiers * step
      const roof = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? length + 4 : 9, 0.4, along === 'x' ? 9 : length + 4), roofMat)
      if (along === 'x') roof.position.set(0, 0.6 + tiers * rise + 4.5, sign * (dist - 2.5))
      else roof.position.set(sign * (dist - 2.5), 0.6 + tiers * rise + 4.5, 0)
      roof.castShadow = true
      this.scene.add(roof)
    }
    stand(L + 16, 'x', -1, W / 2, 0.75)
    stand(L + 16, 'x', 1, W / 2, 0.6, 5, false)
    stand(W + 6, 'z', -1, L / 2, 0.92)
    stand(W + 6, 'z', 1, L / 2, 0.18)
    if (this.opts.crowd === false) return

    const geo = new THREE.BoxGeometry(0.5, 0.62, 0.45)
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), seats.length)
    const neutral = ['#2d3436', '#dfe6e9', '#636e72', '#b2bec3', '#3d5a80', '#e0a458']
    const pal = { home: [home.primary, home.primary, home.secondary], away: [away.primary, away.primary, away.secondary] }
    const c = new THREE.Color()
    seats.forEach((seat, i) => {
      tmpM.makeRotationY(seat.rotY)
      tmpM.setPosition(seat.pos)
      mesh.setMatrixAt(i, tmpM)
      const list = seat.side === 'n' ? neutral : pal[seat.side]
      c.set(list[Math.floor(rnd() * list.length)])
      c.offsetHSL(0, 0, (rnd() - 0.5) * 0.08)
      mesh.setColorAt(i, c)
      this.crowdBase.push({ m: tmpM.clone(), side: seat.side })
    })
    mesh.receiveShadow = true
    this.crowd = mesh
    this.scene.add(mesh)
  }

  private buildBoards() {
    const tex = boardTexture()
    const board = (len: number, x: number, z: number, rotY: number) => {
      const t = tex.clone()
      t.repeat.set(len / 24, 1)
      t.wrapS = THREE.RepeatWrapping
      t.needsUpdate = true
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.9, 0.12),
        new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: new THREE.Color('#ffffff'), emissiveMap: t, emissiveIntensity: 0.35 }),
      )
      m.position.set(x, 0.45, z)
      m.rotation.y = rotY
      this.scene.add(m)
    }
    board(L + 6, 0, -(W / 2 + 4.5), 0)
    board(W - 12, -(L / 2 + 4.5), 0, Math.PI / 2)
    board(W - 12, L / 2 + 4.5, 0, -Math.PI / 2)
  }

  private buildPylons() {
    const mat = new THREE.MeshStandardMaterial({ color: '#9aa1a6', roughness: 0.6, metalness: 0.4 })
    const lamp = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#fff6dd'), emissiveIntensity: 1.2 })
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const g = new THREE.Group()
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 38, 8), mat)
        mast.position.y = 19
        const head = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.6), lamp)
        head.position.y = 38.5
        head.lookAt(new THREE.Vector3(-sx * 60, 0, -sz * 40))
        g.add(mast, head)
        g.position.set(sx * (L / 2 + 22), 0, sz * (W / 2 + 22))
        this.scene.add(g)
      }
  }

  /**
   * Footballers with human proportions - chest, waist, neck, head, thighs and shins with knees,
   * upper arms and forearms with elbows - every body part instanced across all players.
   */
  private buildFigures() {
    const meta = this.pkg.meta
    const players = (['home', 'away'] as Side[]).flatMap((side) => meta.teams[side].players.map((p) => ({ p, side })))
    const n = players.length
    this.ids = players.map(({ p }) => p.id)
    const torso = lathe([[0.13, 0], [0.135, 0.08], [0.15, 0.2], [0.175, 0.32], [0.182, 0.4], [0.165, 0.46], [0.115, 0.505], [0.05, 0.53], [0, 0.535]], 20)
    torso.scale(1.26, 1, 0.68)
    const shorts = lathe([[0, -0.01], [0.165, 0], [0.175, 0.08], [0.16, 0.2], [0.145, 0.25], [0, 0.26]], 20)
    shorts.scale(1.18, 1, 0.82)
    const g: Record<PartName, THREE.BufferGeometry> = {
      torso,
      shorts,
      neck: new THREE.CylinderGeometry(0.052, 0.06, 0.12, 10),
      head: new THREE.SphereGeometry(0.108, 16, 12).scale(0.92, 1.12, 1),
      hair: new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.48).scale(0.94, 1.08, 1.04).translate(0, 0.022, -0.012),
      thighs: new THREE.CapsuleGeometry(0.078, THIGH - 0.12, 4, 10).translate(0, -THIGH / 2, 0),
      shins: new THREE.CapsuleGeometry(0.062, SHIN - 0.1, 4, 10).translate(0, -SHIN / 2, 0),
      boots: new THREE.BoxGeometry(0.1, 0.07, 0.25).translate(0, -SHIN - 0.01, 0.05),
      upperArms: new THREE.CapsuleGeometry(0.052, UPPER_ARM - 0.1, 4, 8).translate(0, -UPPER_ARM / 2, 0),
      foreArms: new THREE.CapsuleGeometry(0.044, 0.22, 4, 8).translate(0, -0.15, 0),
      hands: new THREE.SphereGeometry(0.048, 10, 8).scale(0.75, 1.25, 0.55).translate(0, -0.34, 0),
    }
    const counts = Object.fromEntries(Object.keys(g).map((k) => [k, PAIRED.includes(k as PartName) ? 2 * n : n])) as Record<PartName, number>
    this.parts = Object.fromEntries(Object.entries(g).map(([k, geo]) => [k, new Part(geo, counts[k as PartName], this.scene)])) as Record<PartName, Part>
    const col = new THREE.Color()
    players.forEach(({ p, side }, i) => {
      const team = meta.teams[side]
      const gk = p.role === 'GK'
      const h = hash(p.id)
      const shirt = gk ? (side === 'home' ? '#f5d90a' : '#39d353') : team.primary
      const shorts = gk ? '#1f1f1f' : team.secondary
      const socks = gk ? '#1f1f1f' : team.primary
      const skin = SKIN[h % SKIN.length]
      const set = (part: PartName, idx: number, c: string) => this.parts[part].mesh.setColorAt(idx, col.set(c))
      set('torso', i, shirt)
      set('shorts', i, shorts)
      set('neck', i, skin)
      set('head', i, skin)
      set('hair', i, HAIR[(h >> 3) % HAIR.length])
      for (const k of [2 * i, 2 * i + 1]) {
        set('thighs', k, skin)
        set('shins', k, socks)
        set('boots', k, (h >> 5) % 3 === 0 ? '#f2f2f2' : '#151515')
        set('upperArms', k, shirt)
        set('foreArms', k, gk ? shirt : skin)
        set('hands', k, gk ? '#e9ecef' : skin)
      }
      this.bodies.push({ side, x: 0, z: 0, heading: side === 'home' ? Math.PI / 2 : -Math.PI / 2, phase: (h % 100) / 16, amp: 0, speed: 0, has: false })
    })
    for (const part of Object.values(this.parts)) {
      for (let k = 0; k < part.mesh.count; k++) part.mesh.setMatrixAt(k, ZERO)
      part.mesh.instanceColor!.needsUpdate = true
    }
  }

  private buildBall() {
    this.ballMark = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }))
    this.ballMark.rotation.x = -Math.PI / 2
    this.ballMark.renderOrder = 1
    this.scene.add(this.ballMark)
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35 }))
    this.ball.castShadow = true
    this.scene.add(this.ball)
  }

  private tag(cls: string): CSS2DObject {
    const el = document.createElement('div')
    el.className = cls
    const obj = new CSS2DObject(el)
    obj.visible = false
    this.scene.add(obj)
    return obj
  }

  private setTag(obj: CSS2DObject, html: string) {
    if (this.tagText.get(obj) === html) return
    this.tagText.set(obj, html)
    obj.element.innerHTML = html
  }

  private arc(a: THREE.Vector3, b: THREE.Vector3, peak: number, mat: THREE.Material, radius = 0.09): THREE.Mesh {
    const mid = a.clone().lerp(b, 0.5)
    mid.y = Math.max(a.y, b.y) + peak
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 32, radius, 6, false), mat)
    mesh.renderOrder = 3
    return mesh
  }

  // ------------------------------------------------------------------ loop

  private resize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = `${w}px`
    this.renderer.domElement.style.height = `${h}px`
    this.labels.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.hPass.uniforms.h.value = 1.5 / w
    this.vPass.uniforms.v.value = 1.5 / h
    this.idleFrames = 0
  }

  private onPointer = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.pointerMoved = true
  }

  private onLeave = () => {
    this.pointer = null
    this.pointerMoved = true
  }

  private loop = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const realDt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0.016
    this.lastNow = now
    if (!this.onScreen || document.hidden) return

    const t = this.clock.timeAt(now)
    const f = this.store.frameAt(t)
    const ready = f !== null
    const changed = t !== this.lastMatchT || this.pointerMoved || this.cheer !== null || ready !== this.wasReady
    this.wasReady = ready
    // when paused and nothing moves, stop redrawing once the camera has settled
    this.idleFrames = changed ? 0 : this.idleFrames + 1
    if (this.idleFrames > 150) return
    const dtMatch = this.lastMatchT < 0 ? 0 : t - this.lastMatchT
    this.lastMatchT = t
    this.pointerMoved = false

    if (f) this.place(f, t, dtMatch, realDt)
    this.updateCamera(t, f, realDt)
    this.updateCrowd(now)
    this.composer.render()
    this.labels.render(this.scene, this.camera)
    if (this.clock.playing) this.watchFrameRate(realDt * 1000)
  }

  private place(f: NonNullable<ReturnType<TrackingStore['frameAt']>>, t: number, dtMatch: number, realDt: number) {
    const [bxp, byp] = f.ball
    const bx = toX(bxp)
    const bz = toZ(byp)
    const teleport = Math.abs(dtMatch) > 1.5
    const cues = this.store.activeCues(t)
    const P = this.parts
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]
      const xr = f.x[i]
      if (f.ids[i] !== this.ids[i] || Number.isNaN(xr)) {
        if (b.has) {
          for (const part of SINGLE) P[part].mesh.setMatrixAt(i, ZERO)
          for (const part of PAIRED) {
            P[part].mesh.setMatrixAt(2 * i, ZERO)
            P[part].mesh.setMatrixAt(2 * i + 1, ZERO)
          }
        }
        b.has = false
        continue
      }
      const x = toX(xr)
      const z = toZ(f.y[i])
      let vx = 0
      let vz = 0
      if (b.has && !teleport && dtMatch > 0) {
        vx = (x - b.x) / dtMatch
        vz = (z - b.z) / dtMatch
        const dist = Math.hypot(x - b.x, z - b.z)
        b.phase += (dist / STRIDE) * Math.PI * 2
      }
      const sp = Math.min(10, Math.hypot(vx, vz))
      const k = 1 - Math.exp(-10 * realDt)
      if (dtMatch !== 0 || !b.has) b.speed += (sp - b.speed) * (b.has ? k : 1)
      b.amp += (Math.min(1, b.speed / 6.5) - b.amp) * k
      // run towards where you are going; when standing, face the ball
      const target = b.speed > 1.2 ? Math.atan2(vx, vz) : Math.atan2(bx - x, bz - z)
      let d = target - b.heading
      d = Math.atan2(Math.sin(d), Math.cos(d))
      b.heading += d * (1 - Math.exp(-(b.speed > 1.2 ? 9 : 3) * realDt))
      b.x = x
      b.z = z
      b.has = true

      const sprint = Math.min(1, b.speed / 8)
      const a = b.amp
      const ph = b.phase
      // running gait: thighs swing, knees fold as the leg comes through, arms drive bent at the elbow
      const reach = (0.42 + 0.3 * sprint) * a
      let thighL = -reach * Math.sin(ph)
      let thighR = reach * Math.sin(ph)
      let kneeL = a * (0.15 + (0.9 + 0.5 * sprint) * Math.max(0, Math.cos(ph)))
      let kneeR = a * (0.15 + (0.9 + 0.5 * sprint) * Math.max(0, -Math.cos(ph)))
      const drive = (0.45 + 0.35 * sprint) * a
      let armL = drive * Math.sin(ph)
      let armR = -drive * Math.sin(ph)
      let elbowL = -(0.25 + 1.15 * a)
      let elbowR = -(0.25 + 1.15 * a)
      let bob = Math.abs(Math.cos(ph)) * 0.045 * a
      let pitch = 0.08 * a + 0.16 * sprint
      let roll = 0
      let drop = 0
      const party = this.cheer !== null && this.cheer.side === b.side && t >= this.cheer.from && t < this.cheer.until
      if (party) {
        // the scoring side celebrates: arms up, jumping
        const wave = performance.now() / 1000
        bob = Math.abs(Math.sin(wave * 7 + i)) * 0.2
        thighL = thighR = 0
        kneeL = kneeR = 0.15
        armL = -2.7 + 0.25 * Math.sin(wave * 9 + i)
        armR = -2.7 + 0.25 * Math.cos(wave * 9 + i)
        elbowL = elbowR = -0.2
        pitch = 0
      }
      // football movements: kicks, tackles, slides, falls, dives
      const act = cues.get(i)
      if (act && !party) {
        const u = act.u
        const arc = Math.sin(Math.PI * u)
        const hold = Math.max(0, Math.min(1, u / 0.22, (1 - u) / 0.25))
        switch (act.kind) {
          case 1: // pass and
          case 2: {
            // shot: the striking leg swings back, then through the ball
            const big = act.kind === 2 ? 1.3 : 1
            thighR = (0.65 - 1.9 * u) * big
            kneeR = u < 0.45 ? 1.3 * big * Math.sin((Math.PI * u) / 0.45) : 0.2
            thighL = -0.1
            kneeL = 0.35
            armL = -0.8 * big * arc
            armR = 0.6 * big * arc
            elbowL = elbowR = -0.4
            pitch = -0.08 * big * arc
            break
          }
          case 3: // stab tackle and
          case 5: {
            // lunge: plant one leg, stretch the other at the ball
            const k = act.kind === 3 ? 1 : 0.8
            thighR = -1.15 * k * arc
            kneeR = 0.15
            thighL = 0.25 * k * arc
            kneeL = 0.9 * k * arc
            pitch = 0.35 * k * arc
            armL = -0.7 * arc
            armR = 0.8 * arc
            break
          }
          case 4: // slide tackle: down on the hip, legs first
            roll = (i % 2 ? 1 : -1) * 1.2 * hold
            pitch = -0.4 * hold
            thighR = -1.35 * hold
            thighL = -1.0 * hold
            kneeR = 0.1
            kneeL = 0.5 * hold
            armL = 0.9 * hold
            armR = 0.4 * hold
            break
          case 6: {
            // fouled: goes down, then gets up
            const down = Math.max(0, Math.min(1, u / 0.18, (1 - u) / 0.3))
            // flat on his front: arms out ahead, heels up
            pitch = 1.52 * down
            armL = -2.55 * down
            armR = -2.25 * down
            elbowL = -0.5 * down
            elbowR = -0.8 * down
            thighL = 0.05 * down
            thighR = -0.1 * down
            kneeL = 0.75 * down
            kneeR = 0.35 * down
            break
          }
          case 7: // goalkeeper dive towards +y or -y of the pitch
          case 8: {
            const toward = act.kind === 7 ? 1 : -1
            roll = Math.sign(Math.sin(b.heading) || 1) * toward * 1.35 * hold
            drop = -0.45 * arc // in the air
            armL = armR = -2.9 * hold
            elbowL = elbowR = -0.1
            thighL = 0.2 * hold
            thighR = -0.25 * hold
            kneeL = kneeR = 0.3 * hold
            break
          }
          case 9: // block: spread out, arms tucked
            thighL = -0.45 * arc
            thighR = 0.45 * arc
            kneeL = kneeR = 0.4 * arc
            armL = armR = 0.1
            elbowL = elbowR = -1.6
            pitch = 0.2 * arc
            break
        }
      }
      tmpQ.setFromAxisAngle(UP, b.heading)
      tmpB.compose(tmpV.set(x, 0, z), tmpQ, tmpS.setScalar(FIG))
      if (roll) tmpB.multiply(tmpM.makeRotationZ(roll))
      tmpB.multiply(tmpM.makeRotationX(pitch))
      let slot = 0
      // a joint: start from `parent`, move to (ox, oy), then bend by `rotX`
      const joint = (parent: THREE.Matrix4, ox: number, oy: number, rotX: number, rotZ = 0) => {
        const m = POOL[slot++].copy(parent).multiply(tmpM.makeTranslation(ox, oy, 0))
        if (rotZ) m.multiply(tmpM.makeRotationZ(rotZ))
        if (rotX) m.multiply(tmpM.makeRotationX(rotX))
        return m
      }
      const torsoM = joint(tmpB, 0, HIP, 0)
      const shortsM = joint(tmpB, 0, HIP - 0.17, 0)
      const neckM = joint(tmpB, 0, HIP + 0.56, 0)
      const headM = joint(tmpB, 0, HIP + 0.69, 0)
      const limbs = ([[-1, thighL, kneeL, armL, elbowL], [1, thighR, kneeR, armR, elbowR]] as const).map(([side, thigh, knee, arm, elbow]) => {
        const hip = joint(tmpB, side * 0.1, HIP, thigh)
        const shin = joint(hip, 0, -THIGH, knee)
        const shoulder = joint(tmpB, side * 0.245, SHOULDER, arm, side * (0.1 + 0.08 * a))
        const fore = joint(shoulder, 0, -UPPER_ARM, elbow)
        return { hip, shin, shoulder, fore }
      })
      // rest the body on the grass: find its lowest point (boots, knees, hips, chest, head, hands) and lift
      // or lower everything so that point touches the ground - a slide or a fall lies on the pitch, not in it
      let low = Infinity
      const probe = (m: THREE.Matrix4, px: number, py: number, pz: number) => {
        const y = tmpV.set(px, py, pz).applyMatrix4(m).y
        if (y < low) low = y
      }
      probe(torsoM, 0, 0.3, 0.13)
      probe(torsoM, 0, 0.3, -0.13)
      probe(torsoM, 0.22, 0.4, 0)
      probe(torsoM, -0.22, 0.4, 0)
      probe(shortsM, 0.2, 0.05, 0)
      probe(shortsM, -0.2, 0.05, 0)
      probe(shortsM, 0, 0.05, -0.14)
      probe(headM, 0, 0.13, 0)
      probe(headM, 0, 0, 0.11)
      probe(headM, 0, 0, -0.11)
      probe(headM, 0.1, 0, 0)
      probe(headM, -0.1, 0, 0)
      for (const l of limbs) {
        probe(l.hip, 0, -THIGH, 0.08)
        probe(l.shin, 0, -SHIN - 0.045, 0.17)
        probe(l.shin, 0, -SHIN - 0.045, -0.07)
        probe(l.shin, 0, -SHIN / 2, -0.07)
        probe(l.fore, 0, -0.38, 0)
        probe(l.fore, 0, 0, -0.05)
      }
      const lift = -low + (bob - drop) * FIG
      for (let q = 0; q < slot; q++) POOL[q].elements[13] += lift
      P.torso.mesh.setMatrixAt(i, torsoM)
      P.shorts.mesh.setMatrixAt(i, shortsM)
      P.neck.mesh.setMatrixAt(i, neckM)
      P.head.mesh.setMatrixAt(i, headM)
      P.hair.mesh.setMatrixAt(i, headM)
      limbs.forEach((l, s) => {
        const k = 2 * i + s
        P.thighs.mesh.setMatrixAt(k, l.hip)
        P.shins.mesh.setMatrixAt(k, l.shin)
        P.boots.mesh.setMatrixAt(k, l.shin)
        P.upperArms.mesh.setMatrixAt(k, l.shoulder)
        P.foreArms.mesh.setMatrixAt(k, l.fore)
        P.hands.mesh.setMatrixAt(k, l.fore)
      })
    }
    for (const part of Object.values(P)) part.mesh.instanceMatrix.needsUpdate = true

    // ball: lifted by its height, spinning with its speed, with a marker on the grass
    const prevX = this.ball.position.x
    const prevZ = this.ball.position.z
    const cam = this.camera.position
    const bs = Math.max(0.36, Math.min(0.6, Math.hypot(cam.x - bx, cam.y, cam.z - bz) / 160))
    this.ball.scale.setScalar(bs)
    this.ball.position.set(bx, BALL_R * bs + f.ballZ, bz)
    const travel = Math.hypot(bx - prevX, bz - prevZ)
    if (travel < 5) this.ball.rotation.x += travel / (BALL_R * bs)
    this.ballMark.position.set(bx, 0.03, bz)
    this.ballMark.scale.setScalar(bs)
    ;(this.ballMark.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.38 - f.ballZ * 0.03)

    // the player on the ball: a ring on the grass and a name tag
    const oi = f.owner >= 0 && f.owner < this.bodies.length && this.bodies[f.owner].has ? f.owner : -1
    if (oi >= 0) {
      const b = this.bodies[oi]
      this.ring.visible = true
      this.ring.position.set(b.x, 0.04, b.z)
      this.ring.scale.setScalar(1 + 0.06 * Math.sin(performance.now() / 160))
      this.ownerTag.visible = true
      this.ownerTag.position.set(b.x, 2.75 * FIG, b.z)
      const kmh = Math.round(b.speed * 3.6)
      this.setTag(this.ownerTag, `<b>${esc(surname(this.opts.name(this.ids[oi])))}</b>${kmh > 14 ? `<i>${kmh} km/h</i>` : ''}`)
    } else {
      this.ring.visible = false
      this.ownerTag.visible = false
    }

    // the pass or shot being played, as an arc over the grass
    const idx = lastIndex(this.ballEvents, t)
    const cur = idx >= 0 ? this.ballEvents[idx] : null
    const live = !!cur && (cur.type === 'pass' || cur.type === 'clearance' || cur.type === 'shot') && t <= cur.ts + cur.dur + 0.3 && cur.end_x !== undefined
    if (live && cur!.id !== this.passKey) {
      this.clearArc()
      const nxt = this.ballEvents[idx + 1]
      const snap = !!nxt && nxt.ts - (cur!.ts + cur!.dur) < 0.6 && nxt.set_piece == null
      const ex = cur!.type !== 'shot' && snap ? nxt.x : cur!.end_x!
      const ey = cur!.type !== 'shot' && snap ? nxt.y : cur!.end_y!
      const lofted = cur!.pass_type === 'long' || cur!.pass_type === 'cross' || cur!.type === 'clearance'
      const len = Math.hypot(ex - cur!.x, ey - cur!.y)
      const peak = cur!.type === 'shot' ? 1.4 : lofted ? Math.min(14, 0.16 * len) * 0.9 : 0.25
      const a = new THREE.Vector3(toX(cur!.x), 0.12, toZ(cur!.y))
      const bpt = new THREE.Vector3(toX(ex), cur!.type === 'shot' ? 1.1 : 0.12, toZ(ey))
      this.passArc = this.arc(a, bpt, peak, cur!.type === 'shot' ? this.shotMat : this.arMat, cur!.type === 'shot' ? 0.12 : 0.07)
      this.scene.add(this.passArc)
      this.passKey = cur!.id
      if (cur!.type === 'shot' && cur!.xg !== undefined) {
        this.xgTag.visible = true
        this.xgTag.position.copy(a).setY(3.2)
        this.setTag(this.xgTag, `xG ${cur!.xg.toFixed(2)}`)
      }
    } else if (!live && this.passArc) {
      this.clearArc()
    }
    if (this.passArc && cur) (this.passArc.material as THREE.MeshBasicMaterial).opacity = Math.max(0.2, 0.9 - (t - cur.ts) * 0.12)
    if (!live) this.xgTag.visible = false

    // a goal: the scoring end jumps
    // (tied to match time, so it holds after a seek or fast-forward and never shows before the ball is in)
    const scored = this.goalsIn.find((g) => t >= g.from && t < g.from + 7)
    if (scored && this.cheer?.from !== scored.from) this.cheer = { side: scored.side, from: scored.from, until: scored.from + 7 }

    // hover: name, number and speed
    this.hoverIdx = -1
    if (this.pointer) {
      this.raycaster.setFromCamera(this.pointer, this.camera)
      const torso = this.parts.torso.mesh
      torso.computeBoundingSphere()
      const hit = this.raycaster.intersectObject(torso, false)[0]
      if (hit?.instanceId !== undefined) this.hoverIdx = hit.instanceId
    }
    if (this.hoverIdx >= 0 && this.hoverIdx !== oi && this.bodies[this.hoverIdx].has) {
      const b = this.bodies[this.hoverIdx]
      const pid = this.ids[this.hoverIdx]
      const team = this.hoverIdx < this.pkg.meta.teams.home.players.length ? this.pkg.meta.teams.home : this.pkg.meta.teams.away
      const num = team.players.find((p) => p.id === pid)?.number ?? ''
      this.hoverTag.visible = true
      this.hoverTag.position.set(b.x, 2.75 * FIG, b.z)
      this.setTag(this.hoverTag, `<b>${num} ${esc(this.opts.name(pid))}</b><i>${Math.round(b.speed * 3.6)} km/h</i>`)
      this.renderer.domElement.style.cursor = 'pointer'
    } else {
      this.hoverTag.visible = false
      this.renderer.domElement.style.cursor = ''
    }
  }

  private clearArc() {
    if (!this.passArc) return
    this.scene.remove(this.passArc)
    this.passArc.geometry.dispose()
    this.passArc = null
    this.passKey = -1
  }

  // ------------------------------------------------------------------ the director

  private directorShot(t: number): 'broadcast' | 'goal' | 'celebrate' | 'follow' | 'tactical' {
    for (const s of this.shots) {
      if (t >= s.ts - 2.2 && t <= s.ts + 2.0) return 'goal'
      if (s.goal && t > s.ts + 2.0 && t < s.ts + 8) return 'celebrate'
    }
    if (this.tour) {
      // between the big moments: the main camera, then closer and wider angles in turn
      let k = (performance.now() / 1000) % TOUR_LENGTH
      for (const [shot, d] of TOUR) {
        if (k < d) return shot === 'goal' && Math.abs(this.focus.x) < 25 ? 'broadcast' : shot
        k -= d
      }
    }
    return 'broadcast'
  }

  private updateCamera(t: number, f: ReturnType<TrackingStore['frameAt']>, realDt: number) {
    const ball = this.ball.position
    const kf = 1 - Math.exp(-3.5 * realDt)
    this.focus.x += (ball.x - this.focus.x) * kf
    this.focus.z += (ball.z - this.focus.z) * kf
    const fx = this.focus.x
    const fz = this.focus.z
    const shot = this.override ? this.override.shot : this.mode === 'director' ? this.directorShot(t) : this.mode
    const prev = this.lastCut
    const cut = shot !== prev
    this.lastCut = shot
    if (cut && prev) this.opts.onCut?.(shot)

    const pos = tmpV
    const look = tmpLook
    let fov = 22
    switch (shot) {
      case 'tactical':
        pos.set(0, 150, 62)
        look.set(0, 0, 2)
        fov = 30
        break
      case 'goal': {
        const s = this.shots.find((x) => t >= x.ts - 2.2 && t <= x.ts + 2.0)
        const dir = s?.dir ?? (fx >= 0 ? 1 : -1)
        const box = dir * (L / 2 - 17)
        pos.set(dir * (L / 2 + 7), 11, fz * 0.3)
        look.set(box + (fx - box) * 0.35, 0, fz * 0.6)
        fov = 44
        break
      }
      case 'replay': {
        const dir = this.override?.dir ?? 1
        // raised behind the goal, so the crossbar and net never block the view
        pos.set(dir * (L / 2 + 6.5), 6.8, Math.max(-8, Math.min(8, ball.z * 0.4)))
        look.set(ball.x - dir * 2, 0.6, ball.z * 0.9)
        fov = 46
        break
      }
      case 'celebrate': {
        const a = t * 0.35
        pos.set(fx + Math.cos(a) * 16, 6, fz + Math.sin(a) * 16)
        look.set(fx, 1.2, fz)
        fov = 40
        break
      }
      case 'follow': {
        const side = f && f.owner >= 0 ? f.teams[f.owner] : null
        const dir = side === 'away' ? -1 : 1
        pos.set(fx - dir * 16, 8, fz + 9)
        look.set(fx + dir * 8, 0, fz)
        fov = 42
        break
      }
      default: // broadcast: the main camera high in the stand, panning with play
        pos.set(fx * 0.82, 42, W / 2 + 70)
        look.set(fx * 0.95, 0, fz * 0.3 - 2)
        fov = 22
    }
    if (shot !== 'broadcast' && shot !== 'tactical') {
      pos.x = Math.max(-(L / 2 + 7.5), Math.min(L / 2 + 7.5, pos.x))
      pos.z = Math.max(-(W / 2 + 7.5), Math.min(W / 2 + 7.5, pos.z))
      pos.y = Math.max(2, pos.y)
    }
    if (cut || this.camPos.lengthSq() === 0) {
      this.camPos.copy(pos)
      this.camLook.copy(look)
    } else {
      const k = 1 - Math.exp(-(shot === 'broadcast' ? 2.6 : 4.5) * realDt)
      this.camPos.lerp(pos, k)
      this.camLook.lerp(look, k)
    }
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    if (cut && prev) {
      // a small settle after each cut, so a change of angle is felt
      this.camera.fov = fov * 1.1
      this.camera.updateProjectionMatrix()
    } else if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = cut ? fov : this.camera.fov + (fov - this.camera.fov) * (1 - Math.exp(-5 * realDt))
      this.camera.updateProjectionMatrix()
    }
    // keep the tilt-shift's sharp band on the ball, so the action is always in focus
    const ndc = tmpNdc.copy(this.ball.position).project(this.camera)
    const target = Math.min(0.85, Math.max(0.15, (ndc.y + 1) / 2))
    this.focusY += (target - this.focusY) * (cut ? 1 : 1 - Math.exp(-4 * realDt))
    this.hPass.uniforms.r.value = this.vPass.uniforms.r.value = this.focusY
  }

  private updateCrowd(now: number) {
    if (!this.crowd || !this.cheer) return
    const mt = this.clock.time
    const active = mt >= this.cheer.from && mt < this.cheer.until
    const s = now / 1000
    this.crowdBase.forEach((b, i) => {
      if (b.side !== this.cheer!.side) return
      tmpM.copy(b.m)
      if (active) tmpM.elements[13] += Math.max(0, Math.sin(s * 9 + i * 1.7)) * 0.55
      this.crowd!.setMatrixAt(i, tmpM)
    })
    this.crowd.instanceMatrix.needsUpdate = true
    if (mt >= this.cheer.until || mt < this.cheer.from - 15) this.cheer = null
  }
}

// ---------------------------------------------------------------------- helpers

const GRADE = {
  name: 'Grade',
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.15 }, vignette: { value: 0.3 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float saturation; uniform float vignette; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float g = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = mix(vec3(g), c.rgb, saturation);
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - vignette * dot(d, d) * 1.6;
      gl_FragColor = c; }`,
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function surname(n: string) {
  return n.split(' ').slice(-1)[0] ?? n
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function lastIndex(events: MatchEvent[], t: number): number {
  let lo = 0
  let hi = events.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].ts <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Grass with mowing stripes and pitch markings, 16 px per metre; noise comes from one small repeating tile. */
function grassTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const M = 6
  const PX = 16
  const cw = (L + 2 * M) * PX
  const ch = (W + 2 * M) * PX
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const g = c.getContext('2d')!
  g.fillStyle = '#40803a'
  g.fillRect(0, 0, cw, ch)
  const stripes = 18
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#4a8a3c' : '#40803a'
    g.fillRect(((M + (L / stripes) * i) * PX) | 0, 0, Math.ceil((L / stripes) * PX) + 1, ch)
  }
  const tile = document.createElement('canvas')
  tile.width = tile.height = 128
  const tg = tile.getContext('2d')!
  const img = tg.createImageData(128, 128)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = v * 0.7
    img.data[i + 1] = v
    img.data[i + 2] = v * 0.5
    img.data[i + 3] = 22
  }
  tg.putImageData(img, 0, 0)
  g.fillStyle = g.createPattern(tile, 'repeat')!
  g.fillRect(0, 0, cw, ch)

  const P = (x: number, y: number): [number, number] => [(x + M) * PX, (y + M) * PX]
  g.strokeStyle = 'rgba(255,255,255,0.92)'
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.lineWidth = 0.15 * PX
  const rect = (x: number, y: number, w: number, h: number) => g.strokeRect(...P(x, y), w * PX, h * PX)
  rect(0, 0, L, W)
  g.beginPath()
  g.moveTo(...P(L / 2, 0))
  g.lineTo(...P(L / 2, W))
  g.stroke()
  g.beginPath()
  g.arc(...P(L / 2, W / 2), 9.15 * PX, 0, Math.PI * 2)
  g.stroke()
  const spot = (x: number, y: number) => {
    g.beginPath()
    g.arc(...P(x, y), 0.25 * PX, 0, Math.PI * 2)
    g.fill()
  }
  spot(L / 2, W / 2)
  for (const left of [true, false]) {
    rect(left ? 0 : L - 16.5, W / 2 - 20.16, 16.5, 40.32)
    rect(left ? 0 : L - 5.5, W / 2 - 9.16, 5.5, 18.32)
    const s = left ? 11 : L - 11
    spot(s, W / 2)
    g.beginPath()
    g.arc(...P(s, W / 2), 9.15 * PX, left ? -0.927 : Math.PI - 0.927, left ? 0.927 : Math.PI + 0.927)
    g.stroke()
    for (const cy of [0, W]) {
      g.beginPath()
      const start = left ? (cy === 0 ? 0 : -Math.PI / 2) : cy === 0 ? Math.PI / 2 : Math.PI
      g.arc(...P(left ? 0 : L, cy), 1 * PX, start, start + Math.PI / 2)
      g.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return tex
}

function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 40
  const g = c.getContext('2d')!
  g.fillStyle = '#101418'
  g.fillRect(0, 0, 1024, 40)
  g.font = '800 26px "Archivo Variable", sans-serif'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.fillText('MATCHMIND', 24, 21)
  g.fillStyle = '#c6ff3d'
  g.fillText('AI CREW', 250, 21)
  g.fillStyle = '#ffffff'
  g.fillText('FACT-CHECKED BY CODE', 420, 21)
  g.fillStyle = '#ff4d2e'
  g.fillText('WHAT IF?', 800, 21)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 128, 64)
  g.fillStyle = '#1a1a1a'
  for (const [x, y] of [[16, 16], [56, 30], [96, 14], [36, 50], [80, 50], [120, 40]]) {
    g.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7)
    }
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
