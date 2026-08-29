// 领域常量：权限点、角色、作业票类型、隐患状态等
// 后端是“真相来源”，前端按需复制常量。

// ========== 作业票类型 ==========
// 注意：isHazardous=true 表示“危险作业”，需要额外审批 + 现场检查
export const WORK_PERMIT_TYPES: Record<
  string,
  { label: string; isHazardous: boolean; needCertificate: boolean }
> = {
  hot_work: { label: '动火作业', isHazardous: true, needCertificate: true },
  high_altitude: { label: '高处作业', isHazardous: true, needCertificate: true },
  confined_space: { label: '受限空间作业', isHazardous: true, needCertificate: true },
  lifting: { label: '起重吊装作业', isHazardous: true, needCertificate: true },
  excavation: { label: '动土（挖掘）作业', isHazardous: true, needCertificate: false },
  road_breaking: { label: '断路作业', isHazardous: false, needCertificate: false }, // 断路清单，独立于挖掘
  temporary_electricity: { label: '临时用电', isHazardous: true, needCertificate: false },
  blind: { label: '盲板抽堵作业', isHazardous: true, needCertificate: false },
  other: { label: '其他危险作业', isHazardous: true, needCertificate: false },
  // 常规（非危险）作业：不属于 GB 30871 八大危险作业，但仍需办票、交底与审批留痕。
  // 缺少该类型时，常规作业只能被迫套用"其他危险作业"，导致常规票被误标危险、混进危险台账。
  routine: { label: '常规作业', isHazardous: false, needCertificate: false },
};

export function getWorkPermitType(key: string) {
  return WORK_PERMIT_TYPES[key] || WORK_PERMIT_TYPES.other;
}

// ========== 作业票编号前缀（按作业类型区分，便于台账检索与归档）==========
// 编号格式：{PREFIX}-{YYYYMM}-{4位流水}，例如 GWP-202608-0001、HWP-202608-0007。
// 旧数据使用 ZY{YYYYMM}{流水} / ZY-DM-A-NNNN 等历史格式，保持不动，仅新票采用本规则。
export const PERMIT_NO_PREFIX: Record<string, string> = {
  routine: 'GWP', // General Work Permit 常规作业
  hot_work: 'HWP', // Hot Work Permit 动火作业
  confined_space: 'CSE', // Confined Space Entry 受限空间
  high_altitude: 'WHP', // Work at Height Permit 高处作业
  lifting: 'LFP', // Lifting Permit 起重吊装
  excavation: 'EXP', // Excavation Permit 动土（挖掘）
  road_breaking: 'RCP', // Road Closure Permit 断路作业
  blind: 'LBP', // Line Blinding Permit 盲板抽堵
  temporary_electricity: 'TEP', // Temporary Electricity Permit 临时用电
  other: 'OSP', // Other Special Permit 其他危险作业
};

export function permitNoPrefix(type: string): string {
  return PERMIT_NO_PREFIX[type] || PERMIT_NO_PREFIX.other;
}

// ========== 作业票有效时限（小时，内部从严口径，依据 GB 30871-2022 与公司制度）==========
// 危险作业票（动火/受限空间/高处/吊装/挖掘/断路/盲板）单票有效期 ≤24 小时；
// 临时用电按 GB/T 或公司制度独立管理，≤15 天（360 小时），不随关联危险票同步；
// 作业申请单作业周期 ≤7 天（168 小时）。
export const PERMIT_DURATION_LIMIT_HOURS: Record<string, number> = {
  hot_work: 24,
  high_altitude: 24,
  confined_space: 24,
  lifting: 24,
  excavation: 24,
  road_breaking: 24,
  blind: 24,
  temporary_electricity: 15 * 24,
  routine: 7 * 24, // 常规作业：与申请单口径一致，≤7 天
};
export const APPLICATION_DURATION_LIMIT_HOURS = 7 * 24;

export function permitDurationLimitHours(type: string): number | null {
  return PERMIT_DURATION_LIMIT_HOURS[type] ?? null;
}

// ========== 作业票签字角色 ==========
// 用于现场多方手机签字：申请人 / 作业负责人 / 监护人（危险作业）/
// 监火人（动火作业）/ 作业人（承包商或本厂）/ 验收人
export const SIGN_ROLES: Record<string, { label: string; required: 'always' | 'hazardous' | 'hot_work' | 'never' }> = {
  applicant: { label: '申请人', required: 'always' },
  supervisor: { label: '监护人（专职）', required: 'hazardous' },
  fire_watcher: { label: '监火人', required: 'hot_work' },
  worker: { label: '作业人', required: 'always' },
  contractor: { label: '承包商负责人', required: 'never' },
  acceptor: { label: '验收人', required: 'never' },
};
export const SIGN_ROLE_KEYS = Object.keys(SIGN_ROLES);

// 计算某作业类型「必须签字」的角色集合（用于提交/完工时的强制校验）
export function requiredSignRoles(type: string, isHazardous: boolean): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(SIGN_ROLES)) {
    if (v.required === 'always') keys.push(k);
    else if (v.required === 'hazardous' && isHazardous) keys.push(k);
    else if (v.required === 'hot_work' && type === 'hot_work') keys.push(k);
  }
  return keys;
}


// ========== 隐患状态 ==========
export const HAZARD_STATUS: Record<string, { label: string; color: string }> = {
  pending_assign: { label: '待派单', color: '#f59e0b' },
  assigned: { label: '整改中', color: '#3b82f6' },
  rectified: { label: '待部门确认', color: '#8b5cf6' },
  dept_confirmed: { label: '待验收', color: '#0ea5e9' },
  accepted: { label: '已验收', color: '#22c55e' },
  rejected: { label: '验收不通过', color: '#ef4444' },
  cancelled: { label: '已撤销', color: '#94a3b8' },
  archived: { label: '已归档', color: '#64748b' },
};

// ========== 作业票状态 ==========
// 危险作业票（isHazardous）三方顺序会签：
//   pending_review(待申请部门主管审核) -> ehs_reviewing(待EHS工程师审批) -> reviewing(待工程部经理批准) -> approved
// 非危险作业票：pending_review -> approved（一步审核）
export const WORK_PERMIT_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  pending_review: { label: '待部门审核', color: '#f59e0b' },
  ehs_reviewing: { label: '待EHS审批', color: '#8b5cf6' },
  reviewing: { label: '待经理批准', color: '#3b82f6' },
  approved: { label: '已批准', color: '#22c55e' },
  rejected: { label: '已驳回', color: '#ef4444' },
  printed: { label: '执行中', color: '#0ea5e9' },
  paused: { label: '已暂停', color: '#f97316' },
  finished: { label: '完工待归档', color: '#14b8a6' },
  completed: { label: '已归档', color: '#64748b' },
  voided: { label: '已作废', color: '#dc2626' },
};

// ========== 风险等级 ==========
export const RISK_LEVELS: Record<string, { label: string; color: string }> = {
  low: { label: '低风险', color: '#22c55e' },
  normal: { label: '一般风险', color: '#84cc16' },
  major: { label: '较大风险', color: '#f59e0b' },
  critical: { label: '重大风险', color: '#ef4444' },
};

// ========== 权限点 ==========
// subject:action  含义见各模块
export const PERMISSIONS: { subject: string; action: string; description: string }[] = [
  { subject: 'hazard', action: 'create', description: '上报隐患（含微信免登录）' },
  { subject: 'hazard', action: 'view_own', description: '查看自己上报的隐患' },
  { subject: 'hazard', action: 'view_all', description: '查看全部隐患' },
  { subject: 'hazard', action: 'view_department', description: '查看部门隐患（部门负责人）' },
  { subject: 'hazard', action: 'assign', description: '派单/分配整改部门' },
  { subject: 'hazard', action: 'rectify', description: '提交整改' },
  { subject: 'hazard', action: 'dept_review', description: '部门负责人审核确认整改' },
  { subject: 'hazard', action: 'accept', description: '验收隐患' },
  { subject: 'hazard', action: 'archive', description: '直接归档隐患' },
  { subject: 'hazard', action: 'export', description: '导出隐患台账' },
  { subject: 'work_permit', action: 'create', description: '提交作业票申请' },
  { subject: 'work_permit', action: 'view_own', description: '查看自己的作业票' },
  { subject: 'work_permit', action: 'view_all', description: '查看全部作业票' },
  { subject: 'work_permit', action: 'review', description: '审核作业票（申请部门主管）' },
  { subject: 'work_permit', action: 'approve_ehs', description: 'EHS工程师审批（危险作业票会签第2步）' },
  { subject: 'work_permit', action: 'approve_mgr', description: '工程部经理批准（危险作业票会签第3步）' },
  { subject: 'work_permit', action: 'approve', description: '批准作业票（兼容旧权限，等同工程部经理批准）' },
  { subject: 'work_permit', action: 'print', description: '打印/导出作业票' },
  { subject: 'work_permit', action: 'onsite_check', description: '现场检查签字/交底/巡检' },
  { subject: 'work_permit', action: 'pause', description: '暂停/恢复现场作业（EHS）' },
  { subject: 'work_permit', action: 'void', description: '作废作业票（EHS）' },
  { subject: 'work_permit', action: 'export', description: '导出作业票台账' },
  { subject: 'epermit', action: 'create', description: '提交作业票申请' },
  { subject: 'epermit', action: 'view_own', description: '查看自己的作业票' },
  { subject: 'epermit', action: 'view_all', description: '查看全部作业票' },
  { subject: 'epermit', action: 'review', description: '审核作业票（申请部门主管）' },
  { subject: 'epermit', action: 'approve_ehs', description: 'EHS工程师审批（电子化危险作业票会签第2步）' },
  { subject: 'epermit', action: 'approve_mgr', description: '工程部经理批准（电子化危险作业票会签第3步）' },
  { subject: 'epermit', action: 'approve', description: '批准作业票（兼容旧权限，等同工程部经理批准）' },
  { subject: 'epermit', action: 'print', description: '打印/导出作业票' },
  { subject: 'epermit', action: 'onsite_check', description: '电子化现场交底/检查/签字' },
  { subject: 'epermit', action: 'pause', description: '暂停/恢复电子化现场作业' },
  { subject: 'epermit', action: 'void', description: '作废作业票' },
  { subject: 'epermit', action: 'export', description: '导出作业票台账' },
  { subject: 'board', action: 'view', description: '查看全员作业看板' },
  { subject: 'user', action: 'manage', description: '管理员工账号' },
  { subject: 'role', action: 'manage', description: '管理角色与权限' },
  { subject: 'department', action: 'manage', description: '管理部门' },
  { subject: 'area', action: 'manage', description: '管理区域' },
  { subject: 'hazard_type', action: 'manage', description: '管理隐患类型' },
  { subject: 'risk_level', action: 'manage', description: '管理风险等级' },
  { subject: 'email', action: 'manage', description: '管理邮件通知（SMTP）' },
  { subject: 'lottery', action: 'manage', description: '管理安全抽奖设置' },
  { subject: 'qr', action: 'manage', description: '管理微信上报二维码' },
  { subject: 'config', action: 'manage', description: '管理系统配置（AI提示词等）' },
  { subject: 'dashboard', action: 'view', description: '查看数据看板' },
  { subject: 'backup', action: 'download', description: '下载数据库备份' },
  { subject: 'backup', action: 'sync_feishu', description: '同步备份到飞书多维表格' },
];

// ========== 角色 -> 权限映射（种子数据）============
export const ROLE_SEEDS: { key: string; name: string; description: string; perms: string[] }[] = [
  {
    key: 'admin',
    name: '系统管理员',
    description: '拥有全部权限',
    perms: PERMISSIONS.map((p) => `${p.subject}:${p.action}`),
  },
  {
    key: 'safety',
    name: '安全员（审核人）',
    description: '隐患派单/验收、作业票审核',
    perms: [
      'hazard:create',
      'hazard:view_own',
      'hazard:view_all',
      'hazard:assign',
      'hazard:accept',
      'hazard:archive',
      'hazard:export',
      'work_permit:create',
      'work_permit:view_own',
      'work_permit:view_all',
      'work_permit:review',
      'work_permit:approve_ehs',
      'work_permit:print',
      'work_permit:onsite_check',
      'work_permit:pause',
      'work_permit:void',
      'work_permit:export',
      'epermit:create',
      'epermit:view_own',
      'epermit:view_all',
      'epermit:review',
      'epermit:approve_ehs',
      'epermit:print',
      'epermit:onsite_check',
      'epermit:pause',
      'epermit:void',
      'epermit:export',
      'dashboard:view',
      'board:view',
    ],
  },
  {
    key: 'approver',
    name: '审批人（部门负责人）',
    description: '批准作业票（含危险作业）',
    perms: [
      'hazard:create',
      'hazard:view_own',
      'hazard:view_all',
      'hazard:view_department',
      'hazard:dept_review',
      'work_permit:create',
      'work_permit:view_own',
      'work_permit:view_all',
      'work_permit:review',
      'work_permit:approve',
      'work_permit:approve_mgr',
      'work_permit:print',
      'work_permit:onsite_check',
      'epermit:create',
      'epermit:view_own',
      'epermit:view_all',
      'epermit:review',
      'epermit:approve',
      'epermit:approve_mgr',
      'epermit:print',
      'epermit:onsite_check',
      'dashboard:view',
      'board:view',
    ],
  },
  {
    key: 'employee',
    name: '普通员工',
    description: '上报隐患、提交自己的作业票申请',
    perms: [
      'hazard:create',
      'hazard:view_own',
      'work_permit:create',
      'work_permit:view_own',
      'work_permit:onsite_check',
      'epermit:create',
      'epermit:view_own',
      'epermit:onsite_check',
      'dashboard:view',
      'board:view',
    ],
  },
];
