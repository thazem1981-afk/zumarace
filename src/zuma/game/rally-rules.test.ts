import { describe, expect, it } from 'vitest'
import { BIOME_ORDER, biomeForStage, conditionsForStage, gripForConditions, SURFACE_GRIP, WEATHER_GRIP, windForWeather } from './environment'
import { CAMPAIGN_CARS, CAMPAIGN_STAGES, CAR_ABILITIES } from './campaign'
import { buildPaceNotes, gradeFor, paceNotePhase, turnAngle } from './pace-notes'
import { lookFor, parseGarage } from './customization'
import { parseSave } from '../engine/save'
import { advanceLateralMotion, passingLane } from './handling'
import { shapeAnalogStick, smoothControl } from '../engine/input'
import { automaticGear, engineRpm, gearAcceleration, gearTopSpeed, shiftGear } from './transmission'
import { sampleReplay, type ReplayFrame } from './replay'
import { buildStageRoutePoints } from './rally-track'
import * as THREE from 'three'
import { ParticlePool, SkidMarks } from './vfx'

describe('custom garage paint', () => {
  it('accepts custom six-digit paint and rim colours and rejects invalid values', () => {
    const parsed = parseGarage({ 'dune-runner': { paint: '#123abc', rim: '#abcdef' }, 'sand-hawk': { paint: 'red', rim: '#12' } }, new Set(CAMPAIGN_CARS.map(car => car.id)))
    expect(parsed['dune-runner']?.paint).toBe('#123abc')
    expect(parsed['dune-runner']?.rim).toBe('#abcdef')
    expect(parsed['sand-hawk']?.paint).toBeNull()
    expect(parsed['sand-hawk']?.rim).toBe('#aeb5b9')
  })
})

describe('stage variety', () => {
  it('consecutive stages never share a biome', () => {
    for (let s = 1; s < 100; s += 1) expect(biomeForStage(s).id).not.toBe(biomeForStage(s + 1).id)
  })
  it('uses all seven landscapes, not only desert', () => {
    const seen = new Set(Array.from({ length: 12 }, (_, i) => biomeForStage(i + 1).id))
    expect(seen.size).toBe(BIOME_ORDER.length)
  })
  it('city stages are tarmac night races', () => {
    const cityStages = Array.from({ length: 100 }, (_, i) => conditionsForStage(i + 1)).filter(c => c.biome.id === 'city')
    expect(cityStages.length).toBeGreaterThan(0)
    for (const c of cityStages) {
      expect(c.biome.surface).toBe('tarmac')
      expect(['night', 'sunset']).toContain(c.time)
    }
  })
  it('stage 1 is clear daylight', () => {
    expect(conditionsForStage(1)).toMatchObject({ weather: 'clear', time: 'day' })
  })
  it('snow only falls in the snow biome', () => {
    for (let s = 1; s <= 100; s += 1) {
      const c = conditionsForStage(s)
      if (c.weather === 'snow') expect(c.biome.id).toBe('snow')
    }
  })
  it('weather wind is deterministic and has stronger gusts in sandstorms', () => {
    expect(windForWeather('rain', 12)).toEqual(windForWeather('rain', 12))
    expect(Math.abs(windForWeather('sandstorm', 2).x)).toBeGreaterThan(Math.abs(windForWeather('rain', 2).x))
    expect(windForWeather('clear', 20)).toEqual({ x: 0, z: 0 })
  })
  it('rain and snow reduce grip', () => {
    expect(WEATHER_GRIP.rain).toBeLessThan(1)
    expect(WEATHER_GRIP.snow).toBeLessThan(WEATHER_GRIP.rain)
  })
  it('every stage has a unique name', () => {
    expect(new Set(CAMPAIGN_STAGES.map(s => s.name)).size).toBe(100)
  })
})

describe('car names', () => {
  it('renamed to descriptive model names', () => {
    expect(CAMPAIGN_CARS[0].name).toBe('هاتشباك رالي R2')
    expect(CAMPAIGN_CARS.find(c => c.id === 'storm-buggy')?.name).toBe('باجي رملي 1000cc')
    const neon = CAMPAIGN_CARS.find(c => c.id === 'neon-gt')
    expect(neon?.name).toBe('كوبيه كهربائية GT-E')
    expect(neon?.price).toBeGreaterThan(Math.max(...CAMPAIGN_CARS.filter(c => c.id !== 'neon-gt').map(c => c.price)))
    expect(CAR_ABILITIES.regen.turboRecharge).toBeGreaterThan(1)
  })
})

describe('co-driver pace notes', () => {
  it('a turn from +z toward +x is a left turn', () => {
    expect(turnAngle({ x: 0, z: 1 }, { x: 1, z: 0 })).toBeGreaterThan(0)
  })
  it('grades sharp corners lower', () => {
    expect(gradeFor(1.3)).toBe(1)
    expect(gradeFor(0.3)).toBe(5)
    expect(gradeFor(0.05)).toBe(0)
  })
  it('finds corners on a circular loop all in one direction', () => {
    const n = 120
    const tangents = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return { x: Math.cos(a), z: -Math.sin(a) } })
    const notes = buildPaceNotes(tangents, 5)
    expect(notes.length).toBeGreaterThan(0)
    expect(new Set(notes.map(n => n.direction)).size).toBe(1)
  })
})

describe('garage customisation', () => {
  it('drops invalid colours and unknown cars', () => {
    const g = parseGarage({ 'dune-runner': { paint: 'red', rim: '#112233', livery: 'bogus', number: 7 }, fake: {} }, new Set(['dune-runner']))
    expect(Object.keys(g)).toEqual(['dune-runner'])
    expect(lookFor(g, 'dune-runner')).toMatchObject({ paint: null, rim: '#112233', livery: 'rally' })
  })
  it('save keeps the chosen camera and driver', () => {
    const s = parseSave(JSON.stringify({ version: 2, cameraMode: 'hood', driver: 'layla' }))
    expect(s.cameraMode).toBe('hood')
    expect(s.driver).toBe('layla')
    expect(parseSave(JSON.stringify({ version: 2, cameraMode: 'photo' })).cameraMode).toBe('photo')
  })
  it('defaults engine sound on and persists the mute choice', () => {
    expect(parseSave(null).engineSound).toBe(true)
    expect(parseSave(JSON.stringify({ version: 2, engineSound: false })).engineSound).toBe(false)
  })

  it('defaults to automatic transmission and preserves manual selection', () => {
    expect(parseSave(null).transmission).toBe('automatic')
    expect(parseSave(JSON.stringify({ version: 2, transmission: 'manual' })).transmission).toBe('manual')
  })
})

describe('rally lateral handling', () => {
  const base = { steer: 1, speed: 24, steeringForce: 11.5, tireGrip: 1, steeringSkill: 1, drifting: false, lateralVelocity: 0, dt: 1 / 60 }

  it('limits lateral acceleration to available tyre grip', () => {
    const next = advanceLateralMotion(base)
    const maximum = 9.81 * base.tireGrip * base.dt
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThanOrEqual(maximum)
  })

  it('reduces cornering force on a low-grip surface', () => {
    const dry = advanceLateralMotion(base)
    const wet = advanceLateralMotion({ ...base, tireGrip: 0.55 })
    expect(wet).toBeLessThan(dry)
  })

  it('saturates steering demand instead of allowing unlimited lateral acceleration', () => {
    const moderate = advanceLateralMotion({ ...base, steer: 1 })
    const extreme = advanceLateralMotion({ ...base, steer: 8 })
    expect(extreme).toBeCloseTo(moderate, 8)
  })

  it('lets a drift carry more sideways momentum after steering input ends', () => {
    const normal = advanceLateralMotion({ ...base, steer: 0, lateralVelocity: 5 })
    const drifting = advanceLateralMotion({ ...base, steer: 0, drifting: true, lateralVelocity: 5 })
    expect(drifting).toBeGreaterThan(normal)
  })

  it('is stable for zero or negative time steps and bounds lateral speed', () => {
    expect(advanceLateralMotion({ ...base, dt: 0, lateralVelocity: 3 })).toBe(3)
    expect(advanceLateralMotion({ ...base, dt: -1, lateralVelocity: 3 })).toBe(3)
    expect(advanceLateralMotion({ ...base, lateralVelocity: 30 })).toBeLessThanOrEqual(12)
  })
})

describe('procedural rally routes', () => {
  it('builds deterministic, finite closed-course control points', () => {
    const first = buildStageRoutePoints(12)
    const repeated = buildStageRoutePoints(12)
    expect(first).toHaveLength(56)
    expect(first.map(p => p.toArray())).toEqual(repeated.map(p => p.toArray()))
    expect(first.every(p => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true)
  })

  it('includes the new narrow switchback course in the stage rotation', () => {
    const switchback = buildStageRoutePoints(6)
    const previous = buildStageRoutePoints(5)
    expect(switchback).toHaveLength(56)
    expect(switchback.map(p => p.toArray())).not.toEqual(previous.map(p => p.toArray()))
    const xSpan = Math.max(...switchback.map(p => p.x)) - Math.min(...switchback.map(p => p.x))
    const zSpan = Math.max(...switchback.map(p => p.z)) - Math.min(...switchback.map(p => p.z))
    expect(zSpan).toBeGreaterThan(xSpan)
  })

  it('changes course geometry between stages', () => {
    const first = buildStageRoutePoints(12)
    const next = buildStageRoutePoints(13)
    expect(first.map(p => p.toArray())).not.toEqual(next.map(p => p.toArray()))
  })
})


describe('rally visual effect pools', () => {
  it('clears particle visibility and resets its emission cursor', () => {
    const pool = new ParticlePool(2)
    pool.emit(new THREE.Vector3(1, 0.2, 2), new THREE.Vector3(0, 1, 0), new THREE.Color(0xffffff), 1, 1)
    pool.clear()
    expect(Array.from(pool.points.geometry.getAttribute('color').array)).toEqual(new Array(8).fill(0))
    expect(Array.from(pool.points.geometry.getAttribute('psize').array)).toEqual(new Array(2).fill(0))
    pool.emit(new THREE.Vector3(3, 0.2, 4), new THREE.Vector3(0, 1, 0), new THREE.Color(0xffffff), 1, 1)
    expect(pool.points.geometry.getAttribute('position').array.slice(0, 3)).toEqual(new Float32Array([3, 0.2, 4]))
  })

  it('clears skid marks and restarts the ring buffer at its first slot', () => {
    const marks = new SkidMarks(2)
    marks.add(new THREE.Vector3(1, 0, 2), 0)
    marks.clear()
    const matrix = new THREE.Matrix4()
    marks.mesh.getMatrixAt(0, matrix)
    expect([matrix.elements[0], matrix.elements[5], matrix.elements[10]]).toEqual([0, 0, 0])
    marks.add(new THREE.Vector3(3, 0, 4), 0)
    marks.mesh.getMatrixAt(0, matrix)
    expect([matrix.elements[0], matrix.elements[5], matrix.elements[10]]).toEqual([1, 1, 1])
  })
})


describe('precision driving controls', () => {
  it('filters stick drift while preserving full steering range', () => {
    expect(shapeAnalogStick(0.05, -0.04)).toEqual({ x: 0, y: 0 })
    const full = shapeAnalogStick(1, 0)
    expect(full.x).toBeCloseTo(1, 8)
    expect(full.y).toBe(0)
  })

  it('keeps diagonal stick input within the unit circle', () => {
    const diagonal = shapeAnalogStick(1, 1)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 8)
    expect(diagonal.x).toBeCloseTo(diagonal.y, 8)
  })

  it('smooths control changes and snaps safely when no time elapses', () => {
    expect(smoothControl(0, 1, 0)).toBe(0)
    const first = smoothControl(0, 1, 1 / 60)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(1)
    expect(smoothControl(first, 1, 1 / 60)).toBeGreaterThan(first)
  })
})


describe('surface-aware rally grip', () => {
  it('gives tarmac more grip than loose sand and snow', () => {
    expect(SURFACE_GRIP.tarmac).toBeGreaterThan(SURFACE_GRIP.sand)
    expect(SURFACE_GRIP.sand).toBeGreaterThan(SURFACE_GRIP.snow)
  })

  it('reduces road grip in rain and snow', () => {
    expect(gripForConditions('tarmac', 'rain')).toBeLessThan(gripForConditions('tarmac', 'clear'))
    expect(gripForConditions('gravel', 'snow')).toBeLessThan(gripForConditions('gravel', 'cloudy'))
  })

  it('keeps clear-weather grip stable at zero weather intensity', () => {
    expect(gripForConditions('gravel', 'rain', 0)).toBe(SURFACE_GRIP.gravel)
  })
})


describe('rally racecraft helpers', () => {
  it('chooses a clear lane away from nearby traffic', () => {
    const target = passingLane(-1, 1, 4)
    expect(Math.abs(target - 1)).toBeGreaterThan(2.2)
    expect(target).toBeGreaterThanOrEqual(-4)
    expect(target).toBeLessThanOrEqual(4)
  })

  it('keeps passing targets within the road edge', () => {
    expect(Math.abs(passingLane(0, 3.8, 4))).toBeLessThanOrEqual(4)
  })

  it('stages co-driver calls before the braking point', () => {
    expect(paceNotePhase(160)).toBe('prepare')
    expect(paceNotePhase(90)).toBe('call')
    expect(paceNotePhase(30)).toBeNull()
    expect(paceNotePhase(Number.NaN)).toBeNull()
  })
})


describe('rally transmission', () => {
  it('shifts automatically as speed rises', () => {
    expect(automaticGear(4)).toBe(1)
    expect(automaticGear(22)).toBe(3)
    expect(automaticGear(52)).toBe(6)
  })

  it('keeps manual shifts within six forward gears', () => {
    expect(shiftGear(1, -1)).toBe(1)
    expect(shiftGear(1, 1)).toBe(2)
    expect(shiftGear(6, 1)).toBe(6)
  })

  it('trades low-gear acceleration for higher-gear top speed', () => {
    expect(gearAcceleration(1)).toBeGreaterThan(gearAcceleration(6))
    expect(gearTopSpeed(6)).toBeGreaterThan(gearTopSpeed(1))
    expect(engineRpm(0, 1)).toBe(950)
  })
})


describe('race replay sampling', () => {
  const frames: ReplayFrame[] = [
    { time: 0, distance: 0, lane: 0, speed: 10, lateralVelocity: 0, longitudinalAccel: 0, steerInput: 0, drifting: false, braking: false, rivals: [{ distance: 8, lane: -2 }] },
    { time: 1, distance: 20, lane: 4, speed: 30, lateralVelocity: 2, longitudinalAccel: 4, steerInput: 1, drifting: true, braking: true, rivals: [{ distance: 28, lane: 2 }] },
  ]

  it('interpolates player and rival positions between recorded snapshots', () => {
    const frame = sampleReplay(frames, 0.5)
    expect(frame?.distance).toBe(10)
    expect(frame?.lane).toBe(2)
    expect(frame?.speed).toBe(20)
    expect(frame?.rivals[0].distance).toBe(18)
  })

  it('clamps playback to the first and last recorded snapshots', () => {
    expect(sampleReplay(frames, -1)?.distance).toBe(0)
    expect(sampleReplay(frames, 4)?.distance).toBe(20)
    expect(sampleReplay([], 0)).toBeNull()
  })
})
