import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
const FOLLOW_RULE = '.map-preview-shell.has-sheet .map-controls'

// CSS の実測は jsdom ではできないため、規則の置き場所（構造）で担保する。
// 右下の地図操作系がシートの高さに追随するのは、シートが横幅いっぱいに広がる幅だけに限る。
// 広い幅ではシートは左下の浮きカードであり、右側の操作系は通常位置に固定する。
describe('map controls placement with the bottom sheet', () => {
  it('follows the sheet height only in the full-width sheet range', () => {
    expect(css.split(FOLLOW_RULE).length - 1).toBe(1)
    const mediaAt = css.indexOf('@media (max-width: 640px)')
    expect(mediaAt).toBeGreaterThan(-1)
    expect(css.indexOf(FOLLOW_RULE)).toBeGreaterThan(mediaAt)
  })

  it('keeps the wide-layout controls at their fixed bottom position', () => {
    expect(css).toContain('.map-controls { position: absolute; right: 17px; bottom: 52px;')
  })
})
