import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Quality, SaveData, SaveStore } from '../engine/save'
import { CAMPAIGN_CARS, CAMPAIGN_STAGES, MAX_UPGRADE_LEVEL, TURBO_TYPES, UPGRADE_BASE_COST, type CarId, type UpgradeKind, type RaceProgress, type TurboTypeId } from '../game/campaign'
import type { RallyHud, RallyResult } from '../game/rally-game'

export type RallyScreen = 'boot' | 'title' | 'campaign' | 'garage' | 'hud' | 'pause' | 'settings' | 'results'
export type RallyUiActions = {
  start(stage: number): void
  resume(): void
  restart(): void
  next(stage: number): void
  quit(): void
  buyCar(id: CarId): void
  selectCar(id: CarId): void
  buyTurbo(id: TurboTypeId): void
  selectTurbo(id: TurboTypeId): void
  upgrade(kind: UpgradeKind): void
  settings(patch: Partial<SaveData>): void
}

/** Arabic, RTL HTML interface. Menus use the same focus/confirm path for keyboard and gamepad. */
export class RallyUi {
  screen: RallyScreen = 'boot'
  private readonly root: HTMLElement
  private readonly stack: RallyScreen[] = []
  private repeatDelay = 0
  private lastDirection = 0
  private lastResult?: RallyResult

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: RallyUiActions,
  ) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.root.addEventListener('click', event => this.onClick(event))
    this.root.addEventListener('input', event => this.onInput(event))
    this.root.addEventListener('focusin', event => {
      if ((event.target as HTMLElement).matches('[data-nav]')) this.audio.play('ui')
    })
    this.root.addEventListener('pointerdown', () => {
      if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('has-touch')
    }, { once: true })
    this.i18n.onChange(() => this.translate())
    this.translate()
    this.refreshSettings()
  }

  show(screen: RallyScreen): void {
    this.stack.length = 0
    this.setScreen(screen)
  }

  push(screen: RallyScreen): void {
    this.stack.push(this.screen)
    this.setScreen(screen)
  }

  back(): void {
    const previous = this.stack.pop()
    if (previous) this.setScreen(previous)
    else if (this.screen === 'pause') this.actions.resume()
    else this.actions.quit()
  }

  setBootProgress(progress: number): void {
    const bar = this.root.querySelector<HTMLElement>('.boot-bar i')
    if (bar) bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, progress))})`
  }

  showBootError(): void {
    this.root.querySelector<HTMLElement>('.boot-error')?.classList.add('is-visible')
    const retry = this.root.querySelector<HTMLButtonElement>('[data-action="retry-load"]')
    if (retry) retry.hidden = false
  }

  showTitle(): void {
    const progress = this.save.data.raceProgress
    this.root.querySelector('[data-slot="home-stage"]')!.textContent = number(progress.unlockedStage)
    this.root.querySelector('[data-slot="home-coins"]')!.textContent = number(progress.coins)
    this.root.querySelector('[data-slot="home-wins"]')!.textContent = number(progress.wins)
    this.show('title')
  }

  showCampaign(progress: RaceProgress = this.save.data.raceProgress): void {
    const grid = this.root.querySelector<HTMLElement>('.stage-grid')!
    grid.innerHTML = CAMPAIGN_STAGES.map(stage => {
      const unlocked = stage.number <= progress.unlockedStage
      const current = stage.number === progress.unlockedStage
      return `<button data-nav data-stage="${stage.number}" class="stage-card${current ? ' is-current' : ''}" ${unlocked ? '' : 'disabled'} aria-label="${escapeHtml(stage.name)} ${number(stage.number)}">
        <strong>${number(stage.number)}</strong><span>${escapeHtml(stage.name)}</span><i>${unlocked ? '◆' : '—'}</i>
      </button>`
    }).join('')
    this.root.querySelector('[data-slot="campaign-open"]')!.textContent = `${number(progress.unlockedStage)}/100`
    this.show('campaign')
  }

  showGarage(progress: RaceProgress = this.save.data.raceProgress): void {
    const grid = this.root.querySelector<HTMLElement>('.car-grid')!
    grid.innerHTML = CAMPAIGN_CARS.map(car => {
      const owned = progress.ownedCars.includes(car.id)
      const selected = progress.selectedCar === car.id
      const action = owned ? 'select-car' : 'buy-car'
      const actionText = selected ? this.i18n.t('shop.selected') : owned ? this.i18n.t('shop.select') : this.i18n.t('shop.buy', { price: number(car.price) })
      return `<article class="car-card${selected ? ' is-selected' : ''}" style="--car-color:${car.color}">
        <div class="car-swatch car-swatch-${car.design}" aria-hidden="true"><span></span><i></i></div>
        <div class="car-card-copy"><h3>${escapeHtml(car.name)}</h3><p>${this.i18n.t('shop.speed')}: ${number(car.topSpeed)} · ${this.i18n.t('shop.acceleration')}: ${number(car.acceleration)}</p><p>${this.i18n.t('shop.grip')}: ${number(car.grip)}</p><p class="car-ability"><b>${this.i18n.t('shop.ability')}: ${this.i18n.t(`carAbility.${car.ability}.name`)}</b> — ${this.i18n.t(`carAbility.${car.ability}.desc`)}</p></div>
        <button data-nav class="btn ${selected ? 'btn-selected' : owned ? '' : 'btn-accent'}" data-action="${action}" data-car="${car.id}" ${selected || (!owned && progress.coins < car.price) ? 'disabled' : ''}>${escapeHtml(actionText)}</button>
      </article>`
    }).join('')
    this.root.querySelector('[data-slot="garage-coins"]')!.textContent = number(progress.coins)
    this.updateUpgrade('engine', progress)
    this.updateUpgrade('tires', progress)
    this.renderTurboTypes(progress)
    this.show('garage')
  }

  updateHud(hud: RallyHud): void {
    this.text('[data-slot="hud-stage"]', this.i18n.t('hud.stage', { n: number(hud.stage) }))
    this.text('[data-slot="hud-lap"]', this.i18n.t('hud.lap', { lap: number(hud.lap), total: number(hud.laps) }))
    this.text('[data-slot="hud-position"]', this.i18n.t('hud.position', { place: number(hud.place), total: number(hud.racers) }))
    this.text('[data-slot="hud-speed"]', number(hud.speed))
    this.text('[data-slot="hud-time"]', formatClock(hud.elapsed))
    this.text('[data-slot="hud-impacts"]', this.i18n.t('hud.impacts', { n: number(hud.impacts) }))
    this.text('[data-slot="hud-coins"]', number(hud.coins))
    const fill = this.root.querySelector<HTMLElement>('.turbo-fill')
    if (fill) fill.style.width = `${Math.round(hud.turbo * 100)}%`
    this.text('[data-slot="turbo-percent"]', `${number(Math.round(hud.turbo * 100))}٪`)
    const selectedTurbo = this.save.data.raceProgress.selectedTurbo
    this.text('[data-slot="turbo-name"]', selectedTurbo ? this.i18n.t(`turbo.${selectedTurbo}.name`) : this.i18n.t('touch.turboLocked'))
    const turboButton = this.root.querySelector<HTMLButtonElement>('[data-touch="turbo"]')
    const turboLocked = this.save.data.raceProgress.selectedTurbo === null
    if (turboButton && turboButton.disabled !== turboLocked) {
      turboButton.disabled = turboLocked
      turboButton.setAttribute('aria-label', this.i18n.t(turboLocked ? 'touch.turboLocked' : 'touch.turbo'))
    }
    this.root.querySelector('.hud-warning')?.classList.toggle('is-visible', hud.crashed)
    this.root.querySelector('.hud-drift')?.classList.toggle('is-visible', hud.drifting)
    this.root.querySelector('.hud-impacts')?.classList.toggle('is-danger', hud.impacts >= 4)
    this.root.querySelector('.hud-impact-reset')?.classList.toggle('is-visible', hud.impactResetNotice)
    const signal = this.root.querySelector<HTMLElement>('.race-signal')
    if (signal) {
      const active = hud.countdown > 0 || hud.starting
      signal.textContent = hud.countdown > 0 ? number(hud.countdown) : hud.starting ? this.i18n.t('race.go') : ''
      signal.dataset.value = hud.countdown > 0 ? String(hud.countdown) : hud.starting ? 'go' : ''
      signal.classList.toggle('is-active', active)
      signal.setAttribute('aria-hidden', String(!active))
    }
    const speed = this.root.querySelector<HTMLElement>('.speed-gauge')
    if (speed) speed.style.setProperty('--speed', `${Math.min(100, hud.speed / 1.5)}%`)
  }

  showResults(result: RallyResult): void {
    this.lastResult = result
    const panel = this.root.querySelector<HTMLElement>('.results-panel')!
    panel.classList.toggle('is-win', result.won)
    this.text('.results-title', this.i18n.t(result.won ? 'results.win' : 'results.loss'))
    this.text('[data-slot="results-stage"]', this.i18n.t('results.stage', { n: number(result.stage), name: result.stageName }))
    this.text('[data-slot="results-time"]', formatClock(result.elapsed))
    this.text('[data-slot="results-reward"]', result.reward ? `+${number(result.reward)}` : number(0))
    this.text('[data-slot="results-coins"]', number(result.coins))
    const next = this.root.querySelector<HTMLButtonElement>('[data-action="next"]')!
    next.hidden = !result.won || result.stage >= 100
    next.textContent = this.i18n.t('menu.next')
    this.root.querySelector('.results-unranked')?.classList.toggle('is-visible', result.unranked)
    this.show('results')
  }

  refreshSettings(): void {
    const d = this.save.data
    this.setValue('[name="musicVolume"]', d.musicVolume)
    this.setValue('[name="sfxVolume"]', d.sfxVolume)
    this.setValue('[name="sensitivity"]', d.sensitivity)
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.toggle')) {
      const key = button.dataset.setting as 'muted' | 'reducedMotion'
      const on = d[key] === true
      button.setAttribute('aria-pressed', String(on))
      button.textContent = this.i18n.t(on ? 'settings.on' : 'settings.off')
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.quality-choice')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === d.quality))
    }
    for (const range of this.root.querySelectorAll<HTMLInputElement>('input[type="range"]')) this.updateRange(range)
    this.translate()
  }

  /** Shared input path for menu focus, confirm and back. */
  frame(frameSeconds: number): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    this.repeatDelay = Math.max(0, this.repeatDelay - frameSeconds)
    const direction = Math.abs(this.input.move.y) > 0.55 ? Math.sign(this.input.move.y) : Math.abs(this.input.move.x) > 0.7 ? Math.sign(this.input.move.x) : 0
    if (direction !== 0 && this.repeatDelay === 0) {
      if (direction !== this.lastDirection) this.moveFocus(direction)
      else this.moveFocus(direction)
      this.lastDirection = direction
      this.repeatDelay = 0.18
    } else if (direction === 0) this.lastDirection = 0
    if (this.input.consume('confirm')) (document.activeElement as HTMLElement | null)?.click?.()
    if (this.input.consume('back')) this.back()
    if (this.input.consume('pause')) {
      if (this.screen === 'pause') this.actions.resume()
      else if (this.screen === 'settings' || this.screen === 'garage' || this.screen === 'campaign') this.back()
    }
  }

  private setScreen(screen: RallyScreen): void {
    this.screen = screen
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const name = element.dataset.screen
      const active = name === screen || (name === 'hud' && ['pause', 'results', 'settings'].includes(screen) && this.stack.includes('pause'))
      element.classList.toggle('is-active', active)
      element.setAttribute('aria-hidden', String(!active))
    }
    this.root.dataset.activeScreen = screen
    if (screen === 'settings') this.refreshSettings()
    requestAnimationFrame(() => {
      const first = this.navItems()[0]
      if (first && this.input.method !== 'touch') first.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    })
  }

  private updateUpgrade(kind: UpgradeKind, progress: RaceProgress): void {
    const level = kind === 'engine' ? progress.engineUpgrade : progress.tireUpgrade
    const button = this.root.querySelector<HTMLButtonElement>(`[data-action="upgrade"][data-upgrade="${kind}"]`)
    if (!button) return
    const cost = UPGRADE_BASE_COST[kind] * (level + 1)
    const value = level >= MAX_UPGRADE_LEVEL ? this.i18n.t('shop.max') : this.i18n.t('shop.cost', { n: number(cost) })
    const label = kind === 'engine' ? 'shop.engine' : 'shop.tires'
    button.innerHTML = `<span>${this.i18n.t(label)}</span><b>${this.i18n.t('shop.level', { n: number(level) })}</b><em>${value}</em>`
    button.disabled = level >= MAX_UPGRADE_LEVEL || progress.coins < cost
  }

  private renderTurboTypes(progress: RaceProgress): void {
    const grid = this.root.querySelector<HTMLElement>('.turbo-grid')
    if (!grid) return
    grid.innerHTML = TURBO_TYPES.map(turbo => {
      const owned = progress.ownedTurbos.includes(turbo.id)
      const selected = progress.selectedTurbo === turbo.id
      const action = owned ? 'select-turbo' : 'buy-turbo'
      const buttonText = selected
        ? this.i18n.t('shop.turboSelected')
        : owned
          ? this.i18n.t('shop.turboEquip')
          : this.i18n.t('shop.turboBuy', { price: number(turbo.price) })
      const stats = this.i18n.t('shop.turboStats', {
        power: number(Math.round((turbo.power - 1) * 100)),
        speed: number(Math.round((turbo.topSpeed - 1) * 100)),
        seconds: number(Math.round(1 / turbo.drain)),
      })
      return `<article class="turbo-card${selected ? ' is-selected' : ''}" style="--turbo-color:${turbo.color}">
        <div class="turbo-card-heading"><span aria-hidden="true">⚡</span><div><h4>${this.i18n.t(`turbo.${turbo.id}.name`)}</h4><p>${this.i18n.t(`turbo.${turbo.id}.desc`)}</p></div></div>
        <small>${stats}</small>
        <button data-nav class="turbo-choice${selected ? ' is-equipped' : ''}" data-action="${action}" data-turbo="${turbo.id}" ${selected || (!owned && progress.coins < turbo.price) ? 'disabled' : ''}>${buttonText}</button>
      </article>`
    }).join('')
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-stage], .toggle, .quality-choice')
    if (!target || (target as HTMLButtonElement).disabled) return
    this.audio.unlock()
    this.audio.play('ui')
    if (target.matches('.toggle')) {
      const key = target.dataset.setting as 'muted' | 'reducedMotion'
      this.actions.settings({ [key]: !this.save.data[key] })
      this.refreshSettings()
      return
    }
    if (target.matches('.quality-choice')) {
      this.actions.settings({ quality: target.dataset.value as Quality })
      this.refreshSettings()
      return
    }
    if (target.dataset.stage) {
      const stage = Number(target.dataset.stage)
      if (stage <= this.save.data.raceProgress.unlockedStage) this.actions.start(stage)
      return
    }
    const action = target.dataset.action
    const car = target.dataset.car as CarId | undefined
    const turbo = target.dataset.turbo as TurboTypeId | undefined
    switch (action) {
      case 'race': this.actions.start(this.save.data.raceProgress.unlockedStage); break
      case 'campaign': this.showCampaign(); break
      case 'garage': this.showGarage(); break
      case 'resume': this.actions.resume(); break
      case 'restart': this.actions.restart(); break
      case 'next': if (this.lastResult) this.actions.next(this.lastResult.nextStage); break
      case 'quit': this.actions.quit(); break
      case 'settings': this.push('settings'); break
      case 'back': this.back(); break
      case 'pause': window.dispatchEvent(new CustomEvent('rally:pause')); break
      case 'buy-car': if (car) { this.actions.buyCar(car); this.showGarage() } break
      case 'select-car': if (car) { this.actions.selectCar(car); this.showGarage() } break
      case 'buy-turbo': if (turbo && TURBO_TYPES.some(item => item.id === turbo)) { this.actions.buyTurbo(turbo); this.showGarage() } break
      case 'select-turbo': if (turbo && TURBO_TYPES.some(item => item.id === turbo)) { this.actions.selectTurbo(turbo); this.showGarage() } break
      case 'upgrade': {
        const kind = target.dataset.upgrade as UpgradeKind
        if (kind === 'engine' || kind === 'tires') { this.actions.upgrade(kind); this.showGarage() }
        break
      }
      case 'retry-load': window.dispatchEvent(new CustomEvent('rally:retry-load')); break
    }
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement
    if (!target.matches('input[type="range"]')) return
    const value = Number(target.value)
    this.updateRange(target)
    if (target.name === 'musicVolume') this.actions.settings({ musicVolume: value })
    if (target.name === 'sfxVolume') this.actions.settings({ sfxVolume: value })
    if (target.name === 'sensitivity') this.actions.settings({ sensitivity: value })
  }

  private moveFocus(direction: number): void {
    const items = this.navItems()
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = current < 0 ? 0 : (current + (direction > 0 ? -1 : 1) + items.length) % items.length
    items[next].focus({ preventScroll: true })
    items[next].scrollIntoView({ block: 'nearest' })
  }

  private navItems(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('.screen.is-active [data-nav]:not(:disabled):not([hidden])')]
  }

  private updateRange(input: HTMLInputElement): void {
    const value = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100
    input.style.setProperty('--fill', `${Math.max(0, Math.min(100, value))}%`)
  }

  private setValue(selector: string, value: number): void {
    const input = this.root.querySelector<HTMLInputElement>(selector)
    if (input) input.value = String(value)
  }

  private text(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector)
    if (element) element.textContent = value
  }

  private translate(): void {
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) element.textContent = this.i18n.t(element.dataset.i18n!)
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) element.setAttribute('aria-label', this.i18n.t(element.dataset.i18nLabel!))
    for (const mark of this.root.querySelectorAll<HTMLElement>('.brand-mark')) mark.textContent = 'Z'
  }

  private template(): string {
    const range = (name: string, key: string, min: number, max: number, step: number) =>
      `<label class="setting-row"><span data-i18n="${key}"></span><input data-nav type="range" name="${name}" min="${min}" max="${max}" step="${step}"></label>`
    const toggle = (setting: string, key: string) =>
      `<div class="setting-row"><span data-i18n="${key}"></span><button data-nav class="toggle" data-setting="${setting}" aria-pressed="false"></button></div>`
    return /* html */ `
<section class="screen screen-boot is-active" data-screen="boot">
  <div class="boot-card"><img class="boot-icon" src="/favicon.png" alt="Zuma Race"><h1 data-i18n="game.title"></h1><p data-i18n="boot.loading"></p><div class="boot-bar"><i></i></div><div class="boot-error" data-i18n="boot.error"></div><button data-nav data-action="retry-load" class="btn btn-accent" hidden data-i18n="boot.retry"></button></div>
</section>
<section class="screen screen-title" data-screen="title">
  <header class="screen-top"><div class="wordmark"><img class="brand-emblem" src="/favicon.png" alt=""><div><strong data-i18n="game.title"></strong><small data-i18n="brand.type"></small></div></div><div class="wallet"><span aria-hidden="true">Z</span><b data-slot="home-coins">0</b><small data-i18n="money.coins"></small></div></header>
  <div class="title-copy"><div class="title-ribbon"><i></i><span data-i18n="race.cup"></span><b>100</b></div><p class="eyebrow" data-i18n="brand.eyebrow"></p><h1 data-i18n="game.title"></h1><p class="tagline" data-i18n="game.tagline"></p><div class="campaign-summary"><span><span data-i18n="menu.stage"></span> <b data-slot="home-stage">1</b> / 100</span><span><span data-i18n="menu.wins"></span> <b data-slot="home-wins">0</b></span></div>
    <nav class="menu"><button data-nav class="btn btn-primary" data-action="race"><span data-i18n="menu.race"></span><b>↙</b></button><button data-nav class="btn" data-action="campaign"><span data-i18n="menu.campaign"></span></button><button data-nav class="btn btn-accent" data-action="garage"><span data-i18n="menu.garage"></span></button><button data-nav class="btn btn-quiet" data-action="settings"><span data-i18n="menu.settings"></span></button></nav>
  </div>
  <div class="title-bottom"><span data-i18n="controls.title"></span><p data-i18n="controls.keyboard"></p><p data-i18n="controls.gamepad"></p><p data-i18n="controls.phone"></p></div>
</section>
<section class="screen screen-campaign" data-screen="campaign">
  <header class="panel-heading"><button data-nav class="icon-btn" data-action="back" aria-label="رجوع">‹</button><div><p class="eyebrow" data-i18n="campaign.current"></p><h2 data-i18n="campaign.title"></h2></div><div class="open-count"><b data-slot="campaign-open"></b><small data-i18n="campaign.available"></small></div></header>
  <div class="stage-grid"></div>
</section>
<section class="screen screen-garage" data-screen="garage">
  <header class="panel-heading"><button data-nav class="icon-btn" data-action="back" aria-label="رجوع">‹</button><div><p class="eyebrow" data-i18n="shop.tip"></p><h2 data-i18n="shop.title"></h2></div><div class="wallet"><span aria-hidden="true">Z</span><b data-slot="garage-coins">0</b><small data-i18n="money.coins"></small></div></header>
  <div class="garage-content">
    <div class="car-grid"></div>
    <aside class="upgrade-panel">
      <h3 data-i18n="shop.upgrades"></h3><p class="shop-note" data-i18n="shop.tip"></p>
      <button data-nav class="upgrade-card" data-action="upgrade" data-upgrade="engine"></button>
      <button data-nav class="upgrade-card" data-action="upgrade" data-upgrade="tires"></button>
      <div class="turbo-shop"><div><h3 data-i18n="shop.turboTypes"></h3><p class="shop-note" data-i18n="shop.turboHint"></p></div><div class="turbo-grid"></div></div>
      <button data-nav class="btn btn-primary garage-race" data-action="race"><span data-i18n="menu.race"></span></button>
    </aside>
  </div>
</section>
<section class="screen screen-hud" data-screen="hud">
  <div class="hud-top"><div class="hud-panel stage-panel"><span class="hud-symbol">✦</span><div><b data-slot="hud-stage">المرحلة 1</b><small data-slot="hud-lap">اللفة 1/2</small></div></div><div class="race-position"><b data-slot="hud-position">المركز 1/7</b><small data-slot="hud-time">00:00</small><small class="hud-impacts" data-slot="hud-impacts">اصطدامات ٠/٥</small></div><div class="hud-right"><div class="hud-coins"><span aria-hidden="true">Z</span><b data-slot="hud-coins">0</b></div><button class="hud-pause" data-action="pause" data-i18n-label="touch.pause" aria-label="توقف مؤقت">Ⅱ</button></div></div>
  <div class="speed-gauge"><div class="speed-readout"><strong data-slot="hud-speed">0</strong><small data-i18n="hud.speed"></small></div></div>
  <div class="turbo-box"><div><span data-i18n="hud.turbo"></span><b data-slot="turbo-percent">0%</b></div><small data-slot="turbo-name"></small><div class="turbo-meter"><i class="turbo-fill"></i></div></div>
  <div class="race-signal" aria-live="assertive" aria-hidden="true"></div><div class="hud-impact-reset" role="status" data-i18n="hud.impactReset"></div><div class="hud-warning" data-i18n="hud.crash"></div><div class="hud-drift" data-i18n="hud.drift"></div>
  <div class="touch"><div class="touch-stick"><i></i><span><span data-i18n="touch.steering"></span><br><span data-i18n="touch.acceleration"></span></span></div><button class="touch-btn touch-gas" data-touch="throttle"><b>▲</b><span data-i18n="touch.gas"></span></button><button class="touch-btn touch-brake" data-touch="brake"><b>▼</b><span data-i18n="touch.brake"></span></button><button class="touch-btn touch-turbo" data-touch="turbo" data-i18n-label="touch.turboLocked" aria-label="تيربو مقفل"><b>⚡</b><span data-i18n="touch.turbo"></span></button></div>
</section>
<section class="screen screen-modal" data-screen="pause"><div class="modal-card"><p class="eyebrow" data-i18n="game.title"></p><h2 data-i18n="pause.title"></h2><nav class="menu"><button data-nav class="btn btn-primary" data-action="resume"><span data-i18n="menu.resume"></span></button><button data-nav class="btn" data-action="restart"><span data-i18n="menu.restart"></span></button><button data-nav class="btn" data-action="garage"><span data-i18n="menu.garage"></span></button><button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button><button data-nav class="btn btn-quiet" data-action="quit"><span data-i18n="menu.quit"></span></button></nav></div></section>
<section class="screen screen-modal" data-screen="settings"><div class="modal-card settings-card"><header class="panel-heading"><button data-nav class="icon-btn" data-action="back" aria-label="رجوع">‹</button><h2 data-i18n="settings.title"></h2></header><fieldset><legend data-i18n="settings.audio"></legend>${range('musicVolume', 'settings.music', 0, 1, 0.05)}${range('sfxVolume', 'settings.sfxVolume', 0, 1, 0.05)}${toggle('muted', 'settings.mute')}</fieldset><fieldset><legend data-i18n="settings.controls"></legend>${range('sensitivity', 'settings.sensitivity', 0.5, 1.8, 0.1)}</fieldset><fieldset><legend data-i18n="settings.display"></legend><div class="setting-row"><span data-i18n="settings.quality"></span><div class="quality-segment"><button data-nav class="quality-choice" data-value="low" data-i18n="settings.low"></button><button data-nav class="quality-choice" data-value="medium" data-i18n="settings.medium"></button><button data-nav class="quality-choice" data-value="high" data-i18n="settings.high"></button></div></div>${toggle('reducedMotion', 'settings.reduceMotion')}</fieldset></div></section>
<section class="screen screen-modal screen-results" data-screen="results"><div class="modal-card results-panel"><div class="results-emblem">🏁</div><p class="eyebrow" data-slot="results-stage"></p><h2 class="results-title"></h2><div class="results-grid"><div><span data-i18n="results.time"></span><b data-slot="results-time"></b></div><div><span data-i18n="results.reward"></span><b data-slot="results-reward"></b></div><div><span data-i18n="results.balance"></span><b data-slot="results-coins"></b></div></div><p class="results-unranked" data-i18n="results.unranked"></p><nav class="menu"><button data-nav class="btn btn-primary" data-action="next"><span data-i18n="menu.next"></span></button><button data-nav class="btn" data-action="restart"><span data-i18n="results.retry"></span></button><button data-nav class="btn" data-action="campaign"><span data-i18n="results.map"></span></button><button data-nav class="btn btn-quiet" data-action="quit"><span data-i18n="results.home"></span></button></nav></div></section>`
  }
}

function number(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString('ar-EG')
}

function formatClock(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)])
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
