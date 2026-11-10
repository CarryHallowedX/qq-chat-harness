/**
 * §7.3 自动提炼通道（M1 桩）：真实提炼依赖廉价 LLM 从回合对话抽 importance ≥ 0.5 的事实。
 * 接口先行，M3/M4 在拿到 AgentRunner 后接入实现；M1 阶段用 noop。
 */
import type { MemoryKind, MemoryScope } from './types.ts';

export interface TurnRecord {
  role: 'user' | 'assistant';
  /** user 消息的发言者 id */
  userId?: string;
  text: string;
}

export interface MemoryExtractInput {
  convId: string;
  turns: TurnRecord[];
  /** 本回合的写入目标作用域（ConvResolver.writeTargetsForTurn 的产物） */
  writeTargets: MemoryScope[];
}

export interface MemoryCandidate {
  scope: MemoryScope;
  kind: MemoryKind;
  text: string;
  tags?: string[];
  importance: number;
  sourceRefs?: string[];
}

export interface MemoryExtractor {
  extract(input: MemoryExtractInput): Promise<MemoryCandidate[]>;
}

export const noopExtractor: MemoryExtractor = {
  async extract(): Promise<MemoryCandidate[]> {
    return [];
  },
};
