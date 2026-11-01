import { describe, expect, it } from 'vitest'
import { BIOME_ORDER, biomeForStage, conditionsForStage, WEATHER_GRIP } from './environment'
import { CAMPAIGN_CARS, CAMPAIGN_STAGES } from './campaign'
import { buildPaceNotes, gradeFor, turnAngle } from './pace-notes'
import { lookFor, parseGarage } from './customization'
import { parseSave } from '../engine/save'
import { advanceLateralMotion } from './handling'

describe('stage variety', () => {
  it('consecutive stages never share a biome', () => {
    for (let s = 1; s < 100; s += 1) expect(biomeForStage(s).id).not.toBe(biomeForStage(s + 1).id)
  })
  it('uses all six landscapes, not only desert', () => {
    const seen = new Set(Array.from({ length: 12 }, (_, i) => biomeForStage(i + 1).id))
    expect(seen.size).toBe(BIOME_ORDER.length)
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
