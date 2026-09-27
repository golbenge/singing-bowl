/**
 * 소리 ID -> AudioBuffer 로딩(디코딩) 및 메모리 캐시.
 *  - 'bundled:*' 는 앱에 포함된 샘플 음원 파일(public/sounds/*)
 *  - 그 외 ID 는 IndexedDB에 저장된 사용자 음향 파일(Blob)
 */
import { SOUNDS, getOne } from './db.js'
import { bundledSound, bundledSoundUrl, isBundledSoundId } from './bundled-sounds.js'

const bufferCache = new Map()
const pending = new Map()

function decodeAudioData(context, arrayBuffer) {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (buffer) => {
      if (!settled) {
        settled = true
        resolve(buffer)
      }
    }
    const fail = (error) => {
      if (!settled) {
        settled = true
        reject(error ?? new Error('소리 파일을 해석할 수 없습니다.'))
      }
    }
    try {
      const maybePromise = context.decodeAudioData(arrayBuffer, done, fail)
      if (maybePromise?.then) maybePromise.then(done, fail)
    } catch (error) {
      fail(error)
    }
  })
}

async function loadFromStorage(context, soundId) {
  const record = await getOne(SOUNDS, soundId)
  if (!record) {
    throw new Error('소리 파일을 찾을 수 없습니다. 소리 보관함에서 다시 추가해 주세요.')
  }
  if (!record.blob) {
    throw new Error(`"${record.name}" 파일이 손상되었습니다. 다시 추가해 주세요.`)
  }
  const arrayBuffer = await record.blob.arrayBuffer()
  return decodeAudioData(context, arrayBuffer)
}

/** 앱에 포함된 샘플 음원(오프라인 캐시 대상)을 읽어서 디코딩한다. */
async function loadBundled(context, soundId) {
  const sound = bundledSound(soundId)
  if (!sound) throw new Error(`알 수 없는 샘플 소리입니다: ${soundId}`)

  const response = await fetch(bundledSoundUrl(sound))
  if (!response.ok) {
    throw new Error(
      `샘플 소리를 불러오지 못했습니다(${response.status}). 네트워크가 연결된 상태로 한 번 실행해 주세요.`,
    )
  }
  const arrayBuffer = await response.arrayBuffer()
  return decodeAudioData(context, arrayBuffer)
}

/** 소리를 재생 가능한 AudioBuffer 로 가져온다(캐시 사용). */
export async function loadBuffer(context, soundId) {
  if (!soundId) throw new Error('재생할 소리가 지정되지 않았습니다.')
  if (bufferCache.has(soundId)) return bufferCache.get(soundId)
  if (pending.has(soundId)) return pending.get(soundId)

  const task = (async () => {
    const buffer = isBundledSoundId(soundId)
      ? await loadBundled(context, soundId)
      : await loadFromStorage(context, soundId)
    bufferCache.set(soundId, buffer)
    return buffer
  })()

  pending.set(soundId, task)
  try {
    return await task
  } finally {
    pending.delete(soundId)
  }
}

export function getCachedBuffer(soundId) {
  return bufferCache.get(soundId) ?? null
}

/**
 * 파일을 저장하기 전에 실제로 디코딩되는지 확인하고 길이 정보를 얻는다.
 * (Safari가 지원하지 않는 형식이면 여기서 바로 걸러진다.)
 */
export async function probeAudio(context, arrayBuffer) {
  const buffer = await decodeAudioData(context, arrayBuffer)
  return {
    durationMs: Math.round(buffer.duration * 1000),
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
  }
}

export function evictBuffer(soundId) {
  bufferCache.delete(soundId)
}

export function clearBufferCache() {
  bufferCache.clear()
}
