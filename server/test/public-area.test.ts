import assert from 'node:assert/strict'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import test from 'node:test'
import { readPublicArea } from '../src/public-catalog-http'

const geometry = { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] }
const base = { label: '東京（架空デモ地域）', marker: { latitude: 35.5, longitude: 139.5 },
  publicGeometryJson: JSON.stringify(geometry) }

function row(fields: Record<string, unknown>): DocumentSnapshot {
  return { id: 'demo-area-tokyo', get: (name: string) => fields[name] } as unknown as DocumentSnapshot
}

test('readPublicArea exposes a stored prefecture code', () => {
  assert.equal(readPublicArea(row({ ...base, prefectureCode: '13' }), 1).prefectureCode, '13')
})

test('readPublicArea treats a missing or invalid stored code as unclassified', () => {
  assert.equal(readPublicArea(row(base), 1).prefectureCode, undefined)
  assert.equal(readPublicArea(row({ ...base, prefectureCode: '99' }), 1).prefectureCode, undefined)
  assert.equal(readPublicArea(row({ ...base, prefectureCode: 13 }), 1).prefectureCode, undefined)
})
