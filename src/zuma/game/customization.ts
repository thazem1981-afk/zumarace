/** Garage cosmetic options. Cosmetics are free and never change handling. */
import type { CarId } from './campaign'

export type LiveryId = 'none' | 'stripes' | 'number' | 'split' | 'rally'
export type CarLook = Readonly<{ paint: string | null; rim: string; livery: LiveryId; spoiler: boolean; number: number }>

export const PAINT_COLORS = ['#d79a45', '#c8372d', '#1f6f73', '#2f5fae', '#f2f2ee', '#1c1d20', '#6f9f43', '#e7c13a', '#8f70d6', '#e46b9a'] as const
export const RIM_COLORS = ['#aeb5b9', '#1c1d20', '#d9a63a', '#f2f2ee', '#c8372d'] as const
export const LIVERIES: readonly { id: LiveryId; label: string }[] = [
  { id: 'none', label: 'لون صافٍ' },
  { id: 'stripes', label: 'خطوط سباق' },
  { id: 'number', label: 'رقم جانبي' },
  { id: 'split', label: 'لونان' },
  { id: 'rally', label: 'رالي كامل' },
]

export const DEFAULT_LOOK: CarLook = Object.freeze({ paint: null, rim: RIM_COLORS[0], livery: 'rally', spoiler: true, number: 7 })

export type Garage = Partial<Record<CarId, CarLook>>

export function lookFor(garage: Garage | undefined, id: CarId): CarLook {
  return { ...DEFAULT_LOOK, ...(garage?.[id] ?? {}) }
}

const HEX = /^#[0-9a-f]{6}$/i
const LIVERY_IDS = new Set(LIVERIES.map(l => l.id))

export function parseGarage(raw: unknown, validIds: ReadonlySet<string>): Garage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, CarLook> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validIds.has(id) || !v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    out[id] = {
      paint: typeof o.paint === 'string' && HEX.test(o.paint) ? o.paint : null,
      rim: typeof o.rim === 'string' && HEX.test(o.rim) ? o.rim : DEFAULT_LOOK.rim,
      livery: typeof o.livery === 'string' && LIVERY_IDS.has(o.livery as LiveryId) ? o.livery as LiveryId : DEFAULT_LOOK.livery,
      spoiler: o.spoiler !== false,
      number: typeof o.number === 'number' && Number.isInteger(o.number) && o.number >= 1 && o.number <= 99 ? o.number : DEFAULT_LOOK.number,
    }
  }
  return out as Garage
}
