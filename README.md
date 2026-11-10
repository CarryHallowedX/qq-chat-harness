# qq-chat-harness

QQ 机器人对话编排层插件（设计文档：`../qq-chat-harness-设计文档.md`，v1.1 统一策略版）。

**当前状态：M1 完成** —— 工作区 + 两存储区 + 记忆读写（全对话）。
M2 模式系统 + 信封 + MergeCap + ChatSanitizer / M3 思考闸门 + Humanizer + 会话内命令 / M4 锚文本 + 装傻策略 + ruleGuard 待做。

## 运行

- 需 Node ≥ 22.6（直接跑 TypeScript，无需编译）
- 冒烟测试：`node test/m1-smoke.ts`（或 `npm run smoke`）
- 类型检查（可选，需自装 typescript）：`npm run typecheck`

## 结构（对应设计文档 §13）

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | `createHarnessServices` bootstrap + 公共导出（cordis 注入 M2 接入） |
| `src/config.ts` | §3 配置模型 + 默认值 + resolveConfig |
| `src/workspace.ts` | §2 工作区骨架 / manifest / §11 降级判定 |
| `src/storage.ts` | JSON 原子读写（tmp+rename）、损坏留证 |
| `src/conv.ts` | ConvResolver：会话 → 记忆作用域 / 模式状态键 |
| `src/memory/` | §7 MemoryManager（三级作用域、打分检索、去重合并、遗忘）+ Extractor 桩 |
| `src/memes/` | §8 MemeStore（byTag / byQuery / learn / importImage / update / remove） |
| `src/util.ts` | 小工具（genId / clamp01 / normalizeText…） |

注：`storage.ts` `workspace.ts` `util.ts` 为实现性拆分，§13 布局之外的地基件。

## 关键行为

- **统一策略**：记忆读写、后续的模式/规则/上限对群聊与私聊一致；仅数据键不同（`group:<id>` vs `user:<id>`）。
- **检索打分**：importance × 30 天半衰 × 命中加成 × 作用域等级（user 1.25 > group 1.1 > global 1.0）× 查询相关性。
- **去重合并**：同作用域内归一化同文 → importance 取最大、tags 并集。
- **降级（§11）**：工作区不可写 → 记忆禁用、不落盘，服务不抛错。
- **表情收录**：仅显式收藏走 `learn`；`importImage` 负责把磁盘图片拷入 `memes/images/`。

## 安装为 DSH 插件（v0.2.0 起）

本包已声明 DSH 组合包（`dsh.bundle.patch`），可在宿主插件管理器直接安装：

- 安装后插件以 cordis 服务 `qq-chat-harness` 挂载，配置项见 `cordis.patch.yml`（workspace / autoCapture / retrievalLimit），后续可在插件配置里改。
- `workspace` 留空时回退到用户主目录下的 `qq-harness-workspace`。
- 包入口是 `dist/plugin.js`（由 `scripts/build-dist.mjs` 用 Node 内置 stripTypeScriptTypes 从 `src/*.ts` 编译而来）；改动 `src` 后先 `pnpm build` 再重装/重启。
- `src/plugin.ts` 依赖宿主提供的 `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`（peerDependencies，由宿主解析），不参与本地 `pnpm typecheck`（tsconfig 已排除）。
