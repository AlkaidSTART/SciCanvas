use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'text',
  workspace_record_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  mode TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  generation_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  formula_latex TEXT NOT NULL,
  insight TEXT NOT NULL,
  render_type TEXT NOT NULL,
  controls_json TEXT NOT NULL,
  legend_json TEXT,
  simulation_code TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  params_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS llm_endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  is_preset INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  vision_model TEXT NOT NULL DEFAULT '',
  api_format TEXT NOT NULL DEFAULT 'chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON session_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_generations_session_created ON generations(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_endpoints_active ON llm_endpoints(is_active DESC, is_preset DESC, updated_at DESC);
"#;

const SESSION_SUMMARY_SELECT: &str = r#"
SELECT
  s.id,
  s.title,
  s.source,
  s.workspace_record_id,
  s.created_at,
  s.updated_at,
  (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = s.id) AS message_count,
  (SELECT COUNT(*) FROM generations g WHERE g.session_id = s.id) AS generation_count,
  (SELECT m.content FROM session_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.created_at DESC LIMIT 1) AS last_prompt,
  (SELECT g.id FROM generations g WHERE g.session_id = s.id ORDER BY g.created_at DESC LIMIT 1) AS latest_generation_id,
  (SELECT g.title FROM generations g WHERE g.session_id = s.id ORDER BY g.created_at DESC LIMIT 1) AS latest_generation_title,
  (SELECT g.domain FROM generations g WHERE g.session_id = s.id ORDER BY g.created_at DESC LIMIT 1) AS latest_generation_domain
FROM sessions s
"#;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub source: String,
    pub workspace_record_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
    pub generation_count: i64,
    pub last_prompt: Option<String>,
    pub latest_generation_id: Option<String>,
    pub latest_generation_title: Option<String>,
    pub latest_generation_domain: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub mode: String,
    pub content: String,
    pub status: String,
    pub generation_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredGeneration {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub mode: String,
    pub prompt: String,
    pub title: String,
    pub domain: String,
    pub formula_latex: String,
    pub insight: String,
    pub render_type: String,
    pub spec: Value,
    pub params: Option<Value>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: SessionSummary,
    pub messages: Vec<SessionMessage>,
    pub generations: Vec<StoredGeneration>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGenerationResult {
    pub generation: StoredGeneration,
    pub message: Option<SessionMessage>,
    pub session: SessionSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsResponse {
    pub sessions: Vec<SessionSummary>,
    pub db_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub id: Option<String>,
    pub title: String,
    pub source: Option<String>,
    pub workspace_record_id: Option<String>,
    pub initial_prompt: Option<String>,
    pub initial_mode: Option<String>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendMessageInput {
    pub id: Option<String>,
    pub role: String,
    pub mode: String,
    pub content: String,
    pub status: Option<String>,
    pub generation_id: Option<String>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGenerationInput {
    pub id: Option<String>,
    pub message_id: Option<String>,
    pub mode: String,
    pub prompt: String,
    pub spec: Value,
    pub params: Option<Value>,
    pub assistant_summary: Option<String>,
    pub created_at: Option<i64>,
}

pub struct SqliteStore {
    conn: Mutex<Connection>,
    db_path: String,
}

impl SqliteStore {
    pub fn open_for_app(app: &AppHandle) -> Result<Self, String> {
        let db_path = if let Ok(custom) = std::env::var("SCICANVAS_DB_PATH") {
            PathBuf::from(custom)
        } else {
            let mut dir = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("无法获取应用数据目录: {err}"))?;
            std::fs::create_dir_all(&dir)
                .map_err(|err| format!("无法创建应用数据目录: {err}"))?;
            dir.push("scicanvas.db");
            dir
        };

        if let Some(parent) = db_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("无法创建数据库目录: {err}"))?;
            }
        }

        let conn = Connection::open(&db_path)
            .map_err(|err| format!("无法打开 SQLite 数据库: {err}"))?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|err| format!("初始化 SQLite PRAGMA 失败: {err}"))?;
        conn.execute_batch(SCHEMA_SQL)
            .map_err(|err| format!("初始化 SQLite 表结构失败: {err}"))?;
        seed_preset_llm_endpoints(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            db_path: db_path.to_string_lossy().to_string(),
        })
    }
}

fn read_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        source: row.get(2)?,
        workspace_record_id: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        message_count: row.get(6)?,
        generation_count: row.get(7)?,
        last_prompt: row.get(8)?,
        latest_generation_id: row.get(9)?,
        latest_generation_title: row.get(10)?,
        latest_generation_domain: row.get(11)?,
    })
}

fn read_message_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionMessage> {
    Ok(SessionMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        mode: row.get(3)?,
        content: row.get(4)?,
        status: row.get(5)?,
        generation_id: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn read_generation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredGeneration> {
    let spec_json: String = row.get(10)?;
    let params_json: Option<String> = row.get(11)?;
    let spec: Value = serde_json::from_str(&spec_json).unwrap_or(Value::Null);
    let params: Option<Value> = params_json.and_then(|s| serde_json::from_str(&s).ok());
    Ok(StoredGeneration {
        id: row.get(0)?,
        session_id: row.get(1)?,
        message_id: row.get(2)?,
        mode: row.get(3)?,
        prompt: row.get(4)?,
        title: row.get(5)?,
        domain: row.get(6)?,
        formula_latex: row.get(7)?,
        insight: row.get(8)?,
        render_type: row.get(9)?,
        spec,
        params,
        created_at: row.get(12)?,
    })
}

fn query_session(conn: &Connection, id: &str) -> Result<Option<SessionSummary>, String> {
    let sql = format!("{SESSION_SUMMARY_SELECT} WHERE s.id = ?1");
    conn.query_row(&sql, params![id], read_session_row)
        .optional()
        .map_err(|err| format!("查询会话失败: {err}"))
}

fn query_session_detail(conn: &Connection, id: &str) -> Result<Option<SessionDetail>, String> {
    let Some(session) = query_session(conn, id)? else {
        return Ok(None);
    };

    let mut msg_stmt = conn
        .prepare(
            "SELECT id, session_id, role, mode, content, status, generation_id, created_at
             FROM session_messages
             WHERE session_id = ?1
             ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(|err| format!("查询消息失败: {err}"))?;
    let messages = msg_stmt
        .query_map(params![id], read_message_row)
        .map_err(|err| format!("读取消息失败: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("解析消息失败: {err}"))?;

    let mut gen_stmt = conn
        .prepare(
            "SELECT id, session_id, message_id, mode, prompt, title, domain,
                    formula_latex, insight, render_type, spec_json, params_json, created_at
             FROM generations
             WHERE session_id = ?1
             ORDER BY created_at DESC, rowid DESC
             LIMIT 200",
        )
        .map_err(|err| format!("查询生成记录失败: {err}"))?;
    let generations = gen_stmt
        .query_map(params![id], read_generation_row)
        .map_err(|err| format!("读取生成记录失败: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("解析生成记录失败: {err}"))?;

    Ok(Some(SessionDetail {
        session,
        messages,
        generations,
    }))
}

#[tauri::command]
pub fn sqlite_list_sessions(
    store: State<'_, SqliteStore>,
    limit: Option<i64>,
) -> Result<ListSessionsResponse, String> {
    let conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let safe_limit = limit.unwrap_or(100).clamp(1, 500);
    let sql = format!("{SESSION_SUMMARY_SELECT} ORDER BY s.updated_at DESC LIMIT ?1");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| format!("查询会话列表失败: {err}"))?;
    let sessions = stmt
        .query_map(params![safe_limit], read_session_row)
        .map_err(|err| format!("读取会话列表失败: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("解析会话列表失败: {err}"))?;

    Ok(ListSessionsResponse {
        sessions,
        db_path: store.db_path.clone(),
    })
}

#[tauri::command]
pub fn sqlite_get_session_detail(
    store: State<'_, SqliteStore>,
    session_id: String,
) -> Result<Option<SessionDetail>, String> {
    let conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    query_session_detail(&conn, &session_id)
}

#[tauri::command]
pub fn sqlite_create_session(
    store: State<'_, SqliteStore>,
    input: CreateSessionInput,
) -> Result<SessionDetail, String> {
    let mut conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let now = input.created_at.unwrap_or_else(now_ms);
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let title: String = {
        let trimmed = input.title.trim();
        if trimmed.is_empty() {
            "新会话".to_string()
        } else {
            trimmed.chars().take(120).collect()
        }
    };
    let source = match input.source.as_deref() {
        Some("image") => "image",
        _ => "text",
    };

    let tx = conn
        .transaction()
        .map_err(|err| format!("开启事务失败: {err}"))?;
    tx.execute(
        "INSERT INTO sessions (id, title, source, workspace_record_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, title, source, input.workspace_record_id, now, now],
    )
    .map_err(|err| format!("创建会话失败: {err}"))?;

    if let Some(prompt) = input.initial_prompt.as_deref().map(str::trim) {
        if !prompt.is_empty() {
            let msg_id = Uuid::new_v4().to_string();
            let mode = input.initial_mode.as_deref().unwrap_or("create");
            tx.execute(
                "INSERT INTO session_messages (id, session_id, role, mode, content, status, generation_id, created_at)
                 VALUES (?1, ?2, 'user', ?3, ?4, 'ok', NULL, ?5)",
                params![msg_id, id, mode, prompt, now],
            )
            .map_err(|err| format!("写入初始消息失败: {err}"))?;
        }
    }

    tx.commit().map_err(|err| format!("提交事务失败: {err}"))?;
    query_session_detail(&conn, &id)?
        .ok_or_else(|| "创建会话后读取失败".to_string())
}

#[tauri::command]
pub fn sqlite_delete_session(
    store: State<'_, SqliteStore>,
    session_id: String,
) -> Result<bool, String> {
    let conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let changed = conn
        .execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
        .map_err(|err| format!("删除会话失败: {err}"))?;
    Ok(changed > 0)
}

#[tauri::command]
pub fn sqlite_append_message(
    store: State<'_, SqliteStore>,
    session_id: String,
    input: AppendMessageInput,
) -> Result<SessionMessage, String> {
    let mut conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let now = input.created_at.unwrap_or_else(now_ms);
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let status = match input.status.as_deref() {
        Some("error") => "error",
        _ => "ok",
    };

    let tx = conn
        .transaction()
        .map_err(|err| format!("开启事务失败: {err}"))?;
    tx.execute(
        "INSERT INTO session_messages (id, session_id, role, mode, content, status, generation_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            session_id,
            input.role,
            input.mode,
            input.content,
            status,
            input.generation_id,
            now
        ],
    )
    .map_err(|err| format!("写入会话消息失败: {err}"))?;

    tx.execute(
        "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|err| format!("更新会话时间失败: {err}"))?;

    tx.commit().map_err(|err| format!("提交事务失败: {err}"))?;

    Ok(SessionMessage {
        id,
        session_id,
        role: input.role,
        mode: input.mode,
        content: input.content,
        status: status.to_string(),
        generation_id: input.generation_id,
        created_at: now,
    })
}

#[tauri::command]
pub fn sqlite_save_generation(
    store: State<'_, SqliteStore>,
    session_id: String,
    input: SaveGenerationInput,
) -> Result<SaveGenerationResult, String> {
    let mut conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let now = input.created_at.unwrap_or_else(now_ms);
    let generation_id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let title = input
        .spec
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("未命名实验")
        .to_string();
    let domain = input
        .spec
        .get("domain")
        .and_then(Value::as_str)
        .unwrap_or("未分类")
        .to_string();
    let formula_latex = input
        .spec
        .get("formulaLatex")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let insight = input
        .spec
        .get("insight")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let render_type = input
        .spec
        .get("renderType")
        .and_then(Value::as_str)
        .unwrap_or("canvas2d")
        .to_string();
    let simulation_code = input
        .spec
        .get("simulationCode")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let controls_json = input
        .spec
        .get("controls")
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()))
        .unwrap_or_else(|| "[]".to_string());
    let legend_json = input
        .spec
        .get("legend")
        .filter(|v| !v.is_null())
        .map(|v| serde_json::to_string(v).unwrap_or_default());
    let spec_json =
        serde_json::to_string(&input.spec).map_err(|err| format!("序列化生成内容失败: {err}"))?;
    let params_json = input
        .params
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    let summary_text = input
        .assistant_summary
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let message_id = if summary_text.is_some() {
        Some(
            input
                .message_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
        )
    } else {
        input.message_id
    };

    let tx = conn
        .transaction()
        .map_err(|err| format!("开启事务失败: {err}"))?;
    tx.execute(
        "INSERT INTO generations (
            id, session_id, message_id, mode, prompt, title, domain,
            formula_latex, insight, render_type, controls_json, legend_json,
            simulation_code, spec_json, params_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            generation_id,
            session_id,
            message_id,
            input.mode,
            input.prompt,
            title,
            domain,
            formula_latex,
            insight,
            render_type,
            controls_json,
            legend_json,
            simulation_code,
            spec_json,
            params_json,
            now
        ],
    )
    .map_err(|err| format!("保存生成内容失败: {err}"))?;

    let mut message: Option<SessionMessage> = None;
    if let (Some(content), Some(msg_id)) = (summary_text, message_id.clone()) {
        tx.execute(
            "INSERT INTO session_messages (id, session_id, role, mode, content, status, generation_id, created_at)
             VALUES (?1, ?2, 'assistant', ?3, ?4, 'ok', ?5, ?6)",
            params![msg_id, session_id, input.mode, content, generation_id, now],
        )
        .map_err(|err| format!("写入助手回复失败: {err}"))?;
        message = Some(SessionMessage {
            id: msg_id,
            session_id: session_id.clone(),
            role: "assistant".to_string(),
            mode: input.mode.clone(),
            content,
            status: "ok".to_string(),
            generation_id: Some(generation_id.clone()),
            created_at: now,
        });
    }

    tx.execute(
        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now, session_id],
    )
    .map_err(|err| format!("更新会话标题失败: {err}"))?;

    tx.commit().map_err(|err| format!("提交事务失败: {err}"))?;

    let session = query_session(&conn, &session_id)?
        .ok_or_else(|| "会话不存在".to_string())?;

    let generation = StoredGeneration {
        id: generation_id,
        session_id,
        message_id,
        mode: input.mode,
        prompt: input.prompt,
        title,
        domain,
        formula_latex,
        insight,
        render_type,
        spec: input.spec,
        params: input.params,
        created_at: now,
    };

    Ok(SaveGenerationResult {
        generation,
        message,
        session,
    })
}

#[tauri::command]
pub fn sqlite_list_generations(
    store: State<'_, SqliteStore>,
    session_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<StoredGeneration>, String> {
    let conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let safe_limit = limit.unwrap_or(100).clamp(1, 500);
    if let Some(sid) = session_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, message_id, mode, prompt, title, domain,
                        formula_latex, insight, render_type, spec_json, params_json, created_at
                 FROM generations
                 WHERE session_id = ?1
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?2",
            )
            .map_err(|err| format!("查询生成记录失败: {err}"))?;
        let rows = stmt
            .query_map(params![sid, safe_limit], read_generation_row)
            .map_err(|err| format!("读取生成记录失败: {err}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("解析生成记录失败: {err}"))?;
        Ok(rows)
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, message_id, mode, prompt, title, domain,
                        formula_latex, insight, render_type, spec_json, params_json, created_at
                 FROM generations
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?1",
            )
            .map_err(|err| format!("查询生成记录失败: {err}"))?;
        let rows = stmt
            .query_map(params![safe_limit], read_generation_row)
            .map_err(|err| format!("读取生成记录失败: {err}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("解析生成记录失败: {err}"))?;
        Ok(rows)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointConfig {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub is_preset: bool,
    pub is_active: bool,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub vision_model: String,
    pub api_format: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListLlmEndpointsResponse {
    pub endpoints: Vec<LlmEndpointConfig>,
    pub db_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertLlmEndpointInput {
    pub id: Option<String>,
    pub name: String,
    pub provider_id: Option<String>,
    pub is_preset: Option<bool>,
    pub is_active: Option<bool>,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub vision_model: Option<String>,
    pub api_format: String,
}

fn normalize_api_format(raw: &str) -> &'static str {
    match raw {
        "response" => "response",
        "anthropic" => "anthropic",
        _ => "chat",
    }
}

fn seed_preset_llm_endpoints(conn: &Connection) -> Result<(), String> {
    let presets: [(&str, &str, &str, &str, &str, &str, &str); 5] = [
        (
            "preset-deepseek",
            "DeepSeek",
            "deepseek",
            "https://api.deepseek.com/v1",
            "deepseek-chat",
            "",
            "chat",
        ),
        (
            "preset-doubao",
            "豆包 (Doubao)",
            "doubao",
            "https://ark.cn-beijing.volces.com/api/v3",
            "doubao-1-5-pro-32k-250115",
            "doubao-1-5-vision-pro-32k-250115",
            "chat",
        ),
        (
            "preset-qwen",
            "通义千问 (Qwen)",
            "qwen",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "qwen-plus",
            "qwen-vl-max",
            "chat",
        ),
        (
            "preset-openai",
            "OpenAI",
            "openai",
            "https://api.openai.com/v1",
            "gpt-4o-mini",
            "gpt-4o-mini",
            "response",
        ),
        (
            "preset-anthropic",
            "Anthropic (Claude)",
            "anthropic",
            "https://api.anthropic.com/v1",
            "claude-sonnet-4-20250514",
            "claude-sonnet-4-20250514",
            "anthropic",
        ),
    ];

    let seed_base: i64 = 1_700_000_000_000;
    for (idx, (id, name, provider_id, base_url, model, vision_model, api_format)) in
        presets.iter().enumerate()
    {
        let ts = seed_base + idx as i64;
        conn.execute(
            "INSERT OR IGNORE INTO llm_endpoints (
                id, name, provider_id, is_preset, is_active, base_url, api_key,
                model, vision_model, api_format, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 1, 0, ?4, '', ?5, ?6, ?7, ?8, ?9)",
            params![id, name, provider_id, base_url, model, vision_model, api_format, ts, ts],
        )
        .map_err(|err| format!("初始化内置大模型端点失败: {err}"))?;
    }
    Ok(())
}

fn read_llm_endpoint_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LlmEndpointConfig> {
    let is_preset: i64 = row.get(3)?;
    let is_active: i64 = row.get(4)?;
    let raw_format: String = row.get(9)?;
    Ok(LlmEndpointConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        provider_id: row.get(2)?,
        is_preset: is_preset == 1,
        is_active: is_active == 1,
        base_url: row.get(5)?,
        api_key: row.get(6)?,
        model: row.get(7)?,
        vision_model: row.get(8)?,
        api_format: normalize_api_format(&raw_format).to_string(),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn query_llm_endpoint(conn: &Connection, id: &str) -> Result<Option<LlmEndpointConfig>, String> {
    conn.query_row(
        "SELECT id, name, provider_id, is_preset, is_active, base_url, api_key,
                model, vision_model, api_format, created_at, updated_at
         FROM llm_endpoints
         WHERE id = ?1",
        params![id],
        read_llm_endpoint_row,
    )
    .optional()
    .map_err(|err| format!("查询大模型端点失败: {err}"))
}

#[tauri::command]
pub fn sqlite_list_llm_endpoints(
    store: State<'_, SqliteStore>,
) -> Result<ListLlmEndpointsResponse, String> {
    let conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, provider_id, is_preset, is_active, base_url, api_key,
                    model, vision_model, api_format, created_at, updated_at
             FROM llm_endpoints
             ORDER BY is_preset DESC, CASE WHEN is_preset = 1 THEN created_at ELSE -updated_at END ASC",
        )
        .map_err(|err| format!("查询大模型端点列表失败: {err}"))?;
    let endpoints = stmt
        .query_map([], read_llm_endpoint_row)
        .map_err(|err| format!("读取大模型端点列表失败: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("解析大模型端点列表失败: {err}"))?;
    Ok(ListLlmEndpointsResponse {
        endpoints,
        db_path: store.db_path.clone(),
    })
}

#[tauri::command]
pub fn sqlite_upsert_llm_endpoint(
    store: State<'_, SqliteStore>,
    input: UpsertLlmEndpointInput,
) -> Result<LlmEndpointConfig, String> {
    let mut conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let now = now_ms();
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("custom-{}", Uuid::new_v4()));

    let existing = query_llm_endpoint(&conn, &id)?;
    let is_preset = existing
        .as_ref()
        .map(|e| e.is_preset)
        .unwrap_or_else(|| input.is_preset.unwrap_or(false));
    let is_active = input
        .is_active
        .unwrap_or_else(|| existing.as_ref().map(|e| e.is_active).unwrap_or(false));
    let provider_id = input
        .provider_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| existing.as_ref().map(|e| e.provider_id.clone()))
        .unwrap_or_else(|| "custom".to_string());
    let created_at = existing.as_ref().map(|e| e.created_at).unwrap_or(now);
    let base_url = input.base_url.trim().trim_end_matches('/').to_string();
    let api_format = normalize_api_format(&input.api_format);

    let tx = conn
        .transaction()
        .map_err(|err| format!("开启事务失败: {err}"))?;
    if is_active {
        tx.execute("UPDATE llm_endpoints SET is_active = 0 WHERE is_active = 1", [])
            .map_err(|err| format!("重置激活端点失败: {err}"))?;
    }
    tx.execute(
        "INSERT INTO llm_endpoints (
            id, name, provider_id, is_preset, is_active, base_url, api_key,
            model, vision_model, api_format, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            provider_id = excluded.provider_id,
            is_active = excluded.is_active,
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            model = excluded.model,
            vision_model = excluded.vision_model,
            api_format = excluded.api_format,
            updated_at = excluded.updated_at",
        params![
            id,
            input.name.trim(),
            provider_id,
            if is_preset { 1 } else { 0 },
            if is_active { 1 } else { 0 },
            base_url,
            input.api_key.trim(),
            input.model.trim(),
            input.vision_model.as_deref().unwrap_or("").trim(),
            api_format,
            created_at,
            now
        ],
    )
    .map_err(|err| format!("保存大模型端点失败: {err}"))?;
    tx.commit().map_err(|err| format!("提交事务失败: {err}"))?;

    query_llm_endpoint(&conn, &id)?.ok_or_else(|| "保存端点后读取失败".to_string())
}

#[tauri::command]
pub fn sqlite_set_active_llm_endpoint(
    store: State<'_, SqliteStore>,
    endpoint_id: String,
) -> Result<LlmEndpointConfig, String> {
    let mut conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    if query_llm_endpoint(&conn, &endpoint_id)?.is_none() {
        return Err("模型端点不存在".to_string());
    }
    let now = now_ms();
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启事务失败: {err}"))?;
    tx.execute("UPDATE llm_endpoints SET is_active = 0 WHERE is_active = 1", [])
        .map_err(|err| format!("重置激活端点失败: {err}"))?;
    tx.execute(
        "UPDATE llm_endpoints SET is_active = 1, updated_at = ?1 WHERE id = ?2",
        params![now, endpoint_id],
    )
    .map_err(|err| format!("设置激活端点失败: {err}"))?;
    tx.commit().map_err(|err| format!("提交事务失败: {err}"))?;

    query_llm_endpoint(&conn, &endpoint_id)?.ok_or_else(|| "读取激活端点失败".to_string())
}

#[tauri::command]
pub fn sqlite_delete_llm_endpoint(
    store: State<'_, SqliteStore>,
    endpoint_id: String,
) -> Result<bool, String> {
    let conn = store.conn.lock().map_err(|_| "数据库锁异常".to_string())?;
    let changed = conn
        .execute("DELETE FROM llm_endpoints WHERE id = ?1", params![endpoint_id])
        .map_err(|err| format!("删除大模型端点失败: {err}"))?;
    Ok(changed > 0)
}
