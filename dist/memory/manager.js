/**
 * §7 记忆系统（所有对话生效）
 * - 三级作用域：global / group:<id> / user:<id>
 * - 检索合并优先级：user > group > global（体现在打分系数 scopeRank）
 * - 打分：importance × 时间衰减(30 天半衰) × 命中加成 × 作用域等级 × 查询相关性
 * - 持久化：§2.2 目录骨架（global.json / groups/<id>.json / users/<id>.json + index.json 索引）
 */
import { JsonStore } from '../storage.js';
import { genId, clamp01, dedupeStrings, unionStrings, normalizeText } from '../util.js';
                                                                       

const DAY_MS = 86_400_000;
const KINDS                        = ['fact', 'preference', 'event', 'summary', 'relationship'];

                                 
                     
                   
               
                  
                      
                        
 

                                        
                        
                                           
                
                 
 

                                       
                          
                    
                                    
                                        
 

                     
             
                         
 

                           
             
                     
                   
                  
                 
                     
                    
 

function scopeRank(scope             )         {
  // §7.1 user > group > global
  return scope === 'global' ? 1 : scope.startsWith('group:') ? 1.1 : 1.25;
}

function timeDecay(createdAt        , now        )         {
  return 1 / (1 + Math.max(0, now - createdAt) / DAY_MS / 30);
}

function scopeFileRel(scope             )         {
  if (scope === 'global') return 'memory/global.json';
  if (scope.startsWith('group:')) return `memory/groups/${scope.slice('group:'.length)}.json`;
  return `memory/users/${scope.slice('user:'.length)}.json`;
}

function matchesQuery(e             , tokens          )          {
  const hay = `${e.text} ${e.tags.join(' ')}`.toLowerCase();
  return tokens.some((t) => hay.includes(t));
}

export class MemoryManager {
                   store           ;
                   retrievalLimit        ;
                   onDegraded                           ;
                   entries = new Map                            ();
          loadPromise                ;
          _enabled         ;
          _degraded = false;

  constructor(store           , opts                       = {}) {
    this.store = store;
    this.retrievalLimit = opts.retrievalLimit ?? 8;
    this._enabled = opts.enabled ?? true;
    this.onDegraded = opts.onDegraded;
  }

  get enabled()          {
    return this._enabled;
  }

  get degraded()          {
    return this._degraded;
  }

  /** 运行中转禁用（如工作区中途不可写） */
  disable()       {
    this._enabled = false;
  }

  load()                {
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

          async doLoad()                {
    const scopes                = ['global'];
    for (const f of await this.store.listDir('memory/groups')) {
      if (f.endsWith('.json') && !f.includes('.tmp-') && !f.includes('.corrupt-')) {
        scopes.push(`group:${f.slice(0, -'.json'.length)}`);
      }
    }
    for (const f of await this.store.listDir('memory/users')) {
      if (f.endsWith('.json') && !f.includes('.tmp-') && !f.includes('.corrupt-')) {
        scopes.push(`user:${f.slice(0, -'.json'.length)}`);
      }
    }
    for (const scope of scopes) {
      const data = await this.store.readJson           (scopeFileRel(scope), { version: 1, entries: [] });
      this.entries.set(scope, Array.isArray(data.entries) ? data.entries : []);
    }
  }

          requireLoaded()       {
    if (!this.loadPromise) throw new Error('MemoryManager: 请先调用 load()');
  }

          degrade(err         )       {
    if (this._degraded) return;
    this._degraded = true;
    this.onDegraded?.(err instanceof Error ? err.message : String(err));
  }

          async persist(scope             )                {
    if (!this._enabled || this._degraded) return;
    try {
      const file            = { version: 1, entries: this.entries.get(scope) ?? [] };
      await this.store.writeJson(scopeFileRel(scope), file);
      await this.saveIndex();
    } catch (err) {
      this.degrade(err);
    }
  }

          async saveIndex()                {
    const items                    = [];
    for (const list of this.entries.values()) {
      for (const e of list) {
        items.push({
          id: e.id,
          scope: e.scope,
          kind: e.kind,
          summary: e.text.slice(0, 80),
          tags: e.tags,
          importance: e.importance,
          updatedAt: e.updatedAt ?? e.createdAt,
        });
      }
    }
    await this.store.writeJson('memory/index.json', { version: 1, items });
  }

  /**
   * 写入一条记忆。§7.3 去重合并：同 scope 下归一化文本相同 → 合并为一条
   *（importance 取最大、tags 并集、updatedAt 刷新）。
   * 禁用/降级时返回 null（不抛错，消息功能照常）。
   */
  async add(input                )                              {
    this.requireLoaded();
    if (!this._enabled || this._degraded) return null;
    if (!KINDS.includes(input.kind)) throw new Error(`未知记忆类型 kind=${input.kind}`);
    const text = input.text.trim();
    if (!text) throw new Error('记忆正文不能为空');
    const scope = input.scope;
    const list = this.entries.get(scope) ?? [];
    this.entries.set(scope, list);
    const now = Date.now();
    const key = normalizeText(text);
    const existing = list.find((e) => normalizeText(e.text) === key);
    if (existing) {
      existing.importance = Math.max(existing.importance, clamp01(input.importance ?? existing.importance));
      existing.tags = unionStrings(existing.tags, input.tags ?? []);
      existing.updatedAt = now;
      await this.persist(scope);
      return existing;
    }
    const entry              = {
      id: genId('mem'),
      scope,
      kind: input.kind,
      text,
      tags: dedupeStrings(input.tags ?? []),
      importance: clamp01(input.importance ?? 0.5),
      createdAt: now,
      updatedAt: now,
      hitCount: 0,
      ...(input.sourceRefs && input.sourceRefs.length ? { sourceRefs: [...input.sourceRefs] } : {}),
    };
    list.push(entry);
    await this.persist(scope);
    return entry;
  }

  /**
   * 检索：scopes 会话级作用域 + global 自动并入；
   * 打分 = importance × 时间衰减 × 命中加成 × scopeRank(§7.1 user>group>global) × 查询相关性。
   * 返回的条目会记录 lastHitAt/hitCount（异步落盘）。
   */
  async retrieve(opts                       )                         {
    this.requireLoaded();
    const limit = Math.max(1, opts.limit ?? this.retrievalLimit);
    const now = Date.now();
    const tokens = opts.text ? opts.text.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
    const wanted = opts.scopes.includes('global') ? opts.scopes : [...opts.scopes, 'global'];
    const seen = new Set        ();
    const scored                                  = [];
    for (const scope of wanted) {
      for (const e of this.entries.get(scope) ?? []) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        let s =
          e.importance *
          timeDecay(e.createdAt, now) *
          (1 + 0.1 * Math.min(e.hitCount ?? 0, 10)) *
          scopeRank(e.scope);
        if (tokens.length) s *= matchesQuery(e, tokens) ? 2 : 0.3;
        scored.push({ e, s });
      }
    }
    scored.sort((a, b) => b.s - a.s || b.e.createdAt - a.e.createdAt);
    const hits = scored.slice(0, limit).map((x) => x.e);
    if (hits.length) {
      for (const e of hits) {
        e.lastHitAt = now;
        e.hitCount = (e.hitCount ?? 0) + 1;
      }
      // 命中落盘必须 await：fire-and-forget 会与后续变更竞态，
      // 迟到的旧状态写盘会复活已被删除/合并的条目（搬家后 test 步骤[6] 首次暴露）
      const touched = [...new Set(hits.map((e) => e.scope))];
      await Promise.all(touched.map((s) => this.persist(s)));
    }
    return hits;
  }

  /** §7.4 管理员按关键词删记忆（大小写不敏感子串） */
  async removeByKeyword(scope             , keyword        )                  {
    this.requireLoaded();
    const kw = keyword.trim().toLowerCase();
    if (!kw) return 0;
    const list = this.entries.get(scope) ?? [];
    const kept = list.filter((e) => !normalizeText(e.text).includes(kw));
    const removed = list.length - kept.length;
    if (removed > 0) {
      this.entries.set(scope, kept);
      await this.persist(scope);
    }
    return removed;
  }

  /** §7.4 「忘掉我」：清空 user:<id> 全部记忆 */
  async forgetUser(userId        )                  {
    this.requireLoaded();
    const scope              = `user:${userId}`;
    const n = (this.entries.get(scope) ?? []).length;
    if (n > 0) {
      this.entries.set(scope, []);
      await this.persist(scope);
    }
    return n;
  }

  list(scope              )                {
    const all = scope ? (this.entries.get(scope) ?? []) : [...this.entries.values()].flat();
    return [...all].sort((a, b) => b.createdAt - a.createdAt);
  }

  count()         {
    let n = 0;
    for (const list of this.entries.values()) n += list.length;
    return n;
  }
}
