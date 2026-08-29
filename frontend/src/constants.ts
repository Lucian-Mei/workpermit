// 与后端 domain.ts 保持一致（前端复制，避免每个页面重复定义）
export const WORK_PERMIT_TYPES: Record<string, { label: string; isHazardous: boolean; needCertificate: boolean }> = {
  hot_work: { label: '动火作业', isHazardous: true, needCertificate: true },
  high_altitude: { label: '高处作业', isHazardous: true, needCertificate: true },
  confined_space: { label: '受限空间作业', isHazardous: true, needCertificate: true },
  lifting: { label: '起重吊装作业', isHazardous: true, needCertificate: true },
  excavation: { label: '动土作业', isHazardous: true, needCertificate: false },
  temporary_electricity: { label: '临时用电', isHazardous: true, needCertificate: false },
  blind: { label: '盲板抽堵作业', isHazardous: true, needCertificate: false },
  other: { label: '其他危险作业', isHazardous: true, needCertificate: false },
  // 常规（非危险）作业：不属于八大危险作业，仍需办票与审批留痕
  routine: { label: '常规作业', isHazardous: false, needCertificate: false },
};

// ===== 作业票风险等级（驱动审批层级：低=2级 / 中=3级 / 重大=4级）=====
// 注意：与隐患模块的 RISK_LEVELS（low/normal/major/critical）命名空间不同，此处单独命名避免冲突。
export const PERMIT_RISK_LEVELS: Record<string, { label: string; color: string; levels: number; desc: string }> = {
  low: { label: '一般风险', color: '#22c55e', levels: 2, desc: '区域/部门负责人 → 安全员' },
  medium: { label: '中等风险', color: '#f59e0b', levels: 3, desc: '区域/部门负责人 → 安全员 → 安全部门负责人' },
  high: { label: '重大风险', color: '#ef4444', levels: 4, desc: '区域/部门负责人 → 安全主管 → 安全部门负责人 → 分管副总' },
};

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

export const WORK_PERMIT_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  pending_review: { label: '待部门审核', color: '#f59e0b' },
  ehs_reviewing: { label: '待EHS审批', color: '#a855f7' },
  reviewing: { label: '待经理批准', color: '#3b82f6' },
  approved: { label: '已批准', color: '#22c55e' },
  rejected: { label: '已驳回', color: '#ef4444' },
  printed: { label: '执行中', color: '#0ea5e9' },
  paused: { label: '已暂停', color: '#f97316' },
  finished: { label: '完工待归档', color: '#14b8a6' },
  completed: { label: '已归档', color: '#64748b' },
  voided: { label: '已作废', color: '#dc2626' },
};

// 电子票页面共用的 9 类生命周期卡片
// 顺序即展示顺序：全部 → 审批中 → 交底中 → 作业中 → 进行中 → 已暂停 → 待补资料 → 已完成 → 已归档
// 进行中=交底中+作业中（全部 printed）；已暂停独立（paused 不归入作业中/进行中）；待补资料=已归档但资料不全（超期自动归档）
// 与作业看板 running/paused 口径一致
export const EPERMIT_CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'all', label: '全部', color: '#64748b' },
  { key: 'reviewing', label: '审批中', color: '#f59e0b' },
  { key: 'briefing', label: '交底中', color: '#a855f7' },
  { key: 'working', label: '作业中', color: '#0ea5e9' },
  { key: 'in_progress', label: '进行中', color: '#22c55e' },
  { key: 'paused', label: '已暂停', color: '#f97316' },
  { key: 'material_missing', label: '待补资料', color: '#e11d48' },
  { key: 'finished', label: '已完成', color: '#14b8a6' },
  { key: 'archived', label: '已归档', color: '#64748b' },
];

// 可在作业票下申请的危险作业类型
export const HAZARD_PERMIT_TYPES = ['hot_work', 'high_altitude', 'confined_space', 'lifting', 'excavation', 'temporary_electricity', 'blind'];

// 现场签字角色（与后端 SIGN_ROLES 保持一致）
export const SIGN_ROLES: Record<string, { label: string; required: 'always' | 'hazardous' | 'hot_work' | 'never' }> = {
  applicant: { label: '申请人', required: 'always' },
  supervisor: { label: '监护人（专职）', required: 'hazardous' },
  fire_watcher: { label: '监火人', required: 'hot_work' },
  worker: { label: '作业人', required: 'always' },
  contractor: { label: '承包商负责人', required: 'never' },
  acceptor: { label: '验收人', required: 'never' },
};
export const SIGN_ROLE_KEYS = Object.keys(SIGN_ROLES);

// 某作业类型「必须签字」角色（前端用于呈现必填徽标）
export function requiredSignRoles(type: string, isHazardous: boolean): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(SIGN_ROLES)) {
    if (v.required === 'always') keys.push(k);
    else if (v.required === 'hazardous' && isHazardous) keys.push(k);
    else if (v.required === 'hot_work' && type === 'hot_work') keys.push(k);
  }
  return keys;
}


// 隐患填报：楼栋 / 楼层下拉选项
export const BUILDING_OPTIONS = [
  'A栋', 'B栋', 'C栋', 'D栋',
  '综合办公楼', '1号生产车间', '2号生产车间',
  '仓储中心', '动力站房', '厂区室外',
];

export const FLOOR_OPTIONS = [
  'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '楼顶', '室外',
];

export const RISK_LEVELS: Record<string, { label: string; color: string }> = {
  low: { label: '低风险', color: '#22c55e' },
  normal: { label: '一般风险', color: '#84cc16' },
  major: { label: '较大风险', color: '#f59e0b' },
  critical: { label: '重大风险', color: '#ef4444' },
};

// 权限目录（subject:action -> 中文说明）
// 权限点按「菜单目录」分类（与 Layout 侧边栏 NAV_GROUPS 对应），便于在角色权限管理中识别权限控制的功能。
export type PermCategoryKey = 'overview' | 'hazard' | 'permit' | 'org' | 'system';

export const PERM_CATEGORIES: { key: PermCategoryKey; label: string; desc: string }[] = [
  { key: 'overview', label: '总览', desc: '仪表盘 / 作业看板' },
  { key: 'hazard', label: '隐患管理', desc: '隐患上报 / 派单 / 整改 / 验收 / 导出' },
  { key: 'permit', label: '作业票管理', desc: '作业申请 / 审批 / 现场执行 / 台账（含纸质渠道兼容权限）' },
  { key: 'org', label: '员工与权限', desc: '员工账号 / 角色权限 / 部门' },
  { key: 'system', label: '系统设置', desc: '区域 / 类型 / 邮件 / 抽奖 / 二维码 / 配置 / 备份' },
];

// 权限点目录（44+6=48 个，覆盖 domain.ts PERMISSIONS 全部权限点）
export const PERMISSION_CATALOG: { key: string; label: string; cat: PermCategoryKey }[] = [
  // ===== 总览 =====
  { key: 'dashboard:view', label: '查看数据看板', cat: 'overview' },
  { key: 'board:view', label: '查看全员作业看板', cat: 'overview' },
  // ===== 隐患管理 =====
  { key: 'hazard:create', label: '上报隐患', cat: 'hazard' },
  { key: 'hazard:view_own', label: '查看自己上报的隐患', cat: 'hazard' },
  { key: 'hazard:view_all', label: '查看全部隐患', cat: 'hazard' },
  { key: 'hazard:view_department', label: '查看部门隐患', cat: 'hazard' },
  { key: 'hazard:assign', label: '派单/分配整改', cat: 'hazard' },
  { key: 'hazard:rectify', label: '提交整改', cat: 'hazard' },
  { key: 'hazard:dept_review', label: '部门负责人审核整改', cat: 'hazard' },
  { key: 'hazard:accept', label: '验收隐患', cat: 'hazard' },
  { key: 'hazard:archive', label: '直接归档隐患', cat: 'hazard' },
  { key: 'hazard:export', label: '导出隐患台账', cat: 'hazard' },
  { key: 'hazard_type:manage', label: '管理隐患类型', cat: 'hazard' },
  { key: 'risk_level:manage', label: '管理风险等级', cat: 'hazard' },
  // ===== 作业票 =====
  { key: 'work_permit:create', label: '提交作业票申请', cat: 'permit' },
  { key: 'work_permit:view_own', label: '查看自己的作业票', cat: 'permit' },
  { key: 'work_permit:view_all', label: '查看全部作业票', cat: 'permit' },
  { key: 'work_permit:review', label: '审核作业票（部门主管）', cat: 'permit' },
  { key: 'work_permit:approve_ehs', label: 'EHS工程师审批（危险票）', cat: 'permit' },
  { key: 'work_permit:approve_mgr', label: '经理批准（危险票）', cat: 'permit' },
  { key: 'work_permit:approve', label: '批准作业票（兼容）', cat: 'permit' },
  { key: 'work_permit:print', label: '打印/导出作业票', cat: 'permit' },
  { key: 'work_permit:onsite_check', label: '现场检查/交底/巡检', cat: 'permit' },
  { key: 'work_permit:pause', label: '暂停/恢复现场作业', cat: 'permit' },
  { key: 'work_permit:void', label: '作废作业票', cat: 'permit' },
  { key: 'work_permit:export', label: '导出作业票台账', cat: 'permit' },
  { key: 'epermit:create', label: '提交作业票申请', cat: 'permit' },
  { key: 'epermit:view_own', label: '查看自己的作业票', cat: 'permit' },
  { key: 'epermit:view_all', label: '查看全部作业票', cat: 'permit' },
  { key: 'epermit:review', label: '审核作业票（部门主管）', cat: 'permit' },
  { key: 'epermit:approve_ehs', label: 'EHS工程师审批（电子危险票）', cat: 'permit' },
  { key: 'epermit:approve_mgr', label: '经理批准（电子危险票）', cat: 'permit' },
  { key: 'epermit:approve', label: '批准作业票（兼容）', cat: 'permit' },
  { key: 'epermit:print', label: '打印/导出作业票', cat: 'permit' },
  { key: 'epermit:onsite_check', label: '电子化现场检查/交底/巡检', cat: 'permit' },
  { key: 'epermit:pause', label: '暂停/恢复电子化现场作业', cat: 'permit' },
  { key: 'epermit:void', label: '作废作业票', cat: 'permit' },
  { key: 'epermit:export', label: '导出作业票台账', cat: 'permit' },
  // ===== 员工与权限 =====
  { key: 'user:manage', label: '管理员工账号', cat: 'org' },
  { key: 'role:manage', label: '管理角色与权限', cat: 'org' },
  { key: 'department:manage', label: '管理部门', cat: 'org' },
  // ===== 系统设置 =====
  { key: 'area:manage', label: '管理区域', cat: 'system' },
  { key: 'email:manage', label: '管理邮件通知', cat: 'system' },
  { key: 'lottery:manage', label: '管理安全抽奖', cat: 'system' },
  { key: 'qr:manage', label: '管理上报二维码', cat: 'system' },
  { key: 'config:manage', label: '管理系统配置', cat: 'system' },
  { key: 'backup:download', label: '下载数据库备份', cat: 'system' },
  { key: 'backup:sync_feishu', label: '同步备份到飞书', cat: 'system' },
];

export const PERM_LABEL: Record<string, string> = Object.fromEntries(
  PERMISSION_CATALOG.map((p) => [p.key, p.label]),
);
