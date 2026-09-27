/** 시간 관련 유틸리티 */

export function uid(prefix = 'id') {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}${random}`
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** 3725000 -> "1:02:05", 305000 -> "5:05" */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** 초 단위를 "5분", "1시간 5분", "30초" 처럼 사람이 읽기 쉬운 형태로 */
export function formatKoreanDuration(seconds) {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}초`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const parts = []
  if (hours) parts.push(`${hours}시간`)
  if (minutes) parts.push(`${minutes}분`)
  if (rest && !hours) parts.push(`${rest}초`)
  return parts.join(' ')
}

/** Date.now() 값 -> "오후 3:24" */
export function formatTimeOfDay(timestamp) {
  const date = new Date(timestamp)
  const hours24 = date.getHours()
  const suffix = hours24 < 12 ? '오전' : '오후'
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${suffix} ${hours}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Date.now() 값 -> "2026. 9. 27." */
export function formatDate(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`
}

export function formatBytes(bytes) {
  if (!bytes) return '0KB'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`
}

/** Date.now() 값 -> "2026. 9. 27. 16:05" (빌드 시각 표시용) */
export function formatDateTime(timestamp) {
  const date = new Date(timestamp)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** ISO 문자열을 같은 형식으로 */
export function formatIsoDateTime(iso) {
  const timestamp = Date.parse(iso)
  return Number.isNaN(timestamp) ? '-' : formatDateTime(timestamp)
}

/** 소리 파일 이름에서 확장자를 떼어낸다. */
export function stripExtension(fileName) {
  return fileName.replace(/\.[a-z0-9]{1,5}$/i, '')
}
