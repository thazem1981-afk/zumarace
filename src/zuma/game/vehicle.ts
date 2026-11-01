import * as THREE from 'three'
import type { CampaignCar } from './campaign'
import type { CarLook } from './customization'

type Profile = { length: number; width: number; points: [number, number][]; glass: [number, number][]; bed?: boolean; cage?: boolean; wheel: number; clearance: number }

/** Side silhouettes (z forward, y up) in metres. Extruded across the width with bevels. */
function profileFor(car: CampaignCar): Profile {
  switch (car.design) {
    case 'buggy':
      return { length: 3.9, width: 1.9, wheel: 0.5, clearance: 0.55, cage: true,
        points: [[-1.9, 0.55], [1.7, 0.55], [1.95, 0.75], [1.5, 0.95], [0.5, 1.0], [-1.2, 1.05], [-1.9, 0.95]], glass: [] }
    case 'pickup':
      return { length: 4.8, width: 2.05, wheel: 0.5, clearance: 0.5, bed: true,
        points: [[-2.4, 0.55], [2.35, 0.55], [2.45, 1.05], [1.4, 1.25], [0.85, 1.95], [-0.45, 2.0], [-0.6, 1.3], [-2.4, 1.3]],
        glass: [[1.25, 1.3], [0.82, 1.88], [-0.35, 1.92], [-0.45, 1.32]] }
    case 'rally-truck':
      return { length: 5.1, width: 2.12, wheel: 0.56, clearance: 0.62, bed: true,
        points: [[-2.55, 0.64], [2.45, 0.64], [2.58, 1.12], [1.48, 1.36], [0.98, 2.08], [-0.55, 2.12], [-0.72, 1.42], [-2.55, 1.42]],
        glass: [[1.32, 1.42], [0.94, 2.0], [-0.48, 2.04], [-0.58, 1.44]] }
    case 'rally-hatch':
      return { length: 4.0, width: 1.86, wheel: 0.44, clearance: 0.38,
        points: [[-2.0, 0.43], [1.96, 0.43], [2.05, 0.78], [1.18, 1.02], [0.55, 1.56], [-0.92, 1.58], [-1.55, 1.08], [-1.94, 0.94]],
        glass: [[1.08, 1.04], [0.5, 1.51], [-0.86, 1.53], [-1.48, 1.1]] }
    case 'suv':
    case '4x4':
      return { length: 4.5, width: 2.0, wheel: 0.48, clearance: 0.48,
        points: [[-2.25, 0.55], [2.2, 0.55], [2.3, 1.05], [1.35, 1.25], [0.85, 1.9], [-2.0, 1.95], [-2.25, 1.3]],
        glass: [[1.2, 1.3], [0.8, 1.84], [-1.85, 1.88], [-2.0, 1.35]] }
    case 'coupe':
      return { length: 4.3, width: 1.88, wheel: 0.42, clearance: 0.32,
        points: [[-2.15, 0.4], [2.1, 0.4], [2.18, 0.72], [0.9, 0.95], [0.2, 1.4], [-0.95, 1.42], [-2.05, 1.0]],
        glass: [[0.8, 0.98], [0.2, 1.36], [-0.9, 1.38], [-1.7, 1.02]] }
    case 'sedan':
      return { length: 4.4, width: 1.85, wheel: 0.42, clearance: 0.36,
        points: [[-2.2, 0.42], [2.15, 0.42], [2.22, 0.78], [1.05, 0.98], [0.45, 1.48], [-0.95, 1.5], [-1.55, 1.05], [-2.2, 1.0]],
        glass: [[0.95, 1.02], [0.45, 1.43], [-0.9, 1.45], [-1.4, 1.06]] }
    default:
      return { length: 4.0, width: 1.82, wheel: 0.42, clearance: 0.38,
        points: [[-2.0, 0.44], [1.95, 0.44], [2.02, 0.8], [1.0, 1.0], [0.45, 1.55], [-1.6, 1.58], [-2.0, 1.15]],
        glass: [[0.92, 1.04], [0.45, 1.5], [-1.45, 1.52], [-1.85, 1.15]] }
  }
}

function extrudeProfile(points: [number, number][], width: number, bevel: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)))
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 })
  // Shape lives in (x=z, y); extrusion goes along +z. Rotate so the profile's x becomes world z.
  g.translate(0, 0, -(width - bevel * 2) / 2)
  g.rotateY(-Math.PI / 2)
  return g
}

function liveryTexture(base: string, look: CarLook): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 512, 256)
  const accent = new THREE.Color(base).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6 ? '#1c1d20' : '#f2f2ee'
  if (look.livery === 'stripes' || look.livery === 'rally') {
    ctx.fillStyle = accent
    ctx.fillRect(0, 96, 512, 22); ctx.fillRect(0, 138, 512, 22)
  }
  if (look.livery === 'split') {
    ctx.fillStyle = accent
    ctx.beginPath(); ctx.moveTo(0, 256); ctx.lineTo(512, 120); ctx.lineTo(512, 256); ctx.fill()
  }
  if (look.livery === 'rally') {
    ctx.fillStyle = '#e5822f'
    ctx.beginPath(); ctx.moveTo(300, 256); ctx.lineTo(512, 40); ctx.lineTo(512, 256); ctx.fill()
  }
  if (look.livery === 'number' || look.livery === 'rally') {
    ctx.fillStyle = '#f2f2ee'
    ctx.beginPath(); ctx.arc(256, 150, 58, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111'
    ctx.font = 'bold 78px Arial'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(look.number), 256, 154)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Builds a more realistic procedural car: extruded side profile with bevels, glass house,
 * wheel arches, treaded tyres with spoked rims, lamps, mirrors, mud flaps and optional wing.
 */
export function buildRealisticCar(car: CampaignCar, look: CarLook): THREE.Group {
  const vehicle = new THREE.Group()
  const p = profileFor(car)
  const paintColor = look.paint ?? car.color
  const tex = liveryTexture(paintColor, look)
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tex, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12 })
  const trim = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.7, metalness: 0.15 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0e1a24, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.82, clearcoat: 1 })
  const tire = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.96 })
  const rim = new THREE.MeshStandardMaterial({ color: look.rim, roughness: 0.28, metalness: 0.85 })
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe2a0, emissiveIntensity: 0.6, roughness: 0.2 })
  const tail = new THREE.MeshStandardMaterial({ color: 0x8c1a14, emissive: 0xff2010, emissiveIntensity: 0.35 })
  tail.name = 'tail-lamp'
  const lift = p.clearance - 0.4

  const body = new THREE.Mesh(extrudeProfile(p.points, p.width, 0.12), paint)
  body.name = 'painted-body'
  body.position.y = lift
  body.castShadow = body.receiveShadow = true
  // UVs from ExtrudeGeometry follow shape coords; scale so the livery spans the body side.
  const uv = body.geometry.getAttribute('uv') as THREE.BufferAttribute
  const pos = body.geometry.getAttribute('position') as THREE.BufferAttribute
  body.geometry.computeVertexNormals()
  const nrm = body.geometry.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i += 1) {
    const u = (pos.getZ(i) + p.length / 2) / p.length
    // Flip the left flank so numbers read correctly from both sides.
    uv.setXY(i, nrm.getX(i) > 0.5 ? 1 - u : u, (pos.getY(i) - 0.3) / 1.8)
  }
  vehicle.add(body)

  if (p.glass.length) {
    const house = new THREE.Mesh(extrudeProfile(p.glass, p.width * 0.9, 0.05), glass)
    house.name = 'glass'
    house.position.y = lift + 0.02
    vehicle.add(house)
  }

  const box = (size: [number, number, number], pos: [number, number, number], mat: THREE.Material, name = '') => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat)
    m.position.set(...pos); m.name = name; m.castShadow = true
    vehicle.add(m)
    return m
  }
  const L = p.length / 2
  const W = p.width / 2

  // Give the front and rear ends a layered, rally-built appearance instead of plain blocks.
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x292d31, roughness: 0.62, metalness: 0.28 })
  const carbon = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.48, metalness: 0.32 })
  const alloy = new THREE.MeshStandardMaterial({ color: 0x8d969b, roughness: 0.34, metalness: 0.82 })
  const detailBox = (size: [number, number, number], at: [number, number, number], mat: THREE.Material, name: string) =>
    box(size, at, mat, name)

  // Lower splitter, rear diffuser and sculpted side sills visually lower the body.
  detailBox([p.width * 1.06, 0.09, 0.34], [0, lift + 0.39, L + 0.04], carbon, 'front-splitter')
  detailBox([p.width * 0.92, 0.1, 0.28], [0, lift + 0.38, -L - 0.03], carbon, 'rear-diffuser')
  for (const side of [-1, 1]) {
    detailBox([0.12, 0.16, p.length * 0.48], [side * (W + 0.015), lift + 0.43, 0], bumperMat, 'side-sill')
  }

  // Horizontal grille vanes, a recessed intake and a contrasting bonnet vent set.
  for (let i = 0; i < 3; i += 1) {
    detailBox([p.width * 0.31, 0.025, 0.025], [0, lift + 0.68 + i * 0.055, L + 0.115], alloy, 'grille-vane')
  }
  detailBox([p.width * 0.48, 0.055, 0.035], [0, lift + 0.79, L * 0.58], carbon, 'bonnet-intake')
  for (const side of [-1, 1]) {
    detailBox([0.12, 0.035, 0.42], [side * 0.42, lift + 0.84, L * 0.52], carbon, 'bonnet-vent')
  }

  // Pronounced bolt-on arch extensions frame the wide rally tyres.
  const flareGeo = new THREE.TorusGeometry(p.wheel + 0.13, 0.075, 7, 20, Math.PI)
  flareGeo.rotateY(Math.PI / 2)
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const flare = new THREE.Mesh(flareGeo, bumperMat)
    flare.position.set(side * (W + 0.035), p.wheel, end * (L - p.wheel - 0.35))
    flare.scale.set(1.12, 1.08, 1)
    flare.name = 'wide-arch-flare'
    flare.castShadow = true
    vehicle.add(flare)
  }

  // A subtle windscreen divider and side-window pillars make the glasshouse read as glazing.
  if (p.glass.length) {
    for (const side of [-1, 1]) {
      detailBox([0.055, 0.66, 0.07], [side * (W * 0.43), lift + 1.48, -0.18], trim, 'window-pillar')
      detailBox([0.055, 0.56, 0.07], [side * (W * 0.43), lift + 1.48, 0.72], trim, 'window-pillar')
    }
    detailBox([p.width * 0.78, 0.055, 0.07], [0, lift + 1.91, 0.26], trim, 'roof-windscreen-header')
  }

  if (car.design === 'suv' || car.design === '4x4' || car.design === 'pickup' || car.design === 'rally-truck') {
    // Utility roof rails and recovery hardware distinguish the taller off-road silhouettes.
    for (const side of [-1, 1]) {
      detailBox([0.07, 0.07, p.length * 0.38], [side * W * 0.68, lift + 2.02, -0.12], alloy, 'roof-rail')
      detailBox([0.09, 0.16, 0.09], [side * W * 0.68, lift + 1.94, 0.78], trim, 'roof-rail-foot')
    }
    detailBox([p.width * 0.42, 0.12, 0.12], [0, lift + 0.48, L + 0.19], alloy, 'recovery-hook')
  } else if (!p.cage) {
    // Compact roof scoop gives the rally hatch/coupe a purposeful competition profile.
    detailBox([0.48, 0.13, 0.58], [0, lift + 1.68, -0.12], carbon, 'roof-scoop')
    detailBox([0.34, 0.035, 0.34], [0, lift + 1.75, -0.12], alloy, 'roof-scoop-inlet')
  }
  box([p.width * 1.02, 0.22, 0.2], [0, lift + 0.5, L + 0.02], trim, 'front-bumper')
  box([p.width * 1.02, 0.22, 0.2], [0, lift + 0.5, -L - 0.02], trim, 'rear-bumper')
  box([p.width * 0.4, 0.16, 0.04], [0, lift + 0.7, L + 0.1], trim, 'grille')
  box([0.5, 0.12, 0.02], [0, lift + 0.62, -L - 0.13], new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }), 'plate')
  for (const x of [-1, 1]) {
    box([0.36, 0.13, 0.06], [x * W * 0.62, lift + 0.82, L + 0.06], lamp, 'headlight')
    box([0.3, 0.13, 0.06], [x * W * 0.66, lift + 0.85, -L - 0.06], tail, 'taillight')
    box([0.08, 0.12, 0.2], [x * (W + 0.08), lift + 1.18, 0.75], trim, 'mirror')
    box([0.3, 0.32, 0.03], [x * W * 0.82, p.wheel * 0.75, -L * 0.62 - p.wheel - 0.08], trim, 'mudflap')
    // Rally spot lights on the bonnet for the full rally livery.
    if (look.livery === 'rally' && !p.cage) box([0.2, 0.2, 0.08], [x * 0.3, lift + 1.04, L - 0.35], lamp, 'spot')
  }
  // Exhaust.
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.3 }))
  ex.rotation.x = Math.PI / 2; ex.position.set(W * 0.55, lift + 0.42, -L - 0.12)
  vehicle.add(ex)

  if (p.bed) {
    // Raised bed rails and a tailgate give pickups and rally trucks a readable utility rear.
    box([p.width * 0.86, 0.06, 1.7], [0, lift + 1.1, -L + 1.0], carbon, 'bed-floor')
    for (const side of [-1, 1]) {
      box([0.08, 0.42, 1.7], [side * W * 0.86, lift + 1.33, -L + 1.0], trim, 'bed-side')
      box([0.1, 0.08, 1.7], [side * W * 0.86, lift + 1.57, -L + 1.0], alloy, 'bed-rail')
    }
    box([p.width * 0.86, 0.42, 0.08], [0, lift + 1.33, -L + 1.84], trim, 'tailgate')
    box([p.width * 0.7, 0.08, 0.08], [0, lift + 1.57, -L + 1.84], alloy, 'tailgate-cap')
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.18, 18), tire)
    spare.position.set(0, lift + 1.24, -L + 1.0)
    spare.name = 'bed-spare-wheel'
    spare.castShadow = true
    vehicle.add(spare)
  }
  if (p.cage) {
    const tube = new THREE.MeshStandardMaterial({ color: look.rim, roughness: 0.3, metalness: 0.8 })
    for (const x of [-1, 1]) {
      box([0.07, 0.9, 0.07], [x * W * 0.7, 1.5, 0.3], tube)
      box([0.07, 0.07, 1.6], [x * W * 0.7, 1.95, -0.3], tube)
      box([0.07, 0.9, 0.07], [x * W * 0.7, 1.5, -1.1], tube)
    }
    box([p.width * 0.72, 0.07, 0.07], [0, 1.95, 0.5], tube)
    box([p.width * 0.72, 0.07, 0.07], [0, 1.95, -1.1], tube)
    box([0.5, 0.5, 0.5], [0, 1.3, -0.3], trim, 'seat')
  }
  if (look.spoiler && !p.bed && !p.cage) {
    const topY = Math.max(...p.points.filter(([z]) => z < -L + 0.6).map(([, y]) => y)) + lift
    box([p.width * 0.94, 0.05, 0.36], [0, topY + 0.3, -L + 0.2], paint, 'wing')
    for (const x of [-1, 1]) box([0.05, 0.3, 0.2], [x * W * 0.6, topY + 0.15, -L + 0.22], trim, 'wing-stand')
  }

  // Wheels with arches.
  const wheels: THREE.Object3D[] = []
  const frontAxles: THREE.Group[] = []
  const wheelAxles: THREE.Group[] = []
  const r = p.wheel
  const tireGeo = new THREE.CylinderGeometry(r, r, 0.32, 24)
  tireGeo.rotateZ(Math.PI / 2)
  const treadGeo = new THREE.BoxGeometry(0.34, 0.05, 0.12)
  const rimGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.34, 20)
  rimGeo.rotateZ(Math.PI / 2)
  const spokeGeo = new THREE.BoxGeometry(0.32, r * 0.82, 0.075)
  const brakeDiscGeo = new THREE.CylinderGeometry(r * 0.48, r * 0.48, 0.035, 20)
  brakeDiscGeo.rotateZ(Math.PI / 2)
  const hubGeo = new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.37, 16)
  hubGeo.rotateZ(Math.PI / 2)
  const lugGeo = new THREE.SphereGeometry(0.035, 8, 6)
  const brake = new THREE.MeshStandardMaterial({ color: 0x555b60, metalness: 0.86, roughness: 0.38 })
  const caliper = new THREE.MeshStandardMaterial({ color: 0xc45b32, metalness: 0.35, roughness: 0.5 })
  const archGeo = new THREE.TorusGeometry(r + 0.08, 0.08, 6, 14, Math.PI)
  archGeo.rotateY(Math.PI / 2)
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const axle = new THREE.Group()
    axle.position.set(x * (W - 0.05), r, z * (L - r - 0.35))
    const spin = new THREE.Group()
    spin.name = `wheel-${z > 0 ? 'front' : 'rear'}-${x}`
    const t = new THREE.Mesh(tireGeo, tire); t.castShadow = true
    spin.add(t)
    const treadInstances = new THREE.InstancedMesh(treadGeo, tire, 14)
    const wheelPart = new THREE.Object3D()
    for (let k = 0; k < 14; k += 1) {
      const a = (k / 14) * Math.PI * 2
      wheelPart.position.set(0, Math.cos(a) * r, Math.sin(a) * r)
      wheelPart.rotation.set(-a, 0, 0)
      wheelPart.updateMatrix()
      treadInstances.setMatrixAt(k, wheelPart.matrix)
    }
    treadInstances.instanceMatrix.needsUpdate = true
    spin.add(treadInstances)
    const rm = new THREE.Mesh(rimGeo, rim); rm.name = 'alloy-rim'; spin.add(rm)
    // Ventilated brake rotors and five individual spokes make the wheel read as a real assembly.
    for (const side of [-1, 1]) {
      const disc = new THREE.Mesh(brakeDiscGeo, brake)
      disc.position.x = side * 0.12
      disc.name = 'ventilated-brake-disc'
      spin.add(disc)
      const hub = new THREE.Mesh(hubGeo, rim)
      hub.position.x = side * 0.015
      spin.add(hub)
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, r * 0.34, r * 0.28), caliper)
      clamp.position.set(side * 0.15, r * 0.18, -r * 0.28)
      clamp.name = 'brake-caliper'
      spin.add(clamp)
      const lugs = new THREE.InstancedMesh(lugGeo, alloy, 5)
      for (let lug = 0; lug < 5; lug += 1) {
        const a = (lug / 5) * Math.PI * 2
        wheelPart.position.set(side * 0.19, Math.cos(a) * r * 0.19, Math.sin(a) * r * 0.19)
        wheelPart.rotation.set(0, 0, 0)
        wheelPart.updateMatrix()
        lugs.setMatrixAt(lug, wheelPart.matrix)
      }
      lugs.instanceMatrix.needsUpdate = true
      spin.add(lugs)
    }
    const spokes = new THREE.InstancedMesh(spokeGeo, rim, 5)
    for (let k = 0; k < 5; k += 1) {
      const a = (k / 5) * Math.PI * 2
      wheelPart.position.set(0, Math.cos(a) * r * 0.31, Math.sin(a) * r * 0.31)
      wheelPart.rotation.set(-a, 0, 0)
      wheelPart.updateMatrix()
      spokes.setMatrixAt(k, wheelPart.matrix)
    }
    spokes.name = 'alloy-spokes'
    spokes.instanceMatrix.needsUpdate = true
    spin.add(spokes)
    axle.add(spin)
    vehicle.add(axle)
    wheelAxles.push(axle)
    wheels.push(spin)
    if (z > 0) frontAxles.push(axle)
    const arch = new THREE.Mesh(archGeo, p.cage ? trim : paint)
    arch.position.set(x * (W - 0.02), r, z * (L - r - 0.35))
    vehicle.add(arch)
  }

  // Driver and co-driver silhouettes.
  const suit = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 })
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf2bd4b, roughness: 0.3, metalness: 0.2 })
  for (const x of [-0.38, 0.38]) {
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.3), suit)
    torso.position.set(x, lift + 1.15, -0.1)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), helmet)
    head.position.set(x, lift + 1.48, -0.05)
    vehicle.add(torso, head)
  }

  vehicle.userData.wheels = wheels
  vehicle.userData.wheelRadius = r
  vehicle.userData.frontAxles = frontAxles
  vehicle.userData.wheelAxles = wheelAxles
  vehicle.userData.tailLamp = tail
  vehicle.userData.headLamp = lamp
  return vehicle
}
