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
 */

export type CameraMode = 'director' | 'broadcast' | 'tactical' | 'goal' | 'follow'

const L = 105
const W = 68
const FIG = 1.35 // figures are scaled up a little so they read at broadcast distance
const BALL_R = 0.36
const SKIN = ['#f1c9a5', '#d9a77f', '#b77b55', '#8d5a3b', '#5f3b28']
const BALL_TYPES = new Set(['pass', 'carry', 'shot', 'interception', 'tackle', 'save', 'clearance', 'block'])

const toX = (x: number) => x - L / 2
const toZ = (y: number) => y - W / 2

interface Figure {
  group: THREE.Group
  lean: THREE.Group
  heading: number
  phase: number
  last: THREE.Vector3 | null
  speed: number
}

interface Shot {
  ts: number
  dir: 1 | -1
  goal: boolean
  scorer?: string
}

export interface StadiumOptions {
  /** Called with the column of the player under the pointer (or -1). */
  onHover?: (pid: string | null) => void
  name: (pid: string) => string
  tiltShift?: boolean
  crowd?: boolean
}

export class Stadium {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private composer: EffectComposer
  private hPass: ShaderPass
  private vPass: ShaderPass
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(20, 16 / 9, 1, 900)
  private raf = 0
  private ro: ResizeObserver
  private figures: Figure[] = []
  private ball: THREE.Mesh
  private ring: THREE.Mesh
  private passArc: THREE.Mesh | null = null
  private passKey = -1
  private arMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
  private shotMat = new THREE.MeshBasicMaterial({ color: 0xff4d2e, transparent: true, opacity: 0.95, depthWrite: false })
  private highlightGroup = new THREE.Group()
  private ownerTag: CSS2DObject
  private hoverTag: CSS2DObject
  private xgTag: CSS2DObject
  private crowd: THREE.InstancedMesh | null = null
  private crowdBase: { m: THREE.Matrix4; side: Side | 'n' }[] = []
  private cheer: { side: Side; until: number } | null = null
  private ballEvents: MatchEvent[]
  private shots: Shot[]
  private mode: CameraMode = 'director'
  private camPos = new THREE.Vector3(0, 40, 90)
  private camLook = new THREE.Vector3()
  private focus = new THREE.Vector3()
  private hoverIdx = -1
  private pointer: THREE.Vector2 | null = null
  private raycaster = new THREE.Raycaster()
  private lastTime = 0
  private lastCut = ''
  private ids: string[] = []
  private disposed = false

  private container: HTMLElement
  private pkg: MatchPackage
  private store: TrackingStore
  private clock: PlaybackClock
  private opts: StadiumOptions

  constructor(container: HTMLElement, pkg: MatchPackage, store: TrackingStore, clock: PlaybackClock, opts: StadiumOptions) {
    this.container = container
    this.pkg = pkg
    this.store = store
    this.clock = clock
    this.opts = opts
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
    this.setTiltShift(opts.tiltShift ?? true)

    this.ballEvents = pkg.events.filter((e) => BALL_TYPES.has(e.type))
    this.shots = pkg.events
      .filter((e) => e.type === 'shot')
      .map((e) => ({ ts: e.ts, dir: e.team === 'home' ? 1 : -1, goal: e.outcome === 'goal', scorer: e.player ?? undefined }))

    this.buildWorld()
    this.ball = this.buildBall()
    this.ring = this.buildRing()
    this.scene.add(this.highlightGroup)
    this.ownerTag = this.tag('mm-tag mm-tag-owner')
    this.hoverTag = this.tag('mm-tag mm-tag-hover')
    this.xgTag = this.tag('mm-tag mm-tag-xg')
    this.buildFigures()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.renderer.domElement.addEventListener('pointermove', this.onPointer)
    this.renderer.domElement.addEventListener('pointerleave', this.onLeave)
    this.raf = requestAnimationFrame(this.frame)
  }

  // ------------------------------------------------------------------ public

  setMode(mode: CameraMode) {
    this.mode = mode
  }

  setTiltShift(on: boolean) {
    this.hPass.enabled = on
    this.vPass.enabled = on
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
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.renderer.domElement.removeEventListener('pointermove', this.onPointer)
    this.renderer.domElement.removeEventListener('pointerleave', this.onLeave)
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh || o instanceof THREE.LineSegments) {
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

    // the table the miniature stands on
    const table = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: '#7d8b80', roughness: 1 }))
    table.rotation.x = -Math.PI / 2
    table.position.y = -0.05
    table.receiveShadow = true
    s.add(table)

    // pitch, with mowing stripes and lines painted into one texture
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + 12, W + 12), new THREE.MeshStandardMaterial({ map: grassTexture(this.renderer), roughness: 0.92 }))
    pitch.rotation.x = -Math.PI / 2
    pitch.receiveShadow = true
    s.add(pitch)

    this.buildGoals()
    this.buildStands()
    this.buildBoards()
    this.buildPylons()
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
      // net: a wire box behind the goal line
      const pts: number[] = []
      const depth = 2.0 * dir
      for (let i = 0; i <= 12; i++) {
        const z = -3.66 + (7.32 * i) / 12
        pts.push(x, 2.44, z, x + depth, 1.6, z, x + depth, 1.6, z, x + depth, 0, z)
      }
      for (let j = 0; j <= 5; j++) {
        const yy = (2.44 * j) / 5
        const back = 1.6 * (j / 5)
        pts.push(x + depth, Math.min(back, 1.6), -3.66, x + depth, Math.min(back, 1.6), 3.66)
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
    const gap = 9 // from the touchline to the first row
    const seats: { pos: THREE.Vector3; rotY: number; side: Side | 'n' }[] = []

    const stand = (length: number, along: 'x' | 'z', sign: 1 | -1, half: number, homeShare: number, tiers = 9, roofed = true) => {
      for (let t = 0; t < tiers; t++) {
        const dist = half + gap + t * step
        const h = 0.6 + t * rise
        const block = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? length : step, h, along === 'x' ? step : length), concrete)
        if (along === 'x') block.position.set(0, h / 2, sign * (dist + step / 2))
        else block.position.set(sign * (dist + step / 2), h / 2, 0)
        block.receiveShadow = true
        block.castShadow = t === tiers - 1
        this.scene.add(block)
        const n = Math.floor(length / 0.95)
        for (let i = 0; i < n; i++) {
          if (Math.random() < 0.08) continue // empty seats
          const a = -length / 2 + (i + 0.5) * (length / n)
          const p = along === 'x' ? new THREE.Vector3(a, h + 0.3, sign * (dist + step * 0.5)) : new THREE.Vector3(sign * (dist + step * 0.5), h + 0.3, a)
          const r = Math.random()
          const side: Side | 'n' = r < homeShare ? 'home' : r < homeShare + (1 - homeShare) * 0.8 ? 'away' : 'n'
          seats.push({ pos: p, rotY: along === 'x' ? 0 : Math.PI / 2, side })
        }
      }
      if (!roofed) return
      // a thin roof over the back rows
      const dist = half + gap + tiers * step
      const roof = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? length + 4 : 9, 0.4, along === 'x' ? 9 : length + 4), roofMat)
      if (along === 'x') roof.position.set(0, 0.6 + tiers * rise + 4.5, sign * (dist - 2.5))
      else roof.position.set(sign * (dist - 2.5), 0.6 + tiers * rise + 4.5, 0)
      roof.castShadow = true
      this.scene.add(roof)
    }
    // the far side and both ends get full stands; the near side is kept low and open so it frames the shot
    stand(L + 16, 'x', -1, W / 2, 0.75)
    stand(L + 16, 'x', 1, W / 2, 0.6, 5, false)
    stand(W + 6, 'z', -1, L / 2, 0.92)
    stand(W + 6, 'z', 1, L / 2, 0.18)
    if (this.opts.crowd === false) return

    const geo = new THREE.BoxGeometry(0.5, 0.62, 0.45)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 })
    const mesh = new THREE.InstancedMesh(geo, mat, seats.length)
    const neutral = ['#2d3436', '#dfe6e9', '#636e72', '#b2bec3', '#6c5ce7', '#fdcb6e']
    const pal = {
      home: [home.primary, home.primary, home.secondary],
      away: [away.primary, away.primary, away.secondary],
    }
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    seats.forEach((seat, i) => {
      m.makeRotationY(seat.rotY)
      m.setPosition(seat.pos)
      mesh.setMatrixAt(i, m)
      const list = seat.side === 'n' ? neutral : pal[seat.side]
      c.set(list[Math.floor(Math.random() * list.length)])
      c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08)
      mesh.setColorAt(i, c)
      this.crowdBase.push({ m: m.clone(), side: seat.side })
    })
    mesh.castShadow = false
    mesh.receiveShadow = true
    this.crowd = mesh
    this.scene.add(mesh)
  }

  private buildBoards() {
    const tex = boardTexture()
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.35 })
    const board = (len: number, x: number, z: number, rotY: number) => {
      const t = tex.clone()
      t.repeat.set(len / 24, 1)
      t.wrapS = THREE.RepeatWrapping
      t.needsUpdate = true
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.12), mat.clone())
      ;(m.material as THREE.MeshStandardMaterial).map = t
      ;(m.material as THREE.MeshStandardMaterial).emissiveMap = t
      m.position.set(x, 0.45, z)
      m.rotation.y = rotY
      m.castShadow = true
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
        mast.castShadow = true
        const head = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.6), lamp)
        head.position.y = 38.5
        head.lookAt(new THREE.Vector3(-sx * 60, 0, -sz * 40))
        g.add(mast, head)
        g.position.set(sx * (L / 2 + 22), 0, sz * (W / 2 + 22))
        this.scene.add(g)
      }
  }

  private buildFigures() {
    const meta = this.pkg.meta
    const body = new THREE.CapsuleGeometry(0.33, 0.42, 6, 14)
    const legs = new THREE.CapsuleGeometry(0.25, 0.46, 6, 12)
    const head = new THREE.SphereGeometry(0.2, 16, 12)
    const mats = new Map<string, THREE.MeshStandardMaterial>()
    const mat = (c: string) => {
      if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }))
      return mats.get(c)!
    }
    const ids: string[] = []
    for (const side of ['home', 'away'] as Side[]) {
      const team = meta.teams[side]
      for (const p of team.players) {
        ids.push(p.id)
        const gk = p.role === 'GK'
        const shirt = gk ? (side === 'home' ? '#f5d90a' : '#39d353') : team.primary
        const shorts = gk ? '#222222' : team.secondary
        const group = new THREE.Group()
        const lean = new THREE.Group()
        const b = new THREE.Mesh(body, mat(shirt))
        b.position.y = 1.22
        const l = new THREE.Mesh(legs, mat(shorts))
        l.position.y = 0.52
        const h = new THREE.Mesh(head, mat(SKIN[hash(p.id) % SKIN.length]))
        h.position.y = 1.86
        for (const m of [b, l, h]) {
          m.castShadow = true
          m.userData.pid = p.id
        }
        lean.add(b, l, h)
        group.add(lean)
        group.scale.setScalar(FIG)
        group.visible = false
        this.scene.add(group)
        this.figures.push({ group, lean, heading: side === 'home' ? Math.PI / 2 : -Math.PI / 2, phase: Math.random() * 6, last: null, speed: 0 })
      }
    }
    this.ids = ids
  }

  private ballMark!: THREE.Mesh

  private buildBall(): THREE.Mesh {
    // a soft white disc under the ball so the eye can always find it, as broadcast ball trackers do
    this.ballMark = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }))
    this.ballMark.rotation.x = -Math.PI / 2
    this.ballMark.renderOrder = 1
    this.scene.add(this.ballMark)
    const tex = ballTexture()
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }))
    ball.castShadow = true
    this.scene.add(ball)
    return ball
  }

  private buildRing(): THREE.Mesh {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.32, 48), this.arMat)
    ring.rotation.x = -Math.PI / 2
    ring.renderOrder = 2
    this.scene.add(ring)
    return ring
  }

  private tag(cls: string): CSS2DObject {
    const el = document.createElement('div')
    el.className = cls
    const obj = new CSS2DObject(el)
    obj.visible = false
    this.scene.add(obj)
    return obj
  }

  private arc(a: THREE.Vector3, b: THREE.Vector3, peak: number, mat: THREE.Material, radius = 0.09): THREE.Mesh {
    const mid = a.clone().lerp(b, 0.5)
    mid.y = Math.max(a.y, b.y) + peak
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, radius, 6, false), mat)
    mesh.renderOrder = 3
    return mesh
  }

  // ------------------------------------------------------------------ per frame

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
    this.hPass.uniforms.h.value = 2.2 / w
    this.vPass.uniforms.v.value = 2.2 / h
  }

  private onPointer = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private onLeave = () => {
    this.pointer = null
  }

  private frame = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const t = this.clock.time
    const dt = Math.min(0.1, Math.abs(t - this.lastTime))
    this.lastTime = t
    const f = this.store.frameAt(t)
    if (f) this.place(f, t, dt)
    this.updateCamera(t, f)
    this.updateCrowd()
    const tilt = this.mode !== 'tactical'
    this.hPass.uniforms.r.value = this.vPass.uniforms.r.value = 0.52
    if (this.hPass.enabled !== tilt && (this.opts.tiltShift ?? true)) this.setTiltShift(tilt)
    this.composer.render()
    this.labels.render(this.scene, this.camera)
  }

  private place(f: NonNullable<ReturnType<TrackingStore['frameAt']>>, t: number, dt: number) {
    for (let j = 0; j < this.figures.length; j++) {
      const fig = this.figures[j]
      const col = f.ids.indexOf(this.ids[j])
      const x = col >= 0 ? f.x[col] : NaN
      if (Number.isNaN(x)) {
        fig.group.visible = false
        fig.last = null
        continue
      }
      const pos = new THREE.Vector3(toX(x), 0, toZ(f.y[col]))
      fig.group.visible = true
      if (fig.last && dt > 0) {
        const v = pos.clone().sub(fig.last)
        const sp = v.length() / dt
        fig.speed += (Math.min(sp, 10) - fig.speed) * 0.2
        if (v.lengthSq() > 1e-4) {
          const target = Math.atan2(v.x, v.z)
          let d = target - fig.heading
          d = Math.atan2(Math.sin(d), Math.cos(d))
          fig.heading += d * Math.min(1, 0.25 + fig.speed * 0.03)
        }
        fig.phase += dt * (4 + fig.speed * 1.6)
      }
      fig.last = pos
      fig.group.position.copy(pos)
      fig.group.position.y = Math.abs(Math.sin(fig.phase)) * Math.min(0.09, fig.speed * 0.012)
      fig.group.rotation.y = fig.heading
      fig.lean.rotation.x = Math.min(0.22, fig.speed * 0.028)
    }

    // ball: lifted by its height, spinning with its speed
    const [bx, by] = f.ball
    const prev = this.ball.position.clone()
    this.ball.position.set(toX(bx), BALL_R + f.ballZ, toZ(by))
    this.ballMark.position.set(this.ball.position.x, 0.03, this.ball.position.z)
    ;(this.ballMark.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.38 - f.ballZ * 0.03)
    const travel = this.ball.position.distanceTo(prev)
    if (travel < 5) this.ball.rotation.x += travel / BALL_R

    // the player on the ball: a ring on the grass and a name tag
    const owner = f.owner >= 0 ? f.ids[f.owner] : null
    const oi = owner ? this.ids.indexOf(owner) : -1
    if (oi >= 0 && this.figures[oi].group.visible) {
      const g = this.figures[oi].group.position
      this.ring.visible = true
      this.ring.position.set(g.x, 0.04, g.z)
      const s = 1 + 0.08 * Math.sin(performance.now() / 160)
      this.ring.scale.setScalar(s)
      this.ownerTag.visible = true
      this.ownerTag.position.set(g.x, 2.9 * FIG, g.z)
      const sp = this.figures[oi].speed * 3.6
      this.ownerTag.element.innerHTML = `<b>${esc(surname(this.opts.name(owner!)))}</b>${sp > 14 ? `<i>${sp.toFixed(0)} km/h</i>` : ''}`
    } else {
      this.ring.visible = false
      this.ownerTag.visible = false
    }

    // the pass or shot being played, drawn as an arc over the grass
    const idx = lastIndex(this.ballEvents, t)
    const cur = idx >= 0 ? this.ballEvents[idx] : null
    const live = cur && (cur.type === 'pass' || cur.type === 'clearance' || cur.type === 'shot') && t <= cur.ts + cur.dur + 0.3 && cur.end_x !== undefined
    if (live && cur!.id !== this.passKey) {
      this.clearArc()
      const nxt = this.ballEvents[idx + 1]
      const snap = nxt && nxt.ts - (cur!.ts + cur!.dur) < 0.6 && nxt.set_piece == null
      const ex = cur!.type !== 'shot' && snap ? nxt.x : cur!.end_x!
      const ey = cur!.type !== 'shot' && snap ? nxt.y : cur!.end_y!
      const lofted = cur!.pass_type === 'long' || cur!.pass_type === 'cross' || cur!.type === 'clearance'
      const len = Math.hypot(ex - cur!.x, ey - cur!.y)
      const peak = cur!.type === 'shot' ? 1.4 : lofted ? Math.min(14, 0.16 * len) * 0.9 : 0.25
      const a = new THREE.Vector3(toX(cur!.x), 0.12, toZ(cur!.y))
      const b = new THREE.Vector3(toX(ex), cur!.type === 'shot' ? 1.1 : 0.12, toZ(ey))
      this.passArc = this.arc(a, b, peak, cur!.type === 'shot' ? this.shotMat : this.arMat, cur!.type === 'shot' ? 0.12 : 0.07)
      this.scene.add(this.passArc)
      this.passKey = cur!.id
      if (cur!.type === 'shot' && cur!.xg !== undefined) {
        this.xgTag.visible = true
        this.xgTag.position.copy(a).setY(3.2)
        this.xgTag.element.textContent = `xG ${cur!.xg.toFixed(2)}`
      }
    } else if (!live && this.passArc) {
      this.clearArc()
    }
    if (this.passArc) {
      const age = cur ? t - cur.ts : 9
      ;(this.passArc.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.9 - age * 0.12)
    }

    // goals: the scoring end jumps
    if (cur?.type === 'shot' && cur.outcome === 'goal' && t - (cur.ts + cur.dur) > 0 && t - (cur.ts + cur.dur) < 0.5) {
      this.cheer = { side: cur.team, until: t + 6 }
    }

    // hover: name, number and speed
    this.hoverIdx = -1
    if (this.pointer) {
      this.raycaster.setFromCamera(this.pointer, this.camera)
      const hits = this.raycaster.intersectObjects(this.figures.filter((x) => x.group.visible).map((x) => x.group), true)
      const pid = hits[0]?.object.userData.pid as string | undefined
      if (pid) this.hoverIdx = this.ids.indexOf(pid)
    }
    if (this.hoverIdx >= 0 && this.hoverIdx !== oi) {
      const fig = this.figures[this.hoverIdx]
      const pid = this.ids[this.hoverIdx]
      const team = this.hoverIdx < this.pkg.meta.teams.home.players.length ? this.pkg.meta.teams.home : this.pkg.meta.teams.away
      const num = team.players.find((p) => p.id === pid)?.number ?? ''
      this.hoverTag.visible = true
      this.hoverTag.position.set(fig.group.position.x, 2.9 * FIG, fig.group.position.z)
      this.hoverTag.element.innerHTML = `<b>${num} ${esc(this.opts.name(pid))}</b><i>${(fig.speed * 3.6).toFixed(0)} km/h</i>`
      this.renderer.domElement.style.cursor = 'pointer'
    } else {
      this.hoverTag.visible = false
      this.renderer.domElement.style.cursor = ''
    }
    if (!live) this.xgTag.visible = false
    this.opts.onHover?.(this.hoverIdx >= 0 ? this.ids[this.hoverIdx] : null)
  }

  private clearArc() {
    if (!this.passArc) return
    this.scene.remove(this.passArc)
    this.passArc.geometry.dispose()
    this.passArc = null
    this.passKey = -1
  }

  // ------------------------------------------------------------------ the director

  private directorShot(t: number): 'broadcast' | 'goal' | 'celebrate' | 'tactical' {
    for (const s of this.shots) {
      if (t >= s.ts - 2.6 && t <= s.ts + 2.4) return 'goal'
      if (s.goal && t > s.ts + 2.4 && t < s.ts + 9) return 'celebrate'
    }
    return 'broadcast'
  }

  private updateCamera(t: number, f: ReturnType<TrackingStore['frameAt']>) {
    const ball = this.ball.position
    const k = 1 - Math.exp(-4 * 0.016)
    this.focus.lerp(new THREE.Vector3(ball.x, 0, ball.z), k)
    const fx = this.focus.x
    const fz = this.focus.z
    let shot: string = this.mode
    if (this.mode === 'director') shot = this.directorShot(t)
    const cut = shot !== this.lastCut
    this.lastCut = shot

    const pos = new THREE.Vector3()
    const look = new THREE.Vector3()
    let fov = 20
    switch (shot) {
      case 'tactical':
        pos.set(0, 150, 62)
        look.set(0, 0, 2)
        fov = 30
        break
      case 'goal': {
        const s = this.shots.find((x) => t >= x.ts - 2.6 && t <= x.ts + 2.4)
        const dir = s?.dir ?? (fx >= 0 ? 1 : -1)
        pos.set(dir * (L / 2 + 34), 17, fz * 0.25 + 8)
        look.set(dir * (L / 2 - 14), 0, fz * 0.6)
        fov = 26
        break
      }
      case 'celebrate': {
        const a = t * 0.35
        pos.set(fx + Math.cos(a) * 22, 9, fz + Math.sin(a) * 22)
        look.set(fx, 1.5, fz)
        fov = 30
        break
      }
      case 'follow': {
        const owner = f && f.owner >= 0 ? f.teams[f.owner] : null
        const dir = owner === 'away' ? -1 : 1
        pos.set(fx - dir * 20, 9, fz + 10)
        look.set(fx + dir * 8, 0, fz)
        fov = 34
        break
      }
      default: // broadcast: the main camera high in the stand, panning with play
        pos.set(fx * 0.82, 42, W / 2 + 70)
        look.set(fx * 0.95, 0, fz * 0.3 - 2)
        fov = 22
    }
    if (cut || this.camPos.lengthSq() === 0) {
      this.camPos.copy(pos)
      this.camLook.copy(look)
    } else {
      const s = shot === 'broadcast' ? 0.06 : 0.12
      this.camPos.lerp(pos, s)
      this.camLook.lerp(look, s)
    }
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * (cut ? 1 : 0.1)
      this.camera.updateProjectionMatrix()
    }
  }

  private updateCrowd() {
    if (!this.crowd) return
    const t = this.clock.time
    const active = this.cheer && t < this.cheer.until
    if (!active && !this.crowd.userData.dirty) return
    const m = new THREE.Matrix4()
    const now = performance.now() / 1000
    this.crowdBase.forEach((b, i) => {
      m.copy(b.m)
      if (active && b.side === this.cheer!.side) {
        const jump = Math.max(0, Math.sin(now * 9 + i * 1.7)) * 0.55
        m.elements[13] += jump
      }
      this.crowd!.setMatrixAt(i, m)
    })
    this.crowd.instanceMatrix.needsUpdate = true
    this.crowd.userData.dirty = active
    if (!active) this.cheer = null
  }
}

// ---------------------------------------------------------------------- helpers

const GRADE = {
  name: 'Grade',
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.18 }, vignette: { value: 0.32 } },
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

/** Grass with mowing stripes and pitch markings, 20 px per metre. */
function grassTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const M = 6 // run-off around the lines
  const PX = 20
  const cw = (L + 2 * M) * PX
  const ch = (W + 2 * M) * PX
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const g = c.getContext('2d')!
  g.fillStyle = '#3f7d34'
  g.fillRect(0, 0, cw, ch)
  const stripes = 18
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#4a8a3c' : '#40803a'
    g.fillRect(((M + (L / stripes) * i) * PX) | 0, 0, Math.ceil((L / stripes) * PX) + 1, ch)
  }
  // fine noise so the grass is not flat colour
  const img = g.getImageData(0, 0, cw, ch)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14
    img.data[i] += n * 0.6
    img.data[i + 1] += n
    img.data[i + 2] += n * 0.4
  }
  g.putImageData(img, 0, 0)
  const P = (x: number, y: number): [number, number] => [(x + M) * PX, (y + M) * PX]
  g.strokeStyle = 'rgba(255,255,255,0.92)'
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.lineWidth = 0.14 * PX
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
  g.fillStyle = '#ffffff'
  g.font = '800 26px "Archivo Variable", sans-serif'
  g.textBaseline = 'middle'
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
