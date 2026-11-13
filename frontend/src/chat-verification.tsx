import { useEffect, useId, useRef, useState } from 'react'
import { api } from './api'
import { formatChatNumber } from './chat-result-model'

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
const shortLabels = {
  match: 'Đã kiểm chứng',
  value_mismatch: 'Sai số liệu',
  scope_mismatch: 'Sai phạm vi',
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

export function ChatVerification({ conversationId, messageId, dashboard }: {
  conversationId: string; messageId: string; dashboard: boolean
}) {
  const [result, setResult] = useState<Verification | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const dialog = panel.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [open])

  function closePanel() {
    panel.current?.close()
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

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

  return <div className="chat-verification-action">
    <button type="button" className="chat-verify-button" ref={trigger} aria-haspopup="dialog"
      onClick={() => { setOpen(true); if (!pending) void verify() }}>
      {dashboard ? 'Kiểm chứng KPI' : 'Kiểm chứng'}
    </button>
    {result && <span className={`chat-verify-status ${result.status}`}>{shortLabels[result.status]}</span>}
    {open && <dialog ref={panel} className="chat-verification-panel" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); closePanel() }}
      onClick={event => { if (event.target === event.currentTarget) closePanel() }}>
      <div className="chat-verification-panel-inner">
        <header className="chat-verification-panel-header">
          <h2 id={titleId}>{dashboard ? 'Kiểm chứng KPI hiện tại' : 'Kiểm chứng câu trả lời'}</h2>
          <button type="button" className="text-link" onClick={closePanel}>Đóng</button>
        </header>
        <div className="chat-verification-panel-body">
          <div role="status">
            {pending && <p>Đang tính lại từ dữ liệu…</p>}
            {error && <p className="chat-result-warning">{error}</p>}
            {result && <>
              <span className={`chat-verify-status ${result.status}`}>{labels[result.status]}</span>
              <p className="chat-verify-reason">{result.reason}</p>
            </>}
          </div>
          {error && <button type="button" className="secondary-button" onClick={verify}>Thử lại</button>}
          {result && <>
            {result.dataset && <p className="chat-verify-source">Dữ liệu · {result.dataset}</p>}
            {(result.answerValue !== null || result.computedValue !== null) && <dl className="chat-verify-values">
              <div><dt>{dashboard ? 'KPI hiện tại' : 'Số đã trả'}</dt><dd>{formatChatNumber(result.answerValue)}</dd></div>
              <div><dt>Tính lại từ dữ liệu</dt><dd>{formatChatNumber(result.computedValue)}</dd>
                {result.matchingRows !== null && <small>{result.matchingRows.toLocaleString('vi-VN')} dòng phù hợp</small>}</div>
            </dl>}
            {(result.expected || result.actual) && <dl className="chat-verify-scopes">
              {result.expected && <div><dt>Phạm vi yêu cầu</dt><dd>{scopeText(result.expected)}</dd></div>}
              {result.actual && <div><dt>Phạm vi đã dùng</dt><dd>{scopeText(result.actual)}</dd></div>}
            </dl>}
          </>}
        </div>
      </div>
    </dialog>}
  </div>
}
