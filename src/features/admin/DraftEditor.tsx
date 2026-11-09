import { useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ManagedQuestDraft } from '../../shared/api'

export type DraftFields = ManagedQuestDraft['content']

type Props = {
  draft: DraftFields
  setDraft: Dispatch<SetStateAction<DraftFields>>
  materialChanged: boolean
  sampleConfirm: boolean
  setSampleConfirm: (value: boolean) => void
  onBack: () => void
  onPreview: () => void
  omitMemo?: boolean
  allowSample?: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
}

const sample: DraftFields = {
  title: '青葉みらい市の風見の丘',
  question: '青葉みらい市の架空の丘にある、小さな風車が並ぶ場所を探してください。',
  hints: ['市の中心部から見える、緑の丘を目指しましょう。', '丘の上には風を受けて回るものが並んでいます。', '風車が並ぶ場所が目的地です。'],
  verifiedFeatures: '丘の上に小型風車が並ぶ（このサンプル内の架空設定）',
  draftingNotes: '架空サンプルの例文。現地確認や事実確認を行った内容ではありません。',
}

export default function DraftEditor({ draft, setDraft, materialChanged, sampleConfirm, setSampleConfirm, onBack, onPreview, headingRef, omitMemo = false, allowSample = true }: Props) {
  const edited = Object.values(draft).some(value => Array.isArray(value) ? value.some(item => item !== '') : value !== '')
  const filledHints = draft.hints.filter(hint => hint.trim()).length
  const [revealedHints, setRevealedHints] = useState(1)
  const visibleHints = Math.max(revealedHints, Math.min(3, filledHints + 1))
  const [featureLine, setFeatureLine] = useState('')
  function loadSample() {
    setDraft(omitMemo ? { ...sample, draftingNotes: draft.draftingNotes } : sample)
    setSampleConfirm(false)
  }
  function addFeatureLine() {
    const line = featureLine.trim()
    if (!line) return
    setDraft(current => ({ ...current, verifiedFeatures: current.verifiedFeatures.trim() ? `${current.verifiedFeatures.replace(/\s+$/, '')}\n${line}` : line }))
    setFeatureLine('')
  }

  return <section className="form-section draft-editor" aria-labelledby="draft-heading">
    <h2 id="draft-heading" ref={headingRef} tabIndex={-1}>2/3 問題の文章（AIはまだ使えません）</h2>
    <p className="demo-notice" role="note">対象名や写真の情報は、旅行者向けの文章には入りません。</p>
    {materialChanged && <p className="field-error" role="status">素材が変更されています。下書きを確認してください。</p>}
    <p className="helper">ヒント画像は、参考写真から自動流用しません。</p>
    {allowSample && <div className="sample-actions">
      <button type="button" onClick={() => edited ? setSampleConfirm(true) : loadSample()}>架空サンプルを読み込む（AI未使用）</button>
      {sampleConfirm && <div className="confirm-inline" role="group" aria-label="サンプル置換の確認"><p>現在の下書きを架空サンプルで置き換えますか？</p><button type="button" onClick={() => setSampleConfirm(false)}>キャンセル</button><button type="button" onClick={loadSample}>置き換える</button></div>}
    </div>}
    <p className="helper">旅行者に公開する文章。タイトル・問題文・ヒント3つは確認依頼までに必要です。</p><label>問題タイトル<input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></label>
    <label>問題文<textarea rows={4} value={draft.question} onChange={event => setDraft(current => ({ ...current, question: event.target.value }))} /></label>
    <fieldset><legend>段階ヒント（3段階）</legend>
      {draft.hints.slice(0, visibleHints).map((hint, index) => <label key={index}>ヒント {index + 1}<textarea rows={2} value={hint} onChange={event => setDraft(current => ({ ...current, hints: current.hints.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as DraftFields['hints'] }))} /></label>)}
      <p className="helper">ヒントは {filledHints}/3 入力済みです。</p>
      {visibleHints < 3 && <button type="button" onClick={() => setRevealedHints(visibleHints + 1)}>次のヒントを書く</button>}
    </fieldset>
    <p className="helper">非公開。確認依頼までに必須です（今は空欄可）。</p><label>現地で確かめた見た目の特徴<textarea rows={3} value={draft.verifiedFeatures} onChange={event => setDraft(current => ({ ...current, verifiedFeatures: event.target.value }))} /></label>
    <div className="feature-line-builder">
      <label>特徴を1行で追加<input value={featureLine} onChange={event => setFeatureLine(event.target.value)} placeholder="例：赤い三角屋根がある" /></label>
      <button type="button" disabled={!featureLine.trim()} onClick={addFeatureLine}>特徴を追加</button>
    </div>
    {!omitMemo && <label>下書きの根拠・人のメモ<textarea rows={3} value={draft.draftingNotes} onChange={event => setDraft(current => ({ ...current, draftingNotes: event.target.value }))} /></label>}
    <button className="submit-button" type="button" onClick={onPreview}>表示プレビューへ</button>
    <button type="button" onClick={onBack}>素材・場所へ戻る</button>
  </section>
}
