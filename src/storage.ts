/** 存储底层：JSON 原子读写（tmp + rename），实现性文件（§13 布局的公共地基） */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** 原子写 JSON：先写 tmp 再 rename，避免读到半截文件 */
export async function writeJsonAtomic(absPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, absPath);
}

/**
 * 以 workspace 根为基准的 JSON 存储。
 * 读失败（不存在）返回 fallback；内容损坏则把原文件改名留证后返回 fallback。
 */
export class JsonStore {
  private readonly _root: string;

  constructor(root: string) {
    this._root = root;
  }

  get root(): string {
    return this._root;
  }

  abs(rel: string): string {
    return path.join(this._root, rel);
  }

  async readJson<T>(rel: string, fallback: T): Promise<T> {
    const abs = this.abs(rel);
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      return fallback;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      try {
        await fs.rename(abs, `${abs}.corrupt-${Date.now()}`);
      } catch {
        /* 备份失败也照常返回 fallback */
      }
      return fallback;
    }
  }

  async writeJson(rel: string, data: unknown): Promise<void> {
    return writeJsonAtomic(this.abs(rel), data);
  }

  async listDir(rel: string): Promise<string[]> {
    try {
      return await fs.readdir(this.abs(rel));
    } catch {
      return [];
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }
}
