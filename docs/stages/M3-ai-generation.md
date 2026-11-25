# M3｜AI 实验生成 MVP

**用户价值：**用自然语言或粘贴的 LaTeX 描述一个科学问题，获得可操作的实验画布。

**阶段状态：**已完成（2026-11-25）  
**依赖：**M1；复用 M2 的工作台案例体验（M2 可与 M3 并行，但正式集成应使用统一 Schema）。  
**PRD 来源：**F2 文本/公式输入、F3 运行时协议、5.1 大模型代理方案、5.2 Generative UI Schema。

## MVP 边界

实现文本或 LaTeX 到结构化实验 Schema，再到画布运行的单次生成流程。模型生成的是 Schema 与受控仿真逻辑，不生成任意页面 HTML。论文图片识别留到 M8；基于已有实验的增量微调留到 M4。

## 交付任务

- [x] **M3.1 输入与请求状态**：提供自然语言/LaTeX 输入、提交、取消（若接口支持）、生成中和失败状态。
- [x] **M3.2 模型服务代理**：从服务端函数/API 路由转发请求；服务端凭证只存在服务端；加入超时、错误映射和必要的请求限制。
- [x] **M3.3 结构化生成协议**：要求模型按 M1 Schema 返回 JSON；用服务端和客户端校验，不接受未经校验的模型输出。
- [x] **M3.4 安全运行生成结果**：将验证后的仿真逻辑接入隔离运行时；明确哪些浏览器能力不可访问，限制生成脚本对主应用状态的影响。
- [x] **M3.5 生成结果预览与应用**：成功后显示实验标题、公式、说明和控件；失败或拒绝结果时保留当前可用实验，并提供预设回退入口。
- [x] **M3.6 服务故障兜底**：对网络失败、超时、限额、无效 JSON、Schema 不合法等情况给出可理解提示。
- [x] **M3.7 流程验证**：覆盖有效输出、无效输出、超时和仿真初始化失败；确认无服务端密钥泄露。

## 验收标准

- [x] 可提交自然语言和 LaTeX 请求，并收到一个符合 Schema 的可交互实验。
- [x] 模型输出必须经过类型、范围和必需字段校验后才能运行。
- [x] 模型或网络不可用时，失败有明确反馈；已有实验和内置预设仍可使用。
- [x] 服务端凭证不出现在浏览器 bundle、请求响应、localStorage 或 IndexedDB 中。
- [x] 生成仿真运行在隔离上下文中，不能直接改写主应用 DOM 或 React 状态。
- [x] 测试覆盖主要失败分支；lint/build 通过。

## 完成定义

从用户提交描述到实验展示、参数操作以及失败回退的闭环可重复演示。

## 验收记录

**实现落点**

- 输入、生成中/失败状态与取消：[SidePanel](../../src/components/SidePanel.tsx)
- 客户端请求、超时与错误映射：[client](../../src/ai/client.ts)
- 服务端代理、请求限制与错误映射：[aiProxy](../../server/aiProxy.ts)、[generate](../../server/generate.ts)
- 生成协议、Schema 与语法校验：[schema](../../src/ai/schema.ts)、[prompt](../../src/ai/prompt.ts)
- 隔离运行与协议绑定：[sandboxBootstrap](../../src/runtime/sandboxBootstrap.ts)、[useAISandbox](../../src/hooks/useAISandbox.ts)
- 实验来源、应用与回退：[useWorkbenchStore](../../src/store/useWorkbenchStore.ts)

**验证结果（2026-11-25）**

- 单元/集成测试：`pnpm test` 全部通过，覆盖有效输出、Schema 不合法、控件越界、语法错误、上游 429/401、超时、无效 JSON、网络失败与取消。
- 构建与静态检查：`pnpm lint`、`pnpm build` 通过。
- 浏览器实测（本地 mock OpenAI 兼容服务）：提交自然语言后生成“AI 阻尼振子”，标题、公式、说明与控件正确应用，隔离沙盒持续绘制；构造 `createState` 抛错的输出时显示“模型运行异常 · 初始化阶段”，点击“回到默认实验”后预设实验与控件恢复可用。
- 凭证检查：未配置凭证时 `/api/generate` 返回 503 `not_configured`；使用测试密钥构建后扫描 `dist`，未发现密钥值或 `AI_API_KEY` 字样。

**运行配置**

服务端进程读取以下环境变量（写入项目根目录 `.env`，已被 `.gitignore` 忽略）：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `AI_API_KEY` | 是 | 无 | 模型服务凭证，仅存在于服务端 |
| `AI_BASE_URL` | 否 | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `AI_MODEL` | 否 | `gpt-4o-mini` | 生成使用的模型 |
| `AI_TIMEOUT_MS` | 否 | `45000` | 服务端上游超时时间 |

**安全边界**

- iframe 仅开启 `sandbox="allow-scripts"`，不开启 `allow-same-origin`，因此是独立不透明源；CSP 设置 `default-src 'none'`、`connect-src 'none'`，生成代码中的常用浏览器全局对象被遮蔽。生成逻辑无法访问主应用 DOM、React 状态、同源存储或网络。
- 服务端与客户端校验阶段只编译生成代码，不执行；实例化只发生在沙盒内。
- 残余风险：沙盒内仍可经由 `Function` 构造器访问 iframe 自身的全局对象，但受同源隔离与 CSP 限制，不能影响父页面；可在 M4 进一步收紧。

**部署提示**

- 开发：`pnpm dev`；预览构建产物：`pnpm build && pnpm preview`，Vite 插件会同时为预览服务器挂载 `/api/generate`。
- 纯静态托管不会提供 `/api/generate`，部署时需在 Node 运行环境挂载该路由。

## 暂不纳入

多模态截图输入（M8）、增量修改（M4）、生成代码自动修复（M4）；用户自有 API Key 与第三方 API 站点端点的配置界面及存储归入 M7（已定选型为 IndexedDB）。
