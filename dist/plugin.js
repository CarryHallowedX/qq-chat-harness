/**
 * cordis 宿主插件外壳（M2-lite）
 *
 * 为什么存在：DSH 插件管理器只安装「组合包」（package.json 声明 dsh.bundle.patch），
 * 且宿主运行时不认识 TypeScript——所以包入口指向 dist/plugin.js（由 scripts/build-dist.mjs
 * 用 Node 内置 stripTypeScriptTypes 从本文件编译而来），src/*.ts 仍是开发真源。
 *
 * 本外壳做四件事：声明 Config（schemastery，同时挂在类的 static Config 与模块导出上，
 * Service 类 default export 形态的加载器读前者）、把设置直通给服务组（resolveConfig 深合并兜底）、
 * 惰性创建 M1 的服务组（createHarnessServices）、挂进 cordis（写法范式对齐 dsh-experimental-translator）。
 * 设置语义（§3/§6）：聊天模式禁发思考是硬规则不受开关控制；tool.sendThinking 只管工具模式；
 * restrictionRules 是最高级规则但仅聊天模式注入；maxReplyChars 全模式生效——行为执行在 M2 管线接入。
 */
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHarnessServices } from './index.js';
                                                  

                                       

                                            
                    
                       
                         
                 
                          
                             
                          
                                    
    
 

const configSchema = z.object({
  /** 工作区根目录（记忆存储区 + 表情包存储区所在）。留空 = 用户主目录下 qq-harness-workspace */
  workspace: z.string().default(''),
  /** 回合后自动提炼记忆 */
  autoCapture: z.boolean().default(true),
  /** 每回合注入记忆条数上限 */
  retrievalLimit: z.natural().min(1).max(64).default(8),
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

class QqChatHarnessService extends Service {
  static Config = configSchema;

          config                           ;
          ready                                  = null;

  constructor(ctx         , config                           ) {
    super(ctx, 'qq-chat-harness');
    this.config = config;
    // 存储全部文件落盘，无进程内资源需要清理；登记空清理函数只是表个态。
    (ctx                                                   ).effect(() => async () => {});
  }

  /** 惰性创建服务组（工作区初始化失败会走 §11 降级，不会抛错） */
  ensure()                           {
    if (!this.ready) {
      const root = this.config.workspace || path.join(os.homedir(), 'qq-harness-workspace');
      const cc = this.config.conversation;
      this.ready = createHarnessServices({
        workspace: root,
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
}

export { QqChatHarnessService as default };
