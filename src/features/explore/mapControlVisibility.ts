export type ControlRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>

/** Only fully covered controls need disabling; the opaque sheet intercepts hidden hit targets. */
export function isMapControlFullyCovered(control: ControlRect, sheet: ControlRect): boolean {
  return control.width > 0 && control.height > 0
    && control.left >= sheet.left && control.right <= sheet.right
    && control.top >= sheet.top && control.bottom <= sheet.bottom
}

export function isMapControlWithin(control: ControlRect, visibleBounds: ControlRect): boolean {
  return control.width > 0 && control.height > 0
    && control.left >= visibleBounds.left && control.right <= visibleBounds.right
    && control.top >= visibleBounds.top && control.bottom <= visibleBounds.bottom
}
