import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 프로젝트 사이트는 https://<user>.github.io/<repo>/ 아래에 배포된다.
const base = process.env.BASE_PATH ?? '/singing-bowl/'

export default defineConfig({
  base,
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
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
        skipWaiting: true,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  server: {
    host: true,
  },
})
