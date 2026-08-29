// AI 供应商统一接口。后续要换模型/厂商，只需实现这个接口并在 AiModule 注册。
// mode 用于告知具体调用场景（离线规则分析需要据此返回不同结构），云端厂商可忽略。
export type AiMode = 'hazard' | 'work_risk' | 'work_review' | 'jsa';
export interface AiProvider {
  readonly name: string;
  // 给定 prompt，返回模型文本输出
  chat(system: string, user: string, opts?: { mode?: AiMode }): Promise<string>;
}

export interface AiRiskResult {
  riskAnalysis: string; // 作业风险分析
  suggestions: string[]; // 防护措施建议（可辅助填入表单）
  extraRisks: string; // 提交后复核：是否还存在其他风险
  measuresAdequate: string; // 防护措施是否已到位
}
