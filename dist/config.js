/** §3 配置模型 —— 配置本体放宿主插件配置（ConfigService），工作区只放数据（§2.2） */

                                 
                       
                    
                       
                           
 

                                 
                        
                        
 

                               
                
                   
                        
                       
                         
                         
 

                                     
                               
                               
                   
                             
                  
                                 
                           
                       
                       
                       
 

                                      
                    
                                   
 

                              
                                                                                                      
  

                                                                                          

export const DEFAULT_CONFIG                      = {
  workspace: '',
  conversation: {
    defaultMode: 'chat',
    modeSwitchAdminOnly: true,
    admins: [],
    persona: '',
    restrictionRules: '',
    chat: { humanize: true, maxTypingDelayMs: 3000 },
    tool: { sendThinking: false },
    memory: { enabled: true, autoCapture: true, retrievalLimit: 8 },
  },
};

/** 字段级深合并，未给字段落默认值 */
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
  };
}
