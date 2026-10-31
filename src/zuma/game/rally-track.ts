import * as THREE from 'three'

export type TrackHazard = { distance: number; lateral: number; mesh: THREE.Group }
export type TrackSample = { position: THREE.Vector3; tangent: THREE.Vector3; side: THREE.Vector3 }

const DESERT_PALETTES = [
  { sand: 0xd8ad70, dune: 0xc28d55, road: 0x49433d, curbA: 0xf3d48f, curbB: 0xbd5537, cactus: 0x466a43 },
  { sand: 0xcda16b, dune: 0xb47d4c, road: 0x45464a, curbA: 0xf1c96d, curbB: 0x315e6b, cactus: 0x4f6b48 },
  { sand: 0xe0bd82, dune: 0xc9985e, road: 0x48413a, curbA: 0xffe0a0, curbB: 0x8d4c36, cactus: 0x54754d },
  { sand: 0xb89068, dune: 0x99734f, road: 0x3d4145, curbA: 0xf5c27a, curbB: 0x577b79, cactus: 0x536c49 },
  { sand: 0xd8c18c, dune: 0xb49a66, road: 0x424445, curbA: 0xf6e4a1, curbB: 0x497b78, cactus: 0x476e56 },
  { sand: 0xc7976f, dune: 0xa56d4f, road: 0x3c3a3c, curbA: 0xffcf85, curbB: 0x91464a, cactus: 0x52694e },
  { sand: 0xbfc3ad, dune: 0x9b9c82, road: 0x42494a, curbA: 0xe8deb0, curbB: 0x41737e, cactus: 0x4e6856 },
  { sand: 0xd5a96d, dune: 0xb77945, road: 0x403d3b, curbA: 0xffdb95, curbB: 0x75639a, cactus: 0x5a7043 },
]

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
] as const

type DesertPalette = typeof DESERT_PALETTES[number]

function paletteForStage(stage: number): DesertPalette {
  const base = DESERT_PALETTES[Math.floor((stage - 1) / 5) % DESERT_PALETTES.length]
  const seed = stageSeed(stage)
  const hue = (((seed >>> 5) % 25) - 12) / 360
  const light = (((seed >>> 13) % 9) - 4) / 100
  const color = (value: number, hueShift = 0) => new THREE.Color(value).offsetHSL(hue + hueShift, 0, light).getHex()
  return {
    sand: color(base.sand), dune: color(base.dune, -0.012), road: color(base.road, 0.006),
    curbA: color(base.curbA, -0.018), curbB: color(base.curbB, 0.018), cactus: color(base.cactus, 0.025),
  }
}

/** Deterministic course points; unique stage seeds vary each loop while keeping the radius positive. */
export function buildStageRoutePoints(stage: number): THREE.Vector3[] {
  const safeStage = Number.isInteger(stage) && stage > 0 ? stage : 1
  const family = (safeStage - 1) % 10
  const seed = stageSeed(safeStage)
  const style = COURSE_ARCHETYPES[family]
  const phase = (seed % 628_319) / 100_000
  const rx = (style.rx + (seed % 11) * 0.48) * 1.08
  const rz = (style.rz + ((seed >>> 8) % 9) * 0.58) * 1.08
  const points: THREE.Vector3[] = []
  const count = 32
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    const broad = Math.sin(angle * style.lobes + phase) * style.wave
    const secondary = Math.cos(angle * style.frequency - phase * 0.73) * style.secondary
    const ripple = Math.sin(angle * (style.frequency + 2) + phase * 1.7) * 0.018
    const radius = 1 + broad + secondary + ripple
    const bend = Math.sin(angle * (1 + family % 2) + phase * 0.62) * style.sweep
    const cornerAngle = angle + bend
    const x = Math.sign(Math.cos(cornerAngle)) * Math.pow(Math.abs(Math.cos(cornerAngle)), style.corner)
    const z = Math.sign(Math.sin(cornerAngle)) * Math.pow(Math.abs(Math.sin(cornerAngle)), style.corner)
    points.push(new THREE.Vector3(rx * radius * x, 0, rz * radius * z))
  }
  return points
}

/** A closed, stage-seeded rally loop with visual road, desert dressing and deterministic cone hazards. */
export class RallyTrack {
  readonly group = new THREE.Group()
  readonly curve: THREE.CatmullRomCurve3
  readonly length: number
  readonly width: number
  readonly hazards: TrackHazard[] = []
  readonly palette: typeof DESERT_PALETTES[number]
  private readonly resources = new Set<THREE.BufferGeometry | THREE.Material>()

  constructor(readonly stageNumber: number, width: number) {
    this.width = width
    this.palette = paletteForStage(stageNumber)
    this.group.name = `rally-track-${stageNumber}`
    this.curve = this.makeCurve(stageNumber)
    this.curve.arcLengthDivisions = 4096
    this.curve.updateArcLengths()
    this.length = this.curve.getLength()
    this.buildGround()
    this.buildRoad()
    this.buildSafetyRails()
    this.buildStartGate()
    this.buildDesertProps(stageNumber)
    this.buildHazards(stageNumber)
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

  dispose(): void {
    for (const item of this.resources) item.dispose()
    this.resources.clear()
  }

  private material(color: THREE.ColorRepresentation, roughness = 0.9): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })
    this.resources.add(m)
    return m
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.resources.add(geometry)
    return new THREE.Mesh(geometry, material)
  }

  private makeCurve(stage: number): THREE.CatmullRomCurve3 {
    return new THREE.CatmullRomCurve3(buildStageRoutePoints(stage), true, 'centripetal', 0.42)
  }

  private buildGround(): void {
    const mat = this.material(this.palette.sand)
    const ground = this.mesh(new THREE.PlaneGeometry(1100, 1100), mat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.18
    ground.receiveShadow = true
    this.group.add(ground)
    const duneMat = this.material(this.palette.dune)
    const duneGeo = new THREE.SphereGeometry(1, 18, 12)
    this.resources.add(duneGeo)
    for (let i = 0; i < 34; i += 1) {
      const angle = seeded(stageSeed(this.stageNumber) + i * 7) * Math.PI * 2
      const distance = 105 + seeded(stageSeed(this.stageNumber) + i * 11) * 180
      const dune = new THREE.Mesh(duneGeo, duneMat)
      dune.position.set(Math.cos(angle) * distance, -0.04, Math.sin(angle) * distance)
      dune.scale.set(14 + (i % 5) * 4, 2.4 + (i % 4) * 0.8, 9 + (i % 3) * 4)
      dune.rotation.y = angle
      dune.receiveShadow = true
      this.group.add(dune)
    }
  }

  private buildRoad(): void {
    const segments = 360
    const half = this.width / 2
    const positions = new Float32Array((segments + 1) * 2 * 3)
    const indices: number[] = []
    for (let i = 0; i <= segments; i += 1) {
      const s = this.sample((i / segments) * this.length)
      const offset = i * 6
      positions[offset] = s.position.x + s.side.x * half
      positions[offset + 1] = 0.02
      positions[offset + 2] = s.position.z + s.side.z * half
      positions[offset + 3] = s.position.x - s.side.x * half
      positions[offset + 4] = 0.02
      positions[offset + 5] = s.position.z - s.side.z * half
      if (i < segments) {
        const a = i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const roadGeometry = new THREE.BufferGeometry()
    roadGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    roadGeometry.setIndex(indices)
    roadGeometry.computeVertexNormals()
    const road = new THREE.Mesh(roadGeometry, this.material(this.palette.road))
    road.receiveShadow = true
    road.renderOrder = 1
    this.group.add(road)

    const stripeMat = this.material(0xf2d58e, 0.78)
    const curbMatA = this.material(this.palette.curbA, 0.72)
    const curbMatB = this.material(this.palette.curbB, 0.72)
    const dashGeo = new THREE.BoxGeometry(0.24, 0.035, 2.2)
    const curbGeo = new THREE.BoxGeometry(0.64, 0.22, 2.4)
    this.resources.add(dashGeo)
    this.resources.add(curbGeo)
    for (let d = 5; d < this.length; d += 11) {
      const sample = this.sample(d)
      const yaw = Math.atan2(sample.tangent.x, sample.tangent.z)
      const dash = new THREE.Mesh(dashGeo, stripeMat)
      dash.position.copy(sample.position).setY(0.075)
      dash.rotation.y = yaw
      this.group.add(dash)
      for (const sign of [-1, 1]) {
        const curb = new THREE.Mesh(curbGeo, Math.floor(d / 11) % 2 ? curbMatA : curbMatB)
        curb.position.copy(sample.position).addScaledVector(sample.side, sign * (half + 0.3)).setY(0.13)
        curb.rotation.y = yaw
        curb.receiveShadow = true
        this.group.add(curb)
      }
    }
  }

  private buildStartGate(): void {
    const s = this.sample(0)
    const yaw = Math.atan2(s.tangent.x, s.tangent.z)
    const gate = new THREE.Group()
    gate.position.copy(s.position)
    gate.rotation.y = yaw
    const gold = this.material(0xe7a942, 0.42)
    const dark = this.material(0x342b27, 0.74)
    const postGeo = new THREE.BoxGeometry(0.7, 5.8, 0.7)
    const beamGeo = new THREE.BoxGeometry(this.width + 4, 0.55, 0.72)
    this.resources.add(postGeo)
    this.resources.add(beamGeo)
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
    const accentGeo = new THREE.BoxGeometry(this.width + 1, 0.16, 0.78)
    this.resources.add(accentGeo)
    const accent = new THREE.Mesh(accentGeo, gold)
    accent.position.y = 5.62
    gate.add(accent)
    this.group.add(gate)
    this.buildMarshals(s, yaw)
  }

  private buildSafetyRails(): void {
    const spacing = 4.5
    const count = Math.ceil(this.length / spacing)
    const postGeo = new THREE.BoxGeometry(0.28, 1.18, 0.42)
    const railGeo = new THREE.BoxGeometry(0.24, 0.24, this.length / count + 0.16)
    const postMat = this.material(0x514840, 0.76)
    const railMat = this.material(0xe5cfaa, 0.68)
    this.resources.add(postGeo)
    this.resources.add(railGeo)
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

  private buildMarshals(sample: TrackSample, yaw: number): void {
    const skin = this.material(0xb97850, 0.82)
    const vest = this.material(0xf27b32, 0.72)
    const trousers = this.material(0x343c42, 0.86)
    const helmet = this.material(0xf1d45c, 0.55)
    const torsoGeo = new THREE.CylinderGeometry(0.38, 0.52, 1.18, 7)
    const limbGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.88, 6)
    const legGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.9, 6)
    const neckGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.25, 7)
    const headGeo = new THREE.SphereGeometry(0.32, 8, 6)
    const helmetGeo = new THREE.SphereGeometry(0.37, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)
    const brimGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 8)
    for (const geometry of [torsoGeo, limbGeo, legGeo, neckGeo, headGeo, helmetGeo, brimGeo]) {
      this.resources.add(geometry)
    }

    for (const sign of [-1, 1]) {
      const person = new THREE.Group()
      person.position.copy(sample.position).addScaledVector(sample.side, sign * (this.width / 2 + 3.4))
      person.rotation.y = yaw + (sign < 0 ? Math.PI * 0.12 : -Math.PI * 0.12)

      const torso = new THREE.Mesh(torsoGeo, vest)
      torso.position.y = 1.63
      const neck = new THREE.Mesh(neckGeo, skin)
      neck.position.y = 2.35
      const head = new THREE.Mesh(headGeo, skin)
      head.position.y = 2.66
      const helmetTop = new THREE.Mesh(helmetGeo, helmet)
      helmetTop.position.y = 2.83
      const brim = new THREE.Mesh(brimGeo, helmet)
      brim.position.y = 2.78
      person.add(torso, neck, head, helmetTop, brim)

      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(limbGeo, skin)
        arm.position.set(side * 0.51, 1.72, 0)
        arm.rotation.z = side * -0.28
        const leg = new THREE.Mesh(legGeo, trousers)
        leg.position.set(side * 0.23, 0.49, 0)
        for (const part of [arm, leg]) {
          part.castShadow = true
          person.add(part)
        }
      }
      for (const part of [torso, neck, head, helmetTop, brim]) part.castShadow = true
      this.group.add(person)
    }
  }

  private buildDesertProps(stage: number): void {
    const green = this.material(this.palette.cactus)
    const rockMat = this.material(0x75614c)
    const cactusGeo = new THREE.CylinderGeometry(0.28, 0.42, 3.4, 7)
    const armGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.4, 7)
    const rockGeo = new THREE.DodecahedronGeometry(1.15, 0)
    this.resources.add(cactusGeo)
    this.resources.add(armGeo)
    this.resources.add(rockGeo)
    for (let i = 0; i < 26; i += 1) {
      const d = (i / 26) * this.length + seeded(stageSeed(stage) + i) * 4
      const s = this.sample(d, this.width * 0.5 + 8 + seeded(stageSeed(stage) + i * 13) * 12)
      const prop = new THREE.Group()
      prop.position.copy(s.position)
      prop.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + seeded(stageSeed(stage) + i * 19) * 1.5
      if (i % 3 === 0) {
        const rock = new THREE.Mesh(rockGeo, rockMat)
        rock.position.y = 0.8
        rock.scale.set(1.4, 0.85, 1.1)
        rock.castShadow = true
        prop.add(rock)
      } else {
        const trunk = new THREE.Mesh(cactusGeo, green)
        trunk.position.y = 1.7
        trunk.castShadow = true
        prop.add(trunk)
        for (const side of [-1, 1]) {
          const arm = new THREE.Mesh(armGeo, green)
          arm.position.set(side * 0.56, 1.35 + (side > 0 ? 0.38 : 0), 0)
          arm.rotation.z = side * -0.52
          arm.castShadow = true
          prop.add(arm)
        }
      }
      this.group.add(prop)
    }
  }

  private buildHazards(stage: number): void {
    const count = 1 + Math.floor((stage - 1) / 20)
    const coneGeo = new THREE.ConeGeometry(0.72, 1.55, 8)
    const coneMat = this.material(0xe86b3d, 0.58)
    const bandMat = this.material(0xf4ddbc, 0.7)
    const bandGeo = new THREE.CylinderGeometry(0.5, 0.58, 0.22, 8)
    this.resources.add(coneGeo)
    this.resources.add(bandGeo)
    for (let i = 0; i < count; i += 1) {
      const jitter = (seeded(stageSeed(stage) + i * 17) - 0.5) * 0.11
      const fraction = THREE.MathUtils.clamp(0.14 + ((i + 1) / (count + 1)) * 0.72 + jitter, 0.12, 0.88)
      const distance = this.length * fraction
      const side = seeded(stageSeed(stage) + i * 31) < 0.5 ? -1 : 1
      const lateral = side * this.width * (0.17 + seeded(stageSeed(stage) + i * 47) * 0.13)
      const sample = this.sample(distance, lateral)
      const mesh = new THREE.Group()
      const cone = new THREE.Mesh(coneGeo, coneMat)
      cone.position.y = 0.82
      cone.castShadow = true
      const band = new THREE.Mesh(bandGeo, bandMat)
      band.position.y = 0.62
      mesh.add(cone, band)
      mesh.position.copy(sample.position)
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
