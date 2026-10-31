import ar from '../i18n/ar.json'
import type { Locale } from './save'

export type Dictionary = Record<string, string>
const DICTIONARIES: Record<Locale, Dictionary> = { ar }

/** This game is intentionally Arabic-only; browser and operating-system languages never override it. */
export function detectLocale(_languages: readonly string[] | undefined): Locale {
  return 'ar'
}

export function resolveLocale(_saved: Locale | '', _languages: readonly string[] | undefined): Locale {
  return 'ar'
}

export class I18n {
  locale: Locale
  private listeners = new Set<(locale: Locale) => void>()

  constructor(locale: Locale = 'ar') {
    this.locale = locale
    document.documentElement.lang = 'ar'
    document.documentElement.dir = 'rtl'
  }

  /** Look up a game string and replace `{name}` placeholders. */
  t(key: string, vars: Record<string, string | number> = {}): string {
    const text = DICTIONARIES.ar[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }

  set(_locale: Locale): void {
    if (this.locale === 'ar') return
    this.locale = 'ar'
    document.documentElement.lang = 'ar'
    document.documentElement.dir = 'rtl'
    for (const fn of this.listeners) fn('ar')
  }

  onChange(fn: (locale: Locale) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const DICTIONARY_KEYS = { ar: Object.keys(ar) }
