import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { Chart, Dashboard, Dataset, Conversation, ConversationDetail, ChatResponse } from './api'
import { Empty, SectionTitle } from './ui'
import { ChatResult } from './chat-result'
import { ChatDashboardPanel } from './chat-dashboard'
import { ExplorationReportDialog } from './exploration'

type Done = (message: string) => void
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Thao tác không thành công'

export function ChatPage({ datasets, charts, dashboards, canEdit, done }: {
  datasets: Dataset[]; charts: Chart[]; dashboards: Dashboard[]; canEdit: boolean; done: Done
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConv, setSelectedConv] = useState<ConversationDetail | null>(null)
  const [datasetId, setDatasetId] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [dashboardId, setDashboardId] = useState<string | null>(null)
  const [reportDatasetId, setReportDatasetId] = useState<string | null>(null)
  const [dashboardVersions, setDashboardVersions] = useState<Record<string, number>>({})
  const dashboardTrigger = useRef<HTMLElement>(null)
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

  async function loadConversations() {
    try {
      const convs = await api<Conversation[]>('/chat/conversations')
      setConversations(convs)
    } catch (e) {
      setStatus(errorText(e))
    }
  }

  async function createConversation() {
    if (!datasetId || !canEdit || busy || leaveDashboard.current?.() === false) return
    try {
      const dataset = datasets.find(d => d.id === datasetId)
      const title = `Chat: ${dataset?.name || 'Dataset'}`
      const result = await api<{ id: string }>('/chat/conversations', 'POST', { datasetId, title })
      await loadConversations()
      await openConversation(result.id)
      done('Đã tạo cuộc hội thoại mới.')
    } catch (e) {
      setStatus(errorText(e))
    }
  }

  async function openConversation(id: string) {
    try {
      const conv = await api<ConversationDetail>(`/chat/conversations/${id}`)
      if (selectedConv?.id !== conv.id) setDashboardId(null)
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

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedConv || !message.trim() || busy || !canEdit) return

    setBusy(true)
    setStatus('')
    const userMessage = message.trim()
    setMessage('')

    // Optimistic update: show user message immediately
    const optimisticUserMsg = {
      id: 'temp-' + Date.now(),
      conversation_id: selectedConv.id,
      role: 'user' as const,
      content: userMessage,
      metadata_json: '{}',
      created_at: new Date().toISOString()
    }
    setSelectedConv(prev => prev ? {
      ...prev,
      messages: [...prev.messages, optimisticUserMsg]
    } : null)

    try {
      const response = await api<ChatResponse>('/chat/message', 'POST', {
        conversationId: selectedConv.id,
        message: userMessage
      })

      // Reload conversation to get updated messages
      await openConversation(selectedConv.id)
      await loadConversations() // Update list timestamps
      if (response.dashboard_id) done('Đã tạo dashboard từ hội thoại.')
    } catch (e) {
      setStatus(errorText(e))
      setMessage(userMessage) // Restore message on error
      // Remove optimistic message on error
      setSelectedConv(prev => prev ? {
        ...prev,
        messages: prev.messages.filter(m => m.id !== optimisticUserMsg.id)
      } : null)
    } finally {
      setBusy(false)
    }
  }

  const selectedDataset = datasets.find(d => d.id === datasetId)
  const showSidebar = !sidebarHidden && !dashboardId
  const layoutClass = dashboardId ? ' with-dashboard' : sidebarHidden ? ' without-sidebar' : ''

  return (
    <div className={'two-column wide-left chat-layout' + layoutClass}>
      <section className={`surface chat-main ${sidebarHidden && !dashboardId ? 'full-width' : ''}`}>
        <div className="panel-head">
          <SectionTitle label="Chat AI" />
          {selectedConv && <button className="text-link" disabled={busy} onClick={() => {
            if (leaveDashboard.current?.() === false) return
            setSelectedConv(null); setDashboardId(null); setStatus('')
          }}>Hội thoại mới</button>}
          {!dashboardId && <button className="text-link" onClick={() => setSidebarHidden(!sidebarHidden)}>
            {sidebarHidden ? '☰ Hiện danh sách' : '⇄ Ẩn danh sách'}
          </button>}
        </div>
        {dashboards.length > 0 && <label className="chat-dashboard-picker">Dashboard đã lưu
          <select value={dashboardId && dashboards.some(dashboard => dashboard.id === dashboardId) ? dashboardId : ''}
            onChange={event => {
              if (event.target.value) openDashboard(event.target.value, event.currentTarget)
              else closeDashboard()
            }}>
            <option value="">Chọn dashboard đã lưu</option>
            {dashboards.map(dashboard => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
          </select>
        </label>}

        {!selectedConv ? (
          <div className="chat-empty">
            <Empty
              title="Chưa chọn cuộc hội thoại"
              text="Chọn dataset và tạo cuộc hội thoại mới để bắt đầu hỏi đáp dữ liệu."
            />
            <div className="form-grid" style={{ maxWidth: '400px', margin: '2rem auto 0' }}>
              <label className="wide">
                Chọn dataset để phân tích
                <select value={datasetId} onChange={e => setDatasetId(e.target.value)}>
                  <option value="">Chọn dataset</option>
                  {datasets.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                disabled={!datasetId || !canEdit || busy}
                onClick={createConversation}
              >
                Tạo cuộc hội thoại mới
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <div>
                <strong>{selectedConv.title || 'Cuộc hội thoại'}</strong>
                <small>Dataset: {selectedDataset?.name || 'N/A'}</small>
              </div>
              <button
                className="text-link danger"
                disabled={busy || !canEdit}
                onClick={() => deleteConversation(selectedConv.id)}
                title="Xóa cuộc hội thoại"
              >
                Xóa
              </button>
            </div>

            <div className="chat-messages">
              {selectedConv.messages.length === 0 ? (
                <div className="chat-welcome">
                  <p>Xin chào! Tôi có thể giúp bạn phân tích dữ liệu từ dataset <strong>{selectedDataset?.name}</strong>.</p>
                  <p className="muted">Ví dụ: "Tổng doanh thu là bao nhiêu?" hoặc "Cho tôi xem doanh thu theo vùng"</p>
                </div>
              ) : (
                selectedConv.messages.map(msg => (
                  <div key={msg.id} className={`chat-message ${msg.role}`}>
                    <div className="message-header">
                      <small>{new Date(msg.created_at).toLocaleTimeString('vi-VN')}</small>
                    </div>
                    {msg.role === 'assistant' ? <ChatResult content={msg.content} metadataJson={msg.metadata_json}
                      datasetId={selectedConv.dataset_id} onOpenReport={setReportDatasetId}
                      openDashboard={openDashboard} dashboardVersions={dashboardVersions} />
                      : <div className="message-content">{msg.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>}
                  </div>
                ))
              )}
              {busy && (
                <div className="chat-message assistant">
                  <div className="message-content">
                    <p className="muted">Đang phân tích...</p>
                  </div>
                </div>
              )}
            </div>

            <form className="chat-input-form" onSubmit={sendMessage}>
              <input
                type="text"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Nhập câu hỏi về dữ liệu..."
                aria-label="Câu hỏi dữ liệu"
                maxLength={4000}
                disabled={busy || !canEdit}
              />
              <button type="submit" className="primary-button" disabled={!message.trim() || busy || !canEdit}>
                {busy ? 'Đang gửi...' : 'Gửi'}
              </button>
            </form>
          </>
        )}

        {status && <p className="inline-status">{status}</p>}
      </section>

      {reportDatasetId && <ExplorationReportDialog datasetId={reportDatasetId} onClose={() => setReportDatasetId(null)} />}
      {dashboardId && <ChatDashboardPanel key={dashboardId} id={dashboardId} datasets={datasets} charts={charts}
        canEdit={canEdit} onClose={closeDashboard} leaveGuard={leaveDashboard} done={message => {
          setDashboardVersions(versions => ({ ...versions, [dashboardId]: (versions[dashboardId] ?? 0) + 1 }))
          done(message)
        }} />}

      {showSidebar && (
        <section className="surface chat-conversations-sidebar">
          <div className="panel-head">
            <SectionTitle label="Cuộc hội thoại" count={conversations.length} />
            <button className="text-link" onClick={loadConversations}>
              ↻
            </button>
          </div>

        {!selectedConv && (
          <div className="form-grid">
            <label className="wide">
              Dataset
              <select value={datasetId} onChange={e => setDatasetId(e.target.value)}>
                <option value="">Chọn dataset</option>
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={!datasetId || !canEdit || busy}
              onClick={createConversation}
            >
              Tạo mới
            </button>
          </div>
        )}

        <div className="chat-conversations-list">
          {conversations.length ? (
            conversations.map(conv => (
              <button
                key={conv.id}
                disabled={busy}
                className={`list-row clickable full-row ${selectedConv?.id === conv.id ? 'active' : ''}`}
                onClick={() => openConversation(conv.id)}
              >
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
        </section>
      )}
    </div>
  )
}
