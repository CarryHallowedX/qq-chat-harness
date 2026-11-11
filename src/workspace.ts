/** §2 工作区：骨架创建、manifest 版本标记、不可写降级（§11） */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writeJsonAtomic } from './storage.ts';

export const WORKSPACE_SCHEMA_VERSION = 1;

export interface WorkspaceManifest {
  schemaVersion: number;
  createdAt: number;
}

export interface WorkspaceHandle {
  root: string;
  /** true = §11 降级态：记忆禁用、模式状态不持久化 */
  degraded: boolean;
  reason?: string;
  manifest?: WorkspaceManifest;
}

/** §2.2 目录骨架 */
const SKELETON: readonly string[] = [
  'state',
  'memory',
  'memory/groups',
  'memory/users',
  'memory/blocks',
  'memory/solo',
  'memory/solo/sessions',
  'memes',
  'memes/images',
] as const;

export function workspaceManifestPath(root: string): string {
  return path.join(root, 'manifest.json');
}

export async function initWorkspace(root: string): Promise<WorkspaceHandle> {
  try {
    for (const rel of SKELETON) {
      await fs.mkdir(path.join(root, rel), { recursive: true });
    }
    const mPath = workspaceManifestPath(root);
    let manifest: WorkspaceManifest;
    try {
      manifest = JSON.parse(await fs.readFile(mPath, 'utf8')) as WorkspaceManifest;
    } catch {
      manifest = { schemaVersion: WORKSPACE_SCHEMA_VERSION, createdAt: Date.now() };
      await writeJsonAtomic(mPath, manifest);
    }
    return { root, degraded: false, manifest };
  } catch (err) {
    return {
      root,
      degraded: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
