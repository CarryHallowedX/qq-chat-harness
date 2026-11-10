/**
 * §8 表情包存储区：index.json 元数据索引 + images/ 图片文件
 * - byTag：情绪池均匀随机抽一张（斗图主力）
 * - byQuery：caption/keywords/文件名子串全 token 命中后随机抽
 * - learn：仅在用户明确要求收藏时调用（斗图不自动收录）
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonStore } from '../storage.ts';
import { genId, dedupeStrings } from '../util.ts';
import type { MemeEntry } from './types.ts';

const DEFAULT_TAG = 'daily';
const IMAGES_DIR = 'memes/images';

export interface MemeLearnInput {
  file?: string;
  tag?: string;
  caption?: string;
  keywords?: string[];
  packId?: string;
}

export interface MemeStoreOptions {
  enabled?: boolean;
  onDegraded?: (reason: string) => void;
}

interface MemeIndexFile {
  version: 1;
  items: MemeEntry[];
}

function entryHay(e: MemeEntry): string {
  return `${path.basename(e.file)} ${e.caption} ${e.keywords.join(' ')}`.toLowerCase();
}

function pick<T>(xs: T[]): T {
  return xs[(Math.random() * xs.length) | 0];
}

export class MemeStore {
  private readonly store: JsonStore;
  private readonly onDegraded?: (reason: string) => void;
  private readonly items = new Map<string, MemeEntry>();
  private loadPromise?: Promise<void>;
  private _enabled: boolean;
  private _degraded = false;

  constructor(store: JsonStore, opts: MemeStoreOptions = {}) {
    this.store = store;
    this._enabled = opts.enabled ?? true;
    this.onDegraded = opts.onDegraded;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get degraded(): boolean {
    return this._degraded;
  }

  disable(): void {
    this._enabled = false;
  }

  load(): Promise<void> {
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    const data = await this.store.readJson<MemeIndexFile>('memes/index.json', { version: 1, items: [] });
    for (const it of data.items ?? []) {
      if (it && typeof it.id === 'string') this.items.set(it.id, it);
    }
  }

  private requireLoaded(): void {
    if (!this.loadPromise) throw new Error('MemeStore: 请先调用 load()');
  }

  private degrade(err: unknown): void {
    if (this._degraded) return;
    this._degraded = true;
    this.onDegraded?.(err instanceof Error ? err.message : String(err));
  }

  private async persist(): Promise<void> {
    if (!this._enabled || this._degraded) return;
    try {
      await this.store.writeJson('memes/index.json', { version: 1, items: [...this.items.values()] });
    } catch (err) {
      this.degrade(err);
    }
  }

  list(): MemeEntry[] {
    return [...this.items.values()];
  }

  /** §8.3 给 L5 层的 tag 枚举 */
  tagList(): string[] {
    return [...new Set([...this.items.values()].map((e) => e.tag))].sort();
  }

  byTag(tag: string): MemeEntry | undefined {
    const pool = [...this.items.values()].filter((e) => e.tag === tag);
    return pool.length ? pick(pool) : undefined;
  }

  /** §8.2 caption/keywords/文件名子串检索，全 token 命中后随机抽一张 */
  byQuery(q: string): MemeEntry | undefined {
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
  async learn(input: MemeLearnInput): Promise<MemeEntry | null> {
    this.requireLoaded();
    if (!this._enabled || this._degraded) return null;
    const file = (input.file ?? '').replace(/\\/g, '/');
    if (!file) return null;
    const entry: MemeEntry = {
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
  async importImage(srcAbsPath: string, meta: MemeLearnInput): Promise<MemeEntry | null> {
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
  async markUsed(id: string): Promise<void> {
    const e = this.items.get(id);
    if (!e) return;
    e.useCount += 1;
    await this.persist();
  }

  /** §8.2 管理端维护元数据 */
  async update(
    id: string,
    patch: Partial<Pick<MemeEntry, 'tag' | 'caption' | 'keywords' | 'packId'>>,
  ): Promise<MemeEntry | undefined> {
    const e = this.items.get(id);
    if (!e) return undefined;
    if (patch.tag !== undefined) e.tag = patch.tag.trim() || e.tag;
    if (patch.caption !== undefined) e.caption = patch.caption.trim();
    if (patch.keywords !== undefined) e.keywords = dedupeStrings(patch.keywords);
    if (patch.packId !== undefined) e.packId = patch.packId || undefined;
    await this.persist();
    return e;
  }

  async remove(id: string): Promise<boolean> {
    const ok = this.items.delete(id);
    if (ok) await this.persist();
    return ok;
  }
}
