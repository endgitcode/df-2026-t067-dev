import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExploreBottomSheet, SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'

// jsdomでは親の高さが測れないため、段階の高さは代替値（ステージ640px想定:
// peek 128 / half 352 / full 556）で決まる。
describe('ExploreBottomSheet', () => {
  it('starts at the peek snap showing the toggle as collapsed', () => {
    const onHeightChange = vi.fn()
    const { container } = render(<ExploreBottomSheet onHeightChange={onHeightChange}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    expect((sheet as HTMLElement).style.height).toBe('128px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.explore-sheet-reopen')).toBeNull()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    expect(screen.getByText('リスト本文')).toBeVisible()
    expect(onHeightChange).toHaveBeenLastCalledWith(128)
  })

  it('opens from peek and can close fully', async () => {
    const user = userEvent.setup()
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(sheet).toHaveAttribute('data-snap', 'half')
    expect((sheet as HTMLElement).style.height).toBe('352px')
    expect(screen.getByRole('button', { name: '謎リストを縮める' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: '謎リストを縮める' }))
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    expect((sheet as HTMLElement).style.height).toBe('34px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toBeInTheDocument()
    const reopen = screen.getByRole('button', { name: '問題を見る' })
    expect(reopen).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(reopen)
    await user.click(reopen)
    expect(sheet).toHaveAttribute('data-snap', 'half')
    expect(document.activeElement).toBe(screen.getByText('リスト本文').parentElement)
  })

  it('drags the handle and snaps to the nearest stage without toggling', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'touch', clientY: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'touch', clientY: 100 })
    expect(sheet.style.height).toBe('328px')
    expect(sheet).toHaveClass('is-dragging')
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'touch', clientY: 100 })
    expect(sheet).toHaveAttribute('data-snap', 'half')
    expect(sheet.style.height).toBe('352px')
    // ドラッグ後のクリックで開閉が反転しないこと。
    fireEvent.click(handle)
    expect(sheet).toHaveAttribute('data-snap', 'half')
  })

  it('snaps to full when dragged close to the top', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', clientY: 560 })
    fireEvent.pointerMove(handle, { pointerId: 2, pointerType: 'touch', clientY: 160 })
    fireEvent.pointerUp(handle, { pointerId: 2, pointerType: 'touch', clientY: 160 })
    expect(sheet).toHaveAttribute('data-snap', 'full')
    expect(sheet.style.height).toBe('556px')
  })

  it('keeps the handle visible when closed and reopens by tapping or dragging it', async () => {
    const user = userEvent.setup()
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 3, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 3, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 3, pointerType: 'touch', clientY: 400 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    expect((sheet as HTMLElement).style.height).toBe('34px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toBeInTheDocument()
    const reopen = screen.getByRole('button', { name: '問題を見る' })
    expect(reopen).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(reopen)
    await user.click(reopen)
    expect(sheet).toHaveAttribute('data-snap', 'half')
    expect(document.activeElement).toBe(screen.getByText('リスト本文').parentElement)
    const openHandle = screen.getByRole('button', { name: '謎リストを縮める' })
    fireEvent.pointerDown(openHandle, { pointerId: 4, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerMove(openHandle, { pointerId: 4, pointerType: 'touch', clientY: 600 })
    fireEvent.pointerUp(openHandle, { pointerId: 4, pointerType: 'touch', clientY: 600 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    await user.click(openHandle)
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    fireEvent.pointerDown(openHandle, { pointerId: 5, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerMove(openHandle, { pointerId: 5, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerUp(openHandle, { pointerId: 5, pointerType: 'touch', clientY: 200 })
    expect(sheet).toHaveAttribute('data-snap', 'half')
  })

  it('removes the reopen button from focus when a drag makes the sheet cover it', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 10, pointerType: 'touch', clientY: 300 })
    fireEvent.pointerMove(handle, { pointerId: 10, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 10, pointerType: 'touch', clientY: 400 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')

    const reopen = container.querySelector('.explore-sheet-reopen') as HTMLButtonElement
    reopen.focus()
    fireEvent.pointerDown(handle, { pointerId: 11, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerMove(handle, { pointerId: 11, pointerType: 'touch', clientY: 350 })
    expect(reopen).toHaveAttribute('inert')
    expect(reopen).toBeDisabled()
    expect(document.activeElement).toBe(handle)
    fireEvent.pointerUp(handle, { pointerId: 11, pointerType: 'touch', clientY: 350 })
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
  })

  it('uses the closed-sheet button to browse below the map when a callback is provided', async () => {
    const user = userEvent.setup()
    const onBrowseBelowMap = vi.fn()
    const { container } = render(<ExploreBottomSheet onBrowseBelowMap={onBrowseBelowMap}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')

    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(sheet).toHaveAttribute('data-snap', 'half')
    await user.click(screen.getByRole('button', { name: '謎リストを縮める' }))
    expect(sheet).toHaveAttribute('data-snap', 'closed')

    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(onBrowseBelowMap).toHaveBeenCalledTimes(1)
    expect(sheet).toHaveAttribute('data-snap', 'closed')
  })

  it('only exposes 問題を見る while fully closed', async () => {
    const user = userEvent.setup()
    render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
  })

  it('opens to half when a new area is signalled, and stays where the user left it for the same signal', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(<ExploreBottomSheet openSignal={null}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    rerender(<ExploreBottomSheet openSignal="area-a"><p>リスト本文</p></ExploreBottomSheet>)
    expect(sheet).toHaveAttribute('data-snap', 'half')
    await user.click(screen.getByRole('button', { name: '謎リストを縮める' }))
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    rerender(<ExploreBottomSheet openSignal="area-a"><p>リスト本文</p></ExploreBottomSheet>)
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    rerender(<ExploreBottomSheet openSignal="area-b"><p>リスト本文</p></ExploreBottomSheet>)
    expect(sheet).toHaveAttribute('data-snap', 'half')
  })
})


describe('sheet snap height contract', () => {
  // ExploreBottomSheet 内の snapHeights と同じ式。export すると Fast Refresh lint に当たるためここで固定する。
  function heights(stageHeight: number) {
    const half = Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))
    const full = Math.max(half, stageHeight - 84)
    return { closed: 34, peek: SHEET_PEEK_HEIGHT, half, full }
  }
  it('keeps peek fixed and derives half/full from the usable stage', () => {
    expect(heights(640)).toEqual({ closed: 34, peek: SHEET_PEEK_HEIGHT, half: 352, full: 556 })
    expect(heights(700)).toEqual({ closed: 34, peek: SHEET_PEEK_HEIGHT, half: 385, full: 616 })
  })
})

describe('ExploreBottomSheet stage measure', () => {
  it('subtracts the CSS bottom offset so full fits above the tab bar without a lower gap', () => {
    const shell = document.createElement('div')
    Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 800 })
    document.body.appendChild(shell)
    render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>, { container: shell })
    const sheet = shell.querySelector('.explore-sheet') as HTMLElement
    const original = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const style = original(el)
      if (el === sheet) {
        Object.defineProperty(style, 'bottom', { configurable: true, get: () => '104px' })
      }
      return style
    })
    fireEvent(window, new Event('resize'))
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    // usable = 800 - 104 = 696 → full = 696 - 84 = 612
    fireEvent.pointerDown(handle, { pointerId: 20, pointerType: 'touch', clientY: 600 })
    fireEvent.pointerMove(handle, { pointerId: 20, pointerType: 'touch', clientY: 50 })
    fireEvent.pointerUp(handle, { pointerId: 20, pointerType: 'touch', clientY: 50 })
    expect(sheet).toHaveAttribute('data-snap', 'full')
    expect(sheet.style.height).toBe('612px')
    // 親800に対し bottom104 + height612 = 716。上に84px（SHEET_TOP_GAP）だけ残り、下端の隙間は出ない。
    expect(104 + 612 + 84).toBe(800)
  })

  it('remeasures when the visual viewport resizes (mobile URL bar)', () => {
    const listeners = new Map<string, Set<(event: Event) => void>>()
    const viewport = {
      addEventListener: vi.fn((type: string, handler: (event: Event) => void) => {
        const set = listeners.get(type) ?? new Set<(event: Event) => void>()
        set.add(handler)
        listeners.set(type, set)
      }),
      removeEventListener: vi.fn((type: string, handler: (event: Event) => void) => {
        listeners.get(type)?.delete(handler)
      }),
    }
    vi.stubGlobal('visualViewport', viewport)
    let parentHeight = 640
    const shell = document.createElement('div')
    Object.defineProperty(shell, 'clientHeight', { configurable: true, get: () => parentHeight })
    document.body.appendChild(shell)
    const { unmount } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>, { container: shell })
    const sheet = shell.querySelector('.explore-sheet') as HTMLElement
    expect(viewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(viewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    parentHeight = 500
    for (const handler of listeners.get('resize') ?? []) handler(new Event('resize'))
    fireEvent.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    // usable 500 → half = max(128, round(275)) = 275
    expect(sheet.style.height).toBe('275px')
    unmount()
    expect(viewport.removeEventListener).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
