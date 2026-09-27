import { mount } from 'svelte'
import './app.css'

/**
 * iOS 홈 화면 앱(standalone PWA) 감지.
 * - @media (display-mode: standalone)이 iOS에서 매칭되지 않는 경우가 있어
 *   JS로 standalone 여부를 판단해 <html>에 is-standalone 클래스를 붙인다.
 * - Svelte 마운트보다 먼저 실행되어야 헤더가 첫 프레임부터 올바른 여백을 갖는다.
 */
function markStandalone() {
  try {
    const mq = window.matchMedia?.('(display-mode: standalone)')?.matches === true
    const ios = window.navigator?.standalone === true
    if (mq || ios) document.documentElement.classList.add('is-standalone')
  } catch {
    /* noop */
  }
}
markStandalone()

import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app'),
})

export default app
