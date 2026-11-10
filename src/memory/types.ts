/** §7.2 记忆数据结构 */

export type MemoryScope = 'global' | `group:${string}` | `user:${string}`;

export type MemoryKind = 'fact' | 'preference' | 'event' | 'summary' | 'relationship';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  /** 一句话事实，禁长文 */
  text: string;
  tags: string[];
  /** 0~1 */
  importance: number;
  createdAt: number;
  /** 实现扩展：合并/编辑时间戳（去重合并用，§7.3） */
  updatedAt?: number;
  lastHitAt?: number;
  hitCount?: number;
  /** 来源会话/消息引用 */
  sourceRefs?: string[];
}
