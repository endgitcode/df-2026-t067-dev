export type ControlRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>

/** A control is unsafe to activate when even a sliver of its hit target is behind the sheet. */
export function isMapControlCovered(control: ControlRect, sheet: ControlRect): boolean {
  return control.width > 0 && control.height > 0
    && control.left < sheet.right && control.right > sheet.left
    && control.top < sheet.bottom && control.bottom > sheet.top
}

export function isMapControlWithin(control: ControlRect, visibleBounds: ControlRect): boolean {
  return control.width > 0 && control.height > 0
    && control.left >= visibleBounds.left && control.right <= visibleBounds.right
    && control.top >= visibleBounds.top && control.bottom <= visibleBounds.bottom
}
