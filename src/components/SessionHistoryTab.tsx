import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import type { SessionMessage, StoredGeneration } from '../sessions/types'
import { useSessionStore } from '../store/useSessionStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { FAST_TRANSITION } from './motion'

interface SessionHistoryTabProps {
  onClose: () => void
}

const SMALL_BUTTON =
  'rounded-md border border-line bg-surface px-2 py-[3px] text-[10px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45'
const DANGER_BUTTON =
  'rounded-md border border-rose/40 bg-rose/[0.08] px-2 py-[3px] text-[10px] text-[#a9605f] transition-colors hover:bg-rose/[0.16]'

const MODE_LABEL: Record<string, string> = {
  create: '首次生成',
  refine: '增量微调',
  repair: '自动修复',
  recognize: '截图识别',
}

function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(timestamp)
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

function roleLabel(role: SessionMessage['role']): string {
  if (role === 'user') return '提问'
  if (role === 'assistant') return 'AI'
  return '系统'
}

export function SessionHistoryTab({ onClose }: SessionHistoryTabProps) {
  const sessions = useSessionStore((state) => state.sessions)
  const dbPath = useSessionStore((state) => state.dbPath)
  const loading = useSessionStore((state) => state.loading)
  const error = useSessionStore((state) => state.error)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId)
  const selectedDetail = useSessionStore((state) => state.selectedDetail)
  const loadingDetail = useSessionStore((state) => state.loadingDetail)
  const loadSessions = useSessionStore((state) => state.loadSessions)
  const selectSession = useSessionStore((state) => state.selectSession)
  const setActiveSessionId = useSessionStore((state) => state.setActiveSessionId)
  const deleteSession = useSessionStore((state) => state.deleteSession)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      void selectSession(sessions[0].id)
    }
  }, [selectedSessionId, sessions, selectSession])

  const handleApplyGeneration = (generation: StoredGeneration) => {
    const workbench = useWorkbenchStore.getState()
    workbench.applyGeneratedExperiment(generation.spec, generation.params ?? undefined, {
      newRecord: true,
    })
    setActiveSessionId(generation.sessionId)
    onClose()
  }

  const handleDelete = async (sessionId: string) => {
    if (confirmDeleteId !== sessionId) {
      setConfirmDeleteId(sessionId)
      return
    }
    await deleteSession(sessionId)
    setConfirmDeleteId(null)
  }

  return (
    <motion.div
      key="workspace-sessions"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={FAST_TRANSITION}
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-4 py-3"
    >
      <div className="flex flex-none flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-ink-faint">
          <span>
            {loading ? '正在读取 SQLite 会话…' : `${sessions.length} 条 SQLite 会话记录`}
          </span>
          {dbPath && (
            <span
              className="hidden max-w-[340px] truncate rounded-[5px] border border-line bg-surface-soft px-1.5 py-px font-mono text-[9px] text-ink-faint sm:inline"
              title={dbPath}
            >
              {dbPath}
            </span>
          )}
        </div>
        <button
          className={SMALL_BUTTON}
          type="button"
          disabled={loading}
          onClick={() => void loadSessions()}
        >
          刷新
        </button>
      </div>

      {error && (
        <p
          className="m-0 flex-none rounded-[8px] border border-rose/30 bg-rose/[0.08] px-2.5 py-2 text-[10.5px] leading-[1.55] text-[#a9605f]"
          role="alert"
        >
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-line-strong/60 bg-surface/40 px-4 py-10 text-center">
          <span className="text-[12px] text-ink-dim">还没有 SQLite 会话记录</span>
          <span className="max-w-[40ch] text-[10px] leading-[1.6] text-ink-faint">
            在左侧 AI 沙盒输入描述、上传论文截图或进行增量微调后，每次会话与生成好的实验内容都会自动存入本地 SQLite 数据库。
          </span>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden sm:grid-cols-[240px_minmax(0,1fr)]">
          <div className="preset-scroll flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
            {sessions.map((session) => {
              const selected = session.id === selectedSessionId
              const isActive = session.id === activeSessionId
              return (
                <article
                  key={session.id}
                  className={`flex flex-col gap-1.5 rounded-[10px] border px-2.5 py-2 transition-colors ${
                    selected
                      ? 'border-accent-line bg-accent-soft/45'
                      : 'border-line bg-surface/70 hover:border-line-strong'
                  }`}
                >
                  <button
                    type="button"
                    className="flex flex-col gap-1 text-left"
                    onClick={() => {
                      setConfirmDeleteId(null)
                      void selectSession(session.id)
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="rounded-[4px] border border-line bg-surface-soft px-1 py-px font-mono text-[8.5px] text-ink-faint">
                        {session.source === 'image' ? '论文截图' : '文本对话'}
                      </span>
                      {isActive && (
                        <span className="rounded-[4px] border border-accent-line bg-accent-soft px-1 py-px font-mono text-[8.5px] text-accent-strong">
                          当前会话
                        </span>
                      )}
                    </div>
                    <strong className="truncate text-[11.5px] font-[550] text-ink" title={session.title}>
                      {session.title}
                    </strong>
                    <div className="flex flex-wrap items-center gap-1 text-[9.5px] text-ink-faint">
                      <span>{session.messageCount} 条消息</span>
                      <span>·</span>
                      <span>{session.generationCount} 次生成</span>
                    </div>
                    <span className="text-[9px] text-ink-faint/80">
                      {formatTime(session.updatedAt)}
                    </span>
                  </button>
                  <div className="flex items-center justify-end gap-1 pt-0.5">
                    <button
                      className={DANGER_BUTTON}
                      type="button"
                      onClick={() => void handleDelete(session.id)}
                    >
                      {confirmDeleteId === session.id ? '确认删除' : '删除'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>

          <div className="preset-scroll flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[11px] border border-line bg-surface/55 p-3">
            {loadingDetail ? (
              <div className="flex flex-1 items-center justify-center text-[11px] text-ink-faint">
                正在读取会话详情…
              </div>
            ) : !selectedDetail ? (
              <div className="flex flex-1 items-center justify-center text-[11px] text-ink-faint">
                选择左侧会话查看对话记录与已保存的生成内容
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1 border-b border-line pb-2">
                  <h3 className="m-0 text-[13px] font-[600] text-ink">
                    {selectedDetail.session.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5 text-[9.5px] text-ink-faint">
                    <span>创建于 {formatTime(selectedDetail.session.createdAt)}</span>
                    <span>·</span>
                    <span>{selectedDetail.messages.length} 条消息</span>
                    <span>·</span>
                    <span>{selectedDetail.generations.length} 份已存生成内容</span>
                  </div>
                </div>

                <section className="flex flex-col gap-1.5">
                  <h4 className="m-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    已存入 SQLite 的生成内容（{selectedDetail.generations.length}）
                  </h4>
                  {selectedDetail.generations.length === 0 ? (
                    <p className="m-0 rounded-[8px] border border-dashed border-line px-2.5 py-2 text-[10px] text-ink-faint">
                      该会话暂无成功生成并落库的实验内容。
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {selectedDetail.generations.map((gen, index) => (
                        <div
                          key={gen.id}
                          className="flex flex-col gap-1.5 rounded-[9px] border border-[rgba(138,118,168,0.28)] bg-[rgba(138,118,168,0.06)] px-2.5 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="rounded-[4px] border border-[rgba(138,118,168,0.35)] bg-surface px-1.5 py-px font-mono text-[9px] text-[#6d5a7d]">
                                v{selectedDetail.generations.length - index} ·{' '}
                                {MODE_LABEL[gen.mode] ?? gen.mode}
                              </span>
                              <span className="truncate text-[11.5px] font-[550] text-ink">
                                {gen.title}
                              </span>
                              <span className="text-[9.5px] text-ink-faint">{gen.domain}</span>
                            </div>
                            <button
                              className="rounded-md border border-transparent bg-accent-strong px-2 py-[3px] text-[10px] font-semibold text-[#fbf7ef] transition-colors hover:bg-accent"
                              type="button"
                              onClick={() => handleApplyGeneration(gen)}
                            >
                              加载到画布
                            </button>
                          </div>
                          <p className="m-0 text-[10px] leading-[1.5] text-ink-dim">
                            {gen.insight}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[9px] text-ink-faint">
                            <span>{formatTime(gen.createdAt)}</span>
                            <span>·</span>
                            <span className="font-mono">
                              {gen.spec.controls.length} 个控件 ·{' '}
                              {'simulationCode' in gen.spec
                                ? `${gen.spec.simulationCode.length} 字符代码`
                                : 'Scene2D 场景'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="flex flex-col gap-1.5">
                  <h4 className="m-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    会话消息流水（{selectedDetail.messages.length}）
                  </h4>
                  <div className="flex flex-col gap-1.5">
                    {selectedDetail.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex flex-col gap-1 rounded-[8px] border px-2.5 py-1.5 ${
                          msg.status === 'error'
                            ? 'border-rose/30 bg-rose/[0.07]'
                            : msg.role === 'user'
                              ? 'border-line bg-surface'
                              : 'border-line/70 bg-surface-soft/70'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[9px] text-ink-faint">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-ink-dim">
                              {roleLabel(msg.role)}
                            </span>
                            <span className="rounded-[4px] border border-line bg-surface px-1 py-px font-mono text-[8.5px]">
                              {MODE_LABEL[msg.mode] ?? msg.mode}
                            </span>
                            {msg.status === 'error' && (
                              <span className="text-[#a9605f]">失败</span>
                            )}
                          </div>
                          <span>{formatTime(msg.createdAt)}</span>
                        </div>
                        <p className="m-0 whitespace-pre-wrap break-words text-[10.5px] leading-[1.55] text-ink">
                          {msg.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}
