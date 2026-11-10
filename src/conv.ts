/** §10.3 ConvResolver：会话 id/类型 → 记忆作用域与模式状态键（v1.1 群/私统一策略，仅数据键不同） */
import type { MemoryScope } from './memory/types.ts';

export type ConversationType = 'group' | 'private';

export interface ConversationRef {
  /** 会话 id（群聊=群 id，私聊=c2c 会话 id） */
  convId: string;
  type: ConversationType;
  /** 发言者 id；私聊中即对方 */
  userId?: string;
}

/** §4.1 模式状态键：每会话一个 mode */
export function modeStateKey(ref: ConversationRef): string {
  return ref.convId;
}

export function groupScope(id: string): MemoryScope {
  return `group:${id}`;
}

export function userScope(id: string): MemoryScope {
  return `user:${id}`;
}

/** §7.1/§10.3：本回合应写入的记忆作用域。群聊=群+发言者；私聊=仅 user */
export function writeTargetsForTurn(ref: ConversationRef): MemoryScope[] {
  if (ref.type === 'private') {
    return [userScope(ref.userId ?? ref.convId)];
  }
  const targets: MemoryScope[] = [groupScope(ref.convId)];
  if (ref.userId && ref.userId !== ref.convId) {
    targets.push(userScope(ref.userId));
  }
  return targets;
}

/** §7.1：本回合检索涉及的会话级作用域（global 由 MemoryManager 检索时自动并入） */
export function retrievalScopes(ref: ConversationRef): MemoryScope[] {
  if (ref.type === 'private') {
    return [userScope(ref.userId ?? ref.convId)];
  }
  return [groupScope(ref.convId), userScope(ref.userId ?? ref.convId)];
}
