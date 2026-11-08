const kinds = ['無料', '有料', '未確認'] as const
function split(value: string) {
  for (const kind of kinds) {
    if (value === kind) return { kind, detail: '' }
    if (value.startsWith(kind + '：')) return { kind, detail: value.slice(kind.length + 1) }
  }
  return { kind: '', detail: value }
}

const paidHeads = /^(大人|子供|子ども)?\s*(\d[\d,]*)\s*円\s*(?:[／/]([\s\S]*))?$/
function parsePaidDetail(detail: string) {
  const match = paidHeads.exec(detail.trim())
  if (match) return { target: match[1] ?? '', amount: match[2].replace(/,/g, ''), note: match[3] ?? '' }
  return { target: '', amount: '', note: detail }
}
function composePaidDetail(target: string, amount: string, note: string) {
  const head = amount ? `${target}${amount}円` : ''
  return [head, note].filter(Boolean).join('／')
}

/**
 * The persisted contract remains one optional string. The kind prefix and the
 * existing detail text are preserved; only the visible fields change by kind:
 * paid prices get amount/target inputs, free/unconfirmed collapse the detail
 * into an optional note, and unclassified values keep one free-text field.
 */
export function PriceInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parsed = split(value)
  const paid = parsed.kind === '有料' ? parsePaidDetail(parsed.detail) : null
  function setKind(kind: string) {
    onChange(kind ? kind + (parsed.detail ? '：' + parsed.detail : '') : parsed.detail)
  }
  function setDetail(detail: string) {
    onChange(parsed.kind ? parsed.kind + (detail ? '：' + detail : '') : detail)
  }
  return <div>
    <label>料金の区分<select value={parsed.kind} onChange={event => setKind(event.target.value)}>
      <option value="">未設定・自由文</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
    {parsed.kind === '' && <label>料金<input value={value} onChange={event => onChange(event.target.value)} placeholder="例：大人500円／無料／要確認" /></label>}
    {paid && <>
      <label>金額（円）<input type="number" min="0" step="1" inputMode="numeric" value={paid.amount}
        onChange={event => setDetail(composePaidDetail(paid.target, event.target.value, paid.note))} /></label>
      <label>金額の対象<select value={paid.target} onChange={event => setDetail(composePaidDetail(event.target.value, paid.amount, paid.note))}>
        <option value="">指定なし（一律）</option><option value="大人">大人</option><option value="子供">子供</option></select></label>
      <label>料金の補足<input value={paid.note} onChange={event => setDetail(composePaidDetail(paid.target, paid.amount, event.target.value))} placeholder="例：子供200円、特別展は別途" /></label>
    </>}
    {(parsed.kind === '無料' || parsed.kind === '未確認') && <details>
      <summary>料金の補足（任意）</summary>
      <label>料金の補足<input value={parsed.detail} onChange={event => setDetail(event.target.value)} placeholder="例：施設により異なります" /></label>
    </details>}
    <p className="helper">補足は区分を変えても保持されます。空欄は無料を意味しません。</p>
  </div>
}
