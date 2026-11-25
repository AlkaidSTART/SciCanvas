# SciCanvas 阶段任务文档

本文档集将 [PRD](../PRD.md) 拆分为 M1–M8 八个可独立体验和验收的增量 MVP。每个阶段包含目标用户价值、交付范围、任务清单、验收标准、依赖和暂不纳入范围。

## 阶段导航

| 阶段 | MVP | 前置阶段 |
| --- | --- | --- |
| [M1](./M1-workbench.md) | 可交互科研画布 | 无 |
| [M2](./M2-preset-library.md) | 跨学科预设实验库 | M1 |
| [M3](./M3-ai-generation.md) | AI 实验生成 | M1 |
| [M4](./M4-refinement-recovery.md) | 实验微调与错误恢复 | M3 |
| [M5](./M5-exploration-tools.md) | 科学探索增强 | M1、M2 |
| [M6](./M6-presentation-export.md) | 组会展示与离线导出 | M1；AI 实验导出依赖 M3 |
| [M7](./M7-local-workspace.md) | 本地科研工作区 | M1；保存 AI 实验依赖 M3 |
| [M8](./M8-paper-image-input.md) | 论文截图生成实验 | M3 |

## 建议推进顺序

主链路为 **M1 → M2 → M3 → M4**。M5、M6、M7 可在 M1/M2 后并行推进；M8 在 M3 后推进。每个阶段的验收标准以对应阶段文档为准。

## PRD 待决事项

- M1 开始前统一 Schema 示例与运行时生命周期接口命名。
- 首版建议四个预设先使用 Canvas 2D；是否引入 Three.js 应以实际场景需要为准。
- AI 请求经服务端代理；不得将服务端密钥放在浏览器端。用户自有 API Key 的保存方式需显式告知并由用户选择。
- AI 生成仿真代码应在隔离环境中执行；运行时错误与安全边界按 M1/M3/M4 的验收要求逐步落地。
