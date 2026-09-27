/**
 * 타이머 엔진.
 *
 * 핵심 아이디어
 *  1. 시작할 때 모든 소리를 미리 디코딩해 두고, Web Audio 의 샘플 단위 예약 재생
 *     (source.start(when)) 으로 각 시간대의 소리를 예약한다. → 잠금 화면/백그라운드에서도
 *     JS 타이머가 멈춘 것과 무관하게 정확한 시각에 소리가 난다.
 *  2. 화면이 켜져 있을 때는 250ms 주기 ticker 로 남은 시간/진행 상황을 갱신하고,
 *     혹시 예약이 누락된 소리가 있으면 안전망으로 즉시 재생한다.
 *  3. 일시 중지 = 예약 취소 + AudioContext suspend. 재개 = 남은 시간만 다시 예약.
 *  4. 실행 상태는 localStorage 에 저장해 두어, iOS가 PWA를 종료시켜도 이어서 실행할 수 있다.
 */
import {
  clearMediaSession,
  getAudioContext,
  getMasterGain,
  resumeAudioContext,
  setMasterVolume,
  setMediaSessionHandlers,
  setMediaSessionPlaybackState,
  startKeepAlive,
  stopKeepAlive,
  suspendAudioContext,
  unlockAudio,
  updateMediaSession,
} from './audio-session.js'
import { loadBuffer } from './sound-loader.js'
import { DEFAULT_SOUND_ID, normalizeSoundId } from './bundled-sounds.js'

const STORAGE_KEY = 'singing-bowl:active-run'
const TAIL_MS = 15000 // 마지막 소리 후 이만큼 지나면 자동 종료
const LATE_LIMIT_MS = 5000 // 이보다 늦게 깨어난 소리는 건너뛴다

export { DEFAULT_SOUND_ID }

export class TimerEngine {
  status = $state('idle') // idle | preparing | running | paused | finished
  projectId = $state(null)
  projectName = $state('')
  cues = $state([])
  elapsedMs = $state(0)
  durationMs = $state(0)
  volume = $state(0.9)
  error = $state(null)
  progressMessage = $state('')
  wakeLockActive = $state(false)

  #buffers = new Map()
  #sources = []
  #wallClockStart = 0
  #pausedElapsed = 0
  #ticker = null
  #wakeLock = null
  #lastPersistedAt = 0
  #preparing = false

  get isActive() {
    return this.status === 'running' || this.status === 'paused' || this.status === 'preparing'
  }

  get isRunning() {
    return this.status === 'running'
  }

  get nextCue() {
    return (
      this.cues.find((cue) => cue.atSeconds * 1000 > this.elapsedMs && cue.state !== 'skipped') ??
      null
    )
  }

  get progress() {
    if (!this.durationMs) return 0
    return Math.min(1, Math.max(0, this.elapsedMs / this.durationMs))
  }

  get completedCount() {
    return this.cues.filter((cue) => cue.state === 'done').length
  }

  get skippedCount() {
    return this.cues.filter((cue) => cue.state === 'missed' || cue.state === 'skipped').length
  }

  /** 남은 시간(ms). nextCue 가 없으면 0 */
  get remainingToNextMs() {
    const next = this.nextCue
    if (!next) return 0
    return Math.max(0, next.atSeconds * 1000 - this.elapsedMs)
  }

  /** 끝나는 예상 시각 */
  get estimatedEndAt() {
    if (this.status !== 'running') return null
    return Date.now() + Math.max(0, this.durationMs - this.elapsedMs)
  }

  #computeElapsed() {
    if (this.status === 'running') return Date.now() - this.#wallClockStart
    return this.#pausedElapsed
  }

  #resetRuntime() {
    this.#clearSources()
    this.#stopTicker()
    this.#releaseWakeLock()
    stopKeepAlive()
    clearMediaSession()
  }

  /** 프로젝트를 실행 준비 상태로 만든다(사용자 제스처 안에서 호출). */
  async prepare(project) {
    this.#resetRuntime()
    this.error = null
    this.status = 'idle'
    this.elapsedMs = 0
    this.#pausedElapsed = 0
    this.cues = []
    this.projectId = null

    if (!project) {
      this.error = '타이머를 찾을 수 없습니다.'
      return false
    }

    const defaultSoundId = normalizeSoundId(project.defaultSoundId) ?? DEFAULT_SOUND_ID
    const cues = [...(project.cues ?? [])]
      .sort((a, b) => a.atSeconds - b.atSeconds)
      .map((cue) => ({
        id: cue.id,
        atSeconds: cue.atSeconds,
        soundId: normalizeSoundId(cue.soundId) ?? defaultSoundId,
        label: cue.label ?? '',
        usesDefault: !normalizeSoundId(cue.soundId),
        state: 'pending',
      }))

    if (!cues.length) {
      this.error = '재생할 시간이 없습니다. 타이머에 시간을 먼저 추가해 주세요.'
      return false
    }
    if (cues.some((cue) => !cue.soundId)) {
      this.error = '재생할 소리가 지정되지 않은 시간이 있습니다.'
      return false
    }

    this.projectId = project.id
    this.projectName = project.name
    this.volume = project.volume ?? 0.9
    this.cues = cues
    this.durationMs = cues[cues.length - 1].atSeconds * 1000 + TAIL_MS
    this.status = 'preparing'
    this.#preparing = true

    try {
      await unlockAudio()
      await this.#ensureBuffers()
      setMasterVolume(this.volume)
    } catch (error) {
      this.status = 'idle'
      this.error = error?.message ?? String(error)
      return false
    } finally {
      this.#preparing = false
    }
    return true
  }

  async #ensureBuffers() {
    const context = getAudioContext()
    const ids = [...new Set(this.cues.map((cue) => cue.soundId))]
    const missing = ids.filter((id) => !this.#buffers.has(id))
    for (let index = 0; index < missing.length; index += 1) {
      this.progressMessage = `소리 준비 중… ${index + 1}/${missing.length}`
      this.#buffers.set(missing[index], await loadBuffer(context, missing[index]))
    }
    this.progressMessage = ''
  }

  /** 타이머 시작 (prepare() 를 마친 뒤 호출한다) */
  async start() {
    if (this.#preparing) return false
    if (!this.cues.length) {
      this.error = '재생할 시간이 없습니다.'
      return false
    }
    this.error = null
    try {
      await unlockAudio()
      await this.#ensureBuffers()
    } catch (error) {
      this.error = error?.message ?? String(error)
      return false
    }

    setMasterVolume(this.volume)
    await startKeepAlive()

    this.#pausedElapsed = 0
    this.#wallClockStart = Date.now()
    this.elapsedMs = 0
    this.cues = this.cues.map((cue) => ({ ...cue, state: 'pending' }))
    this.status = 'running'

    this.#scheduleRemaining()
    this.#startTicker()
    this.#bindMediaSession()
    this.#requestWakeLock()
    this.#persist()
    return true
  }

  /** 일시 중지 */
  pause() {
    if (this.status !== 'running') return
    this.#pausedElapsed = this.elapsedMs
    this.#clearSources()
    this.#stopTicker()
    this.#releaseWakeLock()
    stopKeepAlive()
    suspendAudioContext()
    this.status = 'paused'
    setMediaSessionPlaybackState('paused')
    this.#persist()
  }

  /** 재개 */
  async resume() {
    if (this.status !== 'paused') return false
    try {
      await unlockAudio()
      await resumeAudioContext()
      await this.#ensureBuffers()
    } catch (error) {
      this.error = error?.message ?? String(error)
      return false
    }

    setMasterVolume(this.volume)
    await startKeepAlive()

    this.#wallClockStart = Date.now() - this.#pausedElapsed
    this.elapsedMs = this.#pausedElapsed
    this.status = 'running'

    this.#scheduleRemaining()
    this.#startTicker()
    this.#bindMediaSession()
    this.#requestWakeLock()
    this.#persist()
    return true
  }

  /** 종료 (reason: 'manual' | 'finished') */
  stop(reason = 'manual') {
    this.#clearSources()
    this.#stopTicker()
    this.#releaseWakeLock()
    stopKeepAlive()
    suspendAudioContext()
    clearMediaSession()
    this.#clearPersisted()
    this.error = null

    if (reason === 'finished') {
      this.elapsedMs = this.durationMs
      this.cues = this.cues.map((cue) =>
        cue.state === 'pending' || cue.state === 'scheduled' ? { ...cue, state: 'done' } : cue,
      )
      this.status = 'finished'
    } else {
      this.elapsedMs = 0
      this.#pausedElapsed = 0
      this.cues = this.cues.map((cue) => ({ ...cue, state: 'pending' }))
      this.status = 'idle'
    }
  }

  /** 목록으로 돌아가기 등 화면을 떠날 때 실행을 정리한다. */
  reset() {
    this.#resetRuntime()
    this.#clearPersisted()
    this.status = 'idle'
    this.projectId = null
    this.projectName = ''
    this.cues = []
    this.elapsedMs = 0
    this.durationMs = 0
    this.#pausedElapsed = 0
    this.error = null
    this.progressMessage = ''
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume))
    setMasterVolume(this.volume)
    if (this.isActive) this.#persist()
  }

  /* ------------------------------ 내부 동작 ------------------------------ */

  /** 화면이 다시 켜졌을 때 호출: 진행 상황을 즉시 맞추고 wake lock 을 재획득한다. */
  refresh() {
    if (this.status !== 'running') return
    this.#tick()
    this.#requestWakeLock()
  }

  #scheduleRemaining() {
    const context = getAudioContext()
    const elapsedMs = this.#computeElapsed()
    setMasterVolume(this.volume)

    for (const cue of this.cues) {
      if (cue.state !== 'pending') continue
      const buffer = this.#buffers.get(cue.soundId)
      const delayMs = cue.atSeconds * 1000 - elapsedMs
      if (!buffer || delayMs < -200) {
        cue.state = 'missed'
        continue
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(getMasterGain())
      source.start(context.currentTime + Math.max(0, delayMs) / 1000)
      source.onended = () => this.#forgetSource(source)
      this.#sources.push(source)
      cue.state = 'scheduled'
    }
  }

  #forgetSource(source) {
    this.#sources = this.#sources.filter((item) => item !== source)
  }

  #clearSources() {
    for (const source of this.#sources) {
      try {
        source.onended = null
        source.stop()
        source.disconnect()
      } catch {
        /* 이미 종료된 소스는 무시 */
      }
    }
    this.#sources = []
    this.cues = this.cues.map((cue) => (cue.state === 'scheduled' ? { ...cue, state: 'pending' } : cue))
  }

  #playNow(cue) {
    const buffer = this.#buffers.get(cue.soundId)
    if (!buffer) {
      cue.state = 'missed'
      return
    }
    const context = getAudioContext()
    if (context.state !== 'running') context.resume().catch(() => {})
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(getMasterGain())
    source.start()
    source.onended = () => this.#forgetSource(source)
    this.#sources.push(source)
    cue.state = 'done'
  }

  #startTicker() {
    if (this.#ticker) return
    this.#ticker = setInterval(() => this.#tick(), 250)
  }

  #stopTicker() {
    if (!this.#ticker) return
    clearInterval(this.#ticker)
    this.#ticker = null
  }

  #tick() {
    if (this.status !== 'running') return
    const elapsedMs = Date.now() - this.#wallClockStart
    this.elapsedMs = elapsedMs

    for (const cue of this.cues) {
      if (cue.state === 'scheduled' && elapsedMs >= cue.atSeconds * 1000) cue.state = 'done'
    }

    // 예약이 누락된 소리에 대한 안전망 (백그라운드에서 앱이 멈췄다 돌아온 경우 등)
    for (const cue of this.cues) {
      if (cue.state !== 'pending') continue
      const target = cue.atSeconds * 1000
      if (elapsedMs < target) continue
      if (elapsedMs - target <= LATE_LIMIT_MS) this.#playNow(cue)
      else cue.state = 'missed'
    }

    if (elapsedMs >= this.durationMs) {
      this.stop('finished')
      return
    }
    if (Date.now() - this.#lastPersistedAt > 5000) this.#persist()
  }

  #bindMediaSession() {
    updateMediaSession({
      title: this.projectName || '명상 타이머',
      artist: `소리 ${this.cues.length}개 · 명상 타이머`,
    })
    setMediaSessionPlaybackState('playing')
    setMediaSessionHandlers({
      onPlay: () => this.resume(),
      onPause: () => this.pause(),
      onStop: () => this.stop('manual'),
    })
  }

  async #requestWakeLock() {
    if (!('wakeLock' in navigator) || this.#wakeLock || this.status !== 'running') return
    try {
      const sentinel = await navigator.wakeLock.request('screen')
      this.#wakeLock = sentinel
      this.wakeLockActive = true
      sentinel.addEventListener('release', () => {
        this.#wakeLock = null
        this.wakeLockActive = false
      })
    } catch {
      this.wakeLockActive = false
    }
  }

  #releaseWakeLock() {
    const sentinel = this.#wakeLock
    this.#wakeLock = null
    this.wakeLockActive = false
    try {
      sentinel?.release()
    } catch {
      /* noop */
    }
  }

  #persist() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          projectId: this.projectId,
          projectName: this.projectName,
          volume: this.volume,
          cues: this.cues.map((cue) => ({ ...cue })),
          elapsedMs: this.elapsedMs,
          durationMs: this.durationMs,
          paused: this.status !== 'running',
          savedAt: Date.now(),
        }),
      )
      this.#lastPersistedAt = Date.now()
    } catch {
      /* 저장 실패(사파리 프라이빗 모드 등)는 무시 */
    }
  }

  #clearPersisted() {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* noop */
    }
  }

  /* ------------------------ 중단되었던 실행 이어하기 ------------------------ */

  /**
   * 앱이 강제 종료되기 전의 실행 상태를 복구한다(일시 중지 상태로 올려 둔다).
   * 사용자가 '이어서 재생'을 누르면 남은 시간대부터 다시 예약된다.
   */
  restore(saved) {
    if (!saved?.projectId || !Array.isArray(saved.cues) || !saved.cues.length) return false

    this.#resetRuntime()
    const durationMs = saved.durationMs ?? saved.cues[saved.cues.length - 1].atSeconds * 1000 + TAIL_MS
    let elapsedMs = saved.elapsedMs ?? 0
    if (!saved.paused && saved.savedAt) elapsedMs += Math.max(0, Date.now() - saved.savedAt)
    elapsedMs = Math.min(elapsedMs, durationMs)
    if (elapsedMs >= durationMs) return false

    this.projectId = saved.projectId
    this.projectName = saved.projectName ?? ''
    this.volume = saved.volume ?? 0.9
    this.durationMs = durationMs
    this.elapsedMs = elapsedMs
    this.#pausedElapsed = elapsedMs
    this.cues = saved.cues.map((cue) => ({
      id: cue.id,
      atSeconds: cue.atSeconds,
      soundId: normalizeSoundId(cue.soundId) ?? DEFAULT_SOUND_ID,
      label: cue.label ?? '',
      usesDefault: !!cue.usesDefault,
      state: cue.atSeconds * 1000 <= elapsedMs ? 'skipped' : 'pending',
    }))
    this.status = 'paused'
    return true
  }
}

export const timer = new TimerEngine()

/** 강제 종료 전에 저장해 둔 실행 상태를 읽는다(이미 끝난 실행은 null). */
export function readPersistedRun() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved?.projectId || !Array.isArray(saved.cues) || !saved.cues.length) return null

    const durationMs = saved.durationMs ?? 0
    let elapsedMs = saved.elapsedMs ?? 0
    if (!saved.paused && saved.savedAt) elapsedMs += Math.max(0, Date.now() - saved.savedAt)
    if (durationMs && elapsedMs >= durationMs) return null
    return saved
  } catch {
    return null
  }
}

export function discardPersistedRun() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) timer.refresh()
  })
}



