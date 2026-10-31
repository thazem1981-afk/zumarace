import './styles/rally.css'
import './styles/branding.css'
import './styles/race-intro.css'
import type { Object3D } from 'three'
import { Assets } from './engine/assets'
import './styles/landscape.css'
import { Audio } from './engine/audio'
import { I18n } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import { buyCar, buyTurbo, buyUpgrade, selectCar, selectTurbo, type CarId, type TurboTypeId, type UpgradeKind } from './game/campaign'
import { RallyGame, type RallyMode } from './game/rally-game'
import { TouchControls } from './ui/touch'
import { RallyUi } from './ui/rally-ui'

const CAR_MODEL_URLS: Partial<Record<CarId, string>> = {
  'dune-runner': new URL('../assets/models/saqr-rally.glb', import.meta.url).href,
  'zuma-rs': new URL('../assets/models/zuma-rs.glb', import.meta.url).href,
  'dune-pickup': new URL('../assets/models/dune-pickup.glb', import.meta.url).href,
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()
  const i18n = new I18n('ar')
  const input = new Input(canvas)
  const audio = new Audio()
  const assets = new Assets()
  let game: RallyGame | undefined
  let loop: GameLoop | undefined

  const applySettings = (data: SaveData) => {
    input.sensitivity = data.sensitivity
    input.invertY = data.invertY
    audio.setVolumes(data.musicVolume, data.sfxVolume, data.muted)
    if (game) game.reducedMotion = data.reducedMotion
  }
  let gameRenderer: import('./engine/renderer').Renderer | undefined

  const ui = new RallyUi(i18n, save, audio, input, {
    start: stage => {
      if (!game) return
      audio.unlock()
      game.start(stage)
      if (game.mode === 'playing' || game.mode === 'countdown') {
        ui.show('hud')
        loop?.resetAccumulator()
      }
    },
    resume: () => {
      if (game?.mode !== 'paused') return
      game.resume()
      if ((game.mode as RallyMode) === 'playing') audio.startMusic()
      ui.show('hud')
      loop?.resetAccumulator()
    },
    restart: () => {
      if (!game) return
      game.start(game.stageNumber)
      if (game.mode === 'playing' || game.mode === 'countdown') ui.show('hud')
    },
    next: stage => {
      if (!game) return
      game.start(stage)
      if (game.mode === 'playing' || game.mode === 'countdown') ui.show('hud')
    },
    quit: () => {
      game?.toTitle()
      audio.stopMusic()
      ui.showTitle()
    },
    buyCar: (id: CarId) => {
      const result = buyCar(save.data.raceProgress, id)
      if (result.ok) {
        save.update({ raceProgress: result.progress })
        game?.setProgress(result.progress)
      }
    },
    selectCar: (id: CarId) => {
      const result = selectCar(save.data.raceProgress, id)
      if (result.ok) {
        save.update({ raceProgress: result.progress })
        game?.setProgress(result.progress)
      }
    },
    buyTurbo: (id: TurboTypeId) => {
      const result = buyTurbo(save.data.raceProgress, id)
      if (result.ok) {
        save.update({ raceProgress: result.progress })
        game?.setProgress(result.progress)
      }
    },
    selectTurbo: (id: TurboTypeId) => {
      const result = selectTurbo(save.data.raceProgress, id)
      if (result.ok) {
        save.update({ raceProgress: result.progress })
        game?.setProgress(result.progress)
      }
    },
    upgrade: (kind: UpgradeKind) => {
      const result = buyUpgrade(save.data.raceProgress, kind)
      if (result.ok) {
        save.update({ raceProgress: result.progress })
        game?.setProgress(result.progress)
      }
    },
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (qualityChanged && gameRenderer) game?.setQuality(save.data.quality)
    },
  })
  ui.show('boot')
  applySettings(save.data)

  const updatePause = () => {
    if (game?.mode !== 'playing' && game?.mode !== 'countdown') return
    game.pause()
    ui.show('pause')
    audio.stopMusic()
  }

  try {
    ui.setBootProgress(0.12)
    const stopProgress = assets.onProgress(progress => ui.setBootProgress(0.2 + progress * 0.68))
    const modelEntries = Object.entries(CAR_MODEL_URLS) as [CarId, string][]
    const [{ Renderer, suggestQuality }, modelScenes] = await Promise.all([
      import('./engine/renderer'),
      Promise.all(modelEntries.map(async ([id, url]) => [id, (await assets.gltf(url)).scene] as const)),
      document.fonts.ready,
    ]).then(([rendererResult, models]) => [rendererResult, models] as const)
    stopProgress()
    ui.setBootProgress(0.86)
    if (firstRun) save.update({ quality: suggestQuality() })
    gameRenderer = new Renderer(canvas, save.data.quality)
    ui.refreshSettings()
    const models = Object.fromEntries(modelScenes) as Partial<Record<CarId, Object3D>>
    game = new RallyGame(gameRenderer, input, audio, models, save.data.raceProgress, {
      result: result => {
        window.setTimeout(() => ui.showResults(result), 500)
      },
      progress: progress => save.update({ raceProgress: progress }),
      pause: updatePause,
    })
    game.reducedMotion = save.data.reducedMotion

    if (import.meta.env.DEV) {
      try {
        const [{ registerGameTuning }, { tuning }] = await Promise.all([
          import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
        ])
        await registerGameTuning(tuning)
      } catch (error) {
        console.warn('Preview tuning is unavailable; gameplay remains usable.', error)
      }
    }

    const g = game
    loop = new GameLoop({
      beforeFrame: frameSeconds => input.update(frameSeconds),
      step: dt => {
        if (input.consume('pause')) {
          if (g.mode === 'playing' || g.mode === 'countdown') updatePause()
          else if (g.mode === 'paused' && ui.screen === 'pause') {
            g.resume()
            if ((g.mode as RallyMode) === 'playing') audio.startMusic()
            ui.show('hud')
          } else ui.back()
          return
        }
        g.step(dt)
      },
      render: (alpha, frameSeconds) => {
        ui.frame(frameSeconds)
        loop!.paused = g.mode === 'paused'
        g.render(alpha, frameSeconds)
        if (g.mode === 'countdown' || g.mode === 'playing' || g.mode === 'ended') ui.updateHud(g.hud())
      },
    })
    loop.start()
    new TouchControls(document.getElementById('ui')!, input, () => g.mode === 'playing')

    window.addEventListener('rally:pause', updatePause)
    window.addEventListener('rally:retry-load', () => location.reload())
    document.addEventListener('visibilitychange', () => { if (document.hidden) updatePause() })
    window.addEventListener('resize', () => g.resize(window.innerWidth, window.innerHeight))
    g.resize(window.innerWidth, window.innerHeight)
    input.endFrame()
    ui.setBootProgress(1)
    window.setTimeout(() => ui.showTitle(), 160)
    ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save }
  } catch (error) {
    console.error('Rally boot failed', error)
    ui.showBootError()
  }
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

boot().catch(error => {
  console.error(error)
  const root = document.getElementById('ui')
  if (root) root.innerHTML = '<div class="fatal">تعذّر تشغيل اللعبة. أعد تحميل الصفحة للمحاولة مرة أخرى.</div>'
})
