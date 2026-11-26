import { validateGeneratedSpec } from '../ai/schema'
import type { GeneratedExperimentSpec } from '../ai/schema'
import type { ParamValues } from '../types/experiment'
import { WORKSPACE_SCHEMA_VERSION } from './types'
import type { WorkspaceEntry, WorkspaceRecord, WorkspaceSource } from './types'

const MAX_RECORD_TITLE_LENGTH = 80
const FALLBACK_RECORD_TITLE = '未命名实验'

type RawRecord = Record<string, unknown>
type Migration = (raw: RawRecord, now: number) => RawRecord

/**
 * 记录结构迁移表：键为旧版本号，返回新版本原始对象。
 * 未登记的旧版本与更高版本一律标记为 unsupported，保留原始数据供导出。
 */
const MIGRATIONS = new Map<number, Migration>([
  [
    0,
    (raw, now) => {
      const updatedAt = readFiniteNumber(raw.updatedAt) ?? readFiniteNumber(raw.savedAt) ?? now
      return {
        ...raw,
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        title:
          typeof raw.title === 'string'
            ? raw.title
            : typeof raw.name === 'string'
              ? raw.name
              : '',
        domain: typeof raw.domain === 'string' ? raw.domain : '未分类',
        source: raw.source === 'ai' ? 'ai' : 'preset',
        experimentId:
          typeof raw.experimentId === 'string'
            ? raw.experimentId
            : typeof raw.experiment === 'string'
              ? raw.experiment
              : '',
        params: raw.params ?? {},
        speed: raw.speed ?? 1,
        favorite: false,
        createdAt: readFiniteNumber(raw.createdAt) ?? updatedAt,
        updatedAt,
      }
    },
  ],
])

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

/** 清洗用户输入标题：去掉控制字符、压缩空白并限制长度。 */
export function sanitizeRecordTitle(value: string, fallback = FALLBACK_RECORD_TITLE): string {
  const normalized = value
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return fallback
  return normalized.slice(0, MAX_RECORD_TITLE_LENGTH)
}

export function createWorkspaceRecordId(): string {
  const cryptoObject = globalThis.crypto
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID()
  }
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 只接受原始值参数，避免把任意对象带入存储或运行时。 */
function readParams(value: unknown): ParamValues {
  const params: ParamValues = {}
  if (!isRecord(value)) return params
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params[key] = raw
    else if (typeof raw === 'boolean') params[key] = raw
    else if (typeof raw === 'number' && Number.isFinite(raw)) params[key] = raw
  }
  return params
}

export interface BuildWorkspaceRecordInput {
  id: string
  existing: WorkspaceRecord | null
  source: WorkspaceSource
  experimentId: string
  title: string
  domain: string
  spec: GeneratedExperimentSpec | null
  params: ParamValues
  speed: number
  now?: number
}

function specContentSignature(spec: GeneratedExperimentSpec | null | undefined): string | null {
  if (!spec) return null
  return spec.renderType === 'scene2d'
    ? `scene2d:${JSON.stringify(spec.scene)}`
    : `canvas2d:${spec.simulationCode}`
}

/**
 * 组装一条可写入的记录：保留用户重命名与收藏状态，
 * 只有 AI 代码或声明式场景真正变化时才递增版本。
 */
export function buildWorkspaceRecord(input: BuildWorkspaceRecordInput): WorkspaceRecord {
  const now = input.now ?? Date.now()
  const existing = input.existing
  const spec = input.source === 'ai' ? input.spec : null
  const codeChanged =
    input.source === 'ai' &&
    spec !== null &&
    specContentSignature(spec) !== specContentSignature(existing?.spec)

  let codeVersion = 0
  if (input.source === 'ai') {
    codeVersion = existing ? (codeChanged ? existing.codeVersion + 1 : existing.codeVersion) : 1
  }

  return {
    id: input.id,
    title: existing?.title ?? sanitizeRecordTitle(input.title),
    domain: readNonEmptyString(input.domain) ?? '未分类',
    source: input.source,
    experimentId: readNonEmptyString(input.experimentId) ?? 'unknown',
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    codeVersion,
    spec,
    params: { ...input.params },
    speed: Number.isFinite(input.speed) && input.speed > 0 ? input.speed : 1,
    favorite: existing?.favorite ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** 列表处理只依赖记录本身，不携带状态字段。 */
export function toWorkspaceRecord(entry: WorkspaceEntry): WorkspaceRecord {
  return {
    id: entry.id,
    title: entry.title,
    domain: entry.domain,
    source: entry.source,
    experimentId: entry.experimentId,
    schemaVersion: entry.schemaVersion,
    codeVersion: entry.codeVersion,
    spec: entry.spec,
    params: { ...entry.params },
    speed: entry.speed,
    favorite: entry.favorite,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function readSchemaVersion(raw: RawRecord): number {
  const version = raw.schemaVersion
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0
}

function coerceRecord(raw: RawRecord, now: number): WorkspaceRecord | null {
  const id = readNonEmptyString(raw.id)
  const title = readNonEmptyString(raw.title)
  const domain = readNonEmptyString(raw.domain)
  const experimentId = readNonEmptyString(raw.experimentId)
  const source: WorkspaceSource | null =
    raw.source === 'ai' ? 'ai' : raw.source === 'preset' ? 'preset' : null
  if (!id || !title || !domain || !experimentId || !source) return null

  const updatedAt = readFiniteNumber(raw.updatedAt) ?? now
  return {
    id,
    title,
    domain,
    source,
    experimentId,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    codeVersion: Number.isInteger(raw.codeVersion) && (raw.codeVersion as number) >= 0
      ? (raw.codeVersion as number)
      : 0,
    spec: source === 'ai' && isRecord(raw.spec)
      ? (raw.spec as unknown as GeneratedExperimentSpec)
      : null,
    params: readParams(raw.params),
    speed: readFiniteNumber(raw.speed) ?? 1,
    favorite: raw.favorite === true,
    createdAt: readFiniteNumber(raw.createdAt) ?? updatedAt,
    updatedAt,
  }
}

function unsupportedEntry(
  raw: RawRecord,
  version: number,
  now: number,
  issue: string,
): WorkspaceEntry {
  const updatedAt = readFiniteNumber(raw.updatedAt) ?? readFiniteNumber(raw.savedAt) ?? now
  return {
    id: readNonEmptyString(raw.id) ?? createWorkspaceRecordId(),
    title:
      readNonEmptyString(raw.title) ?? readNonEmptyString(raw.name) ?? FALLBACK_RECORD_TITLE,
    domain: readNonEmptyString(raw.domain) ?? '未分类',
    source: raw.source === 'ai' ? 'ai' : 'preset',
    experimentId:
      readNonEmptyString(raw.experimentId) ?? readNonEmptyString(raw.experiment) ?? 'unknown',
    schemaVersion: version,
    codeVersion: Number.isInteger(raw.codeVersion) ? (raw.codeVersion as number) : 0,
    spec: null,
    params: readParams(raw.params),
    speed: readFiniteNumber(raw.speed) ?? 1,
    favorite: raw.favorite === true,
    createdAt: readFiniteNumber(raw.createdAt) ?? updatedAt,
    updatedAt,
    status: 'unsupported',
    issue,
    raw,
  }
}

/**
 * 读取时的兼容性处理：旧版本走迁移，新版本与损坏记录保持只读。
 * 返回 null 仅表示缺少 ID、无法定位的脏数据。
 */
export function normalizeStoredRecord(
  input: unknown,
  now = Date.now(),
): WorkspaceEntry | null {
  if (!isRecord(input)) return null
  if (!readNonEmptyString(input.id)) return null

  const version = readSchemaVersion(input)
  if (version > WORKSPACE_SCHEMA_VERSION) {
    return unsupportedEntry(
      input,
      version,
      now,
      `该记录由更新版本（v${version}）创建，当前仅支持 v${WORKSPACE_SCHEMA_VERSION}；已保留原始数据，可导出备份后删除。`,
    )
  }

  let raw = input
  let status: WorkspaceEntry['status'] = 'ok'
  if (version < WORKSPACE_SCHEMA_VERSION) {
    const migrate = MIGRATIONS.get(version)
    if (!migrate) {
      return unsupportedEntry(
        input,
        version,
        now,
        `暂不支持从 v${version} 升级该记录；已保留原始数据，可导出备份后删除。`,
      )
    }
    raw = migrate(input, now)
    status = 'migrated'
  }

  const record = coerceRecord(raw, now)
  if (!record) {
    return unsupportedEntry(raw, version, now, '记录字段不完整，已保留原始数据，可导出备份后删除。')
  }

  if (record.source === 'ai') {
    if (!record.spec) {
      return unsupportedEntry(raw, version, now, '该 AI 记录缺少代码版本，无法恢复运行。')
    }
    const validation = validateGeneratedSpec(record.spec)
    if (!validation.ok) {
      return unsupportedEntry(
        raw,
        version,
        now,
        `代码版本未通过校验：${validation.issues[0] ?? '未知问题'}。`,
      )
    }
    record.spec = validation.spec
  }

  return { ...record, status, raw: input }
}

/** 收藏优先，其余按最近更新排序。 */
export function sortWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}
