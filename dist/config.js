/**
 * §3 配置模型 —— 配置本体放宿主插件配置（ConfigService），工作区只放数据（§2.2）
 *
 * v0.2.1 新增：「记忆和会话」页签的 memoryBlocks / presetBindings（成员=群聊/私聊/openid），
 * 解析与存储见 memory/blocks.ts。
 */
                                                                                 

                                 
                       
                    
                       
                           
 

                                 
                        
                        
 

                               
                
                   
                        
                       
                         
                         
 

                                     
                               
                               
                   
                             
                  
                                 
                           
                                
                        
                       
                       
                       
 

                                      
                    
                                   
                                                
                                    
                                                        
                                        
 

                              
                                                                                                      
  

                                                                                          

export const DEFAULT_CONFIG                      = {
  workspace: '',
  conversation: {
    defaultMode: 'chat',
    modeSwitchAdminOnly: true,
    admins: [],
    persona: '',
    restrictionRules: '',
    maxReplyChars: 800,
    chat: { humanize: true, maxTypingDelayMs: 3000 },
    tool: { sendThinking: false },
    memory: { enabled: true, autoCapture: true, retrievalLimit: 8 },
  },
  memoryBlocks: [],
  presetBindings: [],
};

/** 区块/绑定成员规范化（未知字段丢弃、成员去重） */
function normMemberGroup(b                               )                    {
  const members = Array.isArray(b?.members) ? [...new Set(b.members.filter((m) => typeof m === 'string' && m.trim()))] : [];
  return { name: typeof b?.name === 'string' ? b.name : '', members };
}

function normPresetBinding(b                                 )                      {
  const members = Array.isArray(b?.members) ? [...new Set(b.members.filter((m) => typeof m === 'string' && m.trim()))] : [];
  return { presetId: typeof b?.presetId === 'string' ? b.presetId.trim() : '', members };
}

/** 字段级深合并，未给字段落默认值（数组整体替换，不做元素级合并） */
export function resolveConfig(input                    )                      {
  const c = input.conversation ?? {};
  return {
    workspace: input.workspace,
    conversation: {
      defaultMode: c.defaultMode ?? DEFAULT_CONFIG.conversation.defaultMode,
      modeSwitchAdminOnly: c.modeSwitchAdminOnly ?? DEFAULT_CONFIG.conversation.modeSwitchAdminOnly,
      admins: [...(c.admins ?? [])],
      persona: c.persona ?? '',
      restrictionRules: c.restrictionRules ?? '',
      maxReplyChars: c.maxReplyChars ?? DEFAULT_CONFIG.conversation.maxReplyChars,
      chat: {
        humanize: c.chat?.humanize ?? DEFAULT_CONFIG.conversation.chat.humanize,
        maxTypingDelayMs: c.chat?.maxTypingDelayMs ?? DEFAULT_CONFIG.conversation.chat.maxTypingDelayMs,
      },
      tool: {
        sendThinking: c.tool?.sendThinking ?? DEFAULT_CONFIG.conversation.tool.sendThinking,
      },
      memory: {
        enabled: c.memory?.enabled ?? DEFAULT_CONFIG.conversation.memory.enabled,
        autoCapture: c.memory?.autoCapture ?? DEFAULT_CONFIG.conversation.memory.autoCapture,
        retrievalLimit: c.memory?.retrievalLimit ?? DEFAULT_CONFIG.conversation.memory.retrievalLimit,
      },
    },
    memoryBlocks: Array.isArray(input.memoryBlocks) ? input.memoryBlocks.map(normMemberGroup) : [],
    presetBindings: Array.isArray(input.presetBindings) ? input.presetBindings.map(normPresetBinding) : [],
  };
}
