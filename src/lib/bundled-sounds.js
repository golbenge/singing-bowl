/**
 * 앱에 함께 들어 있는 샘플 소리.
 *
 * 지금 들어 있는 샘플
 *  - 이름: Tibetan Bowl Struck #1 (싱잉볼 타격음, 약 30초)
 *  - 출처: BigSoundBank  https://bigsoundbank.com/tibetan-bowl-struck-1-s1110.html
 *  - 저작자: Joseph SARDIN
 *  - 라이선스: CC0 1.0 (퍼블릭 도메인) — 출처 표기 불필요, 수정·재배포 허용
 *  - 파일: public/sounds/singing-bowl.m4a (모노 48kHz AAC, 약 433KB)
 *
 * 다른 소리로 바꾸고 싶다면
 *  1) public/sounds/ 안의 파일을 원하는 음원으로 교체하고(같은 이름 유지)
 *  2) 아래 durationMs 값만 실제 길이에 맞게 고치면 됩니다.
 *  (앱에서 직접 쓰는 음원은 ‘소리 보관함 → 음향 파일 추가’로 등록해 시간대마다 지정할 수도 있습니다.)
 */
export const BUNDLED_SOUNDS = [
  {
    id: 'bundled:singing-bowl',
    name: '싱잉볼',
    description: '실제 싱잉볼 타격 녹음 · 약 30초 · CC0',
    kind: 'bundled',
    file: 'sounds/singing-bowl.m4a',
    durationMs: 29993,
    license: 'CC0 1.0 (BigSoundBank · Joseph SARDIN)',
  },
]

export const BUNDLED_MAP = new Map(BUNDLED_SOUNDS.map((sound) => [sound.id, sound]))

/** 새 프로젝트의 기본 소리 */
export const DEFAULT_SOUND_ID = BUNDLED_SOUNDS[0].id

const BUNDLED_PREFIX = 'bundled:'

// 예전 버전에서 쓰던(코드로 합성하던) 소리 ID. 저장된 프로젝트를 자동으로 샘플 소리로 옮긴다.
const LEGACY_PREFIXES = ['builtin:', 'preset:']

/**
 * 저장된 음원 ID를 현재 앱에서 쓸 수 있는 값으로 바꾼다.
 *  - 지원하지 않는(예전 합성) ID는 null 로 만들어 기본 소리를 쓰게 한다.
 */
export function normalizeSoundId(soundId) {
  if (typeof soundId !== 'string' || !soundId) return null
  if (LEGACY_PREFIXES.some((prefix) => soundId.startsWith(prefix))) return null
  return soundId
}

export const isBundledSoundId = (soundId) =>
  typeof soundId === 'string' && soundId.startsWith(BUNDLED_PREFIX)

export function bundledSound(soundId) {
  return BUNDLED_MAP.get(soundId) ?? null
}

/** 배포 경로(base)를 반영한 샘플 파일 URL */
export function bundledSoundUrl(sound) {
  const base = import.meta.env.BASE_URL ?? '/'
  return `${base}${sound.file}`
}
