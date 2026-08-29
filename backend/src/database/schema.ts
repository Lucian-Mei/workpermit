// EHS 管理系统 —— 数据库表结构（Drizzle ORM / PostgreSQL）
// 说明：所有表结构由代码管理，迁移用 `npm run db:push`（开发）或 drizzle-kit migrate（生产）。
// 这样后期加字段、加表都很方便，也方便把数据迁移到别的 Postgres 实例。

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============ 账号与权限 ============

// 角色：admin 超级管理员 / safety 安全员（审核人）/ approver 审批人（部门负责人）/ employee 普通员工
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 50 }).notNull().unique(), // admin / safety / approver / employee
  name: varchar('name', { length: 50 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 权限点：subject + action 唯一确定一个权限，如 hazard:create
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subject: varchar('subject', { length: 50 }).notNull(), // hazard / work_permit / user / role / department / config / dashboard / backup
    action: varchar('action', { length: 50 }).notNull(), // create / view_all / review / approve ...
    description: text('description'),
  },
  (t) => ({
    unq: uniqueIndex('permissions_subject_action').on(t.subject, t.action),
  }),
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: uniqueIndex('role_permissions_pk').on(t.roleId, t.permissionId),
  }),
);

// 员工账号：用户名=姓名拼音，密码由系统下发
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 100 }).notNull().unique(), // 登录名（拼音）
  name: varchar('name', { length: 100 }).notNull(), // 真实姓名
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  department: varchar('department', { length: 100 }),
  area: varchar('area', { length: 100 }), // 所属区域
  managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }), // 直属领导（自关联）
  status: varchar('status', { length: 20 }).notNull().default('active'), // active / disabled
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 刷新令牌（S07）：短期 Access Token 失效后凭 Refresh Token 轮换续期。
// 明文令牌仅返回给客户端（置于 HttpOnly Cookie），库内只存 SHA-256 哈希，支持吊销/轮换/单点登出/离职即时失效。
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(), // sha256 hex
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'), // 轮换后指向新令牌 id
    ua: varchar('ua', { length: 255 }),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxUserId: index('idx_rt_user').on(t.userId),
    idxExpires: index('idx_rt_expires').on(t.expiresAt),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: uniqueIndex('user_roles_pk').on(t.userId, t.roleId),
  }),
);

// ============ 部门 ============
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  abbreviation: varchar('abbreviation', { length: 50 }),
  responsiblePerson: varchar('responsible_person', { length: 100 }), // 部门负责人
  coordinator: varchar('coordinator', { length: 100 }),
  coordinatorPhone: varchar('coordinator_phone', { length: 50 }),
  defaultRectifierId: uuid('default_rectifier_id').references(() => users.id, { onDelete: 'set null' }), // 默认整改人员
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 部门负责人（多对多）：一个部门可配置多个负责人
export const departmentManagers = pgTable(
  'department_managers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('department_managers_pk').on(t.userId, t.departmentId),
  }),
);

// ============ 配置类（隐患类型、风险等级）============
export const hazardTypes = pgTable('hazard_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  regulations: jsonb('regulations').$type<string[]>().default([]), // 关联法规条款
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

// ============ 隐患 ============
// 状态机：pending_assign(待派单) -> assigned(已派单/整改中) -> rectified(已整改待验收)
//        -> accepted(已验收) / rejected(验收不通过,回到整改)
//        / cancelled(撤销)
export const hazards = pgTable(
  'hazards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hazardNo: varchar('hazard_no', { length: 50 }).notNull().unique(),
    // 上报人：登录用户有 userId；微信免登录上报只有 submitterName
    submitterUserId: uuid('submitter_user_id').references(() => users.id, { onDelete: 'set null' }),
    submitterName: varchar('submitter_name', { length: 100 }),
    isAnonymous: boolean('is_anonymous').notNull().default(false), // 微信扫码免登录上报
    building: varchar('building', { length: 100 }),
    floor: varchar('floor', { length: 50 }),
    location: varchar('location', { length: 255 }),
    area: varchar('area', { length: 100 }), // 所属区域（下拉，来自 areas 表）
    department: varchar('department', { length: 100 }), // 上报人所属部门（下拉，来自 departments 表）
    photos: jsonb('photos').$type<string[]>().default([]),
    description: text('description'),
    suggestDepartment: varchar('suggest_department', { length: 100 }),
    suggestAction: text('suggest_action'),
    // AI 辅助分析字段
    aiDescription: text('ai_description'),
    aiCategory: varchar('ai_category', { length: 100 }),
    aiRiskLevel: varchar('ai_risk_level', { length: 50 }),
    aiRegulation: text('ai_regulation'),
    aiSuggestion: text('ai_suggestion'),
    aiRootCause: text('ai_root_cause'),
    ai5Why: text('ai_5why'),
    aiControlMeasures: text('ai_control_measures'),
    categoryApproved: jsonb('category_approved').$type<string[]>().default([]),
    riskLevel: varchar('risk_level', { length: 50 }).notNull().default('low'),
    status: varchar('status', { length: 30 }).notNull().default('pending_assign'),
    allocatedDepartment: varchar('allocated_department', { length: 100 }),
    assignedDeptId: uuid('assigned_dept_id').references(() => departments.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeName: varchar('assignee_name', { length: 100 }),
    deadline: timestamp('deadline', { withTimezone: true }),
    rectificationDesc: text('rectification_desc'),
    rectificationFiles: jsonb('rectification_files').$type<string[]>().default([]),
    rectificationDate: timestamp('rectification_date', { withTimezone: true }),
    acceptanceResult: varchar('acceptance_result', { length: 20 }), // pass / fail
    rejectionReason: text('rejection_reason'),
    archivedReason: text('archived_reason'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByName: varchar('archived_by_name', { length: 100 }),
    isPublic: varchar('is_public', { length: 10 }).notNull().default('是'), // 是否公示
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxStatus: index('idx_hazards_status').on(t.status),
    idxDept: index('idx_hazards_dept').on(t.allocatedDepartment),
    idxSubmitter: index('idx_hazards_submitter').on(t.submitterUserId),
  }),
);

// 隐患处理记录（每一步操作：谁、何时、做了什么、意见）
export const hazardActivities = pgTable(
  'hazard_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hazardId: uuid('hazard_id').notNull().references(() => hazards.id, { onDelete: 'cascade' }),
    operatorId: uuid('operator_id').references(() => users.id, { onDelete: 'set null' }),
    operatorName: varchar('operator_name', { length: 100 }).notNull(),
    action: varchar('action', { length: 30 }).notNull(), // assign / forward / return / rectify / dept_review / accept / cancel / archive
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }),
    comment: text('comment'),
    payload: jsonb('payload').$type<Record<string, any>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxHazard: index('idx_hazard_activities_hazard').on(t.hazardId),
  }),
);

// ============ 作业票 ============
// 作业类型：hot_work 动火 / high_altitude 高处 / confined_space 受限空间 /
//          temporary_electricity 临时用电 / lifting 起重 / excavation 动土 / blind 盲板抽堵 / other 其他
// is_hazardous（危险作业）：hot_work / high_altitude / confined_space / lifting / excavation 等按法规判定
// 状态机：
//   pending_review(待审核) -> reviewing(审核中,仅危险作业需额外审批+现场检查) -> approved(已批准)
//        -> completed(已完成/归档) ；任意审核环节可 rejected(驳回)
export const workPermits = pgTable(
  'work_permits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    permitNo: varchar('permit_no', { length: 50 }).notNull().unique(),
    type: varchar('type', { length: 30 }).notNull(),
    isHazardous: boolean('is_hazardous').notNull().default(false), // 是否危险作业
    // channel: 'paper' 纸质作业票（原流程）/ 'electronic' 作业票（移动端优先）
    channel: varchar('channel', { length: 16 }).notNull().default('paper'),
    // 作业票：从 measure_templates 勾选并确认的安全措施 [{id,content,checked,note?}]
    measureSelections: jsonb('measure_selections').$type<Array<{ id: string; content: string; checked: boolean; note?: string }>>().default([]),
    // ===== 危险作业票 → 常规作业票 手动关联（P0-8）=====
    // 危险作业票必须挂靠在一张“已批准且未完成”的常规作业票（GWP）之下；
    // 常规票自身该字段恒为 null。删除常规票时置空（保留特殊票留痕）。
    linkedRoutineId: uuid('linked_routine_id'),
    linkedRoutineNo: varchar('linked_routine_no', { length: 50 }), // 冗余票号，便于列表/打印直接展示
    building: varchar('building', { length: 100 }), // 楼栋
    floor: varchar('floor', { length: 100 }), // 楼层
    area: varchar('area', { length: 100 }),
    location: varchar('location', { length: 255 }),
    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),
    applicantId: uuid('applicant_id').references(() => users.id, { onDelete: 'set null' }),
    applicantName: varchar('applicant_name', { length: 100 }),
    department: varchar('department', { length: 100 }),
    operatorNames: jsonb('operator_names').$type<string[]>().default([]),
    // 常规票申请时仅填“预计作业人数”，不要求一级安全培训已完成（P0-9 / 第31轮第5条）
    expectedOperatorCount: integer('expected_operator_count'),
    // 超期自动归档/缺资料标记：归档后资料不全置 true，补交后置 false
    materialMissing: boolean('material_missing').notNull().default(false),
    autoArchivedAt: timestamp('auto_archived_at'),
    supervisorName: varchar('supervisor_name', { length: 100 }),
    supervisorContact: varchar('supervisor_contact', { length: 50 }),
    operatorContact: varchar('operator_contact', { length: 50 }),
    content: text('content'), // 作业内容
    // ===== 方案 B 单表合并：承包商协同 / 项目扩展字段 =====
    jobName: varchar('job_name', { length: 255 }), // 作业名称/概述
    projectName: varchar('project_name', { length: 255 }), // 作业项目名称
    contractorUnit: varchar('contractor_unit', { length: 255 }), // 承包商单位名称
    contractorHead: varchar('contractor_head', { length: 100 }), // 承包商负责人
    contractorPhone: varchar('contractor_phone', { length: 50 }), // 承包商电话
    contractorEmail: varchar('contractor_email', { length: 255 }), // 承包商联系邮箱（免登录邀请）
    materialsList: text('materials_list'), // 使用的材料清单
    equipmentList: text('equipment_list'), // 使用的设备工具车辆清单
    managementDept: varchar('management_dept', { length: 100 }), // 承包商管理部门
    managementPerson: varchar('management_person', { length: 100 }), // 管理部门人员
    hazardTypeList: jsonb('hazard_type_list').$type<string[]>().default([]), // 危险作业类型（中文标签）
    // 危险作业监护人双签（合规）：公司监护人 + 承包商监护人
    guardianSignatures: jsonb('guardian_signatures').$type<Array<{ role: 'company_guardian' | 'contractor_guardian'; name: string; signImg?: string; signedAt?: string }>>().default([]),
    // 危险作业提交前现场检查记录（单表合并后由作业票承载，原仅存在于申请单）
    siteInspection: jsonb('site_inspection').$type<{ inspector?: string; result?: string; note?: string; submittedAt?: string } | null>().default(null),
    // 作业步骤（单表合并后由作业票承载，原仅存在于申请单）
    steps: jsonb('steps').$type<string[]>().default([]),
    // 承包商邀请（员工提交后生成，免登录填写）
    contractorInviteToken: varchar('contractor_invite_token', { length: 64 }),
    contractorInviteExpiresAt: timestamp('contractor_invite_expires_at', { withTimezone: true }),
    contractorSubmittedAt: timestamp('contractor_submitted_at', { withTimezone: true }),
    // 入厂核验二维码
    entryQrToken: varchar('entry_qr_token', { length: 64 }),
    entryQrUrl: text('entry_qr_url'),
    // 续期
    renewalCount: integer('renewal_count').notNull().default(0),
    renewalParentId: uuid('renewal_parent_id'),
    // 申请时 AI 风险分析（申请人点“AI分析”生成，可编辑后提交）
    aiRiskAnalysis: text('ai_risk_analysis'),
    safetyMeasures: jsonb('safety_measures').$type<string[]>().default([]), // 安全措施清单
    // 工作安全分析（JSA）：独立小节，[{ step, hazard, control }]，前端独立编辑与展示
    jsas: jsonb('jsas').$type<Array<{ step: string; hazard: string; control: string; risk?: string }>>().default([]),
    // 提交后由后台再做一次 AI 复核（是否存在其他风险、措施是否到位）
    aiReviewAnalysis: text('ai_review_analysis'),
    // 危险作业票三方顺序会签：pending_review(部门主管) -> ehs_reviewing(EHS工程师) -> reviewing(工程部经理) -> approved
    status: varchar('status', { length: 30 }).notNull().default('draft'),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }), // 第1步：申请部门主管
    reviewerName: varchar('reviewer_name', { length: 100 }),
    reviewOpinion: text('review_opinion'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ehsApproverId: uuid('ehs_approver_id').references(() => users.id, { onDelete: 'set null' }), // 第2步：EHS工程师
    ehsApproverName: varchar('ehs_approver_name', { length: 100 }),
    ehsApprovalOpinion: text('ehs_approval_opinion'),
    ehsApprovedAt: timestamp('ehs_approved_at', { withTimezone: true }),
    approverId: uuid('approver_id').references(() => users.id, { onDelete: 'set null' }), // 第3步：工程部经理
    approverName: varchar('approver_name', { length: 100 }),
    approvalOpinion: text('approval_opinion'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    printCount: integer('print_count').notNull().default(0),
    qrCode: text('qr_code'), // 二维码内容（指向公开查看/打印页的链接）
    // ===== 审批路由（按风险等级自动分配审批人层级）=====
    // low=一般风险(2级) / medium=中等风险(3级) / high=重大风险(4级)
    riskLevel: varchar('risk_level', { length: 20 }).notNull().default('low'),
    // 审批链快照：[{seq,stage,roleKey,roleName,approverId,approverName,status,opinion,actedAt}]
    // stage: review(部门/区域负责人) | ehs(安全条线) | final(最终批准，可串行多节点)
    approvalChain: jsonb('approval_chain').$type<Array<Record<string, any>>>(),
    // ===== 重构：作业代码 + 培训二维码 =====
    workCode: varchar('work_code', { length: 20 }), // SG-NNNNNN（6位），月内唯一，作业结束后清除
    trainingQrToken: varchar('training_qr_token', { length: 64 }), // 培训二维码 token（扫码进入考试）
    trainingQrExpiresAt: timestamp('training_qr_expires_at', { withTimezone: true }), // 3 天过期
    // ===== 现场执行态（全程移动端）=====
    printedAt: timestamp('printed_at', { withTimezone: true }), // 打印锁定时间（转执行中）
    finishedAt: timestamp('finished_at', { withTimezone: true }), // 现场完工时间
    archivedAt: timestamp('archived_at', { withTimezone: true }), // 归档时间
    // 电子签字集合：[{role,name,signImg(base64),signedAt}]（承包商在陪同人手机上手写）
    signatures: jsonb('signatures').$type<Array<Record<string, any>>>().default([]),
    // 暂停（仅 EHS/管理员）
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedBy: uuid('paused_by').references(() => users.id, { onDelete: 'set null' }),
    pausedByName: varchar('paused_by_name', { length: 100 }),
    pauseReason: text('pause_reason'),
    // 作废（仅 EHS/管理员，留痕后可重开）
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidedByName: varchar('voided_by_name', { length: 100 }),
    voidReason: text('void_reason'),
    replacedByPermitNo: varchar('replaced_by_permit_no', { length: 50 }), // 作废后重开的新票号
    // 今日进行判定的人工覆盖：null=按计划自动 / active=今日进行 / inactive=今日未进行
    dailyOverride: varchar('daily_override', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxStatus: index('idx_wp_status').on(t.status),
    idxType: index('idx_wp_type').on(t.type),
    idxDept: index('idx_wp_dept').on(t.department),
    idxApplicant: index('idx_wp_applicant').on(t.applicantId),
  }),
);

// （作业申请单表 workPermitApplications 已按方案 B 彻底删除：2026-08-29，系统未上线无存量数据）

// ============ 承包商安全培训记录（入厂核验用途，关联作业票）============
export const workPermitTrainings = pgTable(
  'work_permit_trainings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workPermitId: uuid('work_permit_id').notNull().references(() => workPermits.id, { onDelete: 'cascade' }),
    trainer: varchar('trainer', { length: 100 }), // 培训人
    trainingTopics: text('training_topics'), // 培训内容
    traineeNames: jsonb('trainee_names').$type<string[]>().default([]), // 受训人员
    traineeSignatures: jsonb('trainee_signatures').$type<string[]>().default([]), // 签名（图片URL或文字）
    trainingDate: timestamp('training_date', { withTimezone: true }),
    testResult: varchar('test_result', { length: 50 }), // 合格 / 不合格
    validUntil: timestamp('valid_until', { withTimezone: true }), // 培训有效期（效期内免考）
    remark: text('remark'),
    signCompletedAt: timestamp('sign_completed_at', { withTimezone: true }), // 培训人点击“完成培训签到”
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxWp: index('idx_wpt_wp').on(t.workPermitId),
  }),
);

// 作业票证书 OCR（特种作业证照片/PDF 附件 + 识别结果）
export const certificateOcr = pgTable(
  'certificate_ocr',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workPermitId: uuid('work_permit_id').notNull().references(() => workPermits.id, { onDelete: 'cascade' }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    filePath: varchar('file_path', { length: 512 }).notNull(), // /uploads/xxx
    fileType: varchar('file_type', { length: 20 }).notNull().default('image'), // image / pdf
    issuer: varchar('issuer', { length: 100 }), // 发证机关，如“住建局”“应急管理局”
    certType: varchar('cert_type', { length: 30 }), // 证书类型：welder 焊工 / lifting 吊装 / refrigeration 制冷 / other 其他
    required: boolean('required').notNull().default(false), // 是否按作业内容强制要求（T5 自动判定）
    ocrStatus: varchar('ocr_status', { length: 20 }).notNull().default('pending'), // pending / done / failed / manual
    ocrRaw: text('ocr_raw'), // OCR 原始文本
    ocrFields: jsonb('ocr_fields').$type<Record<string, string>>().default({}), // 结构化识别结果
    needManual: boolean('need_manual').notNull().default(false), // 识别不了，转人工确认
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxWp: index('idx_cert_wp').on(t.workPermitId),
  }),
);

// 作业票现场检查记录（可多次，最终纸质归档）
export const workPermitChecks = pgTable(
  'work_permit_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workPermitId: uuid('work_permit_id').notNull().references(() => workPermits.id, { onDelete: 'cascade' }),
    checkerName: varchar('checker_name', { length: 100 }).notNull(),
    // 动火定时检查槽位：0h（作业开始时）/ 1h / 3h；非动火巡检可空
    checkSlot: varchar('check_slot', { length: 10 }),
    // 解锁时间：1h 槽位 = 0h 完成后 +1h；3h 槽位 = 0h 完成后 +3h
    unlockAt: timestamp('unlock_at', { withTimezone: true }),
    checkItems: jsonb('check_items').$type<Record<string, boolean>>().default({}),
    checkPhoto: varchar('check_photo', { length: 512 }),
    note: text('note'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxWp: index('idx_check_wp').on(t.workPermitId),
  }),
);

// ============ 安全交底记录（挂作业票，一张作业票一份总交底）============
// 内容线上预填/AI 生成 → 现场手机逐条勾选确认 + 拍照 + 参与人签字（承包商在陪同人手机上手写）
export const safetyBriefings = pgTable(
  'safety_briefings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workPermitId: uuid('work_permit_id').notNull().references(() => workPermits.id, { onDelete: 'cascade' }),
    briefer: varchar('briefer', { length: 100 }), // 交底人（陪同人员）
    // 交底要点：[{text, checked}]，线上/AI 预填，现场逐条勾选
    points: jsonb('points').$type<Array<{ text: string; checked: boolean }>>().default([]),
    aiDraft: text('ai_draft'), // AI 生成的交底草稿原文
    content: text('content'), // 交底补充说明（自由文本）
    photos: jsonb('photos').$type<string[]>().default([]), // 现场交底照片
    // 参与人签字：[{name, role(worker/contractor/supervisor), signImg(base64), signedAt}]
    signatures: jsonb('signatures').$type<Array<Record<string, any>>>().default([]),
    briefedAt: timestamp('briefed_at', { withTimezone: true }), // 现场交底完成时间
    status: varchar('status', { length: 20 }).notNull().default('draft'), // draft / done
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxWp: uniqueIndex('idx_briefing_wp').on(t.workPermitId), // 一张作业票一份
  }),
);

// ============ 巡检记录（挂作业票；计入统计；支持纸质扫描 OCR 回填）============
export const inspectionRecords = pgTable(
  'inspection_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workPermitId: uuid('work_permit_id').notNull().references(() => workPermits.id, { onDelete: 'cascade' }), // 关联作业票
    inspectedAt: timestamp('inspected_at', { withTimezone: true }).notNull().defaultNow(), // 巡检时间
    inspector: varchar('inspector', { length: 100 }), // 巡检人
    result: varchar('result', { length: 20 }).notNull().default('normal'), // normal 正常 / abnormal 异常
    note: text('note'),
    photo: varchar('photo', { length: 512 }), // 现场照片 / 纸质记录扫描件
    source: varchar('source', { length: 20 }).notNull().default('manual'), // manual 手工 / ocr 扫描识别
    ocrRaw: text('ocr_raw'), // OCR 原始文本
    createdBy: varchar('created_by', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxWp: index('idx_insp_wp').on(t.workPermitId),
    idxAt: index('idx_insp_at').on(t.inspectedAt),
  }),
);

// ============ 作业票措施/检查点模板（线上可勾选）============
// 内容按原纸质模板（EHS-Ⅱ-008 系列）整理，按作业类型 + 阶段(pre 作业前措施 / during 施工中检查 / post 作业后检查) 存储。
// 作业票从此表拉取勾选项，故“模板完全线上化、不必再参考上传的纸质模板”。
export const measureTemplates = pgTable(
  'measure_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: varchar('type', { length: 30 }).notNull(), // 作业类型 key（hot_work 等）
    category: varchar('category', { length: 20 }).notNull(), // pre / during / post
    content: text('content').notNull(),
    note: varchar('note', { length: 100 }), // 如【危险作业】【高处动火】
    sort: integer('sort').notNull().default(0),
  },
  (t) => ({ idxType: index('idx_measure_type').on(t.type), idxCat: index('idx_measure_cat').on(t.category) }),
);

// ============ 一次性动作令牌（邮件内审批按钮 / 二维码手机签字）============
// purpose: email_approval 邮件审批（48小时过期，单次有效）
//          mobile_sign    二维码手机签字（multi=true 允许多人反复扫码签字，直至过期）
export const actionTokens = pgTable(
  'action_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: varchar('token', { length: 64 }).notNull().unique(),
    purpose: varchar('purpose', { length: 30 }).notNull(), // email_approval / mobile_sign
    targetType: varchar('target_type', { length: 30 }).notNull(), // work_permit / application / briefing / training
    targetId: uuid('target_id').notNull(),
    step: varchar('step', { length: 30 }), // 邮件审批步骤：review / approve_ehs / approve_mgr
    role: varchar('role', { length: 30 }), // 签字角色：worker/contractor/supervisor/fire_watcher 等
    signerName: varchar('signer_name', { length: 100 }), // 指定签字人（单人签字令牌）
    multi: boolean('multi').notNull().default(false), // true=多人共用（培训/交底集体签字）
    meta: jsonb('meta').$type<Record<string, any>>().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: varchar('used_by', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxToken: index('idx_atoken_token').on(t.token),
    idxTarget: index('idx_atoken_target').on(t.targetType, t.targetId),
  }),
);

// ============ 系统配置（AI 提示词、备份开关等）============
export const systemConfig = pgTable(
  'system_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 255 }).notNull().unique(),
    value: text('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unq: uniqueIndex('system_config_key').on(t.key),
  }),
);

// ============ 日志 ============
// 微信免登录上报的提交日志（限流/审计用）
export const submissionLog = pgTable(
  'submission_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientIp: varchar('client_ip', { length: 45 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull().default('hazard'), // hazard / work_permit
    refId: uuid('ref_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxIp: index('idx_submission_ip').on(t.clientIp, t.submittedAt),
  }),
);

// 备份日志
export const backupLog = pgTable('backup_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: varchar('kind', { length: 20 }).notNull().default('download'), // download / feishu
  target: varchar('target', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('success'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============ 区域 ============
export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    code: varchar('code', { length: 50 }), // 区域编码，用于作业票编号前缀
    description: text('description'),
    building: varchar('building', { length: 50 }), // 建筑，如 综合楼
    floor: varchar('floor', { length: 50 }), // 楼层，如 一楼
    responsibleDept: varchar('responsible_dept', { length: 100 }), // 区域负责部门
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({ idxName: index('idx_areas_name').on(t.name) }),
);

// ============ 二维码（微信扫码上报）============
// 生成指向 /anonymous 上报页的二维码，可绑定区域/场景，用于张贴在厂区各处。
export const qrCodes = pgTable(
  'qr_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(), // 二维码名称，如“厂区A-西门”
    scene: varchar('scene', { length: 50 }), // 场景标识，如 gate / workshop / office
    area: varchar('area', { length: 100 }), // 关联区域
    targetUrl: text('target_url').notNull(), // 指向 /anonymous?... 的完整链接
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idxName: index('idx_qr_name').on(t.name) }),
);

// ============ 抽奖记录（隐患上报激励）============
export const lotteryRecords = pgTable(
  'lottery_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    userName: varchar('user_name', { length: 100 }),
    prize: varchar('prize', { length: 100 }).notNull(),
    source: varchar('source', { length: 40 }),
    refId: varchar('ref_id', { length: 100 }),
    refNo: varchar('ref_no', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idxUserId: index('idx_lottery_user').on(t.userId) }),
);

// ============ 关系定义（可选，用于联表查询）============
export const usersRelations = relations(users, ({ many }) => ({
  hazards: many(hazards),
  workPermits: many(workPermits),
}));

export const hazardsRelations = relations(hazards, ({ one }) => ({
  submitter: one(users, {
    fields: [hazards.submitterUserId],
    references: [users.id],
  }),
}));

export const safetyBriefingsRelations = relations(safetyBriefings, ({ one }) => ({
  workPermit: one(workPermits, { fields: [safetyBriefings.workPermitId], references: [workPermits.id] }),
}));

export const inspectionRecordsRelations = relations(inspectionRecords, ({ one }) => ({
  workPermit: one(workPermits, { fields: [inspectionRecords.workPermitId], references: [workPermits.id] }),
}));

export const workPermitTrainingsRelations = relations(workPermitTrainings, ({ one }) => ({
  workPermit: one(workPermits, { fields: [workPermitTrainings.workPermitId], references: [workPermits.id] }),
}));

export const workPermitsRelations = relations(workPermits, ({ many, one }) => ({
  certificates: many(certificateOcr),
  checks: many(workPermitChecks),
  inspections: many(inspectionRecords),
}));

// 承包商库：自动从申请单录入，支持停用
export { contractors } from './contractors.schema';
// 一级安全培训
export { trainingConfig, trainingQuestions, trainingRecords } from './training.schema';

export { entryRegistrations, trainingAttempts } from './entry.schema';
