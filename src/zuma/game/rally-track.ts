import * as THREE from 'three'
import { biomeForStage, type Biome } from './environment'
import { buildPaceNotes, type PaceNote } from './pace-notes'

export type TrackHazard = { distance: number; lateral: number; mesh: THREE.Group }
export type TrackSample = { position: THREE.Vector3; tangent: THREE.Vector3; side: THREE.Vector3 }

/** Loops are scaled up from the original compact ovals so every stage is a longer, more varied course. */
export const TRACK_SCALE = 1.75

const COURSE_ARCHETYPES = [
  { rx: 63, rz: 31, lobes: 2, wave: 0.025, secondary: 0.018, frequency: 5, corner: 1.0, sweep: 0.018 },
  { rx: 49, rz: 49, lobes: 3, wave: 0.095, secondary: 0.038, frequency: 5, corner: 0.88, sweep: 0.035 },
  { rx: 60, rz: 41, lobes: 4, wave: 0.13, secondary: 0.042, frequency: 6, corner: 0.93, sweep: 0.055 },
  { rx: 57, rz: 45, lobes: 2, wave: 0.16, secondary: 0.07, frequency: 5, corner: 0.78, sweep: 0.04 },
  { rx: 61, rz: 37, lobes: 3, wave: 0.07, secondary: 0.085, frequency: 7, corner: 1.13, sweep: 0.065 },
  { rx: 64, rz: 33, lobes: 2, wave: 0.105, secondary: 0.055, frequency: 6, corner: 0.84, sweep: 0.08 },
  { rx: 55, rz: 46, lobes: 5, wave: 0.11, secondary: 0.035, frequency: 3, corner: 0.9, sweep: 0.045 },
  { rx: 51, rz: 48, lobes: 4, wave: 0.17, secondary: 0.045, frequency: 7, corner: 1.0, sweep: 0.07 },
  { rx: 65, rz: 30, lobes: 3, wave: 0.12, secondary: 0.07, frequency: 4, corner: 0.8, sweep: 0.03 },
  { rx: 54, rz: 42, lobes: 5, wave: 0.15, secondary: 0.052, frequency: 2, corner: 1.16, sweep: 0.06 },
  { rx: 58, rz: 44, lobes: 6, wave: 0.09, secondary: 0.06, frequency: 8, corner: 0.95, sweep: 0.05 },
] as const

/** Deterministic course points; unique stage seeds vary each loop while keeping the radius positive. */
export function buildStageRoutePoints(stage: number): THREE.Vector3[] {
  const safeStage = Number.isInteger(stage) && stage > 0 ? stage : 1
  const family = ((safeStage - 1) * 7) % COURSE_ARCHETYPES.length
  const seed = stageSeed(safeStage)
  const style = COURSE_ARCHETYPES[family]
  const phase = (seed % 628_319) / 100_000
  const rx = (style.rx + (seed % 11) * 0.48) * 1.08 * TRACK_SCALE
  const rz = (style.rz + ((seed >>> 8) % 9) * 0.58) * 1.08 * TRACK_SCALE
  const extra = 0.02 + ((seed >>> 3) % 5) * 0.012
  const points: THREE.Vector3[] = []
  const count = 56
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    const broad = Math.sin(angle * style.lobes + phase) * style.wave
    const secondary = Math.cos(angle * style.frequency - phase * 0.73) * style.secondary
    const ripple = Math.sin(angle * (style.frequency + 2) + phase * 1.7) * 0.018
    const chicane = Math.sin(angle * (style.frequency + 5) + phase * 2.3) * extra
    const radius = 1 + broad + secondary + ripple + chicane
    const bend = Math.sin(angle * (1 + family % 2) + phase * 0.62) * style.sweep
    const cornerAngle = angle + bend
    const x = Math.sign(Math.cos(cornerAngle)) * Math.pow(Math.abs(Math.cos(cornerAngle)), style.corner)
    const z = Math.sign(Math.sin(cornerAngle)) * Math.pow(Math.abs(Math.sin(cornerAngle)), style.corner)
    points.push(new THREE.Vector3(rx * radius * x, 0, rz * radius * z))
  }
  return points
}

/** A closed, stage-seeded rally loop dressed for its biome, with deterministic hazards. */
export class RallyTrack {
  readonly group = new THREE.Group()
  readonly curve: THREE.CatmullRomCurve3
  readonly length: number
  readonly width: number
  readonly hazards: TrackHazard[] = []
  readonly biome: Biome
  readonly paceNotes: PaceNote[]
  readonly palette: { road: number; ground: number }
  private readonly resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>()
  private roadMaterial!: THREE.MeshStandardMaterial
  private water?: THREE.Mesh

  constructor(readonly stageNumber: number, width: number) {
    this.width = width
    this.biome = biomeForStage(stageNumber)
    this.palette = { road: this.biome.road, ground: this.biome.ground }
    this.group.name = `rally-track-${stageNumber}`
    this.curve = new THREE.CatmullRomCurve3(buildStageRoutePoints(stageNumber), true, 'centripetal', 0.42)
    this.curve.arcLengthDivisions = 6000
    this.curve.updateArcLengths()
    this.length = this.curve.getLength()
    this.buildGround()
    this.buildRoad()
    this.buildSafetyRails()
    this.buildStartGate()
    this.buildSpectators()
    this.buildBiomeProps()
    this.buildHazards()
    const step = 5
    const tangents = []
    for (let d = 0; d < this.length; d += step) {
      const t = this.curve.getTangentAt(d / this.length)
      tangents.push({ x: t.x, z: t.z })
    }
    this.paceNotes = buildPaceNotes(tangents, step)
  }

  sample(distance: number, lateral = 0): TrackSample {
    const wrapped = ((distance % this.length) + this.length) % this.length
    const t = wrapped / this.length
    const position = this.curve.getPointAt(t)
    const tangent = this.curve.getTangentAt(t).setY(0).normalize()
    const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize()
    position.addScaledVector(side, lateral)
    return { position, tangent, side }
  }

  /** Wet roads get glossier; called by the weather system. */
  setWetness(wet: number): void {
    this.roadMaterial.roughness = THREE.MathUtils.lerp(0.92, 0.38, wet)
    this.roadMaterial.metalness = THREE.MathUtils.lerp(0.02, 0.18, wet)
  }

  update(time: number): void {
    if (this.water) (this.water.material as THREE.MeshStandardMaterial).normalScale?.set(Math.sin(time) * 0.2, 0.2)
  }

  dispose(): void {
    for (const item of this.resources) item.dispose()
    this.resources.clear()
  }

  private material(color: THREE.ColorRepresentation, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02, ...extra })
    this.resources.add(m)
    return m
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.resources.add(g)
    return g
  }

  /** Procedural noise texture so big surfaces never read as flat placeholder planes. */
  private noiseTexture(base: number, alt: number, repeat: number, grain = 0.5, streaks = false): THREE.CanvasTexture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const a = new THREE.Color(base)
    const b = new THREE.Color(alt)
    ctx.fillStyle = `#${a.getHexString()}`
    ctx.fillRect(0, 0, size, size)
    let seed = stageSeed(this.stageNumber)
    const rnd = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed / 0x1_0000_0000 }
    for (let i = 0; i < 2600; i += 1) {
      const c = a.clone().lerp(b, rnd()).offsetHSL(0, 0, (rnd() - 0.5) * 0.08 * grain)
      ctx.fillStyle = `#${c.getHexString()}`
      ctx.globalAlpha = 0.35 + rnd() * 0.5
      const r = 1 + rnd() * (streaks ? 2 : 7)
      if (streaks) ctx.fillRect(rnd() * size, rnd() * size, r, r * (3 + rnd() * 8))
      else { ctx.beginPath(); ctx.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2); ctx.fill() }
    }
    ctx.globalAlpha = 1
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat, repeat)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    this.resources.add(tex)
    return tex
  }

  private buildGround(): void {
    const b = this.biome
    const tex = this.noiseTexture(b.ground, b.groundAlt, 90, 1)
    const ground = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2400, 2400)), this.material(0xffffff, 0.95, { map: tex }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.18
    ground.receiveShadow = true
    this.group.add(ground)

    if (b.id === 'coast') {
      const water = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2400, 900)), this.material(0x2a7f9e, 0.15, { metalness: 0.4, transparent: true, opacity: 0.92 }))
      water.rotation.x = -Math.PI / 2
      water.position.set(0, -0.1, -(this.extentZ() + 60 + 450))
      this.water = water
      this.group.add(water)
    }

    // Surrounding landforms: dunes, mesas, snowy hills or mountains depending on the biome.
    const mounds = b.id === 'desert' || b.id === 'coast' ? 46 : 38
    const moundGeo = this.geo(b.id === 'canyon' || b.id === 'mountain' ? new THREE.CylinderGeometry(0.7, 1, 1, 7, 1) : new THREE.SphereGeometry(1, 20, 12))
    const coneGeo = this.geo(new THREE.ConeGeometry(1, 1, 7, 1))
    const moundMat = this.material(b.id === 'snow' ? 0xf4f7fa : b.id === 'canyon' ? b.rock : b.groundAlt, 0.95)
    const capMat = this.material(0xf6f8fb, 0.8)
    const reach = Math.max(this.extentX(), this.extentZ())
    for (let i = 0; i < mounds; i += 1) {
      const angle = seeded(stageSeed(this.stageNumber) + i * 7) * Math.PI * 2
      const distance = reach + 40 + seeded(stageSeed(this.stageNumber) + i * 11) * 320
      const big = b.id === 'mountain' || b.id === 'snow'
      const mesh = new THREE.Mesh(big ? coneGeo : moundGeo, moundMat)
      const h = big ? 40 + (i % 5) * 18 : b.id === 'canyon' ? 14 + (i % 4) * 9 : 3 + (i % 4) * 1.4
      const w = big ? 50 + (i % 3) * 20 : 20 + (i % 5) * 6
      mesh.position.set(Math.cos(angle) * distance, big || b.id === 'canyon' ? h / 2 - 0.2 : -0.04, Math.sin(angle) * distance)
      mesh.scale.set(w, h, w * (0.6 + (i % 3) * 0.2))
      mesh.rotation.y = angle
      mesh.receiveShadow = true
      this.group.add(mesh)
      if (big) {
        const cap = new THREE.Mesh(coneGeo, capMat)
        cap.scale.set(w * 0.38, h * 0.36, w * 0.38 * (0.6 + (i % 3) * 0.2))
        cap.position.copy(mesh.position).setY(h - h * 0.18 - 0.2)
        cap.rotation.y = angle
        this.group.add(cap)
      }
    }
  }

  private extentX(): number { return Math.max(...this.curve.points.map(p => Math.abs(p.x))) }
  private extentZ(): number { return Math.max(...this.curve.points.map(p => Math.abs(p.z))) }

  private buildRoad(): void {
    const segments = 720
    const half = this.width / 2
    const positions = new Float32Array((segments + 1) * 2 * 3)
    const uvs = new Float32Array((segments + 1) * 2 * 2)
    const indices: number[] = []
    for (let i = 0; i <= segments; i += 1) {
      const d = (i / segments) * this.length
      const s = this.sample(d)
      const offset = i * 6
      positions[offset] = s.position.x + s.side.x * half
      positions[offset + 1] = 0.02
      positions[offset + 2] = s.position.z + s.side.z * half
      positions[offset + 3] = s.position.x - s.side.x * half
      positions[offset + 4] = 0.02
      positions[offset + 5] = s.position.z - s.side.z * half
      uvs.set([0, d / 8, 1, d / 8], i * 4)
      if (i < segments) {
        const a = i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const roadGeometry = new THREE.BufferGeometry()
    roadGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    roadGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    roadGeometry.setIndex(indices)
    roadGeometry.computeVertexNormals()
    this.resources.add(roadGeometry)
    const tarmac = this.biome.surface === 'tarmac'
    const roadTex = this.noiseTexture(this.biome.road, new THREE.Color(this.biome.road).offsetHSL(0, 0, -0.08).getHex(), 1, 1.6, true)
    roadTex.repeat.set(1, 1)
    this.roadMaterial = this.material(0xffffff, tarmac ? 0.82 : 0.95, { map: roadTex })
    const road = new THREE.Mesh(roadGeometry, this.roadMaterial)
    road.receiveShadow = true
    road.renderOrder = 1
    this.group.add(road)

    const stripeMat = this.material(tarmac ? 0xf5f2e6 : 0xf2d58e, 0.78)
    const curbMatA = this.material(this.biome.curbA, 0.72)
    const curbMatB = this.material(this.biome.curbB, 0.72)
    const dashGeo = this.geo(new THREE.BoxGeometry(0.24, 0.035, 2.2))
    const curbGeo = this.geo(new THREE.BoxGeometry(0.64, 0.22, 2.4))
    const step = tarmac ? 9 : 11
    const dashes = new THREE.InstancedMesh(dashGeo, stripeMat, Math.ceil(this.length / step))
    const curbs = [curbMatA, curbMatB].map(m => new THREE.InstancedMesh(curbGeo, m, Math.ceil(this.length / step) * 2))
    const counts = [0, 0]
    let dashCount = 0
    const dummy = new THREE.Object3D()
    for (let d = 5, k = 0; d < this.length; d += step, k += 1) {
      const sample = this.sample(d)
      const yaw = Math.atan2(sample.tangent.x, sample.tangent.z)
      if (tarmac || k % 2 === 0) {
        dummy.position.copy(sample.position).setY(0.04)
        dummy.rotation.set(0, yaw, 0)
        dummy.updateMatrix()
        dashes.setMatrixAt(dashCount++, dummy.matrix)
      }
      for (const sign of [-1, 1]) {
        const which = k % 2
        dummy.position.copy(sample.position).addScaledVector(sample.side, sign * (half + 0.3)).setY(0.13)
        dummy.rotation.set(0, yaw, 0)
        dummy.updateMatrix()
        curbs[which].setMatrixAt(counts[which]++, dummy.matrix)
      }
    }
    dashes.count = dashCount
    curbs.forEach((c, i) => { c.count = counts[i]; c.receiveShadow = true })
    this.group.add(dashes, ...curbs)
  }

  private buildStartGate(): void {
    const s = this.sample(0)
    const yaw = Math.atan2(s.tangent.x, s.tangent.z)
    const gate = new THREE.Group()
    gate.position.copy(s.position)
    gate.rotation.y = yaw
    const gold = this.material(0xe7a942, 0.42, { metalness: 0.3 })
    const dark = this.material(0x342b27, 0.74)
    const postGeo = this.geo(new THREE.BoxGeometry(0.7, 5.8, 0.7))
    const beamGeo = this.geo(new THREE.BoxGeometry(this.width + 4, 0.55, 0.72))
    for (const x of [-this.width * 0.62, this.width * 0.62]) {
      const post = new THREE.Mesh(postGeo, gold)
      post.position.set(x, 2.9, 0)
      post.castShadow = true
      gate.add(post)
    }
    const beam = new THREE.Mesh(beamGeo, dark)
    beam.position.y = 5.25
    beam.castShadow = true
    gate.add(beam)
    // Chequered banner.
    const c = document.createElement('canvas')
    c.width = 256; c.height = 32
    const ctx = c.getContext('2d')!
    for (let x = 0; x < 32; x += 1) for (let y = 0; y < 4; y += 1) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5'; ctx.fillRect(x * 8, y * 8, 8, 8) }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    this.resources.add(tex)
    const banner = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(this.width + 3, 0.7)), this.material(0xffffff, 0.6, { map: tex, side: THREE.DoubleSide }))
    banner.position.y = 4.6
    gate.add(banner)
    // Starting grid boxes on the road.
    const gridMat = this.material(0xf5f5f0, 0.7)
    const gridGeo = this.geo(new THREE.BoxGeometry(3, 0.03, 0.18))
    for (let row = 0; row < 4; row += 1) for (const lane of [-3.2, 3.2]) {
      const g = this.sample(row * 8 + 6, lane)
      const m = new THREE.Mesh(gridGeo, gridMat)
      m.position.copy(g.position).setY(0.045)
      m.rotation.y = yaw
      this.group.add(m)
    }
    this.group.add(gate)
  }

  private buildSafetyRails(): void {
    const spacing = 4.5
    const count = Math.ceil(this.length / spacing)
    const postGeo = this.geo(new THREE.BoxGeometry(0.28, 1.18, 0.42))
    const railGeo = this.geo(new THREE.BoxGeometry(0.24, 0.24, this.length / count + 0.16))
    const postMat = this.material(0x514840, 0.76)
    const railMat = this.material(this.biome.id === 'snow' ? 0xc8372d : 0xe5cfaa, 0.5, { metalness: 0.35 })
    const posts = [-1, 1].map(() => new THREE.InstancedMesh(postGeo, postMat, count))
    const rails = [-1, 1].map(() => new THREE.InstancedMesh(railGeo, railMat, count))
    const dummy = new THREE.Object3D()
    const lateral = this.width / 2 + 0.92
    for (let i = 0; i < count; i += 1) {
      const sample = this.sample((i + 0.5) * this.length / count)
      const yaw = Math.atan2(sample.tangent.x, sample.tangent.z)
      for (let side = 0; side < 2; side += 1) {
        const sign = side === 0 ? -1 : 1
        const position = sample.position.clone().addScaledVector(sample.side, sign * lateral)
        dummy.position.copy(position).setY(0.59)
        dummy.rotation.set(0, yaw, 0)
        dummy.updateMatrix()
        posts[side].setMatrixAt(i, dummy.matrix)
        dummy.position.copy(position).setY(1.02)
        dummy.updateMatrix()
        rails[side].setMatrixAt(i, dummy.matrix)
      }
    }
    for (const mesh of [...posts, ...rails]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
  }

  /** Marshals at the start plus small groups of spectators at a few corners. */
  private buildSpectators(): void {
    const skinTones = [0xb97850, 0x8d5a3b, 0xd7a07a, 0x6b4430].map(c => this.material(c, 0.82))
    const shirts = [0xf27b32, 0x2f6fae, 0xc8372d, 0xe7c13a, 0x3f7a3a, 0xf2f2ee].map(c => this.material(c, 0.8))
    const trousers = this.material(0x343c42, 0.86)
    const torsoGeo = this.geo(new THREE.CylinderGeometry(0.34, 0.46, 1.1, 7))
    const legGeo = this.geo(new THREE.CylinderGeometry(0.15, 0.18, 0.88, 6))
    const armGeo = this.geo(new THREE.CylinderGeometry(0.11, 0.13, 0.82, 6))
    const headGeo = this.geo(new THREE.SphereGeometry(0.28, 10, 8))
    const make = (pos: THREE.Vector3, yaw: number, k: number, cheering: boolean) => {
      const p = new THREE.Group()
      p.position.copy(pos)
      p.rotation.y = yaw
      const torso = new THREE.Mesh(torsoGeo, shirts[k % shirts.length]); torso.position.y = 1.5
      const head = new THREE.Mesh(headGeo, skinTones[k % skinTones.length]); head.position.y = 2.33
      p.add(torso, head)
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, trousers); leg.position.set(s * 0.2, 0.46, 0)
        const arm = new THREE.Mesh(armGeo, skinTones[k % skinTones.length])
        arm.position.set(s * 0.46, cheering ? 2.15 : 1.55, 0)
        arm.rotation.z = cheering ? s * 2.7 : s * -0.25
        p.add(leg, arm)
      }
      p.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
      p.userData.cheer = cheering
      p.userData.phase = k * 0.7
      this.group.add(p)
      return p
    }
    const start = this.sample(0)
    const yaw = Math.atan2(start.tangent.x, start.tangent.z)
    for (const sign of [-1, 1]) make(start.position.clone().addScaledVector(start.side, sign * (this.width / 2 + 3.4)), yaw + sign * 0.4, sign > 0 ? 0 : 3, false)
    const spots = 7
    for (let i = 0; i < spots; i += 1) {
      const d = this.length * (0.1 + (i / spots) * 0.85)
      const sign = i % 2 ? 1 : -1
      const base = this.sample(d, sign * (this.width / 2 + 5.5))
      const face = Math.atan2(-base.side.x * sign, -base.side.z * sign)
      for (let j = 0; j < 5; j += 1) {
        const pos = base.position.clone().addScaledVector(base.tangent, (j - 2) * 1.3).addScaledVector(base.side, sign * (j % 2) * 1.1)
        make(pos, face, i * 5 + j, j % 2 === 0)
      }
    }
  }

  private buildBiomeProps(): void {
    const b = this.biome
    const seed = stageSeed(this.stageNumber)
    const count = 130
    const trunkMat = this.material(0x5a3d26, 0.9)
    const leafMat = this.material(b.foliage, 0.85)
    const snowMat = this.material(0xf4f8fb, 0.7)
    const rockMat = this.material(b.rock, 0.95)
    const cactusMat = this.material(0x466a43, 0.85)
    const coneGeo = this.geo(new THREE.ConeGeometry(1.6, 4.2, 8))
    const trunkGeo = this.geo(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 7))
    const palmTrunkGeo = this.geo(new THREE.CylinderGeometry(0.18, 0.28, 6, 7))
    const frondGeo = this.geo(new THREE.BoxGeometry(0.5, 0.06, 3.2))
    const blobGeo = this.geo(new THREE.IcosahedronGeometry(1.8, 1))
    const rockGeo = this.geo(new THREE.DodecahedronGeometry(1.15, 0))
    const cactusGeo = this.geo(new THREE.CylinderGeometry(0.28, 0.42, 3.4, 7))
    const armGeo = this.geo(new THREE.CylinderGeometry(0.18, 0.22, 1.4, 7))
    for (let i = 0; i < count; i += 1) {
      const r1 = seeded(seed + i * 13)
      const d = (i / count) * this.length + seeded(seed + i) * 6
      const sideSign = r1 < 0.5 ? -1 : 1
      const lateral = sideSign * (this.width * 0.5 + 6 + seeded(seed + i * 29) * 40)
      const s = this.sample(d, lateral)
      const prop = new THREE.Group()
      prop.position.copy(s.position)
      prop.rotation.y = seeded(seed + i * 19) * Math.PI * 2
      const scale = 0.75 + seeded(seed + i * 23) * 0.7
      prop.scale.setScalar(scale)
      const roll = seeded(seed + i * 31)
      const add = (g: THREE.BufferGeometry, m: THREE.Material, y: number, sx = 1, sy = 1, sz = 1) => {
        const mesh = new THREE.Mesh(g, m); mesh.position.y = y; mesh.scale.set(sx, sy, sz); mesh.castShadow = true; mesh.receiveShadow = true; prop.add(mesh); return mesh
      }
      if (roll < 0.25) {
        add(rockGeo, rockMat, 0.6, 1.4, 0.8 + roll, 1.1)
        if (b.id === 'snow') add(rockGeo, snowMat, 1.05, 1.1, 0.3, 0.9)
      } else if (b.id === 'desert') {
        add(cactusGeo, cactusMat, 1.7)
        for (const side of [-1, 1]) { const a = add(armGeo, cactusMat, 1.35 + (side > 0 ? 0.38 : 0)); a.position.x = side * 0.56; a.rotation.z = side * -0.52 }
      } else if (b.id === 'coast' || (b.id === 'canyon' && roll > 0.85)) {
        const t = add(palmTrunkGeo, trunkMat, 3); t.rotation.z = 0.12
        for (let f = 0; f < 6; f += 1) { const fr = add(frondGeo, leafMat, 6); fr.rotation.set(-0.5, (f / 6) * Math.PI * 2, 0); fr.position.x = 0.35; fr.geometry.translate(0, 0, 0) }
      } else if (b.id === 'canyon') {
        add(rockGeo, rockMat, 1.6, 2.2, 2.6 + roll * 2, 1.8)
      } else if (b.id === 'forest' && roll > 0.6) {
        add(trunkGeo, trunkMat, 1.1)
        add(blobGeo, leafMat, 3.4, 1, 1.15, 1)
      } else {
        add(trunkGeo, trunkMat, 1.1)
        add(coneGeo, leafMat, 3.6)
        add(coneGeo, leafMat, 5.2, 0.72, 0.75, 0.72)
        if (b.id === 'snow') add(coneGeo, snowMat, 5.9, 0.42, 0.4, 0.42)
      }
      this.group.add(prop)
    }
  }

  private buildHazards(): void {
    const stage = this.stageNumber
    const count = 2 + Math.floor((stage - 1) / 14)
    const b = this.biome
    const coneMat = this.material(0xe86b3d, 0.58)
    const bandMat = this.material(0xf4ddbc, 0.7)
    const coneGeo = this.geo(new THREE.ConeGeometry(0.72, 1.55, 10))
    const bandGeo = this.geo(new THREE.CylinderGeometry(0.5, 0.58, 0.22, 10))
    const logGeo = this.geo(new THREE.CylinderGeometry(0.4, 0.4, 2.4, 9))
    const barrelGeo = this.geo(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12))
    const rockGeo = this.geo(new THREE.DodecahedronGeometry(0.9, 0))
    const logMat = this.material(0x6b4a2e, 0.9)
    const barrelMat = this.material(0x2f6fae, 0.5, { metalness: 0.4 })
    const rockMat = this.material(b.rock, 0.95)
    for (let i = 0; i < count; i += 1) {
      const jitter = (seeded(stageSeed(stage) + i * 17) - 0.5) * 0.06
      const fraction = THREE.MathUtils.clamp(0.1 + ((i + 1) / (count + 1)) * 0.82 + jitter, 0.08, 0.93)
      const distance = this.length * fraction
      const side = seeded(stageSeed(stage) + i * 31) < 0.5 ? -1 : 1
      const lateral = side * this.width * (0.17 + seeded(stageSeed(stage) + i * 47) * 0.13)
      const sample = this.sample(distance, lateral)
      const mesh = new THREE.Group()
      const kind = (i + stage) % 4
      if (kind === 0 || b.id === 'coast') {
        const cone = new THREE.Mesh(coneGeo, coneMat); cone.position.y = 0.82
        const band = new THREE.Mesh(bandGeo, bandMat); band.position.y = 0.62
        mesh.add(cone, band)
      } else if (kind === 1 && (b.id === 'forest' || b.id === 'snow' || b.id === 'mountain')) {
        const log = new THREE.Mesh(logGeo, logMat); log.rotation.z = Math.PI / 2; log.position.y = 0.4
        mesh.add(log)
      } else if (kind === 2) {
        const barrel = new THREE.Mesh(barrelGeo, barrelMat); barrel.position.y = 0.65
        mesh.add(barrel)
      } else {
        const rock = new THREE.Mesh(rockGeo, rockMat); rock.position.y = 0.55; rock.scale.set(1.3, 0.9, 1.1)
        mesh.add(rock)
      }
      mesh.traverse(o => { o.castShadow = true })
      mesh.position.copy(sample.position)
      mesh.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z)
      this.group.add(mesh)
      this.hazards.push({ distance, lateral, mesh })
    }
  }
}

function stageSeed(stage: number): number {
  return (Math.imul(stage, 0x45d9f3b) ^ 0x9e3779b9) >>> 0
}

function seeded(seed: number): number {
  let x = seed >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return (x >>> 0) / 0xffffffff
}
