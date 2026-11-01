/**
 * Pure stage-environment rules: which biome, weather and time of day each stage uses, and how
 * weather changes grip. No three.js here so the rules can be unit tested.
 */

export type BiomeId = 'desert' | 'forest' | 'snow' | 'canyon' | 'coast' | 'mountain'
export type WeatherId = 'clear' | 'cloudy' | 'rain' | 'fog' | 'snow' | 'sandstorm'
export type TimeOfDayId = 'dawn' | 'day' | 'sunset' | 'night'
export type SurfaceId = 'sand' | 'gravel' | 'mud' | 'snow' | 'tarmac'

export type Biome = Readonly<{
  id: BiomeId
  label: string
  surface: SurfaceId
  ground: number
  groundAlt: number
  road: number
  curbA: number
  curbB: number
  foliage: number
  rock: number
  dust: number
  weathers: readonly WeatherId[]
}>

export const BIOMES: Readonly<Record<BiomeId, Biome>> = Object.freeze({
  desert: { id: 'desert', label: 'صحراء', surface: 'sand', ground: 0xd8ad70, groundAlt: 0xc28d55, road: 0xb99366, curbA: 0xf3d48f, curbB: 0xbd5537, foliage: 0x466a43, rock: 0x8a6a4c, dust: 0xd8b47e, weathers: ['clear', 'clear', 'sandstorm', 'cloudy'] },
  forest: { id: 'forest', label: 'غابة', surface: 'mud', ground: 0x4f6b35, groundAlt: 0x3d5629, road: 0x6b5236, curbA: 0xe9e2c9, curbB: 0xb3402e, foliage: 0x2f5a2a, rock: 0x6a6660, dust: 0x5a4430, weathers: ['clear', 'rain', 'fog', 'cloudy'] },
  snow: { id: 'snow', label: 'ثلوج', surface: 'snow', ground: 0xe8eef2, groundAlt: 0xcfd9e0, road: 0xb9c3c9, curbA: 0xffffff, curbB: 0x2f6fae, foliage: 0x2a4a3a, rock: 0x6e7880, dust: 0xf4f8fb, weathers: ['clear', 'snow', 'snow', 'fog'] },
  canyon: { id: 'canyon', label: 'وادٍ صخري', surface: 'gravel', ground: 0xb5653d, groundAlt: 0x8f4a2c, road: 0x9a6a4c, curbA: 0xf0d9b0, curbB: 0x2f5b66, foliage: 0x6b7a3a, rock: 0x9b4f30, dust: 0xc58a62, weathers: ['clear', 'sandstorm', 'cloudy', 'clear'] },
  coast: { id: 'coast', label: 'ساحل', surface: 'tarmac', ground: 0xe6d3a3, groundAlt: 0x8fae6a, road: 0x45474b, curbA: 0xf5f5f0, curbB: 0xd13f3f, foliage: 0x3f7a3a, rock: 0x8d8478, dust: 0xe6d8b5, weathers: ['clear', 'cloudy', 'rain', 'clear'] },
  mountain: { id: 'mountain', label: 'جبال', surface: 'gravel', ground: 0x7d8a6a, groundAlt: 0x6a6f66, road: 0x8b8378, curbA: 0xf2efe6, curbB: 0x2e6b46, foliage: 0x2f4f33, rock: 0x6f6a66, dust: 0xa59c8e, weathers: ['clear', 'fog', 'rain', 'cloudy'] },
})

/** Stage order cycles biomes so consecutive stages never share a landscape. */
export const BIOME_ORDER: readonly BiomeId[] = ['desert', 'forest', 'canyon', 'snow', 'coast', 'mountain']
const TIMES: readonly TimeOfDayId[] = ['day', 'sunset', 'dawn', 'day', 'night', 'day', 'sunset']

export function biomeForStage(stage: number): Biome {
  const s = Number.isInteger(stage) && stage > 0 ? stage : 1
  return BIOMES[BIOME_ORDER[(s - 1) % BIOME_ORDER.length]]
}

export type StageConditions = Readonly<{ biome: Biome; weather: WeatherId; time: TimeOfDayId }>

export function conditionsForStage(stage: number): StageConditions {
  const s = Number.isInteger(stage) && stage > 0 ? stage : 1
  const biome = biomeForStage(s)
  const seed = hash(s)
  // The first stage is always clear daylight so a new player learns in easy conditions.
  if (s === 1) return { biome, weather: 'clear', time: 'day' }
  const weather = biome.weathers[seed % biome.weathers.length]
  const time = TIMES[(seed >>> 7) % TIMES.length]
  return { biome, weather, time }
}

/** Grip multiplier applied to tyre force for each weather. */
export const WEATHER_GRIP: Readonly<Record<WeatherId, number>> = Object.freeze({
  clear: 1, cloudy: 1, fog: 0.97, rain: 0.82, snow: 0.72, sandstorm: 0.9,
})

/** Smooth, deterministic wind vectors used by weather particles (world units per second). */
export function windForWeather(weather: WeatherId, time: number): Readonly<{ x: number; z: number }> {
  const t = Number.isFinite(time) ? time : 0
  const gust = Math.sin(t * 0.7)
  const crosswind = Math.sin(t * 0.31 + 1.2)
  if (weather === 'sandstorm') return { x: 18 + gust * 8, z: crosswind * 5 }
  if (weather === 'rain') return { x: 2 + gust * 2, z: crosswind * 1.5 }
  if (weather === 'snow') return { x: 1.2 + gust * 0.8, z: crosswind * 1.4 }
  return { x: 0, z: 0 }
}

/** Off-line drag scale by surface: loose surfaces slow a car leaving the racing line more. */
export const SURFACE_DRAG: Readonly<Record<SurfaceId, number>> = Object.freeze({
  tarmac: 1.25, gravel: 1, sand: 1, mud: 1.15, snow: 0.9,
})

export const WEATHER_LABEL: Readonly<Record<WeatherId, string>> = Object.freeze({
  clear: 'صحو', cloudy: 'غائم', rain: 'ممطر', fog: 'ضباب', snow: 'تساقط ثلوج', sandstorm: 'عاصفة رملية',
})
export const TIME_LABEL: Readonly<Record<TimeOfDayId, string>> = Object.freeze({
  dawn: 'فجر', day: 'نهار', sunset: 'غروب', night: 'ليل',
})

/** Start-of-race sun progress (0 = sunrise, 0.5 = noon, 1 = sunset, >1 = night). */
export const TIME_START: Readonly<Record<TimeOfDayId, number>> = Object.freeze({
  dawn: 0.04, day: 0.42, sunset: 0.9, night: 1.35,
})

function hash(stage: number): number {
  let x = (Math.imul(stage, 0x2c1b3c6d) ^ 0x5bd1e995) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 0x297a2d39) >>> 0
  x ^= x >>> 12
  return x >>> 0
}
