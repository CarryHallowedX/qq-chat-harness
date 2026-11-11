/** §2 工作区：骨架创建、manifest 版本标记、不可写降级（§11） */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writeJsonAtomic } from './storage.js';

export const WORKSPACE_SCHEMA_VERSION = 1;

                                    
                        
                    
 

                                  
               
                                     
                    
                  
                               
 

/** §2.2 目录骨架 */
const SKELETON                    = [
  'state',
  'memory',
  'memory/groups',
  'memory/users',
  'memory/blocks',
  'memory/solo',
  'memory/solo/sessions',
  'memes',
  'memes/images',
]         ;

export function workspaceManifestPath(root        )         {
  return path.join(root, 'manifest.json');
}

export async function initWorkspace(root        )                           {
  try {
    for (const rel of SKELETON) {
      await fs.mkdir(path.join(root, rel), { recursive: true });
    }
    const mPath = workspaceManifestPath(root);
    let manifest                   ;
    try {
      manifest = JSON.parse(await fs.readFile(mPath, 'utf8'))                     ;
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
