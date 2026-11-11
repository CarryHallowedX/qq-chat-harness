# qq-chat-harness

QQ 机器人对话编排层插件（设计文档：`../qq-chat-harness-设计文档.md`，v1.1 统一策略版）。

**当前状态：M2-lite 完成** —— M1（工作区 + 两存储区 + 记忆读写）+ agents 拦截层（记忆区块路由 / 预设绑定 / 热切换）+ 记忆区块存储。
M2 正式管线（模式系统 + 信封 + MergeCap + ChatSanitizer）/ M3 思考闸门 + Humanizer + 会话内命令 / M4 锚文本 + 装傻策略 + ruleGuard 待做。

## 运行

- 需 Node ≥ 22.6（直接跑 TypeScript，无需编译）
- 冒烟测试：`npm run smoke`（= m1 存储区冒烟 + m2 路由冒烟，共 43+ 断言）
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
| `src/agents-hook.ts` | agents 拦截层：包装 create/resume/get，按 sessionKey 路由预设、SwappableAgent 代理热切换 |
| `src/memory/blocks.ts` | 记忆区块/预设绑定解析（通配优先→openid 首中、灰标）、SessionMemoryStore、生效表 Markdown |

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

## 插件设置（v0.2.1）

- `conversation.defaultMode`：聊天模式 / 工具模式（聊天模式硬性禁发思考，不受任何开关影响）。
- `conversation.restrictionRules`：输出内容限制规则文本（最高级提示词规则，仅聊天模式注入；冲突时装傻搪塞——行为执行在 M2 管线接入）。
- `conversation.maxReplyChars`：单次回复字数上限（1-8000，默认 800，全模式生效）。
- `conversation.tool.sendThinking`：工具模式思考发送开关（默认 false）。
- 设置存宿主插件配置（ConfigService），工作区只放数据（设计 §3）；默认值由 Config schema 兜底。

## 记忆和会话（v0.2.1，agents 拦截层）

插件通过 `ctx.inject(['agents'])` 包装宿主 agents 服务的 create / resume / get（dsh-subagent 同款模式），在 dsh 与 qqbot 之间实现按会话路由：

### 记忆区块（memoryBlocks）

- 设置里可创建任意多个区块，成员可填「群聊」「私聊」通配或具体 openid；同区块内所有会话**记忆互通**。
- 归属规则：**群聊/私聊通配优先**（按区块序首个命中），其次 openid 按序首中；一个 openid 只归一个区块，被遮蔽的重复项在生效表中标灰（⛔）。
- 记忆按 session 存 JSON（`memory/blocks/<区块>/sessions/<sessionKey>.json`，无区块会话落 `memory/solo/sessions/`），全局记忆 `memory/global.json` 对所有会话可见；**非本会话的记忆只读**。
- 每次 LLM 请求经 `system-prompt/assemble` 把检索到的区块记忆注入对话（`qq-chat-harness:memory` section，条数受 `retrievalLimit` 限制）。
- 工作区根目录的 `记忆区块-生效表.md` 实时展示各成员生效/灰标/待定状态与会话映射，可直接查看。

### 会话模式绑定（presetBindings）

- 每条绑定 = 预设 id（如 `standard` / `ptc` / `minimal` / `creative`）+ 成员（同上规则）；归属某绑定的会话用该预设创建 session。
- openid 已有 session 时**不改动原会话**：拦截层在同一 sessionId 上 dispose 旧 agent → resume 重放（热切换），失败自动回滚旧预设并在后续请求自愈重试。
- 预设清单在插件设置描述与生效表中列出；新增预设需重启宿主刷新。

### 生效表示例

见工作区 `记忆区块-生效表.md`（✅ 生效 / ⏳ 待定 / ⛔ 灰）。
