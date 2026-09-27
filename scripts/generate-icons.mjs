#!/usr/bin/env node
/**
 * 의존성 없이 앱 아이콘(PNG)을 생성한다.
 *   node scripts/generate-icons.mjs
 * public/icons/*.png, public/favicon.png 를 만든다.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* -------------------------------- 그림 그리기 ------------------------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * clamp01(t)
const mixColor = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]

/** u,v 는 0~1 정규화 좌표. 색을 [r,g,b] (0~1) 로 돌려준다. */
function paint(u, v, scale) {
  // 배경: 위에서 아래로 어두워지는 남색 + 중앙의 따뜻한 빛무리
  let color = mixColor([0.106, 0.098, 0.129], [0.043, 0.043, 0.055], clamp01((v - 0.05) / 0.95))
  const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.58) / 0.62)
  color = mixColor(color, [0.29, 0.21, 0.11], glow * glow * 0.85)

  const cx = 0.5
  const rimY = 0.6
  const rx = 0.3 * scale
  const ry = 0.265 * scale
  const inner = 0.995 // 안쪽 그라데이션용

  const dx = (u - cx) / (rx * inner)
  const dy = (v - rimY) / (ry * inner)

  // 그릇 몸통 (아래 반쪽 타원)
  const bodyD = dx * dx + dy * dy
  const inBody = bodyD <= 1 && v >= rimY
  // 그릇 테두리 (위에서 본 타원 링)
  const outer = ((u - cx) / (0.317 * scale)) ** 2 + ((v - rimY) / (0.098 * scale)) ** 2
  const innerRing = ((u - cx) / (0.243 * scale)) ** 2 + ((v - rimY) / (0.062 * scale)) ** 2
  const inRim = outer <= 1 && innerRing >= 1

  const goldLight = [1.0, 0.906, 0.667]
  const goldMid = [0.847, 0.639, 0.267]
  const goldDark = [0.427, 0.278, 0.098]

  if (inBody || inRim) {
    // 좌상단 하이라이트 → 아래로 어두워지는 금속 그라데이션
    const shade = clamp01((v - rimY) / (1.25 * ry)) * 0.75 + clamp01((u - cx + rx) / (2 * rx)) * 0.25
    let metal = mixColor(goldLight, goldMid, clamp01(shade * 1.6))
    metal = mixColor(metal, goldDark, clamp01((shade - 0.55) / 0.45))
    // 테두리는 조금 더 밝게
    if (inRim) metal = mixColor(metal, [1.0, 0.949, 0.804], 0.45)
    color = inRim ? mixColor(color, metal, 0.98) : mixColor(color, metal, 0.96)
  } else if (inBody === false && v >= rimY) {
    // 몸통 바로 바깥의 은은한 그림자
    const d = Math.sqrt(bodyD)
    if (d < 1.18) color = mixColor(color, [0.02, 0.02, 0.03], 0.5 * (1 - (d - 1) / 0.18))
  }

  // 위로 퍼지는 소리 물결 (호)
  for (let i = 0; i < 3; i += 1) {
    const radius = (0.375 + i * 0.075) * scale
    const ring = Math.abs(Math.hypot(u - cx, v - rimY) - radius)
    const thickness = 0.021 * scale
    if (ring <= thickness) {
      const angle = Math.atan2(v - rimY, u - cx)
      const inArc = angle <= -0.52 && angle >= -2.62
      const alpha = inArc ? (0.82 - i * 0.2) * (1 - ring / thickness) ** 0.6 : 0
      if (alpha > 0) color = mixColor(color, [1.0, 0.847, 0.541], alpha)
    }
  }

  return color
}

function renderRgba(size, scale = 1) {
  const SS = 3 // 슈퍼샘플링
  const big = size * SS
  const out = new Uint8ClampedArray(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (x * SS + sx + 0.5) / big
          const v = (y * SS + sy + 0.5) / big
          const c = paint(u, v, scale)
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      out[i] = (r / n) * 255
      out[i + 1] = (g / n) * 255
      out[i + 2] = (b / n) * 255
      out[i + 3] = 255
    }
  }
  return out
}

/* ---------------------------------- 실행 ---------------------------------- */

const targets = [
  { file: 'public/icons/pwa-192.png', size: 192, scale: 1 },
  { file: 'public/icons/pwa-512.png', size: 512, scale: 1 },
  // maskable: 안전 영역(중앙 80%) 안에 들어가도록 축소
  { file: 'public/icons/maskable-512.png', size: 512, scale: 0.78 },
  { file: 'public/icons/apple-touch-icon.png', size: 180, scale: 0.94 },
  { file: 'public/favicon.png', size: 64, scale: 1 },
]

for (const { file, size, scale } of targets) {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encodePng(size, size, renderRgba(size, scale)))
  console.log(`✓ ${file} (${size}x${size})`)
}
