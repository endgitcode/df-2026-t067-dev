import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

export type SheetSnap = 'closed' | 'peek' | 'half' | 'full'

// 覗き見では、ハンドル＋件数＋先頭の行1つが丸ごと収まる高さにする
// （ドラッグしなくても最初の謎に届くことが狙い）。一覧の行はタイトルだけの
// 簡素な形（D-46）になったため、内訳の目安：ハンドル34＋件数行・余白 約28＋
// タイトル行 約46＋余裕 約20。
// 全開では上部の地図操作（範囲チップ等）を残す。
export const SHEET_PEEK_HEIGHT = 128
const SHEET_TOP_GAP = 84
const FALLBACK_STAGE_HEIGHT = 640
const DRAG_TAP_THRESHOLD = 6

function snapHeights(stageHeight: number): Record<SheetSnap, number> {
  const half = Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))
  const full = Math.max(half, stageHeight - SHEET_TOP_GAP)
  return { closed: 0, peek: SHEET_PEEK_HEIGHT, half, full }
}

// 地図の上に重なる引き上げ式シート。スナップは closed / peek / half / full の4段で、
// ハンドルのドラッグとタップ（ボタン）の両方で開閉できる。シート本体が地図とは
// 別の要素なので、シート上のスクロールやドラッグが地図へ伝わることはない。
export function ExploreBottomSheet({ children, openSignal, onHeightChange, onBrowseBelowMap }: {
  children: ReactNode
  /** 地域IDが新しく渡されたら、ハイライトされたカードが見える位置まで開く。 */
  openSignal?: string | null
  onHeightChange?: (height: number) => void
  onBrowseBelowMap?: () => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const reopenRef = useRef<HTMLButtonElement>(null)
  const focusAfterSnap = useRef<'body' | 'reopen' | null>(null)
  const [stageHeight, setStageHeight] = useState(FALLBACK_STAGE_HEIGHT)
  const [snap, setSnap] = useState<SheetSnap>('peek')
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number; distance: number } | null>(null)
  const suppressClick = useRef(false)
  const lastOpenSignal = useRef<string | null>(null)
  const bodyId = useId()

  const measure = useCallback(() => {
    const height = sheetRef.current?.parentElement?.clientHeight ?? 0
    setStageHeight(height >= 320 ? height : FALLBACK_STAGE_HEIGHT)
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  useEffect(() => {
    if (openSignal && openSignal !== lastOpenSignal.current) {
      setSnap((current) => (current === 'closed' || current === 'peek' ? 'half' : current))
    }
    lastOpenSignal.current = openSignal ?? null
  }, [openSignal])

  const heights = snapHeights(stageHeight)
  const height = dragHeight ?? heights[snap]

  useEffect(() => { onHeightChange?.(height) }, [height, onHeightChange])

  useEffect(() => {
    const target = focusAfterSnap.current
    if (!target) return
    focusAfterSnap.current = null
    const element = target === 'body' ? bodyRef.current : reopenRef.current
    if (target === 'body' && element) element.scrollTop = 0
    element?.focus({ preventScroll: true })
  }, [snap])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height, distance: 0 }
    suppressClick.current = false
    setDragHeight(height)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 捕捉できなくてもドラッグは続けられる。 */ }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    const delta = active.startY - event.clientY
    active.distance = Math.max(active.distance, Math.abs(delta))
    setDragHeight(Math.min(heights.full, Math.max(heights.closed, active.startHeight + delta)))
  }
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    drag.current = null
    if (active.distance >= DRAG_TAP_THRESHOLD) {
      suppressClick.current = true
      const target = dragHeight ?? heights[snap]
      const nearest = (Object.entries(heights) as Array<[SheetSnap, number]>)
        .reduce((best, entry) => (Math.abs(entry[1] - target) < Math.abs(best[1] - target) ? entry : best))
      if (nearest[0] === 'closed') focusAfterSnap.current = 'reopen'
      setSnap(nearest[0])
    }
    setDragHeight(null)
  }
  const onClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return }
    if (snap === 'half' || snap === 'full') focusAfterSnap.current = 'reopen'
    setSnap((current) => (current === 'closed' ? 'peek' : current === 'peek' ? 'half' : 'closed'))
  }
  const reopen = () => {
    suppressClick.current = false
    focusAfterSnap.current = 'body'
    setSnap('half')
  }

  return <>
    <div ref={sheetRef} className={'explore-sheet' + (dragHeight !== null ? ' is-dragging' : '')} data-snap={snap} style={{ height }}>
      {snap !== 'closed' && <button type="button" className="explore-sheet-handle" aria-expanded={snap === 'half' || snap === 'full'} aria-controls={bodyId}
        aria-label={snap === 'peek' ? '謎リストを広げる' : '謎リストを縮める'}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={onClick}>
        <span className="explore-sheet-grip" aria-hidden="true" />
      </button>}
      <div ref={bodyRef} className="explore-sheet-body" id={bodyId} tabIndex={-1}>{children}</div>
    </div>
    {(snap === 'closed' || snap === 'peek') && <button ref={reopenRef} type="button" className="explore-sheet-reopen"
      aria-expanded={onBrowseBelowMap ? undefined : false} aria-controls={onBrowseBelowMap ? undefined : bodyId}
      onClick={onBrowseBelowMap ?? reopen}>問題を見る</button>}
  </>
}
