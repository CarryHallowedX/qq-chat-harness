/** 存储底层：JSON 原子读写（tmp + rename），实现性文件（§13 布局的公共地基） */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * 原子写 JSON：先写 tmp 再 rename，避免读到半截文件。
 * Windows 坑：rename 覆盖正被占用的目标（杀毒/索引器握着句柄）会抛 EPERM/EBUSY，
 * 若不重试，写盘失败会被上层降级吞掉、磁盘留下旧文件——表现为「已删条目复活」。
 * 故对换名做有限次退避重试；tmp 名含随机数，防并发写同一目标时撞名。
 */
const RENAME_RETRIES = 8;
const RETRY_DELAY_MS = 25;

export async function writeJsonAtomic(absPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  let lastErr: unknown;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    const tmp = `${absPath}.tmp-${process.pid}-${Date.now().toString(36)}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, absPath);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException | null)?.code ?? '';
      const retriable = code === 'EPERM' || code === 'EBUSY';
      try {
        await fs.unlink(tmp);
      } catch {
        /* tmp 可能已改名成功，忽略 */
      }
      if (!retriable || attempt === RENAME_RETRIES - 1) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw lastErr;
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
