import { Alert, Badge, Button, SurfaceDialog } from './components/ui/primitives'
import { useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
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
const tones = { match: 'positive', value_mismatch: 'danger', scope_mismatch: 'warning', insufficient: 'neutral' } as const
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
    <Button variant="outline" size="sm" type="button" className="chat-verify-button" ref={trigger} aria-haspopup="dialog"
      onClick={() => { setOpen(true); if (!pending) void verify() }}>
      <ShieldCheck size={15} aria-hidden="true" />
      {dashboard ? 'Kiểm chứng KPI' : 'Kiểm chứng'}
    </Button>
    {result && <Badge tone={tones[result.status]}>{shortLabels[result.status]}</Badge>}
    {open && <SurfaceDialog sheet className="verification-sheet" returnFocus={trigger}
      title={dashboard ? 'Kiểm chứng KPI hiện tại' : 'Kiểm chứng câu trả lời'} onClose={() => setOpen(false)}>
        <div className="verification-body">
          <div role="status">
            {pending && <p>Đang tính lại từ dữ liệu…</p>}
            {error && <Alert tone="danger">{error}</Alert>}
            {result && <Alert tone={tones[result.status]}><strong>{labels[result.status]}</strong><p>{result.reason}</p></Alert>}
          </div>
          {error && <Button variant="outline" type="button" className="secondary-button" onClick={verify}>Thử lại</Button>}
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
    </SurfaceDialog>}
  </div>
}
