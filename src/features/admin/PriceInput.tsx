import { normalizePrice } from '../../shared/api/admin'
import { useEffect, useId } from 'react'
const kinds = ['無料', '有料', '未確認'] as const
function split(value: string) {
  for (const kind of kinds) {
    if (value === kind) return { kind, detail: '' }
    if (value.startsWith(kind + '：')) return { kind, detail: value.slice(kind.length + 1) }
  }
  return { kind: '', detail: value }
}

const paidHeads = /^(大人|子供|子ども)?\s*([+-]?\d[\d,.eE+-]*)\s*円\s*(?:[／/]([\s\S]*))?$/
function parsePaidDetail(detail: string) {
  const match = paidHeads.exec(detail.trim())
  if (match) return { target: match[1] ?? '', amount: match[2].replace(/,/g, ''), note: match[3] ?? '' }
  return { target: '', amount: '', note: detail }
}
function composePaidDetail(target: string, amount: string, note: string) {
  const head = amount ? `${target}${amount}円` : ''
  return [head, note].filter(Boolean).join('／')
}

export function PriceInput({ value, onChange, onError }: { value: string; onChange: (value: string) => void; onError?: (error: string) => void }) {
  const parsed = split(normalizePrice(value))
  const paid = parsed.kind === '有料' ? parsePaidDetail(parsed.detail) : null
  const errorId = useId()
  const error = paid?.amount && !/^\d+$/.test(paid.amount) ? '金額は0以上の整数' : ''
  useEffect(() => { onError?.(error) }, [error, onError])
  function setKind(kind: string) {
    onChange(normalizePrice(kind ? kind + (parsed.detail ? '：' + parsed.detail : '') : parsed.detail))
  }
  function setDetail(detail: string) {
    onChange(parsed.kind ? parsed.kind + (detail ? '：' + detail : '') : detail)
  }
  return <div>
    <label>料金の区分<select value={parsed.kind} onChange={event => setKind(event.target.value)}>
      <option value="">未設定・自由文</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
    {parsed.kind === '' && <label>料金<input value={value} onChange={event => onChange(event.target.value)} placeholder="例：大人500円／無料／要確認" /></label>}
    {paid && <>
      <label>料金・円<input aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} type="number" min="0" step="1" inputMode="numeric" value={paid.amount}
        onChange={event => setDetail(composePaidDetail(paid.target, event.target.value, paid.note))} /></label>
      {error && <p id={errorId} role="alert" className="field-error">{error}</p>}
      <label>金額の対象<select value={paid.target} onChange={event => setDetail(composePaidDetail(event.target.value, paid.amount, paid.note))}>
        <option value="">一律</option><option value="大人">大人</option><option value="子供">子供</option></select></label>
      <label>料金の補足<input value={paid.note} onChange={event => setDetail(composePaidDetail(paid.target, paid.amount, event.target.value))} placeholder="例：子供200円、特別展は別途" /></label>
    </>}
    {parsed.kind === '未確認' && <details>
      <summary>補足</summary>
      <label>料金の補足<input value={parsed.detail} onChange={event => setDetail(event.target.value)} placeholder="例：施設により異なります" /></label>
    </details>}

  </div>
}
