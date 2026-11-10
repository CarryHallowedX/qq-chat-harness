/**
 * §7.3 自动提炼通道（M1 桩）：真实提炼依赖廉价 LLM 从回合对话抽 importance ≥ 0.5 的事实。
 * 接口先行，M3/M4 在拿到 AgentRunner 后接入实现；M1 阶段用 noop。
 */
                                                          

                             
                             
                       
                  
               
 

                                     
                 
                      
                                                          
                              
 

                                  
                     
                   
               
                  
                     
                        
 

                                  
                                                                 
 

export const noopExtractor                  = {
  async extract()                             {
    return [];
  },
};
