/**
 * cordis 宿主插件外壳（M2-lite：agents 拦截层 + 记忆和会话页签）
 *
 * 为什么存在：DSH 插件管理器只安装「组合包」（package.json 声明 dsh.bundle.patch），
 * 且宿主运行时不认识 TypeScript——所以包入口指向 dist/plugin.js（由 scripts/build-dist.mjs
 * 用 Node 内置 stripTypeScriptTypes 从本文件编译而来），src/*.ts 仍是开发真源。
 *
 * 本外壳做六件事：
 * ①声明 Config（schemastery，static Config + 模块导出双挂）；
 * ②「记忆和会话」页签：memoryBlocks（记忆区块）/ presetBindings（会话预设绑定）；
 * ③惰性创建服务组（createHarnessServices）；
 * ④ctx.inject(['agents']) 安装 AgentsHook：create/resume/get 拦截 + 会话预设路由 + 热切换代理；
 * ⑤ctx.on('system-prompt/assemble')：把会话可读记忆（全局+生效区块）注入 system prompt；
 * ⑥状态文件：workspace/记忆区块-生效表.md（成员生效/灰/待定 + 会话映射 + 可用预设）。
 */
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHarnessServices } from './index.ts';
import type { HarnessServices } from './index.ts';
import { AgentsHook, parseSessionKey } from './agents-hook.ts';
import { buildStatusMarkdown } from './memory/blocks.ts';
import type { SessionKind, SessionMemoryEntry } from './memory/blocks.ts';

export type ChatMode = 'chat' | 'tool';

export interface QqChatHarnessPluginConfig {
  workspace: string;
  autoCapture: boolean;
  retrievalLimit: number;
  memoryBlocks: { name: string; members: string[] }[];
  presetBindings: { presetId: string; members: string[] }[];
  conversation: {
    defaultMode: ChatMode;
    restrictionRules: string;
    maxReplyChars: number;
    tool: { sendThinking: boolean };
  };
}

const configSchema = z.object({
  /** 工作区根目录（记忆存储区 + 表情包存储区所在）。留空 = 用户主目录下 qq-harness-workspace */
  workspace: z.string().default(''),
  /** 回合后自动提炼记忆 */
  autoCapture: z.boolean().default(true),
  /** 每回合注入记忆条数上限 */
  retrievalLimit: z.natural().min(1).max(64).default(8),
  /** 「记忆和会话」页签：记忆区块。成员填「群聊」「私聊」（通配，优先级最高）或 openid；同一区块内的会话记忆互通 */
  memoryBlocks: z
    .array(
      z.object({
        /** 区块名（留空显示为 block-N） */
        name: z.string().default(''),
        /** 成员列表：「群聊」/「私聊」/openid。openid 被通配收编时该成员标灰；每个 openid 只归属首个包含它的区块 */
        members: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** 「记忆和会话」页签：会话预设绑定。presetId 参考宿主预设（standard/ptc/minimal/creative…，重启宿主后可在工作区「记忆区块-生效表.md」查看可用清单）；归属某绑定的会话用该预设创建（已有 session 则热切换/下次冷开启生效） */
  presetBindings: z
    .array(
      z.object({
        /** 宿主 agent 预设 id */
        presetId: z.string().default(''),
        /** 成员列表：规则同记忆区块 */
        members: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** 对话设置 */
  conversation: z.object({
    /** 对话模式：聊天（只许文本+表情包，禁思考）或工具（正常 agent） */
    defaultMode: z.union(['chat', 'tool']).default('chat'),
    /** 输出内容限制规则（最高级提示词规则，仅聊天模式注入；冲突时装傻搪塞） */
    restrictionRules: z.string().default('').role('textarea'),
    /** 单次回复字数上限（1-8000，默认 800） */
    maxReplyChars: z.natural().min(1).max(8000).default(800),
    /** 工具模式 */
    tool: z.object({
      /** 工具模式是否发送思考（聊天模式硬性禁发，不受此项影响） */
      sendThinking: z.boolean().default(false),
    }),
  }),
});

export const Config = configSchema;

/** 记忆区渲染：条目一行一条（不含思考过程，存储层也不落思考） */
function renderMemorySection(entries: SessionMemoryEntry[]): string {
  const lines = ['以下是关于该会话的记忆（供参考）：'];
  for (const e of entries) {
    const tags = e.tags.length > 0 ? '（标签：' + e.tags.join('、') + '）' : '';
    lines.push('- ' + e.text + tags);
  }
  return lines.join('\n');
}

interface AssembledPrompt {
  sections?: { name?: string; order?: number; text?: string }[];
  [k: string]: unknown;
}

interface CordisCtx {
  get?(name: string): unknown;
  inject?(services: string[], cb: (provider: unknown) => void): void;
  on?(event: string, cb: (...args: unknown[]) => unknown): unknown;
  effect(fn: () => () => Promise<void> | void): void;
}

class QqChatHarnessService extends Service {
  static Config = configSchema;

  private config: QqChatHarnessPluginConfig;
  private ready: Promise<HarnessServices> | null = null;
  private hook: AgentsHook | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(ctx: unknown, config: QqChatHarnessPluginConfig) {
    super(ctx, 'qq-chat-harness');
    this.config = config;
    const c = ctx as CordisCtx;
    // 清理：还还原 agents 三方法、停状态表定时器（句柄表留在模块级，同进程重装可续用归因）
    c.effect(() => async () => {
      this.disposed = true;
      if (this.statusTimer) {
        clearTimeout(this.statusTimer);
        this.statusTimer = null;
      }
      this.hook?.dispose();
      this.hook = null;
    });
    // agents 服务可用后安装拦截层（防御式：宿主未提供 inject 时不炸，插件其余功能照常）
    if (typeof c.inject === 'function') {
      try {
        c.inject(['agents'], (provider: unknown) => {
          void this.onAgentsAvailable(c, provider);
        });
      } catch (err) {
        this.log('warn', '注册 agents 注入失败（拦截层不启用）: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
    // system-prompt/assemble：会话记忆注入（对齐 qqbot registerScopePromptInjection 的写法）
    if (typeof c.on === 'function') {
      try {
        c.on('system-prompt/assemble', (assembly: unknown, context: unknown, next: unknown) =>
          this.onAssemble(assembly, context, next as () => Promise<AssembledPrompt>),
        );
      } catch (err) {
        this.log('warn', '注册 system-prompt/assemble 失败（记忆不注入，消息照常）: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    const logger = (this as unknown as { logger?: Record<string, ((m: string) => void) | undefined> }).logger;
    const fn = logger?.[level] ?? (level === 'info' ? console.log : level === 'warn' ? console.warn : console.error);
    fn('[qq-chat-harness] ' + msg);
  }

  /** 惰性创建服务组（工作区初始化失败会走 §11 降级，不会抛错） */
  ensure(): Promise<HarnessServices> {
    if (!this.ready) {
      const root = this.config.workspace || path.join(os.homedir(), 'qq-harness-workspace');
      const cc = this.config.conversation;
      this.ready = createHarnessServices({
        workspace: root,
        memoryBlocks: this.config.memoryBlocks,
        presetBindings: this.config.presetBindings,
        conversation: {
          defaultMode: cc.defaultMode,
          restrictionRules: cc.restrictionRules,
          maxReplyChars: cc.maxReplyChars,
          tool: { sendThinking: cc.tool.sendThinking },
          memory: {
            enabled: true,
            autoCapture: this.config.autoCapture,
            retrievalLimit: this.config.retrievalLimit,
          },
        },
      });
    }
    return this.ready;
  }

  /** 解析预设为 {agentPreset, setup}（对齐 qqbot composePreset：agentPresets.resolve + mount） */
  private makeComposePreset(c: CordisCtx) {
    return async (presetId: string): Promise<{ agentPreset?: string; setup?: (agentCtx: unknown) => Promise<void> }> => {
      const presets = c.get?.('agentPresets') as
        | { resolve?: (id: string) => { id?: string } | undefined; mount?: (agentCtx: unknown, id: string) => Promise<void> }
        | undefined;
      if (!presets || typeof presets.resolve !== 'function' || typeof presets.mount !== 'function') return {};
      const resolved = presets.resolve(presetId);
      if (!resolved || !resolved.id) return {};
      return {
        agentPreset: resolved.id,
        setup: async (agentCtx: unknown) => {
          await presets.mount!(agentCtx, resolved.id!);
        },
      };
    };
  }

  /** agents 上下文就绪：装拦截层 + 刷状态表 */
  private async onAgentsAvailable(c: CordisCtx, provider: unknown): Promise<void> {
    try {
      const services = await this.ensure();
      const p = provider as { agents?: unknown; get?(name: string): unknown } | undefined;
      const agents = (p?.agents ?? p?.get?.('agents')) as Record<string, unknown> | undefined;
      if (!agents || typeof agents !== 'object') {
        this.log('warn', 'agents 服务不可见（拦截层不启用；记忆注入与预设路由失效）');
        return;
      }
      this.hook = new AgentsHook({
        workspaceRoot: services.workspace.root,
        prefsPath: path.join(os.homedir(), '.dsh-qqbot', 'model-prefs.json'),
        getConfig: () => ({
          memoryBlocks: this.config.memoryBlocks ?? [],
          presetBindings: this.config.presetBindings ?? [],
        }),
        composePreset: this.makeComposePreset(c),
        log: (level, msg) => this.log(level, msg),
        onStateChange: () => this.scheduleStatusFlush(c),
      });
      await this.hook.install(agents);
      this.scheduleStatusFlush(c);
    } catch (err) {
      this.log('error', '拦截层安装失败（消息不受影响，路由/记忆注入降级）: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** system-prompt/assemble：把会话可读记忆追加为 prompt section */
  private async onAssemble(_assembly: unknown, context: unknown, next: () => Promise<AssembledPrompt>): Promise<AssembledPrompt> {
    const assembled = await next();
    try {
      const agent = (context as { agent?: unknown } | undefined)?.agent;
      if (!agent || !this.hook) return assembled;
      const key = this.hook.keyOfAgent(agent);
      const parsed = key ? parseSessionKey(key) : null;
      if (!parsed) return assembled;
      const services = await this.ensure();
      const memCfg = services.config.conversation.memory;
      if (!memCfg.enabled) return assembled;
      const entries = await services.blocks.readForSession(
        { kind: parsed.kind, peerId: parsed.peerId, key: key! },
        memCfg.retrievalLimit,
      );
      if (!entries.length) return assembled;
      return {
        ...assembled,
        sections: [
          ...(assembled.sections ?? []),
          { name: 'qq-chat-harness:memory', order: 85, text: renderMemorySection(entries) },
        ],
      };
    } catch (err) {
      this.log('warn', '记忆注入失败（本轮无记忆）: ' + (err instanceof Error ? err.message : String(err)));
      return assembled;
    }
  }

  /** 状态表刷新（2s 防抖，写 workspace/记忆区块-生效表.md） */
  private scheduleStatusFlush(c: CordisCtx): void {
    if (this.disposed) return;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      void this.writeStatusFile(c);
    }, 2000);
  }

  private async writeStatusFile(c: CordisCtx): Promise<void> {
    try {
      const services = await this.ensure();
      if (services.workspace.degraded) return;
      const observed = this.hook?.getObserved() ?? [];
      const knownKinds = new Map<string, SessionKind>();
      for (const o of observed) knownKinds.set(o.peerId, o.kind);
      let availablePresets: string[] = [];
      try {
        const presets = c.get?.('agentPresets') as { list?: () => { id?: string }[] } | undefined;
        availablePresets = (presets?.list?.() ?? []).map((x) => x?.id ?? '').filter((s) => s !== '');
      } catch {
        /* 宿主未暴露预设清单 */
      }
      const md = buildStatusMarkdown({
        blocks: this.config.memoryBlocks ?? [],
        bindings: this.config.presetBindings ?? [],
        observed,
        knownKinds,
        availablePresets,
        generatedAt: Date.now(),
      });
      await mkdir(services.workspace.root, { recursive: true });
      await writeFile(path.join(services.workspace.root, '记忆区块-生效表.md'), md, 'utf8');
    } catch {
      /* 状态文件失败不影响主功能 */
    }
  }
}

export { QqChatHarnessService as default };
