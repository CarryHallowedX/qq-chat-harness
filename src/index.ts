/**
 * qq-chat-harness 插件入口（M1）
 *
 * M1 交付：框架无关的 createHarnessServices bootstrap（工作区 + 两存储区 + 记忆读写，全对话）。
 * 接入 cordis（§13：export default 的 ctx.plugin 形态）属于 M2 与宿主联调的工作，
 * 届时服务创建逻辑保持不变，仅包一层 cordis 注入。
 */
import { resolveConfig } from './config.ts';
import type { DeepPartial, QqChatHarnessConfig } from './config.ts';
import { JsonStore } from './storage.ts';
import { initWorkspace } from './workspace.ts';
import type { WorkspaceHandle } from './workspace.ts';
import { MemoryManager } from './memory/manager.ts';
import { noopExtractor } from './memory/extractor.ts';
import type { MemoryExtractor } from './memory/extractor.ts';
import { MemeStore } from './memes/store.ts';
import * as conv from './conv.ts';

export type HarnessConfigInput = DeepPartial<QqChatHarnessConfig> & { workspace: string };

export interface HarnessServices {
  config: QqChatHarnessConfig;
  workspace: WorkspaceHandle;
  memory: MemoryManager;
  memes: MemeStore;
  extractor: MemoryExtractor;
  conv: typeof conv;
}

/** §11：工作区降级时记忆禁用、存储不落盘，但服务不抛错、消息功能照常 */
export async function createHarnessServices(input: HarnessConfigInput): Promise<HarnessServices> {
  const config = resolveConfig(input);
  const workspace = await initWorkspace(config.workspace);
  const store = new JsonStore(workspace.root);
  const onDegraded = (reason: string): void => {
    workspace.degraded = true;
    workspace.reason = workspace.reason ?? reason;
  };
  const memory = new MemoryManager(store, {
    retrievalLimit: config.conversation.memory.retrievalLimit,
    enabled: config.conversation.memory.enabled && !workspace.degraded,
    onDegraded,
  });
  const memes = new MemeStore(store, { enabled: !workspace.degraded, onDegraded });
  await memory.load();
  await memes.load();
  return { config, workspace, memory, memes, extractor: noopExtractor, conv };
}

export { resolveConfig, DEFAULT_CONFIG } from './config.ts';
export type {
  QqChatHarnessConfig,
  ConversationConfig,
  ChatModeConfig,
  ToolModeConfig,
  MemoryConfig,
} from './config.ts';
export { initWorkspace, WORKSPACE_SCHEMA_VERSION } from './workspace.ts';
export type { WorkspaceHandle, WorkspaceManifest } from './workspace.ts';
export { JsonStore, writeJsonAtomic } from './storage.ts';
export { MemoryManager } from './memory/manager.ts';
export type { MemoryAddInput, MemoryRetrieveOptions, MemoryManagerOptions } from './memory/manager.ts';
export { noopExtractor } from './memory/extractor.ts';
export type { MemoryExtractor, MemoryExtractInput, MemoryCandidate, TurnRecord } from './memory/extractor.ts';
export type { MemoryEntry, MemoryKind, MemoryScope } from './memory/types.ts';
export type { MemeEntry } from './memes/types.ts';
export { MemeStore } from './memes/store.ts';
export type { MemeLearnInput, MemeStoreOptions } from './memes/store.ts';
export {
  modeStateKey,
  groupScope,
  userScope,
  writeTargetsForTurn,
  retrievalScopes,
} from './conv.ts';
export type { ConversationRef, ConversationType } from './conv.ts';
