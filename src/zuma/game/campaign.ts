/**
 * Pure campaign/store rules. This module deliberately has no renderer, persistence,
 * network, or real-money dependencies; callers own and replace the returned state.
 */

export type CampaignStage = Readonly<{
  number: number
  name: string
  /** A display-friendly campaign rating on a 1–100 scale. */
  difficulty: number
  timeLimitSeconds: number
  rewardCoins: number
}>

const STAGE_NAMES = [
  'رمل الفجر', 'وادي السراب', 'كثيب العنبر', 'ممر النخيل', 'هضبة الريح',
  'عين الغبار', 'قوس الرمال', 'سهل الظمأ', 'درب القمر', 'واحة الصمت',
  'تل الذهب', 'شق الزمرد', 'سنام الجمل', 'ساحة القيظ', 'مضيق السكون',
  'خيمة البيداء', 'حافة السراب', 'مجرى الوادي', 'كثيب اللؤلؤ', 'درب الشهب',
  'مرتفَع النوق', 'سهل الياقوت', 'عين النخيل', 'جرف الرمال', 'بوابة القيظ',
  'قاع البلور', 'ممر الواحة', 'هضبة الصقور', 'رابية العنبر', 'وادي النيازك',
  'درب الملح', 'رمل الياقوت', 'سنام الريح', 'فج القوافل', 'تل السحاب',
  'عين السراب', 'مضمار الظلال', 'سهل الكثبان', 'ممر العقيق', 'رابية الهلال',
  'وادي الزعفران', 'حافة النخيل', 'درب الغسق', 'قوس الغبار', 'قاع الرمال',
  'هضبة الجمر', 'واحة البريق', 'شق القوافل', 'تل المها', 'سهل النجوم',
  'ممر السدر', 'عين الرمال', 'رابية الشفق', 'وادي الفضة', 'درب الصقور',
  'كثيب المرجان', 'فج السراب', 'سنام النخيل', 'قاع العنبر', 'بوابة القمر',
  'تل العواصف', 'سهل البلور', 'مضيق الرمال', 'هضبة الندى', 'درب السيوف',
  'واحة الشروق', 'شق الهلال', 'رابية الغيم', 'وادي العقيق', 'قوس النخيل',
  'مرتفَع السراب', 'عين الزمرد', 'فج الرمال', 'سهل العنقاء', 'تل الزعفران',
  'ممر الجمر', 'درب الواحة', 'حافة الشفق', 'قاع النيازك', 'هضبة اللؤلؤ',
  'وادي القوافل', 'رابية الذهب', 'سنام الصقور', 'مضمار الغسق', 'عين البلور',
  'كثيب الشهب', 'بوابة الرمال', 'سهل المها', 'شق العواصف', 'تل السدر',
  'درب الياقوت', 'واحة الهلال', 'هضبة العنبر', 'قوس الشفق', 'وادي النجوم',
  'فج النخيل', 'قمة السراب', 'ميدان البيداء', 'قلب الصحراء', 'عرش الرمال',
] as const

/** The complete, immutable, one-based campaign table. */
export const CAMPAIGN_STAGES: readonly CampaignStage[] = Object.freeze(
  STAGE_NAMES.map((name, index) => {
    const number = index + 1
    return Object.freeze({
      number,
      name,
      difficulty: number,
      timeLimitSeconds: Math.round(165 - (number - 1) * (71 / 99)),
      rewardCoins: 100 + Math.floor((number - 1) * 6.5),
    })
  }),
)

/** Returns a stage for an integer in 1–100; invalid or out-of-range values return undefined. */
export function stageByNumber(number: number): CampaignStage | undefined {
  if (!Number.isInteger(number) || number < 1 || number > CAMPAIGN_STAGES.length) return undefined
  return CAMPAIGN_STAGES[number - 1]
}

export type CarId = 'dune-runner' | 'sand-hawk' | 'mirage-gt' | 'desert-king' | 'zuma-rs' | 'dune-pickup' | 'storm-buggy' | 'falcon-rally' | 'atlas-suv'
export type CarDesign = 'glb' | 'rally-hatch' | 'coupe' | '4x4' | 'sedan' | 'pickup' | 'buggy' | 'rally-truck' | 'suv'
export type CampaignCar = Readonly<{
  id: CarId
  name: string
  price: number
  acceleration: number
  topSpeed: number
  handling: number
  grip: number
  color: string
  design: CarDesign
  ability: CarAbilityId
}>

export type CarAbilityId = 'launch' | 'grip' | 'speed' | 'armor' | 'cornering' | 'recharge' | 'drift' | 'turbo' | 'terrain'
export type CarAbilityProfile = Readonly<{
  id: CarAbilityId
  acceleration: number
  topSpeed: number
  steering: number
  grip: number
  drift: number
  turboPower: number
  turboRecharge: number
  offroadDrag: number
  crashDuration: number
  crashSpeedRetention: number
}>

const defineAbility = (id: CarAbilityId, overrides: Partial<CarAbilityProfile> = {}): CarAbilityProfile =>
  Object.freeze({
    id, acceleration: 1, topSpeed: 1, steering: 1, grip: 1, drift: 1, turboPower: 1,
    turboRecharge: 1, offroadDrag: 1, crashDuration: 1, crashSpeedRetention: 0.42, ...overrides,
  })

/** One distinct, passive handling strength for each showroom car. */
export const CAR_ABILITIES: Readonly<Record<CarAbilityId, CarAbilityProfile>> = Object.freeze({
  launch: defineAbility('launch', { acceleration: 1.16 }),
  grip: defineAbility('grip', { grip: 1.18 }),
  speed: defineAbility('speed', { topSpeed: 1.12 }),
  armor: defineAbility('armor', { crashDuration: 0.72, crashSpeedRetention: 0.58 }),
  cornering: defineAbility('cornering', { steering: 1.18 }),
  recharge: defineAbility('recharge', { turboRecharge: 1.36 }),
  drift: defineAbility('drift', { drift: 1.3 }),
  turbo: defineAbility('turbo', { turboPower: 1.22 }),
  terrain: defineAbility('terrain', { offroadDrag: 0.45, grip: 1.06 }),
})

/** Store inventory: first car is free; the remaining cars cost in-game coins only. */
export const CAMPAIGN_CARS: readonly CampaignCar[] = Object.freeze([
  Object.freeze({ id: 'dune-runner', name: 'عدّاء الرمال', price: 0, acceleration: 6, topSpeed: 6, handling: 6, grip: 6, color: '#d79a45', design: 'glb', ability: 'launch' }),
  Object.freeze({ id: 'sand-hawk', name: 'صقر الوادي', price: 500, acceleration: 7, topSpeed: 7, handling: 6, grip: 7, color: '#45a6a0', design: 'rally-hatch', ability: 'grip' }),
  Object.freeze({ id: 'mirage-gt', name: 'سراب جي تي', price: 1_500, acceleration: 8, topSpeed: 8, handling: 8, grip: 7, color: '#8f70d6', design: 'coupe', ability: 'speed' }),
  Object.freeze({ id: 'desert-king', name: 'ملك الصحراء', price: 3_500, acceleration: 9, topSpeed: 10, handling: 8, grip: 9, color: '#d35448', design: '4x4', ability: 'armor' }),
  Object.freeze({ id: 'zuma-rs', name: 'زوما آر إس', price: 4_800, acceleration: 9, topSpeed: 10, handling: 9, grip: 9, color: '#45a6d4', design: 'sedan', ability: 'cornering' }),
  Object.freeze({ id: 'dune-pickup', name: 'بيك أب الكثبان', price: 6_400, acceleration: 8, topSpeed: 8, handling: 8, grip: 10, color: '#72a455', design: 'pickup', ability: 'recharge' }),
  Object.freeze({ id: 'storm-buggy', name: 'عاصفة باجي', price: 8_500, acceleration: 10, topSpeed: 9, handling: 10, grip: 9, color: '#e77a3d', design: 'buggy', ability: 'drift' }),
  Object.freeze({ id: 'falcon-rally', name: 'صقر الرالي', price: 10_800, acceleration: 9, topSpeed: 11, handling: 9, grip: 10, color: '#4b8182', design: 'rally-truck', ability: 'turbo' }),
  Object.freeze({ id: 'atlas-suv', name: 'أطلس الصحراوي', price: 13_200, acceleration: 10, topSpeed: 11, handling: 9, grip: 10, color: '#c7a64b', design: 'suv', ability: 'terrain' }),
])

export const TURBO_TYPES = Object.freeze([
  Object.freeze({ id: 'balanced', price: 350, power: 1.18, topSpeed: 1.34, drain: 0.21, recharge: 0.07, color: '#52bda4' }),
  Object.freeze({ id: 'sprint', price: 800, power: 1.58, topSpeed: 1.46, drain: 0.38, recharge: 0.05, color: '#f17c43' }),
  Object.freeze({ id: 'endurance', price: 1_100, power: 1.02, topSpeed: 1.27, drain: 0.12, recharge: 0.095, color: '#77aee2' }),
] as const)
export type TurboTypeId = typeof TURBO_TYPES[number]['id']
export type UpgradeKind = 'engine' | 'tires'
export type RaceProgress = Readonly<{
  coins: number
  unlockedStage: number
  ownedCars: readonly CarId[]
  selectedCar: CarId
  engineUpgrade: number
  tireUpgrade: number
  ownedTurbos: readonly TurboTypeId[]
  selectedTurbo: TurboTypeId | null
  wins: number
}>

export const MAX_UPGRADE_LEVEL = 5
/** Cost of the next level = this base price × (current level + 1). */
export const UPGRADE_BASE_COST: Readonly<Record<UpgradeKind, number>> = Object.freeze({ engine: 250, tires: 200 })

export function defaultRaceProgress(): RaceProgress {
  return {
    coins: 0,
    unlockedStage: 1,
    ownedCars: ['dune-runner'],
    selectedCar: 'dune-runner',
    engineUpgrade: 0,
    tireUpgrade: 0,
    ownedTurbos: [],
    selectedTurbo: null,
    wins: 0,
  }
}

export type OperationFailureReason = 'invalid-car' | 'invalid-turbo' | 'already-owned' | 'not-owned' | 'insufficient-coins' | 'invalid-upgrade' | 'max-upgrade-level' | 'invalid-stage' | 'stage-locked'
export type OperationFailure = Readonly<{ ok: false; progress: RaceProgress; reason: OperationFailureReason }>
export type BuyCarSuccess = Readonly<{ ok: true; progress: RaceProgress; car: CampaignCar }>
export type SelectCarSuccess = Readonly<{ ok: true; progress: RaceProgress; car: CampaignCar }>
export type TurboBuySuccess = Readonly<{ ok: true; progress: RaceProgress; turbo: typeof TURBO_TYPES[number] }>
export type TurboSelectSuccess = Readonly<{ ok: true; progress: RaceProgress; turbo: typeof TURBO_TYPES[number] }>
export type UpgradeSuccess = Readonly<{ ok: true; progress: RaceProgress; kind: UpgradeKind; level: number; cost: number }>
export type StageWinSuccess = Readonly<{ ok: true; progress: RaceProgress; stage: CampaignStage; reward: number; unlockedStage: number }>

function failure(progress: RaceProgress, reason: OperationFailureReason): OperationFailure {
  return { ok: false, progress, reason }
}

/** Buy one store car with coins. Failed attempts return the original progress unchanged. */
export function buyCar(progress: RaceProgress, carId: CarId): BuyCarSuccess | OperationFailure {
  const car = CAMPAIGN_CARS.find(item => item.id === carId)
  if (!car) return failure(progress, 'invalid-car')
  if (progress.ownedCars.includes(car.id)) return failure(progress, 'already-owned')
  if (progress.coins < car.price) return failure(progress, 'insufficient-coins')
  return {
    ok: true,
    car,
    progress: { ...progress, coins: progress.coins - car.price, ownedCars: [...progress.ownedCars, car.id] },
  }
}

/** Select only an owned car; this never spends coins. */
export function selectCar(progress: RaceProgress, carId: CarId): SelectCarSuccess | OperationFailure {
  const car = CAMPAIGN_CARS.find(item => item.id === carId)
  if (!car) return failure(progress, 'invalid-car')
  if (!progress.ownedCars.includes(car.id)) return failure(progress, 'not-owned')
  return { ok: true, car, progress: { ...progress, selectedCar: car.id } }
}

/** Buy a turbo module using Zuma Coin and equip it immediately. */
export function buyTurbo(progress: RaceProgress, turboId: TurboTypeId): TurboBuySuccess | OperationFailure {
  const turbo = TURBO_TYPES.find(item => item.id === turboId)
  if (!turbo) return failure(progress, 'invalid-turbo')
  if (progress.ownedTurbos.includes(turbo.id)) return failure(progress, 'already-owned')
  if (progress.coins < turbo.price) return failure(progress, 'insufficient-coins')
  return {
    ok: true,
    turbo,
    progress: {
      ...progress,
      coins: progress.coins - turbo.price,
      ownedTurbos: [...progress.ownedTurbos, turbo.id],
      selectedTurbo: turbo.id,
    },
  }
}

/** Equip an owned turbo module without spending coins. */
export function selectTurbo(progress: RaceProgress, turboId: TurboTypeId): TurboSelectSuccess | OperationFailure {
  const turbo = TURBO_TYPES.find(item => item.id === turboId)
  if (!turbo) return failure(progress, 'invalid-turbo')
  if (!progress.ownedTurbos.includes(turbo.id)) return failure(progress, 'not-owned')
  return { ok: true, turbo, progress: { ...progress, selectedTurbo: turbo.id } }
}

/** Buy the next engine or tire upgrade. Levels are capped at MAX_UPGRADE_LEVEL. */
export function buyUpgrade(progress: RaceProgress, kind: UpgradeKind): UpgradeSuccess | OperationFailure {
  if (kind !== 'engine' && kind !== 'tires') return failure(progress, 'invalid-upgrade')
  const currentLevel = kind === 'engine' ? progress.engineUpgrade : progress.tireUpgrade
  if (!Number.isInteger(currentLevel) || currentLevel < 0 || currentLevel > MAX_UPGRADE_LEVEL) {
    return failure(progress, 'invalid-upgrade')
  }
  if (currentLevel >= MAX_UPGRADE_LEVEL) return failure(progress, 'max-upgrade-level')
  const cost = UPGRADE_BASE_COST[kind] * (currentLevel + 1)
  if (progress.coins < cost) return failure(progress, 'insufficient-coins')
  const nextLevel = currentLevel + 1
  const nextProgress: RaceProgress = kind === 'engine'
    ? { ...progress, coins: progress.coins - cost, engineUpgrade: nextLevel }
    : { ...progress, coins: progress.coins - cost, tireUpgrade: nextLevel }
  return { ok: true, progress: nextProgress, kind, level: nextLevel, cost }
}

/**
 * Record a clear of an unlocked stage, pay that stage's fixed coin reward, and unlock the
 * next stage. Replaying an unlocked stage is allowed and awards its reward again.
 */
export function finishStage(progress: RaceProgress, stageNumber: number): StageWinSuccess | OperationFailure {
  const stage = stageByNumber(stageNumber)
  if (!stage) return failure(progress, 'invalid-stage')
  if (!Number.isInteger(progress.unlockedStage) || stageNumber > progress.unlockedStage) {
    return failure(progress, 'stage-locked')
  }
  const unlockedStage = Math.min(CAMPAIGN_STAGES.length, Math.max(progress.unlockedStage, stageNumber + 1))
  return {
    ok: true,
    stage,
    reward: stage.rewardCoins,
    unlockedStage,
    progress: { ...progress, coins: progress.coins + stage.rewardCoins, unlockedStage, wins: progress.wins + 1 },
  }
}
