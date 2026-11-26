import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, ChartColumn, Database, LayoutDashboard, MessageSquare, PanelRight, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { api } from './api'
import type { Chart, Dashboard, Dataset, Conversation, ConversationDetail, ChatResponse } from './api'
import { Empty, SectionTitle } from './ui'
import { ChatResult } from './chat-result'
import { ChatDashboardPanel } from './chat-dashboard'
import { ExplorationReportDialog } from './exploration'

type Done = (message: string) => void
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Thao tác không thành công'

export const analysisPrompts = [
  { label: 'Khám phá chất lượng dữ liệu', question: 'Dataset này có bao nhiêu dòng, cột và giá trị thiếu?', icon: Database },
  { label: 'Tìm xu hướng và bất thường', question: 'Phát hiện xu hướng và bất thường từ dataset.', icon: ChartColumn },
  { label: 'Tạo dashboard tổng quan', question: 'Tạo dashboard tổng quan từ dataset.', icon: LayoutDashboard },
]

export function ChatPage({ datasets, charts, dashboards, canEdit, done, initialDraft = '' }: {
  datasets: Dataset[]; charts: Chart[]; dashboards: Dashboard[]; canEdit: boolean; done: Done; initialDraft?: string
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConv, setSelectedConv] = useState<ConversationDetail | null>(null)
  const [datasetId, setDatasetId] = useState('')
  const [message, setMessage] = useState(initialDraft)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [dashboardId, setDashboardId] = useState<string | null>(null)
  const [reportDatasetId, setReportDatasetId] = useState<string | null>(null)
  const [dashboardVersions, setDashboardVersions] = useState<Record<string, number>>({})
  const dashboardTrigger = useRef<HTMLElement>(null)
  const messagesList = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const leaveDashboard = useRef<(() => boolean) | null>(null)

  function openDashboard(id: string, trigger: HTMLElement) {
    if (dashboardId === id || leaveDashboard.current?.() === false) return
    dashboardTrigger.current = trigger
    setDashboardId(id)
  }

  function closeDashboard() {
    if (leaveDashboard.current?.() === false) return
    setDashboardId(null)
    const trigger = dashboardTrigger.current
    requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus() })
  }

  useEffect(() => {
    if (datasets.length && !datasetId) setDatasetId(datasets[0].id)
  }, [datasets, datasetId])

  useEffect(() => {
    loadConversations()
  }, [])

  useEffect(() => {
    if (busy && messagesList.current) messagesList.current.scrollTop = messagesList.current.scrollHeight
  }, [busy, selectedConv?.messages.length])

  async function loadConversations() {
    try {
      const convs = await api<Conversation[]>('/chat/conversations')
      setConversations(convs)
    } catch (e) {
      setStatus(errorText(e))
    }
  }

  function startNewDraft() {
    if (leaveDashboard.current?.() === false) return
    setSelectedConv(null)
    setDashboardId(null)
    setStatus('')
    fillDraft('')
  }

  function fillDraft(text: string) {
    setMessage(text)
    input.current?.focus()
  }

  async function openConversation(id: string) {
    if (selectedConv?.id !== id && leaveDashboard.current?.() === false) return
    try {
      const conv = await api<ConversationDetail>(`/chat/conversations/${id}`)
      if (selectedConv?.id !== conv.id) {
        setDashboardId(null)
        setMessage('')
      }
      setSelectedConv(conv)
      setDatasetId(conv.dataset_id)
      setStatus('')
    } catch (e) {
      setStatus(errorText(e))
    }
  }

  async function deleteConversation(id: string) {
    if (selectedConv?.id === id && leaveDashboard.current?.() === false) return
    if (!confirm('Xóa cuộc hội thoại này?')) return
    try {
      await api(`/chat/conversations/${id}`, 'DELETE')
      if (selectedConv?.id === id) {
        setSelectedConv(null)
        setDashboardId(null)
      }
      await loadConversations()
      done('Đã xóa cuộc hội thoại.')
    } catch (e) {
      setStatus(errorText(e))
    }
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    void submitTurn(message.trim())
  }

  async function submitTurn(userMessage: string, suggestion?: { messageId: string; id: string }) {
    if (!datasetId || !userMessage || busy || !canEdit) return
    if (!selectedConv && leaveDashboard.current?.() === false) return

    setBusy(true)
    setStatus('')
    if (!suggestion) setMessage('')

    let conversation = selectedConv
    const tempId = 'temp-' + Date.now()
    try {
      if (!conversation) {
        const title = `Chat: ${selectedDataset?.name || 'Dataset'}`
        const { id } = await api<{ id: string }>('/chat/conversations', 'POST', { datasetId, title })
        const now = new Date().toISOString()
        setDashboardId(null)
        conversation = {
          id, title, dataset_id: datasetId, created_at: now, updated_at: now, messages: [],
        }
      }
      const conversationId = conversation.id
      setSelectedConv({
        ...conversation,
        messages: [...conversation.messages, {
          id: tempId, role: 'user', content: userMessage,
          metadata_json: '{}', created_at: new Date().toISOString(),
        }],
      })

      const response = suggestion
        ? await api<ChatResponse>(`/chat/conversations/${conversationId}/messages/${suggestion.messageId}/suggestions/${suggestion.id}`, 'POST')
        : await api<ChatResponse>('/chat/message', 'POST', { conversationId, message: userMessage })

      await openConversation(conversationId)
      await loadConversations()
      if (response.dashboard_id) {
        const updated = response.dashboard_id
        setDashboardVersions(versions => ({ ...versions, [updated]: (versions[updated] ?? 0) + 1 }))
        if (dashboardId && selectedConv) setDashboardId(updated)
        if (response.intent === 'create_dashboard') done('Đã tạo dashboard từ hội thoại.')
      }
    } catch (e) {
      setStatus(errorText(e))
      if (!suggestion) setMessage(draft => draft || userMessage)
      setSelectedConv(prev => prev ? {
        ...prev,
        messages: prev.messages.filter(m => m.id !== tempId)
      } : null)
      if (!selectedConv && conversation) await loadConversations()
    } finally {
      setBusy(false)
    }
  }

  const selectedDataset = datasets.find(d => d.id === datasetId)
  const showSidebar = !sidebarHidden && !dashboardId
  const layoutClass = dashboardId ? ' with-dashboard' : sidebarHidden ? ' without-sidebar' : ''

  return (
    <div className={'two-column wide-left chat-layout analysis-workspace' + layoutClass}>
      <section className="chat-main" aria-labelledby="chat-page-title">
        <header className="analysis-toolbar">
          <h1 id="chat-page-title"><Sparkles size={19} aria-hidden="true" /> Chat AI</h1>
          <div className="analysis-toolbar-actions">
            {selectedConv && canEdit && <button className="secondary-button" disabled={busy} onClick={startNewDraft}>
              <Plus size={15} aria-hidden="true" /> Hội thoại mới
            </button>}
            {!dashboardId && <button className="analysis-icon-button" aria-label={sidebarHidden ? 'Hiện lịch sử hội thoại' : 'Ẩn lịch sử hội thoại'}
              title={sidebarHidden ? 'Hiện lịch sử hội thoại' : 'Ẩn lịch sử hội thoại'} aria-expanded={!sidebarHidden} aria-controls={showSidebar ? 'chat-history' : undefined}
              onClick={() => setSidebarHidden(!sidebarHidden)}><PanelRight size={18} aria-hidden="true" /></button>}
          </div>
        </header>
        <div className="analysis-sources">
          {!selectedConv && <label className="analysis-picker">Dataset
            <select value={datasetId} disabled={busy} onChange={e => setDatasetId(e.target.value)}>
              <option value="">Chọn dataset</option>
              {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>}
          <button className="secondary-button analysis-explore" disabled={!datasetId || busy} onClick={() => setReportDatasetId(datasetId)}>
            <Database size={15} aria-hidden="true" /> Khám phá dataset
          </button>
          {dashboards.length > 0 && <label className="chat-dashboard-picker analysis-picker">Dashboard đã lưu
          <select value={dashboardId && dashboards.some(dashboard => dashboard.id === dashboardId) ? dashboardId : ''}
            onChange={event => {
              if (event.target.value) openDashboard(event.target.value, event.currentTarget)
              else closeDashboard()
            }}>
            <option value="">Chọn dashboard đã lưu</option>
            {dashboards.map(dashboard => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
          </select>
          </label>}
        </div>

        {selectedConv && <div className="chat-header">
              <div>
                <strong>{selectedConv.title || 'Cuộc hội thoại'}</strong>
                <small>Dataset: {selectedDataset?.name || 'N/A'}</small>
              </div>
              {canEdit && <button
                className="analysis-icon-button danger"
                disabled={busy || !canEdit}
                onClick={() => deleteConversation(selectedConv.id)}
                title="Xóa cuộc hội thoại" aria-label="Xóa cuộc hội thoại"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>}
            </div>}

            <div className={`chat-messages${!selectedConv?.messages.length ? ' is-empty' : ''}`} ref={messagesList} aria-label="Tin nhắn">
              {!selectedConv?.messages.length ? (
                <div className="chat-welcome">
                  <span className="analysis-welcome-mark" aria-hidden="true"><Sparkles size={27} strokeWidth={1.7} /></span>
                  <h2>{canEdit ? 'Bạn muốn phân tích gì?' : 'Xem dữ liệu trong Chat'}</h2>
                  <p>{canEdit
                    ? datasetId ? 'Hỏi về dataset đang chọn hoặc bắt đầu với một gợi ý.' : 'Thêm một dataset để bắt đầu phân tích.'
                    : 'Chọn một dashboard đã lưu hoặc mở báo cáo khám phá dataset.'}</p>
                  {canEdit && <div className="analysis-prompts">
                    {analysisPrompts.map(({ label, question, icon: Icon }) => <button key={label} disabled={!datasetId || busy} onClick={() => fillDraft(question)}>
                      <Icon size={17} aria-hidden="true" /><span>{label}</span><ArrowUpRight size={15} aria-hidden="true" />
                    </button>)}
                  </div>}
                </div>
              ) : (
                selectedConv.messages.map(msg => (
                  <div key={msg.id} className={`chat-message ${msg.role}`}>
                    <div className="message-header">
                      {msg.role === 'assistant' && <span className="analysis-author"><Sparkles size={14} aria-hidden="true" /> Pythera</span>}
                      <small>{new Date(msg.created_at).toLocaleTimeString('vi-VN')}</small>
                    </div>
                    {msg.role === 'assistant' ? <ChatResult content={msg.content} metadataJson={msg.metadata_json}
                      datasetId={selectedConv.dataset_id} datasets={datasets} onOpenReport={setReportDatasetId}
                      verification={canEdit ? { conversationId: selectedConv.id, messageId: msg.id } : undefined}
                      onSuggestion={canEdit ? action => void submitTurn(action.label, { messageId: msg.id, id: action.id }) : undefined}
                      pending={busy}
                      openDashboard={openDashboard} dashboardVersions={dashboardVersions} />
                      : <div className="message-content">{msg.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>}
                  </div>
                ))
              )}
              {busy && (
                <div className="chat-message assistant" role="status">
                  <div className="message-content">
                    <p className="muted">Đang phân tích...</p>
                  </div>
                </div>
              )}
            </div>

            {status && <p className="inline-status analysis-status" role="status">{status}</p>}
            {canEdit && <form className="chat-input-form" onSubmit={sendMessage}>
              <textarea
                ref={input}
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
                  e.preventDefault()
                  void submitTurn(message.trim())
                }}
                placeholder="Hỏi về dữ liệu…"
                aria-label="Câu hỏi dữ liệu"
                rows={1}
                maxLength={4000}
                disabled={busy || !datasetId}
              />
              <button type="submit" className="primary-button" aria-label="Gửi câu hỏi" title="Gửi câu hỏi" disabled={!datasetId || !message.trim() || busy}>
                <ArrowUp size={20} aria-hidden="true" />
              </button>
            </form>}
      </section>

      {reportDatasetId && <ExplorationReportDialog datasetId={reportDatasetId} onClose={() => setReportDatasetId(null)} />}
      {dashboardId && <ChatDashboardPanel key={`${dashboardId}:${dashboardVersions[dashboardId] ?? 0}`} id={dashboardId} datasets={datasets} charts={charts}
        onClose={closeDashboard} onDeleted={() => setDashboardId(null)} leaveGuard={leaveDashboard} done={message => {
          setDashboardVersions(versions => ({ ...versions, [dashboardId]: (versions[dashboardId] ?? 0) + 1 }))
          done(message)
        }} />}

      {showSidebar && (
        <aside className="chat-conversations-sidebar" id="chat-history" aria-label="Lịch sử hội thoại">
          <div className="panel-head">
            <SectionTitle label="Lịch sử hội thoại" />
            <button className="analysis-icon-button" onClick={loadConversations} aria-label="Tải lại lịch sử" title="Tải lại lịch sử">
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>

        <div className="chat-conversations-list">
          {conversations.length ? (
            conversations.map(conv => (
              <button
                key={conv.id}
                disabled={busy}
                aria-current={selectedConv?.id === conv.id ? 'true' : undefined}
                className={`list-row clickable full-row ${selectedConv?.id === conv.id ? 'active' : ''}`}
                onClick={() => openConversation(conv.id)}
              >
                <MessageSquare size={16} strokeWidth={1.7} aria-hidden="true" />
                <span>
                  <strong>{conv.title}</strong>
                  <small>
                    {conv.dataset_name} · {conv.message_count} tin nhắn
                  </small>
                </span>
              </button>
            ))
          ) : (
            <Empty title="Chưa có cuộc hội thoại" text="Tạo cuộc hội thoại đầu tiên để bắt đầu." />
          )}
        </div>
        </aside>
      )}
    </div>
  )
}
