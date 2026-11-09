import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExploreBottomSheet } from './ExploreBottomSheet'

// jsdomでは親の高さが測れないため、段階の高さは代替値（ステージ640px想定:
// peek 168 / half 352 / full 556）で決まる。
describe('ExploreBottomSheet', () => {
  it('starts at the peek snap showing the toggle as collapsed', () => {
    const onHeightChange = vi.fn()
    const { container } = render(<ExploreBottomSheet onHeightChange={onHeightChange}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    expect((sheet as HTMLElement).style.height).toBe('168px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.explore-sheet-reopen')).toBeNull()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    expect(screen.getByText('リスト本文')).toBeVisible()
    expect(onHeightChange).toHaveBeenLastCalledWith(168)
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
    expect(sheet.style.height).toBe('368px')
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
    // peek が 168 に広がった分（D-73）、closed と peek の中点（101px）を超えるよう
    // ドラッグ量を 70px に調整する。高さ 104px 時点で再表示ボタンはシートに覆われる。
    fireEvent.pointerDown(handle, { pointerId: 11, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerMove(handle, { pointerId: 11, pointerType: 'touch', clientY: 330 })
    expect(reopen).toHaveAttribute('inert')
    expect(reopen).toBeDisabled()
    expect(document.activeElement).toBe(handle)
    fireEvent.pointerUp(handle, { pointerId: 11, pointerType: 'touch', clientY: 330 })
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

  it('ignores a swipe-generated click on the closed-sheet button but keeps keyboard activation', () => {
    const onBrowseBelowMap = vi.fn()
    const { container } = render(<ExploreBottomSheet onBrowseBelowMap={onBrowseBelowMap}><p>リスト本文</p></ExploreBottomSheet>)
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.click(handle)
    fireEvent.click(screen.getByRole('button', { name: '謎リストを縮める' }))
    const reopen = screen.getByRole('button', { name: '問題を見る' })
    fireEvent.pointerDown(reopen, { pointerId: 20, pointerType: 'touch', clientX: 40, clientY: 240 })
    fireEvent.pointerMove(reopen, { pointerId: 20, pointerType: 'touch', clientX: 42, clientY: 220 })
    fireEvent.click(reopen, { detail: 1 })
    expect(onBrowseBelowMap).not.toHaveBeenCalled()
    expect(container.querySelector('.explore-sheet')).toHaveAttribute('data-snap', 'closed')

    fireEvent.click(reopen, { detail: 0 })
    expect(onBrowseBelowMap).toHaveBeenCalledTimes(1)
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
