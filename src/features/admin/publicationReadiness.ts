import type { ManagedQuest } from '../../shared/api'

// Mirrors the saved-data checks of server/src/admin-review.ts
// (missingReviewFields), minus the parts only the server can know:
// whether a registered asset still exists. Photo-test results are kept
// only in the publication screen's state, so they are never reported
// here as done or missing.
function hasValidFeatures(value: string): boolean {
  const features = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return features.length >= 1 && features.length <= 20 && features.every((line) => line.length <= 300)
}

export function remainingWork(quest: ManagedQuest): string[] {
  if (quest.status === 'published') return []
  const { materials, content, referenceAssetId } = quest.draft
  const items: string[] = []
  if (!materials.name.trim()) items.push('対象名')
  if (!materials.photoRights.trim()) items.push('写真の利用権')
  if (!referenceAssetId) items.push('参考写真')
  if (quest.shootingAreaStatus !== 'configured') items.push('撮影できる範囲（非公開）')
  if (!content.title.trim()) items.push('問題タイトル')
  if (!content.question.trim()) items.push('問題文')
  if (content.hints.some((hint) => !hint.trim())) items.push('3本のヒント')
  if (!hasValidFeatures(content.verifiedFeatures)) items.push('現地で確かめた見た目の特徴')
  if (quest.status === 'draft') items.push('確認依頼')
  else if (quest.status === 'review_pending') items.push('公開担当の確認と公開')
  else if (quest.status === 'paused') items.push('再公開の確認依頼と公開担当の確認')
  return items
}
