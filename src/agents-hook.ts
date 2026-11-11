/**
 * agents 服务拦截层（M2-lite 接线）
 *
 * 原理（勘察结论，均以宿主实码为准）：
 * - dsh-qqbot 对宿主的全部依赖是 agents 服务的 create/resume/get 三方法
 *   （session-manager.js openSession L415-482）；本插件声明 inject: ['agents']，
 *   在服务实例上做属性遮蔽包装（官方先例：dsh-subagent 对 agents 装钩子）。
 * - 事件回路按 session.header.id 反查 record（outbound.js L40-46）——换 sessionId
 *   会让回复静默丢失，所以热切换必须保持同 id。
 * - jsonl 持久化每个 id 只允许一个活跃写句柄（SessionAlreadyOwnedError），
 *   而 handle.dispose() 的 teardown 链会 close() 释放写锁（agent-loop initializeAgent），
 *   因此「先 dispose 旧句柄 → 同 id resume（新 setup）」即可在锁语义下完成热切换。
 * - 失败兜底：同 id 换装失败 → 回滚旧预设 resume；再失败 → 保旧 + 报错日志，
 *   路由最迟在会话冷开启（重启/重建）时生效；绝不静默换新 id。
 */
import { readFileSync } from 'node:fs';
import { JsonStore } from './storage.ts';
import { resolvePresetBinding } from './memory/blocks.ts';
import type { ObservedSession, PresetBindingConfig, MemberGroupConfig, SessionKind } from './memory/blocks.ts';

export interface ParsedKey {
  appId: string;
  kind: SessionKind;
  peerId: string;
}

/** sessionKey 形如 qqbot:<appId>:<c2c|group>:<peerId>（dsh-qqbot session-manager.js L356-358） */
export function parseSessionKey(key: string): ParsedKey | null {
  const m = /^qqbot:([^:]+):(c2c|group):(.+)$/.exec(key ?? '');
  if (!m) return null;
  return { appId: m[1], kind: m[2] as SessionKind, peerId: m[3] };
}

export interface AgentHandle {
  agent: unknown;
  dispose?: () => Promise<void> | void;
}

export interface ComposePresetResult {
  agentPreset?: string;
  setup?: (agentCtx: unknown) => Promise<void>;
}

export type ComposePreset = (presetId: string) => Promise<ComposePresetResult>;

export interface HookConfig {
  memoryBlocks: MemberGroupConfig[];
  presetBindings: PresetBindingConfig[];
}

export interface AgentsHookOptions {
  /** 插件工作区根（state/agents-routing.json 落这里） */
  workspaceRoot: string;
  /** dsh-qqbot 的 model-prefs.json 路径（只读，用于 sessionKey↔sessionId 归因） */
  prefsPath: string;
  /** 读当前插件配置（区块+绑定），保持活引用以便热改配置生效 */
  getConfig: () => HookConfig;
  /** 解析预设为 {agentPreset, setup}（对齐 qqbot composePreset：agentPresets.resolve + mount） */
  composePreset: ComposePreset;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** 归因/路由状态变化（刷状态文件） */
  onStateChange?: () => void;
  /** 新会话归属轮询参数（默认 12 次 × 250ms；测试可调小） */
  pollAttempts?: number;
  pollIntervalMs?: number;
}

interface RoutingSessionEntry {
  key: string;
  kind: SessionKind;
  peerId: string;
  sessionId: string;
  /** 出生预设（'' = 未知） */
  presetId: string;
  createdAt: number;
}

interface RoutingStateFile {
  version: 1;
  sessions: Record<string, RoutingSessionEntry>;
}

const STATE_REL = 'state/agents-routing.json';
const STATE_CAP = 500;
const HARNESS = Symbol.for('qq-chat-harness:proxy');

interface ProxyState {
  sessionId: string;
  keyPromise: Promise<string | null>;
  current: Record<string, unknown>;
  /** 出生预设；null = 尚未观察（首次 swapCheck 时采纳 routed） */
  birthPreset: string | null;
  swapping: boolean;
  chain: Promise<void>;
  degradedLogged: boolean;
}

/** 模块级共享：插件重载（同进程 require 缓存命中）时句柄/归因得以延续 */
const SHARED = {
  agents: null as unknown as Record<string, unknown> | null,
  orig: null as null | { create: (o: unknown) => Promise<AgentHandle>; resume: (o: unknown) => Promise<AgentHandle>; get: (id: string) => unknown },
  handles: new Map<string, { handle: AgentHandle }>(),
  proxies: new Map<string, ProxyState>(),
  getConfig: (): HookConfig => ({ memoryBlocks: [], presetBindings: [] }),
  composePreset: (async () => ({})) as ComposePreset,
  prefsPath: '',
  log: ((_l: string, _m: string) => {}) as (l: 'info' | 'warn' | 'error', m: string) => void,
  onStateChange: (() => {}) as () => void,
  state: { version: 1, sessions: {} } as RoutingStateFile,
  stateDirty: false,
  pollAttempts: 12,
  pollIntervalMs: 250,
  prefsCache: { at: 0, data: null as { sessionIds?: Record<string, string> } | null },
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function readPrefs(): { sessionIds?: Record<string, string> } | null {
  if (!SHARED.prefsPath) return null;
  const now = Date.now();
  if (SHARED.prefsCache.data && now - SHARED.prefsCache.at < 5_000) return SHARED.prefsCache.data;
  try {
    const raw = readFileSync(SHARED.prefsPath, 'utf8');
    const parsed = JSON.parse(raw) as { sessionIds?: Record<string, string> };
    SHARED.prefsCache = { at: now, data: parsed };
    return parsed;
  } catch {
    SHARED.prefsCache = { at: now, data: null };
    return null;
  }
}

export class AgentsHook {
  private installed = false;

  private readonly opts: AgentsHookOptions;

  constructor(opts: AgentsHookOptions) {
    this.opts = opts;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    (this.opts.log ?? SHARED.log)(level, msg);
  }

  /** 在 agents 服务实例上装拦截（属性遮蔽；dispose 可还原） */
  async install(agents: Record<string, unknown>): Promise<void> {
    if (this.installed) this.dispose();
    // 读状态文件
    try {
      const store = new JsonStore(this.opts.workspaceRoot);
      const loaded = await store.readJson<RoutingStateFile>(STATE_REL, { version: 1, sessions: {} });
      SHARED.state = loaded && loaded.sessions ? loaded : { version: 1, sessions: {} };
    } catch {
      SHARED.state = { version: 1, sessions: {} };
    }
    SHARED.agents = agents;
    SHARED.orig = {
      create: agents.create as (o: unknown) => Promise<AgentHandle>,
      resume: agents.resume as (o: unknown) => Promise<AgentHandle>,
      get: agents.get as (id: string) => unknown,
    };
    SHARED.getConfig = this.opts.getConfig;
    SHARED.composePreset = this.opts.composePreset;
    SHARED.prefsPath = this.opts.prefsPath;
    SHARED.log = this.opts.log ?? SHARED.log;
    SHARED.onStateChange = this.opts.onStateChange ?? SHARED.onStateChange;
    SHARED.pollAttempts = this.opts.pollAttempts ?? 12;
    SHARED.pollIntervalMs = this.opts.pollIntervalMs ?? 250;
    const self = this;
    agents.create = async function (options: unknown) {
      return self.interceptCreate(options);
    };
    agents.resume = async function (options: unknown) {
      return self.interceptResume(options);
    };
    agents.get = function (sessionId: string) {
      return self.interceptGet(sessionId);
    };
    this.installed = true;
    this.log('info', 'agents 拦截层已安装（记忆区块 + 会话预设路由）');
  }

  /** 还原 agents 上的三个原方法；句柄/归因表保留（同进程重装可续用） */
  dispose(): void {
    if (!this.installed || !SHARED.agents || !SHARED.orig) {
      this.installed = false;
      return;
    }
    try {
      SHARED.agents.create = SHARED.orig.create;
      SHARED.agents.resume = SHARED.orig.resume;
      SHARED.agents.get = SHARED.orig.get;
    } catch {
      /* 宿主对象异常时放弃还原，避免崩溃 */
    }
    SHARED.agents = null;
    this.installed = false;
  }

  // ---------- 归因 ----------

  private stateEntry(sessionId: string): RoutingSessionEntry | undefined {
    return SHARED.state.sessions[sessionId];
  }

  /** prefs 反查：sessionIds[key] === sessionId */
  private prefsReverse(sessionId: string): string | null {
    const prefs = readPrefs();
    const map = prefs?.sessionIds;
    if (!map) return null;
    for (const [key, id] of Object.entries(map)) {
      if (id === sessionId) return key;
    }
    return null;
  }

  keyOfSessionId(sessionId: string): string | null {
    return this.stateEntry(sessionId)?.key ?? this.prefsReverse(sessionId);
  }

  /** assemble 归因：内部 agent 对象 → sessionKey */
  keyOfAgent(agent: unknown): string | null {
    for (const [sid, ps] of SHARED.proxies) {
      if (ps.current === agent) return this.keyOfSessionId(sid);
    }
    return null;
  }

  private routedPresetFor(kind: SessionKind, peerId: string): string {
    return resolvePresetBinding(SHARED.getConfig().presetBindings, kind, peerId).presetId;
  }

  private async safeCompose(presetId: string): Promise<ComposePresetResult> {
    try {
      return await SHARED.composePreset(presetId);
    } catch (err) {
      this.log('warn', '预设 ' + presetId + ' 解析失败（im-qqbot 同款兜底）: ' + errMsg(err));
      return {};
    }
  }

  private async saveState(): Promise<void> {
    try {
      const sessions = Object.values(SHARED.state.sessions).sort((a, b) => b.createdAt - a.createdAt).slice(0, STATE_CAP);
      const next: RoutingStateFile = { version: 1, sessions: {} };
      for (const e of sessions) next.sessions[e.sessionId] = e;
      SHARED.state = next;
      const store = new JsonStore(this.opts.workspaceRoot);
      await store.writeJson(STATE_REL, SHARED.state);
      SHARED.onStateChange();
    } catch (err) {
      this.log('warn', '路由状态落盘失败: ' + errMsg(err));
    }
  }

  private async attributeNow(sessionId: string, key: string, presetId: string): Promise<void> {
    const parsed = parseSessionKey(key);
    if (!parsed || !sessionId) return;
    const prev = SHARED.state.sessions[sessionId];
    SHARED.state.sessions[sessionId] = {
      key,
      kind: parsed.kind,
      peerId: parsed.peerId,
      sessionId,
      presetId,
      createdAt: prev?.createdAt ?? Date.now(),
    };
    await this.saveState();
  }

  /** 新 peer 归因：create 返回后轮询 prefs，等 qqbot 把 sessionKey 记到 sessionId */
  private async pollAndAttribute(sessionId: string, keyPromise: Promise<string | null>, presetId: string): Promise<void> {
    try {
      const key = await keyPromise;
      if (key) await this.attributeNow(sessionId, key, presetId);
    } catch {
      /* 归因失败不影响消息流 */
    }
  }

  private pollPrefsForSessionId(sessionId: string): Promise<string | null> {
    const attempts = SHARED.pollAttempts;
    const interval = SHARED.pollIntervalMs;
    return new Promise((resolve) => {
      let n = 0;
      const tick = (): void => {
        n += 1;
        const key = this.prefsReverse(sessionId);
        if (key) {
          resolve(key);
          return;
        }
        if (n >= attempts) {
          resolve(null);
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  // ---------- 三个拦截点 ----------

  /** create 拦截：已知归属则改写 meta.agentPreset + setup；返回句柄的 agent 包代理 */
  private async interceptCreate(options: unknown): Promise<AgentHandle> {
    const orig = SHARED.orig!;
    const o = (options ?? {}) as {
      sessionId?: string;
      meta?: { agentPreset?: string; cwd?: string };
      setup?: (agentCtx: unknown) => Promise<void>;
    };
    const sessionId = o.sessionId ?? '';
    let key = sessionId ? this.keyOfSessionId(sessionId) : null;
    let birthPreset: string | null = null;
    let req = options;
    if (key) {
      const parsed = parseSessionKey(key);
      if (parsed) {
        const routed = this.routedPresetFor(parsed.kind, parsed.peerId);
        const configured = o.meta?.agentPreset ?? '';
        birthPreset = routed || configured;
        if (routed && configured !== routed) {
          const composed = await this.safeCompose(routed);
          req = {
            ...o,
            meta: { ...(o.meta ?? {}), ...(composed.agentPreset || routed ? { agentPreset: composed.agentPreset ?? routed } : {}) },
            ...(composed.setup ? { setup: composed.setup } : {}),
          };
          birthPreset = composed.agentPreset ?? routed;
        }
      }
    }
    const handle = await orig.create.call(SHARED.agents, req);
    const agent = handle?.agent as Record<string, unknown> | undefined;
    if (agent && sessionId) {
      let keyPromise: Promise<string | null>;
      if (key) {
        keyPromise = Promise.resolve(key);
      } else {
        keyPromise = this.pollPrefsForSessionId(sessionId);
        void this.pollAndAttribute(sessionId, keyPromise, birthPreset ?? '');
      }
      handle.agent = this.makeProxy(agent, sessionId, keyPromise, birthPreset ?? '');
      SHARED.handles.set(sessionId, { handle });
      if (key) void this.pollAndAttribute(sessionId, keyPromise, birthPreset ?? '');
    }
    return handle;
  }

  /** resume 拦截：冷开启即按绑定路由（覆盖 setup）；正常恢复也包代理便于热切换 */
  private async interceptResume(options: unknown): Promise<AgentHandle> {
    const orig = SHARED.orig!;
    const o = (options ?? {}) as {
      resumeSessionId?: string;
      setup?: (agentCtx: unknown) => Promise<void>;
    };
    const sessionId = o.resumeSessionId ?? '';
    const key = sessionId ? this.keyOfSessionId(sessionId) : null;
    let birthPreset: string | null = null;
    let req = options;
    if (key) {
      const parsed = parseSessionKey(key);
      if (parsed) {
        const routed = this.routedPresetFor(parsed.kind, parsed.peerId);
        const known = this.stateEntry(sessionId)?.presetId ?? '';
        if (routed && routed !== known) {
          const composed = await this.safeCompose(routed);
          if (composed.setup) {
            req = { ...o, setup: composed.setup };
          }
          birthPreset = composed.agentPreset ?? routed;
        } else {
          birthPreset = known || routed;
        }
      }
    }
    const handle = await orig.resume.call(SHARED.agents, req);
    const agent = handle?.agent as Record<string, unknown> | undefined;
    if (agent && sessionId) {
      const keyPromise = Promise.resolve(key ?? this.keyOfSessionId(sessionId));
      handle.agent = this.makeProxy(agent, sessionId, keyPromise, birthPreset ?? '');
      SHARED.handles.set(sessionId, { handle });
      if (key) void this.pollAndAttribute(sessionId, keyPromise, birthPreset ?? '');
    }
    return handle;
  }

  /** get 拦截：live agent 包代理（幂等）；从不返回假 undefined（避免逼 qqbot 走必败的 resume） */
  private interceptGet(sessionId: string): unknown {
    const orig = SHARED.orig!;
    const live = orig.get.call(SHARED.agents, sessionId) as Record<string, unknown> | undefined;
    if (!live || typeof live !== 'object') return live;
    if ((live as Record<symbol, unknown>)[HARNESS]) return live;
    const key = this.keyOfSessionId(sessionId);
    const birth = this.stateEntry(sessionId)?.presetId ?? '';
    return this.makeProxy(live, sessionId, Promise.resolve(key), birth);
  }

  // ---------- 可热切换代理 ----------

  private makeProxy(
    agent: Record<string, unknown>,
    sessionId: string,
    keyPromise: Promise<string | null>,
    birth: string,
  ): unknown {
    const self = this;
    const st: ProxyState = {
      sessionId,
      keyPromise,
      current: agent,
      birthPreset: birth || null,
      swapping: false,
      chain: Promise.resolve(),
      degradedLogged: false,
    };
    SHARED.proxies.set(sessionId, st);
    return new Proxy(agent, {
      get(_target, prop) {
        if (prop === HARNESS) return st;
        if (prop === 'followup') {
          return async (message: unknown): Promise<unknown> => {
            try {
              await self.swapCheck(st);
            } catch (err) {
              self.log('warn', '热切换检查失败（保旧继续）: ' + errMsg(err));
            }
            const cur = st.current as { followup: (m: unknown) => Promise<unknown> };
            return cur.followup(message);
          };
        }
        const v = Reflect.get(st.current, prop, st.current);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(st.current) : v;
      },
      set(_target, prop, value) {
        Reflect.set(st.current, prop, value);
        return true;
      },
    });
  }

  /** followup 检查点：串行化的热切换 */
  private swapCheck(st: ProxyState): Promise<void> {
    const run = st.chain.then(() => this.swapOnce(st));
    st.chain = run.catch(() => {});
    return run;
  }

  private async swapOnce(st: ProxyState): Promise<void> {
    if (st.swapping || !SHARED.agents || !SHARED.orig) return;
    const key = await st.keyPromise;
    if (!key) return;
    const parsed = parseSessionKey(key);
    if (!parsed) return;
    const routed = this.routedPresetFor(parsed.kind, parsed.peerId);
    if (!routed) return;
    if (st.birthPreset === null) {
      // 首次观察即采纳：冷路由语义（绑定在会话第一次被本插件看到时落定）
      st.birthPreset = routed;
      await this.attributeNow(st.sessionId, key, routed);
      return;
    }
    if (st.birthPreset === routed) {
      if (this.stateEntry(st.sessionId)?.presetId !== routed) await this.attributeNow(st.sessionId, key, routed);
      return;
    }
    const owned = SHARED.handles.get(st.sessionId);
    if (!owned) {
      if (!st.degradedLogged) {
        st.degradedLogged = true;
        this.log('info', '会话 ' + st.sessionId + ' 非本插件持有句柄，预设路由将在下次冷开启生效');
      }
      await this.attributeNow(st.sessionId, key, st.birthPreset);
      return;
    }
    st.swapping = true;
    try {
      const composed = await this.safeCompose(routed);
      const oldHandle = owned.handle;
      // ① 先终结旧 agent：teardown 链 close() 释放 jsonl 写锁（SessionAlreadyOwnedError 语义）
      try {
        await oldHandle?.dispose?.();
      } catch (err) {
        this.log('warn', '旧 agent 终止异常（继续换装）: ' + errMsg(err));
      }
      // ② 同 id resume：事件全量重放，session.header.id 不变 → 事件回路无缝
      const nh = (await SHARED.orig!.resume.call(SHARED.agents, {
        resumeSessionId: st.sessionId,
        ...(composed.setup ? { setup: composed.setup } : {}),
      })) as AgentHandle;
      const newAgent = nh?.agent as { session?: { header?: { id?: string } } } | undefined;
      const sid = newAgent?.session?.header?.id;
      if (sid && sid !== st.sessionId) throw new Error('resume 返回了不同会话 (' + sid + ')');
      // ③ 换装成功
      st.current = nh.agent as Record<string, unknown>;
      owned.handle = nh;
      st.birthPreset = composed.agentPreset ?? routed;
      st.degradedLogged = false;
      this.log('info', '会话 ' + st.sessionId + ' 预设热切换 → ' + routed);
      await this.attributeNow(st.sessionId, key, st.birthPreset);
    } catch (err) {
      // ④ 回滚旧预设（旧句柄已销毁，尽力救回；保 birth 不变，下次 followup 可再试路由）
      try {
        const composed = await this.safeCompose(st.birthPreset);
        const nh = (await SHARED.orig!.resume.call(SHARED.agents, {
          resumeSessionId: st.sessionId,
          ...(composed.setup ? { setup: composed.setup } : {}),
        })) as AgentHandle;
        st.current = nh.agent as Record<string, unknown>;
        const owned2 = SHARED.handles.get(st.sessionId);
        if (owned2) owned2.handle = nh;
        this.log('warn', '预设热切换失败已回滚旧预设 ' + st.birthPreset + ': ' + errMsg(err));
      } catch (err2) {
        this.log('error', '预设热切换失败且回滚失败（该会话需 /new 重建）: ' + errMsg(err) + ' / ' + errMsg(err2));
      }
    } finally {
      st.swapping = false;
    }
  }

  // ---------- 状态导出 ----------

  /** 观察到的会话（含实时路由结果），供状态表渲染 */
  getObserved(): ObservedSession[] {
    return Object.values(SHARED.state.sessions)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({
        key: e.key,
        kind: e.kind,
        peerId: e.peerId,
        sessionId: e.sessionId,
        presetId: e.presetId,
        routedPreset: (() => {
          try {
            return this.routedPresetFor(e.kind, e.peerId);
          } catch {
            return '';
          }
        })(),
        createdAt: e.createdAt,
      }));
  }

  /** 代理态（测试/诊断用） */
  proxyStateOf(sessionId: string): ProxyState | undefined {
    return SHARED.proxies.get(sessionId);
  }
}
