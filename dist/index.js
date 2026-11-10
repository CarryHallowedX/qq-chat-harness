/**
 * qq-chat-harness 插件入口（M1）
 *
 * M1 交付：框架无关的 createHarnessServices bootstrap（工作区 + 两存储区 + 记忆读写，全对话）。
 * 接入 cordis（§13：export default 的 ctx.plugin 形态）属于 M2 与宿主联调的工作，
 * 届时服务创建逻辑保持不变，仅包一层 cordis 注入。
 */
import { resolveConfig } from './config.js';
                                                                    
import { JsonStore } from './storage.js';
import { initWorkspace } from './workspace.js';
                                                      
import { MemoryManager } from './memory/manager.js';
import { noopExtractor } from './memory/extractor.js';
                                                             
import { MemeStore } from './memes/store.js';
import * as conv from './conv.js';

                                                                                          

                                  
                              
                             
                        
                   
                             
                    
 

/** §11：工作区降级时记忆禁用、存储不落盘，但服务不抛错、消息功能照常 */
export async function createHarnessServices(input                    )                           {
  const config = resolveConfig(input);
  const workspace = await initWorkspace(config.workspace);
  const store = new JsonStore(workspace.root);
  const onDegraded = (reason        )       => {
    workspace.degraded = true;
    workspace.reason = workspace.reason ?? reason;
  };
  const memory = new MemoryManager(store, {
    retrievalLimit: config.conversation.memory.retrievalLimit,
    enabled: config.conversation.memory.enabled && !workspace.degraded,
    onDegraded,
  });
  const memes = new MemeStore(store, { enabled: !workspace.degraded, onDegraded });
  await memory.load();
  await memes.load();
  return { config, workspace, memory, memes, extractor: noopExtractor, conv };
}

export { resolveConfig, DEFAULT_CONFIG } from './config.js';
             
                      
                     
                 
                 
               
                     
export { initWorkspace, WORKSPACE_SCHEMA_VERSION } from './workspace.js';
                                                                         
export { JsonStore, writeJsonAtomic } from './storage.js';
export { MemoryManager } from './memory/manager.js';
                                                                                                       
export { noopExtractor } from './memory/extractor.js';
                                                                                                              
                                                                              
                                                  
export { MemeStore } from './memes/store.js';
                                                                         
export {
  modeStateKey,
  groupScope,
  userScope,
  writeTargetsForTurn,
  retrievalScopes,
} from './conv.js';
                                                                   
