/**
 * 오디오 세션 관리.
 *
 * iPhone에서 화면이 잠기거나 앱이 백그라운드로 가도 소리가 나야 하므로,
 *  - WebAudio: 정확한 시각에 소리를 예약 재생하기 위해
 *  - <audio> 요소: iOS 오디오 세션을 계속 살려두기 위해(무음 루프)
 * 두 가지를 함께 사용한다. 추가로 잠금 화면 컨트롤(Media Session)을 연결한다.
 */
import { loadBuffer } from './sound-loader.js'

let audioContext = null
let masterGain = null
let keepAlive = null

export function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext
    if (!AudioContextClass) throw new Error('이 브라우저는 Web Audio API를 지원하지 않습니다.')
    audioContext = new AudioContextClass({ latencyHint: 'interactive' })
    masterGain = audioContext.createGain()
    masterGain.gain.value = 1
    masterGain.connect(audioContext.destination)
  }
  return audioContext
}

export function getMasterGain() {
  getAudioContext()
  return masterGain
}

export function setMasterVolume(volume) {
  const gain = getMasterGain()
  gain.gain.value = Math.min(1, Math.max(0, volume))
}

/**
 * iOS는 완전한 무음 신호를 재생 중단으로 취급할 수 있어서
 * 들리지 않을 만큼(약 -84dBFS) 아주 작은 잡음을 담은 1초 WAV를 만든다.
 */
function createSilentLoopUrl() {
  const sampleRate = 8000
  const frames = sampleRate
  const dataSize = frames * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)

  let state = 20260927
  for (let i = 0; i < frames; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const sample = (state & 1 ? 1 : -1) * (1 + ((state >>> 8) & 1))
    view.setInt16(44 + i * 2, sample, true)
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

export function getKeepAliveElement() {
  if (!keepAlive) {
    keepAlive = document.createElement('audio')
    keepAlive.setAttribute('playsinline', 'true')
    keepAlive.setAttribute('webkit-playsinline', 'true')
    keepAlive.setAttribute('aria-hidden', 'true')
    keepAlive.loop = true
    keepAlive.preload = 'auto'
    keepAlive.volume = 1
    keepAlive.src = createSilentLoopUrl()
    Object.assign(keepAlive.style, {
      position: 'fixed',
      left: '-9999px',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.appendChild(keepAlive)
  }
  return keepAlive
}

/** 사용자 제스처(버튼 탭) 안에서 호출해야 한다. */
export async function unlockAudio() {
  const context = getAudioContext()
  if (context.state !== 'running') {
    try {
      await context.resume()
    } catch {
      /* resume 실패는 실제 재생 시점에 다시 확인한다 */
    }
  }
  return context.state
}

/**
 * 버튼 탭 직후 가장 먼저 호출한다.
 * 여기서 오디오 컨텍스트를 깨우고 무음 루프를 재생해 두면, 이후 소리 파일을
 * 디코딩하는 동안에도 iOS 오디오 세션이 살아 있어 잠금 화면에서도 재생된다.
 */
export async function primeAudio() {
  const state = await unlockAudio()
  await startKeepAlive()
  return state
}

export async function startKeepAlive() {
  const element = getKeepAliveElement()
  try {
    if (element.paused) await element.play()
  } catch {
    /* 자동 재생이 막힌 경우엔 조용히 무시 (사용자가 다시 탭하면 재시도) */
  }
}

export function stopKeepAlive() {
  if (!keepAlive) return
  keepAlive.pause()
  try {
    keepAlive.currentTime = 0
  } catch {
    /* noop */
  }
}

export async function suspendAudioContext() {
  if (!audioContext || audioContext.state !== 'running') return
  try {
    await audioContext.suspend()
  } catch {
    /* noop */
  }
}

export async function resumeAudioContext() {
  if (!audioContext) return
  try {
    if (audioContext.state !== 'running') await audioContext.resume()
  } catch {
    /* noop */
  }
}

/* ------------------------------- Media Session ------------------------------ */

const base = import.meta.env.BASE_URL ?? '/'

export function updateMediaSession({ title, artist, album }) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || '명상 타이머',
      artist: artist || 'Singing Bowl',
      album: album || '명상 타이머',
      artwork: [
        { src: `${base}icons/pwa-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${base}icons/pwa-512.png`, sizes: '512x512', type: 'image/png' },
      ],
    })
  } catch {
    /* noop */
  }
}

export function setMediaSessionPlaybackState(state) {
  if (!('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.playbackState = state
  } catch {
    /* noop */
  }
}

export function setMediaSessionHandlers({ onPlay, onPause, onStop } = {}) {
  if (!('mediaSession' in navigator)) return
  const session = navigator.mediaSession
  const safe = (action, handler) => {
    try {
      session.setActionHandler(action, handler)
    } catch {
      /* 지원하지 않는 액션은 무시 */
    }
  }
  safe('play', onPlay ?? null)
  safe('pause', onPause ?? null)
  safe('stop', onStop ?? null)
}

export function clearMediaSession() {
  if (!('mediaSession' in navigator)) return
  setMediaSessionHandlers({})
  try {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  } catch {
    /* noop */
  }
}

/* --------------------------------- 미리 듣기 -------------------------------- */

/** 소리 목록에서 한 번 미리 들어보기(타이머 볼륨과 무관). */
export async function previewSound(soundId, volume = 0.85) {
  await unlockAudio()
  const context = getAudioContext()
  const buffer = await loadBuffer(context, soundId)
  const gain = context.createGain()
  gain.gain.value = Math.min(1, Math.max(0, volume))
  gain.connect(context.destination)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(gain)
  source.start()
  source.onended = () => {
    try {
      source.disconnect()
      gain.disconnect()
    } catch {
      /* noop */
    }
  }
  return source
}


export function audioContextState() {
  return audioContext?.state ?? 'closed'
}
