import { useState } from 'react'
import { api } from './api'

type Filter = { column: string; operator: string; value: string | number | boolean | null }
type Scope = { column: string; aggregate: string; filters: Filter[] }
type Verification = {
  status: 'match' | 'value_mismatch' | 'scope_mismatch' | 'insufficient'
  reason: string
  dataset: string | null
  expected: Scope | null
  actual: Scope | null
  answerValue: string | null
  computedValue: string | null
  matchingRows: number | null
}

const labels = {
  match: 'Khớp',
  value_mismatch: 'Không khớp số liệu',
  scope_mismatch: 'Không khớp phạm vi',
  insufficient: 'Chưa đủ căn cứ',
}
const aggregates: Record<string, string> = { sum: 'Tổng', avg: 'Trung bình', count: 'Đếm' }
const operators: Record<string, string> = { eq: '=', gte: '≥', gt: '>', lte: '≤', lt: '<', ne: '≠', is_null: 'là NULL', is_not_null: 'khác NULL' }

function scopeText(scope: Scope) {
  const metric = (aggregates[scope.aggregate] || scope.aggregate) + ' ' + (scope.column === '*' ? 'số dòng' : scope.column)
  return [metric, ...scope.filters.map(filter =>
    [filter.column, operators[filter.operator] || filter.operator, filter.value].filter(value => value !== null).join(' '),
  )].join(' · ')
}

function numberText(value: string | null) {
  if (value === null) return '—'
  const [integer, fraction] = value.split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction ? ',' + fraction : '')
}

export function ChatVerification({ conversationId, messageId, dashboard }: {
  conversationId: string; messageId: string; dashboard: boolean
}) {
  const [result, setResult] = useState<Verification | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function verify() {
    setPending(true)
    setError('')
    setResult(null)
    try {
      setResult(await api<Verification>('/chat/conversations/' + conversationId + '/messages/' + messageId + '/verification', 'POST'))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Không thể kiểm tra câu trả lời.')
    } finally {
      setPending(false)
    }
  }

  return <div className="chat-result-section">
    <button type="button" className="secondary-button" disabled={pending} onClick={verify}>
      {pending ? 'Đang kiểm tra…' : dashboard ? 'Kiểm tra KPI hiện tại' : 'Kiểm tra câu trả lời'}
    </button>
    <div aria-live="polite" aria-atomic="true">
      {error && <p className="chat-result-warning">{error}</p>}
      {result && <div className="chat-result-section">
        <p><strong>{labels[result.status]}</strong> · {result.reason}</p>
        {result.expected && result.actual && <dl className="chat-result-facts">
          <div><dt>Phạm vi yêu cầu</dt><dd>{scopeText(result.expected)}</dd></div>
          <div><dt>Phạm vi đã dùng</dt><dd>{scopeText(result.actual)}</dd></div>
          <div><dt>{dashboard ? 'KPI hiện tại' : 'Số đã trả'}</dt><dd>{numberText(result.answerValue)}</dd></div>
          <div><dt>Tính lại từ {result.dataset}</dt><dd>{numberText(result.computedValue)}
            {result.matchingRows !== null && <small> từ {result.matchingRows.toLocaleString('vi-VN')} dòng</small>}</dd></div>
        </dl>}
      </div>}
    </div>
  </div>
}
