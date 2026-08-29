/**
 * 作业票审批路由（按票种固定审批链，不做风险分级）
 *
 * 设计目标：提交作业票时按「常规票 / 特殊票」两条固定链生成审批链，把每一级应审批人
 * 直接落到票上，避免人工指派、漏签、越级批准。
 *
 * 【2026-08 改造】原「按风险等级(low/medium/high)动态决定 2/3/4 级审批」已按业务要求废弃。
 * 业务口径：审批层级只取决于票种，不再随作业时段、时长、类型浮动，便于承包商与部门形成稳定预期。
 *
 * 票种与审批链：
 *   routine 常规作业票（isHazardous=false）
 *     ① 区域负责人 → ② 承包商管理部门                                （2 级）
 *     · 不经 EHS 审批，但 approved 时通知申请人需抄送 EHS 存档
 *   special 危险作业票（isHazardous=true，GB 30871 八大危险作业）
 *     ① 申请部门主管 → ② EHS 工程师 → ③ 工程部经理                    （3 级）
 *
 * 同一人兼多级时不再合并：按流程逐级走完，每级独立审批、留痕（2026-08-22 业务调整）。
 * 同一人可连续完成各级操作，界面提示当前所处级别。
 *
 * 与既有状态机的映射（不改状态机，保证前端兼容）：
 *   stage=review → pending_review
 *   stage=ehs    → ehs_reviewing
 *   stage=final  → reviewing（final 可有多个节点，串行签完才 approved）
 */

/** 票种：常规 / 特殊。取代原 RiskLevel 作为审批链的唯一决定因素。 */
export type PermitKind = 'routine' | 'special';
export type ChainStage = 'review' | 'ehs' | 'final';

export interface ChainNode {
  seq: number;
  stage: ChainStage;
  roleKey: string;
  roleName: string;
  approverId: string | null;
  approverName: string | null;
  status: 'pending' | 'approved' | 'rejected';
  opinion?: string | null;
  actedAt?: string | null;
  /** 实际操作人（代签/授权审批时与预分配审批人不一致，留痕用） */
  actualApproverId?: string | null;
  actualApproverName?: string | null;
  /** 因同一人兼任多级而被合并进来的角色名（展示用，如"承包商管理部门"） */
  mergedRoles?: string[];
}

export const PERMIT_KIND_LABEL: Record<PermitKind, string> = {
  routine: '常规作业票',
  special: '危险作业票',
};

/** 按票面判定票种：是否危险作业决定走哪条链。 */
export function permitKind(wp: { isHazardous?: boolean | null }): PermitKind {
  return wp?.isHazardous ? 'special' : 'routine';
}

/**
 * @deprecated 风险分级已从审批路由中移除，仅为兼容 work_permits.risk_level 历史列与
 * 既有种子数据保留。新代码不要用它决定审批层级。
 */
export type RiskLevel = 'low' | 'medium' | 'high';
/**
 * @deprecated 同上，仅用于回填历史列。
 * 保留宽松入参（允许传 type/startTime/endTime 等旧字段）以兼容既有种子数据的调用点，
 * 但这些字段已不再影响结果——只看是否危险作业。
 */
export function evaluateRiskLevel(wp: { isHazardous?: boolean | null; [k: string]: any }): RiskLevel {
  return wp?.isHazardous ? 'high' : 'low';
}

/**
 * 各票种对应的固定审批层级定义（角色语义，不含具体人）。
 * 注意：stage 的取值直接决定审批时走 review()/approveEhs()/approve() 哪个入口，
 * 常规票第 2 级用 final（→reviewing 状态），不占用 ehs 阶段，从而绕开 EHS 审批。
 */
export function chainTemplate(kind: PermitKind): Array<Pick<ChainNode, 'stage' | 'roleKey' | 'roleName'>> {
  if (kind === 'routine') {
    return [
      { stage: 'review', roleKey: 'area_manager', roleName: '区域负责人' },
      { stage: 'final', roleKey: 'contractor_dept', roleName: '承包商管理部门' },
    ];
  }
  return [
    { stage: 'review', roleKey: 'dept_manager', roleName: '申请部门主管' },
    { stage: 'ehs', roleKey: 'ehs_engineer', roleName: 'EHS工程师' },
    { stage: 'final', roleKey: 'eng_manager', roleName: '工程部经理' },
  ];
}

/**
 * 链级去重（已停用于新链，2026-08-22 业务调整：不再合并审批步骤）。
 * @deprecated 新提交的票直接生成完整链，逐级走完；本函数仅保留兼容历史数据回填。
 * 规则：同一 approverId 只保留最早出现的节点，被合并的角色名记入 mergedRoles 供展示。
 * 未解析到具体人的节点（approverId=null）不参与去重，保持角色占位。
 */
export function dedupeChain(chain: ChainNode[]): ChainNode[] {
  const seen = new Map<string, ChainNode>();
  const out: ChainNode[] = [];
  // 状态优先级：rejected > approved > pending。合并同审批人节点时，保留「更强」的处理结果，
  // 以便对历史/存量数据做回填去重时，不会因丢弃后出现的已签节点而丢失审批留痕。
  const rank: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
  for (const node of chain) {
    const key = node.approverId;
    if (key && seen.has(key)) {
      const keep = seen.get(key)!;
      keep.mergedRoles = [...(keep.mergedRoles || []), node.roleName];
      if ((rank[node.status || 'pending'] ?? 0) > (rank[keep.status || 'pending'] ?? 0)) {
        keep.status = node.status;
        if (node.opinion != null) keep.opinion = node.opinion;
        if (node.actedAt != null) keep.actedAt = node.actedAt;
        if (node.actualApproverId != null) keep.actualApproverId = node.actualApproverId;
        if (node.actualApproverName != null) keep.actualApproverName = node.actualApproverName;
      }
      continue;
    }
    if (key) seen.set(key, node);
    out.push(node);
  }
  return out.map((n, i) => ({ ...n, seq: i + 1 }));
}

/** 取链上第一个未处理节点 */
export function nextPending(chain: ChainNode[] | null | undefined): ChainNode | null {
  if (!chain?.length) return null;
  return chain.find((n) => n.status === 'pending') ?? null;
}

/** 把「下一个待办节点的 stage」翻译为作业票状态 */
export function stageToStatus(stage: ChainStage): string {
  if (stage === 'review') return 'pending_review';
  if (stage === 'ehs') return 'ehs_reviewing';
  return 'reviewing';
}

/**
 * 标记链上当前阶段的第一个待办节点为已处理，返回新链 + 下一个状态。
 * 若链已全部签完 → nextStatus='approved'。
 */
export function advanceChain(
  chain: ChainNode[] | null | undefined,
  stage: ChainStage,
  actor: { userId: string | null; name: string },
  approve: boolean,
  opinion?: string,
): { chain: ChainNode[]; nextStatus: string; nextNode: ChainNode | null } {
  const list: ChainNode[] = Array.isArray(chain) ? JSON.parse(JSON.stringify(chain)) : [];
  const idx = list.findIndex((n) => n.status === 'pending' && n.stage === stage);
  if (idx >= 0) {
    list[idx].status = approve ? 'approved' : 'rejected';
    list[idx].opinion = opinion ?? null;
    list[idx].actedAt = new Date().toISOString();
    // 实际审批人可能与预分配不同（代签/授权），以实际操作人为准并留痕
    if (actor.userId && list[idx].approverId !== actor.userId) {
      list[idx].actualApproverId = actor.userId as any;
      list[idx].actualApproverName = actor.name as any;
    }
    if (!list[idx].approverId) {
      list[idx].approverId = actor.userId;
      list[idx].approverName = actor.name;
    }
  }
  if (!approve) return { chain: list, nextStatus: 'rejected', nextNode: null };
  const nxt = nextPending(list);
  return { chain: list, nextStatus: nxt ? stageToStatus(nxt.stage) : 'approved', nextNode: nxt };
}

/** 审批链的人类可读摘要（用于日志/邮件） */
export function describeChain(kind: PermitKind, chain: ChainNode[]): string {
  return (
    `${PERMIT_KIND_LABEL[kind]}（${chain.length}级）：` +
    chain.map((n, i) => `${i + 1}.${n.roleName}${n.approverName ? `(${n.approverName})` : ''}`).join(' → ')
  );
}
