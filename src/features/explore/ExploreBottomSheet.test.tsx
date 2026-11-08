import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExploreBottomSheet } from './ExploreBottomSheet'

// jsdomでは親の高さが測れないため、段階の高さは代替値（ステージ640px想定:
// peek 200 / half 352 / full 556）で決まる。
describe('ExploreBottomSheet', () => {
  it('starts at the peek snap showing the toggle as collapsed', () => {
    const onHeightChange = vi.fn()
    const { container } = render(<ExploreBottomSheet onHeightChange={onHeightChange}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    expect((sheet as HTMLElement).style.height).toBe('200px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('リスト本文')).toBeVisible()
    expect(onHeightChange).toHaveBeenLastCalledWith(200)
  })

  it('opens from peek and can close fully while keeping the handle available', async () => {
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
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toBeVisible()
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(sheet).toHaveAttribute('data-snap', 'peek')
  })

  it('drags the handle and snaps to the nearest stage without toggling', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'touch', clientY: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'touch', clientY: 100 })
    expect(sheet.style.height).toBe('400px')
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

  it('drags fully down to the handle only', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 3, pointerType: 'touch', clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 3, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 3, pointerType: 'touch', clientY: 400 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    expect(sheet.style.height).toBe('34px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toBeVisible()
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toHaveAttribute('aria-expanded', 'false')
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
