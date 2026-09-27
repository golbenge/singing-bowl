/**
 * 내장 소리(싱잉볼/종/징/방울/목탁/알림음)를 코드로 합성한다.
 * 별도의 음원 파일이 없어도 오프라인에서 바로 동작하도록 하기 위함이며,
 * 파일을 하나도 추가하지 않은 사용자도 타이머를 쓸 수 있다.
 */

const BUILTIN_PREFIX = 'builtin:'

/**
 * partials: 배음(비화성 배음 포함) 목록
 *   ratio  : 기본 주파수 대비 배율
 *   gain   : 세기
 *   decay  : 지수 감쇠 시상수(초)
 *   drift  : 주파수 흔들림(Hz) - 맥놀이/맥동감
 * noise    : 어택 순간의 잡음 성분
 */
const RECIPES = {
  bowl: {
    name: '싱잉볼',
    description: '긴 잔향과 맥놀이가 있는 금속 공명',
    duration: 9,
    base: 214,
    attack: 0.008,
    seed: 20260927,
    partials: [
      { ratio: 0.5, gain: 0.28, decay: 5.2 },
      { ratio: 1, gain: 1, decay: 7.4, drift: 0.9 },
      { ratio: 1.006, gain: 0.85, decay: 7 },
      { ratio: 1.19, gain: 0.42, decay: 5.2 },
      { ratio: 1.58, gain: 0.34, decay: 4.4 },
      { ratio: 2, gain: 0.3, decay: 3.8 },
      { ratio: 2.68, gain: 0.22, decay: 3 },
      { ratio: 3.04, gain: 0.16, decay: 2.5 },
      { ratio: 4.12, gain: 0.12, decay: 2 },
      { ratio: 5.46, gain: 0.09, decay: 1.4 },
    ],
    noise: { gain: 0.12, decay: 0.05, smooth: 0.5 },
  },
  bell: {
    name: '큰 종',
    description: '낮고 깊게 울리는 종소리',
    duration: 10,
    base: 132,
    attack: 0.004,
    seed: 771,
    partials: [
      { ratio: 0.5, gain: 0.3, decay: 7.5 },
      { ratio: 1, gain: 1, decay: 9.5, drift: 0.4 },
      { ratio: 1.2, gain: 0.5, decay: 6.5 },
      { ratio: 1.5, gain: 0.45, decay: 5.5 },
      { ratio: 2, gain: 0.4, decay: 4.6 },
      { ratio: 2.51, gain: 0.3, decay: 3.6 },
      { ratio: 3, gain: 0.25, decay: 3 },
      { ratio: 4, gain: 0.18, decay: 2.2 },
      { ratio: 4.95, gain: 0.14, decay: 1.8 },
      { ratio: 6.1, gain: 0.1, decay: 1.3 },
    ],
    noise: { gain: 0.2, decay: 0.12, smooth: 0.55 },
  },
  gong: {
    name: '징',
    description: '넓게 퍼지는 묵직한 금속 울림',
    duration: 13,
    base: 98,
    attack: 0.02,
    seed: 4242,
    partials: [
      { ratio: 1, gain: 1, decay: 9.5, drift: 1.2 },
      { ratio: 1.35, gain: 0.6, decay: 7.5, drift: 0.8 },
      { ratio: 2.1, gain: 0.5, decay: 6.5 },
      { ratio: 2.9, gain: 0.4, decay: 5.2 },
      { ratio: 3.7, gain: 0.3, decay: 4.4 },
      { ratio: 4.6, gain: 0.25, decay: 3.6 },
      { ratio: 5.8, gain: 0.2, decay: 2.9 },
      { ratio: 7.1, gain: 0.15, decay: 2.2 },
      { ratio: 9.3, gain: 0.1, decay: 1.6 },
      { ratio: 12.4, gain: 0.07, decay: 1.2 },
    ],
    noise: { gain: 0.32, decay: 0.7, smooth: 0.35 },
  },
  chime: {
    name: '방울',
    description: '맑고 짧은 작은 종소리',
    duration: 4.5,
    base: 1180,
    attack: 0.003,
    seed: 313,
    partials: [
      { ratio: 1, gain: 1, decay: 1.8, drift: 1.5 },
      { ratio: 2.02, gain: 0.55, decay: 1.2 },
      { ratio: 3.09, gain: 0.3, decay: 0.8 },
      { ratio: 4.6, gain: 0.18, decay: 0.5 },
      { ratio: 6.3, gain: 0.1, decay: 0.3 },
    ],
    noise: { gain: 0.25, decay: 0.02, smooth: 0.6 },
  },
  wood: {
    name: '목탁',
    description: '짧고 또렷한 나무 두드리는 소리',
    duration: 1.4,
    base: 430,
    attack: 0.001,
    seed: 909,
    partials: [
      { ratio: 1, gain: 1, decay: 0.16 },
      { ratio: 2.35, gain: 0.6, decay: 0.11 },
      { ratio: 3.9, gain: 0.35, decay: 0.07 },
      { ratio: 5.6, gain: 0.2, decay: 0.045 },
    ],
    noise: { gain: 0.55, decay: 0.012, smooth: 0.75 },
  },
  ping: {
    name: '알림음',
    description: '부드러운 전자 알림음',
    duration: 2.4,
    base: 660,
    attack: 0.004,
    seed: 51,
    partials: [
      { ratio: 1, gain: 1, decay: 1.4 },
      { ratio: 2, gain: 0.35, decay: 0.65 },
      { ratio: 3, gain: 0.12, decay: 0.35 },
    ],
    noise: { gain: 0.06, decay: 0.02, smooth: 0.6 },
  },
}

export const BUILTIN_SOUNDS = Object.entries(RECIPES).map(([key, recipe]) => ({
  id: `${BUILTIN_PREFIX}${key}`,
  name: recipe.name,
  description: recipe.description,
  durationMs: Math.round(recipe.duration * 1000),
  kind: 'builtin',
}))

export const BUILTIN_MAP = new Map(BUILTIN_SOUNDS.map((sound) => [sound.id, sound]))

/** 새 프로젝트의 기본 소리 */
export const DEFAULT_SOUND_ID = BUILTIN_SOUNDS[0].id

export const isBuiltinSoundId = (soundId) =>
  typeof soundId === 'string' && soundId.startsWith(BUILTIN_PREFIX)

export function builtinSound(soundId) {
  return BUILTIN_MAP.get(soundId) ?? null
}


function makeRandom(seed) {
  let state = (seed || 1) >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function synthesize(recipe, sampleRate) {
  const length = Math.max(1, Math.ceil(recipe.duration * sampleRate))
  const data = new Float32Array(length)
  const random = makeRandom(recipe.seed)

  for (const partial of recipe.partials) {
    const frequency = recipe.base * partial.ratio
    const phase = random() * Math.PI * 2
    const drift = partial.drift ?? 0
    const driftRate = 0.25 + random() * 0.35

    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate
      const env =
        t < recipe.attack ? t / recipe.attack : Math.exp(-(t - recipe.attack) / partial.decay)
      if (env < 1e-4) break
      const f = drift ? frequency + drift * Math.sin(2 * Math.PI * driftRate * t) : frequency
      data[i] += partial.gain * env * Math.sin(2 * Math.PI * f * t + phase)
    }
  }

  if (recipe.noise) {
    const { gain, decay, smooth = 0.5 } = recipe.noise
    let previous = 0
    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate
      const env = Math.exp(-t / decay)
      if (env < 1e-4) break
      const white = random() * 2 - 1
      previous = previous * smooth + white * (1 - smooth)
      data[i] += gain * env * previous
    }
  }

  // 1) 피크 정규화 (짧은 어택 잡음이 전체 크기를 지배하지 않도록 10ms 이후 기준)
  const skip = Math.min(Math.round(0.01 * sampleRate), Math.floor(length / 4))
  let peak = 0
  for (let i = skip; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]))
  if (peak > 0) {
    const peakGain = 0.92 / peak
    for (let i = 0; i < length; i += 1) data[i] *= peakGain
  }

  // 2) 소리마다 체감 음량이 비슷하도록 RMS 기준으로 맞춘다.
  //    (긴 잔향 때문에 전체 구간 RMS를 쓰면 실제로 들리는 앞부분이 작아진다.)
  const loudnessWindow = Math.min(length, Math.round(1.2 * sampleRate))
  let energy = 0
  for (let i = 0; i < loudnessWindow; i += 1) energy += data[i] * data[i]
  const rms = Math.sqrt(energy / loudnessWindow)
  const targetRms = recipe.loudness ?? 0.07
  if (rms > 0) {
    let loudnessGain = targetRms / rms
    let max = 0
    for (let i = 0; i < length; i += 1) max = Math.max(max, Math.abs(data[i]) * loudnessGain)
    if (max > 0.98) loudnessGain *= 0.98 / max
    for (let i = 0; i < length; i += 1) data[i] *= loudnessGain
  }

  // 3) 클릭 방지를 위한 페이드 인/아웃
  const fadeIn = Math.round(0.004 * sampleRate)
  const fadeOut = Math.min(Math.round(0.06 * sampleRate), Math.floor(length / 4))


  for (let i = 0; i < length; i += 1) {
    let gain = 1
    if (i < fadeIn) gain *= i / fadeIn
    const fromEnd = length - 1 - i
    if (fromEnd < fadeOut) gain *= fromEnd / fadeOut
    data[i] *= gain
  }

  return data
}

const bufferCache = new Map()

/** 내장 소리를 AudioBuffer 로 렌더링(캐시)한다. */
export function renderBuiltinBuffer(audioContext, soundId) {
  const recipeKey = String(soundId).slice(BUILTIN_PREFIX.length)
  const recipe = RECIPES[recipeKey]
  if (!recipe) throw new Error(`알 수 없는 내장 소리입니다: ${soundId}`)

  const cacheKey = `${soundId}@${audioContext.sampleRate}`
  const cached = bufferCache.get(cacheKey)
  if (cached) return cached

  const samples = synthesize(recipe, audioContext.sampleRate)
  const buffer = audioContext.createBuffer(1, samples.length, audioContext.sampleRate)
  buffer.copyToChannel(samples, 0)
  bufferCache.set(cacheKey, buffer)
  return buffer
}
