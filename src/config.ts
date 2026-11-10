/** §3 配置模型 —— 配置本体放宿主插件配置（ConfigService），工作区只放数据（§2.2） */

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
  chat: ChatModeConfig;
  tool: ToolModeConfig;
  memory: MemoryConfig;
}

export interface QqChatHarnessConfig {
  workspace: string;
  conversation: ConversationConfig;
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
    chat: { humanize: true, maxTypingDelayMs: 3000 },
    tool: { sendThinking: false },
    memory: { enabled: true, autoCapture: true, retrievalLimit: 8 },
  },
};

/** 字段级深合并，未给字段落默认值 */
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
  };
}
