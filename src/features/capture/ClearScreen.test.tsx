import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ClearScreen } from './ClearScreen'

it('isolates clear-screen gestures and restores the background state on unmount', () => {
  const alreadyInert = document.createElement('aside')
  alreadyInert.setAttribute('inert', '')
  document.body.append(alreadyInert)
  const onPointerDown = vi.fn()
  const onTouchStart = vi.fn()
  const view = render(<div onPointerDown={onPointerDown} onTouchStart={onTouchStart}>
    <ClearScreen photo={new Blob(['synthetic'])} onReturnToMap={vi.fn()} />
  </div>)
  const dialog = screen.getByRole('dialog')
  expect(dialog.parentElement).toBe(document.body)
  expect(view.container).toHaveAttribute('inert')
  fireEvent.pointerDown(dialog)
  fireEvent.touchStart(dialog)
  expect(onPointerDown).not.toHaveBeenCalled()
  expect(onTouchStart).not.toHaveBeenCalled()
  view.unmount()
  expect(view.container).not.toHaveAttribute('inert')
  expect(alreadyInert).toHaveAttribute('inert')
  alreadyInert.remove()
})
