import { useSyncExternalStore } from 'react'

// App.css のワークスペースが2カラムになる境界（max-width: 980px の反対側）を
// 「広い画面＝PC」の境目として使う。UA判定はしない。
export const WIDE_VIEWPORT_QUERY = '(min-width: 981px)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(WIDE_VIEWPORT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getSnapshot() {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

export function useWideViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
