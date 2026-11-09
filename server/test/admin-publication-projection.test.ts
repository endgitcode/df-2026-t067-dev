import assert from 'node:assert/strict'
import test from 'node:test'
import type { ManagedQuest } from '../../src/shared/api/admin'
import { projectManagedQuest, publicHintImagesPath, publicHintImagePath } from '../src/admin-publication'

const base: ManagedQuest = {
  questId: 'quest-a', orgId: 'org-a', areaId: 'area-a', draftRevision: 2, publishedVersion: null,
  status: 'review_pending', shootingAreaStatus: 'configured', source: 'mock',
  draft: {
    materials: { name: '内部対象', evidence: '確認済み', price: '', photoNote: '', photoRights: '合成',
      requiresBoat: false, requiresPaidFacility: false },
    content: { title: '問題', question: '問題文', hints: ['ヒント1', 'ヒント2', 'ヒント3'],
      verifiedFeatures: '特徴', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
    referenceAssetId: 'reference-a', hintAssetId: 'legacy-hint',
  },
}

test('projects legacy hint into slot one without duplicating its standalone control', () => {
  const { quest } = projectManagedQuest(base, 4)
  assert.equal(quest.hintImages?.[0], publicHintImagesPath('quest-a', 1, 4))
  assert.equal(quest.hintImages?.[1], null)
  assert.equal(quest.optionalHintImage, undefined)
})

test('includes the quest number in the public projection only when assigned', () => {
  assert.equal(projectManagedQuest(base, 4, '40-01').quest.questNumber, '40-01')
  assert.equal(projectManagedQuest(base, 4).quest.questNumber, undefined)
})

test('preserves an independent legacy image when slot one has an explicitly different asset', () => {
  const { quest } = projectManagedQuest({ ...base, draft: { ...base.draft, hintAssetIds: ['new-hint', null, null] } }, 4)
  assert.equal(quest.hintImages?.[0], publicHintImagesPath('quest-a', 1, 4))
  assert.equal(quest.optionalHintImage, publicHintImagePath('quest-a', 4))
})


test('formats public conditions on separate lines without the paid category prefix', () => {
  const quest = { ...base, draft: { ...base.draft, materials: { ...base.draft.materials,
    requiresBoat: true, price: '有料：大人500円', photoNote: '足元に注意',
  } } }
  assert.equal(projectManagedQuest(quest, 4).quest.visitConditions,
    '船上・海上からの撮影が必要。\n料金：大人500円\n撮影の注意：足元に注意')
})

test('does not publish unconfirmed prices or their unverified details', () => {
  for (const price of ['', '未確認', ' 未確認：受付で確認 ']) {
    const quest = { ...base, draft: { ...base.draft, materials: { ...base.draft.materials, price } } }
    assert.equal(projectManagedQuest(quest, 4).quest.visitConditions, '')
  }
  const quest = { ...base, draft: { ...base.draft, materials: { ...base.draft.materials, price: '無料' } } }
  assert.equal(projectManagedQuest(quest, 4).quest.visitConditions, '料金：無料')
})
