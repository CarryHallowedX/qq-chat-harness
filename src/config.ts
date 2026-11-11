/**
 * §3 配置模型 —— 配置本体放宿主插件配置（ConfigService），工作区只放数据（§2.2）
 *
 * v0.2.1 新增：「记忆和会话」页签的 memoryBlocks / presetBindings（成员=群聊/私聊/openid），
 * 解析与存储见 memory/blocks.ts。
 */
import type { MemberGroupConfig, PresetBindingConfig } from './memory/blocks.ts';

export interface ChatModeConfig {
  /** 模拟打字延迟，默认 true */
  humanize: boolean;
  /** 打字延迟上限，默认 3000 */
  maxTypingDelayMs: number;
}

export interface ToolModeConfig {
  /** 思考发送开关，默认 false */
  sendThinking: boolean;
}

export interface MemoryConfig {
  /** 默认 true */
  enabled: boolean;
  /** 回合后自动提炼，默认 true */
  autoCapture: boolean;
  /** 每回合注入记忆条数上限，默认 8 */
  retrievalLimit: number;
}

export interface ConversationConfig {
  defaultMode: 'chat' | 'tool';
  modeSwitchAdminOnly: boolean;
  admins: string[];
  /** 人设文本框（最高级规则，两种模式都注入） */
  persona: string;
  /** 输出限制规则文本框（最高级规则，仅聊天模式注入） */
  restrictionRules: string;
  /** 单次回复字数上限（所有模式生效，默认 800） */
  maxReplyChars: number;
  chat: ChatModeConfig;
  tool: ToolModeConfig;
  memory: MemoryConfig;
}

export interface QqChatHarnessConfig {
  workspace: string;
  conversation: ConversationConfig;
  /** 「记忆和会话」页签：记忆区块（成员=群聊/私聊/openid，通配优先级最高） */
  memoryBlocks: MemberGroupConfig[];
  /** 「记忆和会话」页签：会话预设绑定（presetId=宿主 agent 预设 id，规则同区块） */
  presetBindings: PresetBindingConfig[];
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U> ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type HarnessConfigInput = DeepPartial<QqChatHarnessConfig> & { workspace: string };

export const DEFAULT_CONFIG: QqChatHarnessConfig = {
  workspace: '',
  conversation: {
    defaultMode: 'chat',
    modeSwitchAdminOnly: true,
    admins: [],
    persona: '',
    restrictionRules: '',
    maxReplyChars: 800,
    chat: { humanize: true, maxTypingDelayMs: 3000 },
    tool: { sendThinking: false },
    memory: { enabled: true, autoCapture: true, retrievalLimit: 8 },
  },
  memoryBlocks: [],
  presetBindings: [],
};

/** 区块/绑定成员规范化（未知字段丢弃、成员去重） */
function normMemberGroup(b: MemberGroupConfig | undefined): MemberGroupConfig {
  const members = Array.isArray(b?.members) ? [...new Set(b.members.filter((m) => typeof m === 'string' && m.trim()))] : [];
  return { name: typeof b?.name === 'string' ? b.name : '', members };
}

function normPresetBinding(b: PresetBindingConfig | undefined): PresetBindingConfig {
  const members = Array.isArray(b?.members) ? [...new Set(b.members.filter((m) => typeof m === 'string' && m.trim()))] : [];
  return { presetId: typeof b?.presetId === 'string' ? b.presetId.trim() : '', members };
}

/** 字段级深合并，未给字段落默认值（数组整体替换，不做元素级合并） */
export function resolveConfig(input: HarnessConfigInput): QqChatHarnessConfig {
  const c = input.conversation ?? {};
  return {
    workspace: input.workspace,
    conversation: {
      defaultMode: c.defaultMode ?? DEFAULT_CONFIG.conversation.defaultMode,
      modeSwitchAdminOnly: c.modeSwitchAdminOnly ?? DEFAULT_CONFIG.conversation.modeSwitchAdminOnly,
      admins: [...(c.admins ?? [])],
      persona: c.persona ?? '',
      restrictionRules: c.restrictionRules ?? '',
      maxReplyChars: c.maxReplyChars ?? DEFAULT_CONFIG.conversation.maxReplyChars,
      chat: {
        humanize: c.chat?.humanize ?? DEFAULT_CONFIG.conversation.chat.humanize,
        maxTypingDelayMs: c.chat?.maxTypingDelayMs ?? DEFAULT_CONFIG.conversation.chat.maxTypingDelayMs,
      },
      tool: {
        sendThinking: c.tool?.sendThinking ?? DEFAULT_CONFIG.conversation.tool.sendThinking,
      },
      memory: {
        enabled: c.memory?.enabled ?? DEFAULT_CONFIG.conversation.memory.enabled,
        autoCapture: c.memory?.autoCapture ?? DEFAULT_CONFIG.conversation.memory.autoCapture,
        retrievalLimit: c.memory?.retrievalLimit ?? DEFAULT_CONFIG.conversation.memory.retrievalLimit,
      },
    },
    memoryBlocks: Array.isArray(input.memoryBlocks) ? input.memoryBlocks.map(normMemberGroup) : [],
    presetBindings: Array.isArray(input.presetBindings) ? input.presetBindings.map(normPresetBinding) : [],
  };
}
