import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Quality, SaveData, SaveStore } from '../engine/save'
import { CAMPAIGN_CARS, CAMPAIGN_STAGES, MAX_UPGRADE_LEVEL, TURBO_TYPES, UPGRADE_BASE_COST, type CarId, type UpgradeKind, type RaceProgress, type TurboTypeId } from '../game/campaign'
import type { RallyHud, RallyResult } from '../game/rally-game'
import { DRIVERS, driverById, type Driver, type DriverId } from '../game/characters'
import { LIVERIES, lookFor, PAINT_COLORS, RIM_COLORS, type CarLook, type LiveryId } from '../game/customization'
import { conditionsForStage, TIME_LABEL, WEATHER_LABEL } from '../game/environment'
import salemImg from '../../assets/driver-salem.jpg'
import laylaImg from '../../assets/driver-layla.jpg'
import karimImg from '../../assets/driver-karim.jpg'

const PORTRAITS: Partial<Record<DriverId, string>> = { salem: salemImg, layla: laylaImg, karim: karimImg }
const CAMERA_LABEL: Record<string, string> = { chase: 'مطاردة', far: 'مطاردة بعيدة', hood: 'قمرة القيادة', bumper: 'المصد', tv: 'تلفزيونية', photo: 'تصوير سينمائي' }
const WEATHER_ICON: Record<string, string> = { clear: '☀', cloudy: '☁', rain: '☔', fog: '≋', snow: '❄', sandstorm: '🌪' }
const CAR_DESIGN_LABEL: Record<string, string> = {
  glb: 'رالي',
  'rally-hatch': 'هاتشباك رياضية',
  coupe: 'كوبيه منخفضة',
  '4x4': 'دفع رباعي',
  sedan: 'سيدان رالي',
  pickup: 'بيك أب',
  buggy: 'باجي صحراوي',
  'rally-truck': 'شاحنة رالي',
  suv: 'دفع رباعي مرتفع',
}

export type RallyScreen = 'boot' | 'title' | 'campaign' | 'garage' | 'hud' | 'pause' | 'settings' | 'results'
export type RallyUiActions = {
  start(stage: number): void
  resume(): void
  restart(): void
  replay(): void
  next(stage: number): void
  quit(): void
  buyCar(id: CarId): void
  selectCar(id: CarId): void
  buyTurbo(id: TurboTypeId): void
  selectTurbo(id: TurboTypeId): void
  upgrade(kind: UpgradeKind): void
  settings(patch: Partial<SaveData>): void
  setDriver(id: DriverId): void
  setLook(id: CarId, patch: Partial<CarLook>): void
  cycleCamera(): void
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
    const stage = CAMPAIGN_STAGES[progress.unlockedStage - 1]
    const c = conditionsForStage(stage.number)
    const driver = driverById(this.save.data.driver)
    const car = CAMPAIGN_CARS.find(item => item.id === progress.selectedCar) ?? CAMPAIGN_CARS[0]
    const next = this.root.querySelector<HTMLElement>('[data-slot="home-next"]')!
    next.innerHTML = `<small>المرحلة القادمة · ${number(stage.number)}</small><strong>${escapeHtml(stage.name)}</strong>
      <div class="cond-chips"><span>${escapeHtml(c.biome.label)}</span><span>${WEATHER_ICON[c.weather]} ${escapeHtml(WEATHER_LABEL[c.weather])}</span><span>${escapeHtml(TIME_LABEL[c.time])}</span></div>`
    const crew = this.root.querySelector<HTMLElement>('[data-slot="home-crew"]')!
    crew.innerHTML = `<div class="crew-person">${driverPortrait(driver)}<div><small>السائق</small><b>${escapeHtml(driver.name)}</b><em>${escapeHtml(driver.perk)}</em></div></div>
      <div class="crew-car"><small>السيارة</small><b>${escapeHtml(car.name)}</b></div>`
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
      return `<article class="car-card${selected ? ' is-selected' : ''}" style="--car-color:${lookFor(this.save.data.garage, car.id).paint ?? car.color}" aria-label="${escapeHtml(car.name)}">
        <div class="car-swatch car-swatch-${car.design}" aria-hidden="true"><span></span><i></i></div>
        <div class="car-card-copy"><div class="car-card-title"><h3>${escapeHtml(car.name)}</h3><small class="car-state ${selected ? 'is-current' : owned ? 'is-owned' : 'is-locked'}">${selected ? 'مختارة' : owned ? 'مملوكة' : 'مقفلة'}</small></div><small class="car-design">${CAR_DESIGN_LABEL[car.design] ?? 'سيارة رالي'}</small><p>${this.i18n.t('shop.speed')}: ${number(car.topSpeed)} · ${this.i18n.t('shop.acceleration')}: ${number(car.acceleration)}</p><p>${this.i18n.t('shop.grip')}: ${number(car.grip)}</p><p class="car-ability"><b>${this.i18n.t('shop.ability')}: ${this.i18n.t(`carAbility.${car.ability}.name`)}</b> — ${this.i18n.t(`carAbility.${car.ability}.desc`)}</p></div>
        <button data-nav class="btn ${selected ? 'btn-selected' : owned ? '' : 'btn-accent'}" data-action="${action}" data-car="${car.id}" aria-pressed="${selected}" aria-label="${selected ? 'السيارة المختارة' : owned ? 'اختيار ' + escapeHtml(car.name) : 'شراء ' + escapeHtml(car.name)}" ${selected || (!owned && progress.coins < car.price) ? 'disabled' : ''}>${escapeHtml(actionText)}</button>
      </article>`
    }).join('')
    this.root.querySelector('[data-slot="garage-coins"]')!.textContent = number(progress.coins)
    this.updateUpgrade('engine', progress)
    this.updateUpgrade('tires', progress)
    this.renderTurboTypes(progress)
    this.renderDrivers()
    this.renderLook(progress)
    this.show('garage')
  }

  updateHud(hud: RallyHud): void {
    this.text('[data-slot="hud-stage"]', this.i18n.t('hud.stage', { n: number(hud.stage) }))
    this.text('[data-slot="hud-lap"]', this.i18n.t('hud.lap', { lap: number(hud.lap), total: number(hud.laps) }))
    this.text('[data-slot="hud-position"]', this.i18n.t('hud.position', { place: number(hud.place), total: number(hud.racers) }))
    this.text('[data-slot="hud-speed"]', number(hud.speed))
    this.text('[data-slot="hud-gear"]', number(hud.gear))
    this.text('[data-slot="hud-rpm"]', number(hud.rpm))
    const manual = this.save.data.transmission === 'manual'
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-touch="gearUp"], [data-touch="gearDown"]')) button.hidden = !manual
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
    const engineButton = this.root.querySelector<HTMLButtonElement>('[data-action="engine-toggle"]')
    if (engineButton) {
      const enabled = this.save.data.engineSound
      engineButton.textContent = enabled ? '🔊' : '🔇'
      engineButton.setAttribute('aria-pressed', String(enabled))
      engineButton.setAttribute('aria-label', enabled ? 'إيقاف صوت المحرك' : 'تشغيل صوت المحرك')
      engineButton.title = enabled ? 'إيقاف صوت المحرك' : 'تشغيل صوت المحرك'
    }
    this.text('[data-slot="hud-conditions"]', hud.conditions)
    this.text('[data-slot="hud-camera"]', `🎥 ${CAMERA_LABEL[hud.camera] ?? ''}`)
    const list = this.root.querySelector<HTMLElement>('.standings')
    if (list) {
      const html = hud.standings.map((r, i) => `<li class="${r.player ? 'is-player' : ''}"><b>${number(i + 1)}</b>${escapeHtml(r.name)}</li>`).join('')
      if (list.dataset.html !== html) { list.innerHTML = html; list.dataset.html = html }
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
    const replay = this.root.querySelector<HTMLButtonElement>('[data-action="replay"]')
    if (replay) replay.hidden = !result.hasReplay
    this.root.querySelector('.results-unranked')?.classList.toggle('is-visible', result.unranked)
    this.show('results')
  }

  refreshSettings(): void {
    const d = this.save.data
    this.setValue('[name="sfxVolume"]', d.sfxVolume)
    this.setValue('[name="sensitivity"]', d.sensitivity)
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.toggle')) {
      const key = button.dataset.setting as 'muted' | 'reducedMotion' | 'engineSound'
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

  private renderDrivers(): void {
    const grid = this.root.querySelector<HTMLElement>('.driver-grid')
    if (!grid) return
    const current = this.save.data.driver
    grid.innerHTML = DRIVERS.map(d => `<button data-nav class="driver-card${d.id === current ? ' is-selected' : ''}" data-action="driver" data-driver="${d.id}" aria-pressed="${d.id === current}" style="--suit:${d.suit}">
      ${driverPortrait(d)}<span><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.origin)}</small><em>${escapeHtml(d.perk)}</em></span></button>`).join('')
  }

  private renderLook(progress: RaceProgress): void {
    const panel = this.root.querySelector<HTMLElement>('.look-panel')
    if (!panel) return
    const car = CAMPAIGN_CARS.find(item => item.id === progress.selectedCar) ?? CAMPAIGN_CARS[0]
    const look = lookFor(this.save.data.garage, car.id)
    const paint = look.paint ?? car.color
    panel.innerHTML = `<h3>تخصيص المظهر · ${escapeHtml(car.name)}</h3>
      <p class="shop-note">التخصيص مجاني ولا يغيّر أداء السيارة.</p>
      <div class="look-row"><label for="custom-paint">لون مخصص</label><input id="custom-paint" class="custom-color" type="color" value="${paint}" aria-label="اختيار لون الطلاء"></div><div class="look-row"><span>لون الطلاء</span><div class="swatches">${[car.color, ...PAINT_COLORS.filter(c => c !== car.color)].map(c => `<button data-nav class="swatch${c === paint ? ' is-on' : ''}" data-action="paint" data-value="${c}" style="--c:${c}" aria-label="لون ${c}"></button>`).join('')}</div></div>
      <div class="look-row"><label for="custom-rim">لون جنوط مخصص</label><input id="custom-rim" class="custom-color" type="color" value="${look.rim}" aria-label="اختيار لون الجنوط"></div><div class="look-row"><span>لون الجنوط</span><div class="swatches">${RIM_COLORS.map(c => `<button data-nav class="swatch${c === look.rim ? ' is-on' : ''}" data-action="rim" data-value="${c}" style="--c:${c}" aria-label="جنط ${c}"></button>`).join('')}</div></div>
      <div class="look-row"><span>الملصقات</span><div class="chips">${LIVERIES.map(l => `<button data-nav class="chip${l.id === look.livery ? ' is-on' : ''}" data-action="livery" data-value="${l.id}">${escapeHtml(l.label)}</button>`).join('')}</div></div>
      <div class="look-row"><span>الجناح الخلفي</span><div class="chips"><button data-nav class="chip${look.spoiler ? ' is-on' : ''}" data-action="spoiler" data-value="1">مركّب</button><button data-nav class="chip${!look.spoiler ? ' is-on' : ''}" data-action="spoiler" data-value="0">بدون</button></div></div>
      <div class="look-row"><span>رقم السيارة</span><div class="chips"><button data-nav class="chip" data-action="number" data-value="-1" aria-label="أقل">−</button><b class="car-number">${number(look.number)}</b><button data-nav class="chip" data-action="number" data-value="1" aria-label="أكثر">+</button></div></div>`
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
      const key = target.dataset.setting as 'muted' | 'reducedMotion' | 'engineSound'
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
      case 'replay': this.actions.replay(); break
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
      case 'driver': if (target.dataset.driver) { this.actions.setDriver(target.dataset.driver as DriverId); this.showGarage() } break
      case 'camera': this.actions.cycleCamera(); break
      case 'engine-toggle':
        this.actions.settings({ engineSound: !this.save.data.engineSound })
        break
      case 'paint': case 'rim': case 'livery': case 'spoiler': case 'number': {
        const id = this.save.data.raceProgress.selectedCar
        const v = target.dataset.value ?? ''
        const cur = lookFor(this.save.data.garage, id)
        const patch: Partial<CarLook> = action === 'paint' ? { paint: v } : action === 'rim' ? { rim: v } : action === 'livery' ? { livery: v as LiveryId }
          : action === 'spoiler' ? { spoiler: v === '1' } : { number: ((cur.number - 1 + Number(v) + 99) % 99) + 1 }
        this.actions.setLook(id, patch)
        this.showGarage()
        break
      }
      case 'retry-load': window.dispatchEvent(new CustomEvent('rally:retry-load')); break
    }
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement
    if (target.matches('input[type="color"]')) {
      const id = this.save.data.raceProgress.selectedCar
      this.actions.setLook(id, target.id === 'custom-paint' ? { paint: target.value } : { rim: target.value })
      const swatch = target.id === 'custom-paint' ? '.car-card.is-selected' : null
      if (swatch) this.root.querySelector<HTMLElement>(swatch)?.style.setProperty('--car-color', target.value)
      return
    }
    if (!target.matches('input[type="range"]')) return
    const value = Number(target.value)
    this.updateRange(target)
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
  <div class="title-layout">
    <div class="title-copy"><div class="title-ribbon"><i></i><span data-i18n="race.cup"></span><b>100</b></div><p class="eyebrow" data-i18n="brand.eyebrow"></p><h1 class="title-logo"><span>ZUMA</span><em>RALLY</em></h1><p class="tagline" data-i18n="game.tagline"></p><div class="campaign-summary"><span><span data-i18n="menu.stage"></span> <b data-slot="home-stage">1</b> / 100</span><span><span data-i18n="menu.wins"></span> <b data-slot="home-wins">0</b></span></div>
      <nav class="menu"><button data-nav class="btn btn-primary" data-action="race"><span data-i18n="menu.race"></span><b>↙</b></button><button data-nav class="btn" data-action="campaign"><span data-i18n="menu.campaign"></span></button><button data-nav class="btn btn-accent" data-action="garage"><span data-i18n="menu.garage"></span></button><button data-nav class="btn btn-quiet" data-action="settings"><span data-i18n="menu.settings"></span></button></nav>
    </div>
    <aside class="title-side"><div class="next-stage" data-slot="home-next"></div><div class="crew" data-slot="home-crew"></div></aside>
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
    <div class="garage-main"><h3 class="garage-sub">اختر السائق</h3><div class="driver-grid"></div><h3 class="garage-sub">السيارات</h3><div class="car-grid"></div></div>
    <aside class="upgrade-panel">
      <div class="look-panel"></div>
      <h3 data-i18n="shop.upgrades"></h3><p class="shop-note" data-i18n="shop.tip"></p>
      <button data-nav class="upgrade-card" data-action="upgrade" data-upgrade="engine"></button>
      <button data-nav class="upgrade-card" data-action="upgrade" data-upgrade="tires"></button>
      <div class="turbo-shop"><div><h3 data-i18n="shop.turboTypes"></h3><p class="shop-note" data-i18n="shop.turboHint"></p></div><div class="turbo-grid"></div></div>
      <button data-nav class="btn btn-primary garage-race" data-action="race"><span data-i18n="menu.race"></span></button>
    </aside>
  </div>
</section>
<section class="screen screen-hud" data-screen="hud">
  <div class="hud-top"><div class="hud-panel stage-panel"><span class="hud-symbol">✦</span><div><b data-slot="hud-stage">المرحلة 1</b><small data-slot="hud-lap">اللفة 1/2</small></div></div><div class="race-position"><b data-slot="hud-position">المركز 1/7</b><small data-slot="hud-time">00:00</small><small class="hud-impacts" data-slot="hud-impacts">اصطدامات ٠/٥</small></div><div class="hud-right"><div class="hud-coins"><span aria-hidden="true">Z</span><b data-slot="hud-coins">0</b></div><button class="hud-camera" data-action="camera" aria-label="تبديل الكاميرا" data-slot="hud-camera">🎥</button><button class="hud-engine" data-action="engine-toggle" aria-label="إيقاف صوت المحرك" aria-pressed="true" title="إيقاف صوت المحرك">🔊</button><button class="hud-pause" data-action="pause" data-i18n-label="touch.pause" aria-label="توقف مؤقت">Ⅱ</button></div></div>
  <div class="hud-conditions" data-slot="hud-conditions"></div>
  <ol class="standings"></ol>
  <div class="speed-gauge"><div class="gear-readout"><b data-slot="hud-gear">1</b><small>GEAR</small></div><div class="speed-readout"><strong data-slot="hud-speed">0</strong><small data-i18n="hud.speed"></small><small class="rpm-readout"><span data-slot="hud-rpm">950</span> RPM</small></div></div>
  <div class="turbo-box"><div><span data-i18n="hud.turbo"></span><b data-slot="turbo-percent">0%</b></div><small data-slot="turbo-name"></small><div class="turbo-meter"><i class="turbo-fill"></i></div></div>
  <div class="race-signal" aria-live="assertive" aria-hidden="true"></div><div class="hud-impact-reset" role="status" data-i18n="hud.impactReset"></div><div class="hud-warning" data-i18n="hud.crash"></div><div class="hud-drift" data-i18n="hud.drift"></div>
  <div class="touch"><div class="touch-stick"><i></i><span><span data-i18n="touch.steering"></span><br><span data-i18n="touch.acceleration"></span></span></div><button class="touch-btn touch-gas" data-touch="throttle"><b>▲</b><span data-i18n="touch.gas"></span></button><button class="touch-btn touch-brake" data-touch="brake"><b>▼</b><span data-i18n="touch.brake"></span></button><button class="touch-btn touch-shift-up" data-touch="gearUp" hidden aria-label="رفع الغيار"><b>＋</b><span>غيار أعلى</span></button><button class="touch-btn touch-shift-down" data-touch="gearDown" hidden aria-label="خفض الغيار"><b>－</b><span>غيار أقل</span></button><button class="touch-btn touch-turbo" data-touch="turbo" data-i18n-label="touch.turboLocked" aria-label="تيربو مقفل"><b>⚡</b><span data-i18n="touch.turbo"></span></button></div>
</section>
<section class="screen screen-modal" data-screen="pause"><div class="modal-card"><p class="eyebrow" data-i18n="game.title"></p><h2 data-i18n="pause.title"></h2><nav class="menu"><button data-nav class="btn btn-primary" data-action="resume"><span data-i18n="menu.resume"></span></button><button data-nav class="btn" data-action="restart"><span data-i18n="menu.restart"></span></button><button data-nav class="btn" data-action="garage"><span data-i18n="menu.garage"></span></button><button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button><button data-nav class="btn btn-quiet" data-action="quit"><span data-i18n="menu.quit"></span></button></nav></div></section>
<section class="screen screen-modal" data-screen="settings"><div class="modal-card settings-card"><header class="panel-heading"><button data-nav class="icon-btn" data-action="back" aria-label="رجوع">‹</button><h2 data-i18n="settings.title"></h2></header><fieldset><legend data-i18n="settings.audio"></legend>${range('sfxVolume', 'settings.sfxVolume', 0, 1, 0.05)}${toggle('muted', 'settings.mute')}</fieldset><fieldset><legend data-i18n="settings.controls"></legend>${range('sensitivity', 'settings.sensitivity', 0.5, 1.8, 0.1)}<p class="shop-note">ناقل الحركة يدوي دائماً؛ غيّر الغيار بنفسك أثناء السباق.</p></fieldset><fieldset><legend data-i18n="settings.display"></legend><div class="setting-row"><span data-i18n="settings.quality"></span><div class="quality-segment"><button data-nav class="quality-choice" data-value="low" data-i18n="settings.low"></button><button data-nav class="quality-choice" data-value="medium" data-i18n="settings.medium"></button><button data-nav class="quality-choice" data-value="high" data-i18n="settings.high"></button></div></div>${toggle('reducedMotion', 'settings.reduceMotion')}</fieldset><fieldset><legend>الصوت</legend><div class="setting-row"><span>صوت المحرك</span><button data-nav class="toggle" data-setting="engineSound" aria-pressed="true"></button></div></fieldset></div></section>
<section class="screen screen-modal screen-results" data-screen="results"><div class="modal-card results-panel"><div class="results-emblem">🏁</div><p class="eyebrow" data-slot="results-stage"></p><h2 class="results-title"></h2><div class="results-grid"><div><span data-i18n="results.time"></span><b data-slot="results-time"></b></div><div><span data-i18n="results.reward"></span><b data-slot="results-reward"></b></div><div><span data-i18n="results.balance"></span><b data-slot="results-coins"></b></div></div><p class="results-unranked" data-i18n="results.unranked"></p><nav class="menu"><button data-nav class="btn btn-primary" data-action="next"><span data-i18n="menu.next"></span></button><button data-nav class="btn" data-action="replay" hidden>إعادة العرض</button><button data-nav class="btn" data-action="restart"><span data-i18n="results.retry"></span></button><button data-nav class="btn" data-action="campaign"><span data-i18n="results.map"></span></button><button data-nav class="btn btn-quiet" data-action="quit"><span data-i18n="results.home"></span></button></nav></div></section>`
  }
}

function driverPortrait(driver: Driver): string {
  const portrait = PORTRAITS[driver.id]
  if (portrait) return `<img src="${portrait}" alt="" width="72" height="72" loading="lazy">`
  const initials = driver.name.split(' ').slice(0, 2).map(part => part[0] ?? '').join('')
  return `<div class="driver-avatar" aria-hidden="true" style="--suit:${driver.suit};width:72px;height:72px;min-width:72px;border-radius:50%;display:grid;place-items:center;background:var(--suit);color:white;font-size:24px;font-weight:900">${escapeHtml(initials)}</div>`
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
