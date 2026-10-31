import { CAMPAIGN_CARS, TURBO_TYPES, defaultRaceProgress, type CarId, type RaceProgress, type TurboTypeId } from '../game/campaign'

export type Locale = 'ar'
export type Quality = 'low' | 'medium' | 'high'

export type SaveData = {
  version: 2
  locale: Locale
  musicVolume: number
  sfxVolume: number
  muted: boolean
  /** Driving steer gain in 0.5–1.8. */
  sensitivity: number
  quality: Quality
  reducedMotion: boolean
  /** Compatibility fields retained for the unused starter modules. */
  invertY: boolean
  tutorialDone: boolean
  playerName: string
  leaderboard: ScoreEntry[]
  raceProgress: RaceProgress
}

export type ScoreEntry = { name: string; score: number; seconds: number; at: number }

export const SAVE_KEY = 'duneflow.save'
const VALID_CAR_IDS = new Set<string>(CAMPAIGN_CARS.map(car => car.id))
const VALID_TURBO_IDS = new Set<string>(TURBO_TYPES.map(turbo => turbo.id))

export function defaultSave(): SaveData {
  return {
    version: 2,
    locale: 'ar',
    musicVolume: 0.7,
    sfxVolume: 0.8,
    muted: false,
    sensitivity: 1,
    quality: 'high',
    reducedMotion: false,
    invertY: false,
    tutorialDone: false,
    playerName: 'سائق',
    leaderboard: [],
    raceProgress: defaultRaceProgress(),
  }
}

const clamp01 = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback
const integerIn = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback

const LEADERBOARD_SIZE = 10

export function insertScore(board: readonly ScoreEntry[], entry: ScoreEntry): { board: ScoreEntry[]; rank: number } {
  const next = [...board, entry].sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.at - b.at).slice(0, LEADERBOARD_SIZE)
  return { board: next, rank: next.indexOf(entry) }
}

function parseLeaderboard(raw: unknown): ScoreEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map(item => ({
      name: typeof item.name === 'string' ? item.name.slice(0, 16) : 'سائق',
      score: integerIn(item.score, 0, 9_999_999, 0),
      seconds: integerIn(item.seconds, 0, 99_999, 0),
      at: integerIn(item.at, 0, Number.MAX_SAFE_INTEGER, 0),
    }))
    .sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.at - b.at)
    .slice(0, LEADERBOARD_SIZE)
}

function parseRaceProgress(raw: unknown): RaceProgress {
  const base = defaultRaceProgress()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const value = raw as Record<string, unknown>
  const owned = Array.isArray(value.ownedCars)
    ? [...new Set(value.ownedCars.filter((id): id is string => typeof id === 'string' && VALID_CAR_IDS.has(id)))] as CarId[]
    : [...base.ownedCars]
  if (!owned.includes(base.ownedCars[0])) owned.unshift(base.ownedCars[0])
  const selected = typeof value.selectedCar === 'string' && owned.includes(value.selectedCar as CarId)
    ? value.selectedCar as CarId
    : owned[0]
  const ownedTurbos = Array.isArray(value.ownedTurbos)
    ? [...new Set(value.ownedTurbos.filter((id): id is string => typeof id === 'string' && VALID_TURBO_IDS.has(id)))] as TurboTypeId[]
    : [...base.ownedTurbos]
  const selectedTurbo = typeof value.selectedTurbo === 'string' && ownedTurbos.includes(value.selectedTurbo as TurboTypeId)
    ? value.selectedTurbo as TurboTypeId
    : null
  return {
    coins: integerIn(value.coins, 0, 9_999_999, base.coins),
    unlockedStage: integerIn(value.unlockedStage, 1, 100, base.unlockedStage),
    ownedCars: owned,
    selectedCar: selected,
    engineUpgrade: integerIn(value.engineUpgrade, 0, 5, base.engineUpgrade),
    tireUpgrade: integerIn(value.tireUpgrade, 0, 5, base.tireUpgrade),
    ownedTurbos,
    selectedTurbo,
    wins: integerIn(value.wins, 0, 1_000_000, base.wins),
  }
}

/** Parse and migrate stored JSON into a valid Arabic-only SaveData record. */
export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    data = parsed as Record<string, unknown>
  } catch {
    return base
  }
  // Version 1 was the inherited starter's settings-only record; retain safe settings but start
  // the rally campaign clean. Version 2 adds validated local race progress.
  if (data.version !== 1 && data.version !== 2) return base
  const sensitivity = data.sensitivity
  return {
    version: 2,
    locale: 'ar',
    musicVolume: clamp01(data.musicVolume, base.musicVolume),
    sfxVolume: clamp01(data.sfxVolume, base.sfxVolume),
    muted: data.muted === true,
    invertY: data.invertY === true,
    tutorialDone: data.tutorialDone === true,
    playerName: typeof data.playerName === 'string' ? data.playerName.slice(0, 16) : base.playerName,
    leaderboard: parseLeaderboard(data.leaderboard),
    sensitivity: typeof sensitivity === 'number' && Number.isFinite(sensitivity) && sensitivity >= 0.5 && sensitivity <= 1.8 ? sensitivity : base.sensitivity,
    quality: data.quality === 'low' || data.quality === 'medium' || data.quality === 'high' ? data.quality : base.quality,
    reducedMotion: data.reducedMotion === true,
    raceProgress: data.version === 2 ? parseRaceProgress(data.raceProgress) : base.raceProgress,
  }
}

export class SaveStore {
  data: SaveData

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null
    } catch {
      raw = null
    }
    this.data = parseSave(raw)
  }

  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      // Private browsing or quota: the game keeps working with in-memory settings.
    }
  }
}
