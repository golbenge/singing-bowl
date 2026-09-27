import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 프로젝트 사이트는 https://<user>.github.io/<repo>/ 아래에 배포된다.
const base = process.env.BASE_PATH ?? '/singing-bowl/'

// 빌드 시각: 앱에 심어 두고 version.json 과 비교해 새 버전 여부를 판단한다.
const buildTime = new Date().toISOString()

export default defineConfig({
  base,
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    svelte(),
    {
      // 배포된 최신 빌드 시각을 알려 주는 파일(서비스 워커 프리캐시 대상이 아니다).
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildTime }),
        })
      },
    },
    VitePWA({
      // 새 버전을 자동 적용하지 않고 사용자가 '지금 새로고침'을 누르게 한다.
      registerType: 'prompt',
      // 등록은 src/lib/app-update.svelte.js 에서 직접 한다(Safari/iOS 대응).
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Singing Bowl — 명상 타이머',
        short_name: 'Singing Bowl',
        description: '정해진 시간에 원하는 소리를 재생해 주는 오프라인 명상 타이머',
        lang: 'ko',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d0f14',
        theme_color: '#0d0f14',
        categories: ['lifestyle', 'health', 'music'],
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // m4a 등 음원 확장자도 함께 미리 받아 두어야 오프라인에서 샘플 소리가 재생된다.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,m4a,mp3,wav,ogg,aac}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // 새 워커는 대기 상태로 두고, 사용자가 새로고침할 때 SKIP_WAITING 메시지로 활성화한다.
        skipWaiting: false,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  server: {
    host: true,
  },
})

