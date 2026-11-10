/**
 * §8 表情包存储区：index.json 元数据索引 + images/ 图片文件
 * - byTag：情绪池均匀随机抽一张（斗图主力）
 * - byQuery：caption/keywords/文件名子串全 token 命中后随机抽
 * - learn：仅在用户明确要求收藏时调用（斗图不自动收录）
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonStore } from '../storage.js';
import { genId, dedupeStrings } from '../util.js';
                                            

const DEFAULT_TAG = 'daily';
const IMAGES_DIR = 'memes/images';

                                 
                
               
                   
                      
                  
 

                                   
                    
                                        
 

                         
             
                     
 

function entryHay(e           )         {
  return `${path.basename(e.file)} ${e.caption} ${e.keywords.join(' ')}`.toLowerCase();
}

function pick   (xs     )    {
  return xs[(Math.random() * xs.length) | 0];
}

export class MemeStore {
                   store           ;
                   onDegraded                           ;
                   items = new Map                   ();
          loadPromise                ;
          _enabled         ;
          _degraded = false;

  constructor(store           , opts                   = {}) {
    this.store = store;
    this._enabled = opts.enabled ?? true;
    this.onDegraded = opts.onDegraded;
  }

  get enabled()          {
    return this._enabled;
  }

  get degraded()          {
    return this._degraded;
  }

  disable()       {
    this._enabled = false;
  }

  load()                {
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

          async doLoad()                {
    const data = await this.store.readJson               ('memes/index.json', { version: 1, items: [] });
    for (const it of data.items ?? []) {
      if (it && typeof it.id === 'string') this.items.set(it.id, it);
    }
  }

          requireLoaded()       {
    if (!this.loadPromise) throw new Error('MemeStore: 请先调用 load()');
  }

          degrade(err         )       {
    if (this._degraded) return;
    this._degraded = true;
    this.onDegraded?.(err instanceof Error ? err.message : String(err));
  }

          async persist()                {
    if (!this._enabled || this._degraded) return;
    try {
      await this.store.writeJson('memes/index.json', { version: 1, items: [...this.items.values()] });
    } catch (err) {
      this.degrade(err);
    }
  }

  list()              {
    return [...this.items.values()];
  }

  /** §8.3 给 L5 层的 tag 枚举 */
  tagList()           {
    return [...new Set([...this.items.values()].map((e) => e.tag))].sort();
  }

  byTag(tag        )                        {
    const pool = [...this.items.values()].filter((e) => e.tag === tag);
    return pool.length ? pick(pool) : undefined;
  }

  /** §8.2 caption/keywords/文件名子串检索，全 token 命中后随机抽一张 */
  byQuery(q        )                        {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return undefined;
    const hits = [...this.items.values()].filter((e) => {
      const hay = entryHay(e);
      return tokens.every((t) => hay.includes(t));
    });
    return hits.length ? pick(hits) : undefined;
  }

  /**
   * 收录一条表情（仅用户明确要求收藏时调用）。
   * file 为相对 memes/images/ 的路径；这里归一化为纯文件名防路径逃逸。
   * 禁用/降级返回 null。
   */
  async learn(input                )                            {
    this.requireLoaded();
    if (!this._enabled || this._degraded) return null;
    const file = (input.file ?? '').replace(/\\/g, '/');
    if (!file) return null;
    const entry            = {
      id: genId('meme'),
      file: path.basename(file),
      tag: input.tag?.trim() || DEFAULT_TAG,
      caption: input.caption?.trim() || '',
      keywords: dedupeStrings(input.keywords ?? []),
      ...(input.packId ? { packId: input.packId } : {}),
      useCount: 0,
      addedAt: Date.now(),
    };
    this.items.set(entry.id, entry);
    await this.persist();
    return entry;
  }

  /** 把磁盘上的图片文件拷入 images/ 并收录（learn 的二进制半边） */
  async importImage(srcAbsPath        , meta                )                            {
    this.requireLoaded();
    if (!this._enabled || this._degraded) return null;
    try {
      const ext = path.extname(srcAbsPath) || '.png';
      const rel = `${genId('meme')}${ext}`;
      await fs.mkdir(this.store.abs(IMAGES_DIR), { recursive: true });
      await fs.copyFile(srcAbsPath, this.store.abs(`${IMAGES_DIR}/${rel}`));
      return await this.learn({ ...meta, file: rel });
    } catch (err) {
      this.degrade(err);
      return null;
    }
  }

  /** 斗图/发送后计数（§10.1 异步） */
  async markUsed(id        )                {
    const e = this.items.get(id);
    if (!e) return;
    e.useCount += 1;
    await this.persist();
  }

  /** §8.2 管理端维护元数据 */
  async update(
    id        ,
    patch                                                                     ,
  )                                 {
    const e = this.items.get(id);
    if (!e) return undefined;
    if (patch.tag !== undefined) e.tag = patch.tag.trim() || e.tag;
    if (patch.caption !== undefined) e.caption = patch.caption.trim();
    if (patch.keywords !== undefined) e.keywords = dedupeStrings(patch.keywords);
    if (patch.packId !== undefined) e.packId = patch.packId || undefined;
    await this.persist();
    return e;
  }

  async remove(id        )                   {
    const ok = this.items.delete(id);
    if (ok) await this.persist();
    return ok;
  }
}
