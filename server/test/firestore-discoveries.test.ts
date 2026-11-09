import assert from 'node:assert/strict'
import test from 'node:test'
import { Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { FirestoreDiscoveryStore } from '../src/firestore-discoveries'

// 本人の記録一覧は、複合インデックスが無い DB でも読めなければならない（D-57）。
// このフェイクは orderBy / startAfter / limit を実装しないため、listOwned が
// それらに頼る実装へ戻ると呼び出し時点で落ちて回帰に気づける。
type FakeDoc = { id: string; data: Record<string, unknown> }

class FakeQuery {
  constructor(private readonly docs: FakeDoc[], private readonly filters: [string, unknown][] = []) {}
  where(field: string, _op: string, value: unknown) {
    return new FakeQuery(this.docs, [...this.filters, [field, value]])
  }
  select() { return this }
  async get() {
    const matched = this.docs.filter((doc) => this.filters.every(([field, value]) => doc.data[field] === value))
    return { docs: matched.map((doc) => ({ id: doc.id, data: () => doc.data })), size: matched.length }
  }
}

function fakeDb(docs: FakeDoc[]): Firestore {
  return { collection: () => new FakeQuery(docs) } as unknown as Firestore
}

function record(id: string, uid: string, seconds: number, nanoseconds = 0, areaId = 'area-1'): FakeDoc {
  return { id, data: { uid, discoveryId: id, areaId, placeId: 'place-1', questId: 'quest-1', questVersion: 1,
    firstClearedAt: new Timestamp(seconds, nanoseconds), placeName: '場所' + id,
    descriptionSnapshot: '', revealedLocation: { latitude: 35, longitude: 139 } } }
}

const photos = { readRecord: async () => { throw new Error('unused') }, deleteRecord: async () => { throw new Error('unused') } }

test('listOwned は複合インデックスなしで本人の記録を新しい順に返す', async () => {
  const store = new FirestoreDiscoveryStore(fakeDb([
    record('disc-b', 'user-1', 200),
    record('disc-a', 'user-1', 300),
    record('disc-c', 'user-1', 300),
    record('disc-z', 'user-2', 400),
  ]), photos)
  const page = await store.listOwned('user-1', {})
  // 同日時はドキュメントIDの降順（従来の orderBy と同じ並び）。
  assert.deepEqual(page.items.map((item) => item.discoveryId), ['disc-c', 'disc-a', 'disc-b'])
  assert.equal(page.nextCursor, null)
})

test('listOwned はカーソルで続きを返し、地域でも絞れる', async () => {
  const store = new FirestoreDiscoveryStore(fakeDb([
    record('disc-a', 'user-1', 300, 0, 'area-1'),
    record('disc-b', 'user-1', 200, 0, 'area-2'),
    record('disc-c', 'user-1', 100, 0, 'area-1'),
  ]), photos)
  const first = await store.listOwned('user-1', { limit: 2 })
  assert.deepEqual(first.items.map((item) => item.discoveryId), ['disc-a', 'disc-b'])
  assert.ok(first.nextCursor)
  const rest = await store.listOwned('user-1', { limit: 2, cursor: first.nextCursor! })
  assert.deepEqual(rest.items.map((item) => item.discoveryId), ['disc-c'])
  assert.equal(rest.nextCursor, null)
  const area = await store.listOwned('user-1', { areaId: 'area-1' })
  assert.deepEqual(area.items.map((item) => item.discoveryId), ['disc-a', 'disc-c'])
})

test('listOwned は該当0件でもカーソルの本人・地域と形式を検証する', async () => {
  const store = new FirestoreDiscoveryStore(fakeDb([
    record('disc-a', 'user-1', 300), record('disc-b', 'user-1', 200),
  ]), photos)
  const first = await store.listOwned('user-1', { areaId: 'area-1', limit: 1 })
  assert.ok(first.nextCursor)
  for (const [uid, areaId] of [['user-1', 'different-area'], ['other-owner', 'area-1']]) {
    assert.deepEqual(await store.listOwned(uid, { areaId }), { items: [], nextCursor: null })
    await assert.rejects(store.listOwned(uid, { areaId, cursor: first.nextCursor }), { code: 'INVALID_INPUT' })
    await assert.rejects(store.listOwned(uid, { areaId, cursor: 'malformed' }), { code: 'INVALID_INPUT' })
  }
  const empty = new FirestoreDiscoveryStore(fakeDb([]), photos)
  assert.deepEqual(await empty.listOwned('user-1', { areaId: 'area-1', cursor: first.nextCursor }),
    { items: [], nextCursor: null })
  const invalidPosition = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString())
  invalidPosition.after = 'invalid-position'
  await assert.rejects(empty.listOwned('user-1', { areaId: 'area-1',
    cursor: Buffer.from(JSON.stringify(invalidPosition)).toString('base64url') }), { code: 'INVALID_INPUT' })
})
