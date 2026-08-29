# 作业票模型合并设计文档（方案 B · 全合并）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0（详细设计） |
| 编制 | 高级项目经理 |
| 日期 | 2026-08-29 |
| 决策来源 | 用户确认：方案 B（常规+危险全落 `workPermits`，停用 `workPermitApplications` 表）+ 先出详细设计 |
| 关联文档 | `作业票申请流程规范.md`、`作业票流程整体规划.html`、`作业票承包商协同改造-tasklist.md` |
| 当前状态 | **设计阶段，未改代码** |

---

## 1. 决策背景与目标

### 1.1 背景
现行系统存在"作业申请单（`workPermitApplications`，`SQ-` 编号）"与"作业票（`workPermits`，`GWP-`/`HWP-` 编号）"**双表双编号**模型。代码核实确认：申请单在 `submit` 时即"换正式号 + 建 `workPermits` 行 + 自身标记 `converted` 隐藏"（`work-permit-applications.service.ts` 的 `submit` → `ensureWorkPermitFromApplication`）。即**常规票本质就是申请单换号后的 `workPermits` 行**，申请单行退化为一条被隐藏的冗余记录。

用户判定：该步骤使系统复杂、单据不连贯，倾向"常规票一申请即占作业票编号"。经分析，决定将**常规与危险作业票统一合并到 `workPermits` 单表**，停用 `workPermitApplications` 表。

### 1.2 目标
- **单一事实源**：所有作业票（常规/危险）仅存于 `workPermits`，单一编号、单一状态机、单一数据源。
- **单据连贯**：申请即占作业票编号（`GWP-`/`HWP-`…），无 `SQ-` 中间号、无 `converted` 隐藏态。
- **审批统一**：以 `approval-routing.ts` 为唯一审批链真相源，删除申请单的并行会签遗留字段。
- **衔接既有口径**：常规票同样执行 JSA 分析（步骤级定级，不评整体风险等级）；承包商安全培训记录作为"入厂核验"用途，不再作为独立培训流程或强制归档门禁。

### 1.3 非目标（本次不做）
- 不改动危险作业票的业务规则（GB 30871 八大危险作业、挂靠常规票、监护人双签、三级审批）。
- 不引入整体风险等级（沿用"仅 JSA 步骤级定级"口径）。
- 不重写打印模板（模板已变量驱动，合并后字段映射保持一致即可）。

---

## 2. 现状模型（双表，代码核实）

### 2.1 实体与字段对照

| 维度 | `workPermitApplications`（申请单） | `workPermits`（作业票） |
|---|---|---|
| 编号 | `SQ-YYYYMM-NNNN` | `GWP-`/`HWP-`/`CSE-`/`LIF-`/`EXC-`/`TMP-`/`BLD-`/`OTH-` + `YYYYMM-NNNN` |
| JSA | `jsas`（371 行） | `jsas`（267 行）✅ 已支持常规票 |
| 作业内容 | `content` + `jobName` | `content`（无 `jobName`） |
| 时间 | `planStart`/`planEnd` | `startTime`/`endTime` |
| 作业人数 | `operatorCount` | `expectedOperatorCount` |
| 承包商/项目扩展 | `projectName`/`contractorUnit`/`contractorHead`/`contractorPhone`/`materialsList`/`equipmentList`/`managementDept`/`managementPerson`（352–361） | 无 |
| 危险类型标签 | `hazardTypeList`（362） | 无 |
| 培训记录 | `trainingId`（FK→trainings，已随申请单删除） | `workPermitTrainings` 经 `workPermitId` 关联（NOT NULL，FK→workPermits） |
| 挂靠常规票 | `linkedRoutineId`/`linkedRoutineNo`（377–378） | `linkedRoutineId`/`linkedRoutineNo`（242–243）✅ 双表都有 |
| 监护人双签 | `guardianSignatures`（381） | 无 |
| 入厂核验 | `entryQrToken`/`entryQrUrl`（393–394） | 无（有 `trainingQrToken` 294） |
| 审批字段 | `areaApprover*`/`deptApprover*` 并行会签（384–391）+ `reviewer*`/`approver*` | `reviewer*`/`ehsApprover*`/`approver*` 链式（272–283）+ `approvalChain`（291） |
| 票种标记 | `permitType`（367） | `isHazardous` + `type` |
| 状态机 | `draft→pending_review→reviewing→approved→…→converted` | `draft→pending_review→ehs_reviewing→reviewing→approved→printed→…` |

### 2.2 审批模型分歧（关键）
- **`workPermits` 权威链**（`approval-routing.ts` `chainTemplate`）：
  - 常规（routine）：① 区域负责人 → ② 承包商管理部门（2 级）
  - 危险（special）：① 申请部门主管 → ② EHS 工程师 → ③ 工程部经理（3 级）
- **`workPermitApplications` 的 `areaApprover`/`deptApprover` 并行会签**为纸质流程遗留，提交后申请单即 `converted`、作业票经 `autoApproveFromApplication`/`autoSubmitFromApplication` 走 `approval-routing` 链。**合并后以 `approval-routing.ts` 为唯一真相源，申请单并行会签字段作废。**

### 2.3 公开页引用（需重定向）
`public-actions.service.ts` 同时引用两表：
- `loadSummary`（100–117）：按 `targetType` 读 `work_permit` 或申请单。
- `getEntryInfo`（119–133）：按 `entryQrToken` 读申请单 → 合并后改读 `workPermits.entryQrToken`。
- `getActiveApplications`（136+）：按 `status='printed' & channel='electronic'` 读申请单，经 `workPermits.trainingQrToken→applicationId` 反查 → 合并后直接查 `workPermits`。

### 2.4 启动期数据同步
`database.module.ts` 的 `syncWorkPermitsFromApplications`（665 行）仅在启动时把 `involves_hazardous=true` 的申请单同步为 `workPermits`。**合并后停用该函数。**

---

## 3. 目标模型（单 `workPermits` 表）

### 3.1 表职责
- **`workPermits`**：唯一作业票表。常规票 `isHazardous=false`（前缀 `GWP-`）；危险票 `isHazardous=true`（前缀按类型）。承载全部字段（见 §4 迁移表）。
- **`workPermitApplications`**：**已彻底删除**（2026-08-29 执行）。系统未上线、无存量数据与真实用户，按用户最终决策「干干净净一次性修改彻底」直接删表 + 删 `applicationId` 列 + 删模块 + 删全部引用，不做灰度开关、不做迁移脚本、不做只读兼容、不做回滚。
- **`workPermitTrainings`**：保留，关联键由 `applicationId` 改为 `workPermitId`（NOT NULL，FK→`workPermits`）。
- **`certificateOcr`**：已关联 `workPermitId`（455 行），无需改。

### 3.2 状态机（单链）
统一采用 `workPermits` 现有状态机：`draft → pending_review → (ehs_reviewing) → reviewing → approved → printed → paused/finished → completed/voided`。删除 `converted` 态。

### 3.3 编号规则
- 创建即占号：`createDraft` 时按票种前缀生成正式号（常规 `GWP-`、危险按类型前缀），**不再生成 `SQ-` 中间号**。
- `genPermitNo(type)`（`work-permits.service.ts` 135 行）复用，prefix 取自 `permitNoPrefix(type)`（`domain.ts` 44 行）。
- 危险票提交时不再换号（原 `submit` 的 `SQ- → 正式号` 逻辑移除）。

---

## 4. 字段映射与迁移表（逐字段）

> 符号：➡ 重命名映射；➕ 新增列；🗑 删除（冗余）；✅ 已存在。

| 申请单字段 | 目标 | 处理方式 |
|---|---|---|
| `permitNo` (`SQ-`) | `workPermits.permitNo` (`GWP-`/…) | 🗑 弃用 `SQ-`；新建即占正式号 |
| `jobName` | `workPermits.jobName` | ➕ 新增列 |
| `content` | `workPermits.content` | ✅ 已存在 |
| `planStart`/`planEnd` | `workPermits.startTime`/`endTime` | ➡ 重命名映射 |
| `operatorCount` | `workPermits.expectedOperatorCount` | ➡ 语义一致，重命名 |
| `projectName`/`contractorUnit`/`contractorHead`/`contractorPhone` | `workPermits.*` | ➕ 新增（承包商协同改造 P0 所需） |
| `materialsList`/`equipmentList` | `workPermits.*` | ➕ 新增 |
| `managementDept`/`managementPerson` | `workPermits.*` | ➕ 新增 |
| `hazardTypeList` | `workPermits.hazardTypeList` | ➕ 新增（危险票中文标签） |
| `permitType` | — | 🗑 冗余（`isHazardous`+`type` 已区分） |
| `jsas` | `workPermits.jsas` | ✅ 已存在（常规票强制填充） |
| `safetyMeasures` | `workPermits.measureSelections` | ➡ 结构转换（申请单 `{id,content,checked,note}` 与票 `{id,content,checked,note}` 一致） |
| `trainingId` | `workPermitTrainings.workPermitId` | ➡ trainings 改关联票 |
| `linkedRoutineId`/`linkedRoutineNo` | `workPermits.*` | ✅ 已存在 |
| `guardianSignatures` | `workPermits.guardianSignatures` | ➕ 新增（危险票） |
| `entryQrToken`/`entryQrUrl` | `workPermits.*` | ➕ 新增（入厂核验） |
| `areaApprover*`/`deptApprover*` | — | 🗑 作废（以 `approvalChain` 为准） |
| `reviewer*`/`approver*`/`approvalChain` | `workPermits.*` | ✅ 已存在（权威链） |
| `applicationId`（票侧外键） | — | 🗑 合并后票不再反向关联申请单 |

**`workPermits` 需新增列汇总（13 项）**：`jobName`、`projectName`、`contractorUnit`、`contractorHead`、`contractorPhone`、`materialsList`、`equipmentList`、`managementDept`、`managementPerson`、`hazardTypeList`、`guardianSignatures`、`entryQrToken`、`entryQrUrl`。

**`workPermitTrainings` 改造**：新增 `workPermitId`（NOT NULL，FK→`workPermits`）。`applicationId` 列已随合并一并删除，无保留期、无迁移脚本、无回滚（系统未上线）。

---

## 5. 审批模型统一（关键决策）

- **唯一真相源**：`approval-routing.ts` 的 `chainTemplate`。常规 2 级（区域负责人→承包商管理部门）、危险 3 级（部门主管→EHS→工程部经理）。
- **删除**：申请单 `areaApprover`/`deptApprover` 并行会签及对应 UI；`workPermits` 提交即按 `chainTemplate` 生成 `approvalChain` 快照。
- **常规票 JSA 口径**：常规票同样在 `draft→pending_review` 前完成 AI JSA 分析（`analyzeJsa`，步骤级定级 高/中/低，不评整体风险等级），`jsas` 必填且可编辑，与危险票一致。提交校验放开"常规票不强制作业人"的限制，仅保留危险票对 `operatorNames` 的强制。
- **培训记录口径**：`workPermitTrainings` 作为"入厂核验"用途（`testResult` 合格/`signCompletedAt` 完成即视为培训已核验）。**移除旧"常规票必须完成培训才能归档"的强制门禁**；入厂核验页仅提示未完成，不阻断归档。

---

## 6. 服务层改造

### 6.1 `work-permits.service.ts`（主入口，承接申请单逻辑）
- 新增 `createDraft(dto, user, channel)`：创建即占正式号（`GWP-`/类型前缀），写 `jobName`/`planStart`→`startTime` 等全部字段；`status='draft`。
- `submit(id, user)`：移除 `SQ-→正式号` 换号；按 `isHazardous` 经 `chainTemplate` 生成 `approvalChain`；常规票同步 `jsas`（必填校验）；危险票保留证书/挂靠/监护人校验。
- `approve` 系列（review/ehs/final）：沿用 `advanceChain`；常规票经 2 级即 `approved` 并生成 `entryQrToken`（原 `onApproved` 非危险分支逻辑迁入）。
- 新增 `completeTrainingSign`、`getEntryInfo`、`getActiveApplications` 等原申请单服务方法（迁入或直接调用 trainings/public-actions）。

### 6.2 `work-permit-applications` 模块（已删除）
- **已彻底删除**（2026-08-29 执行）：`briefing-template.ts` / `e-applications.controller.ts` / `work-permit-applications.module.ts` / `work-permit-applications.service.ts` 全部删除；方法合并入 `work-permits.service.ts`（建单/提交/审批主路径）与 `public-actions`（入厂/培训/签名）。全局引用已清零，无残留编译引用。
- `syncWorkPermitsFromApplications` 已从 `database.module.ts` 删除（无双表同步逻辑）。

### 6.3 `public-actions.service.ts`
- `loadSummary`：移除 `targetType='application'` 分支，仅 `work_permit`。
- `getEntryInfo`：由 `workPermits.entryQrToken` 读取。
- `getActiveApplications`：直接查 `workPermits`（`status='printed' & channel='electronic'`），`trainingQrToken` 已在票上。

### 6.4 `dashboard.service.ts` / 看板
- `board/today` 等查询（原读取 `workPermitApplications` 处，如 247/271/368/378 行）统一改为 `workPermits`；危险票挂靠常规票的展示逻辑保留（`linkedRoutineNo`）。

---

## 7. 前端改造

- **入口收敛**：删除"作业申请单"独立列表/详情/向导页，合并到"作业票"模块；新建/edit 页按 `isHazardous` 切换常规/危险字段集。
- **常量**（`constants.ts`）：删除 `WORK_PERMIT_APPLICATION_STATUS`；`WORK_PERMIT_STATUS` 删除 `converted`；`HAZARD_PERMIT_TYPES` 保留。
- **状态机/卡片**（`EPERMIT_CATEGORIES`）：移除"申请中"隐含态（草稿即 `workPermits.draft`）。
- **打印**：`printTemplate.ts`/`printTemplatePresets.ts` 字段解析已由 `fieldKey` 驱动，仅需将 `jobName`/`entryQrToken` 等新字段补入字段库与 `resolveField`；无需重写版面。
- **承包商协同改造 P0**：原 tasklist 中的"承包商邮箱/邀请令牌/二维码"逻辑改挂 `workPermits`（不再经申请单）。

---

## 8. 种子与公开页改造

- `seed.service.ts`：停止写 `workPermitApplications`；直接写 `workPermits`（含 `jobName`/`startTime`/`contractor*`/`entryQrToken` 等全部字段）；`workPermitTrainings` 回填 `workPermitId`；`simulateRoutineWorkflow`（30 张常规票）直接建 `workPermits`（GWP-），含 JSA/交底/入厂记录。
- 公开页（`/public/entry`、`/public/sign`、`/public/training`）：token 绑定改为 `workPermits.entryQrToken` / `trainingQrToken`；签名经 `workPermits.addSignature`。

---

## 9. 存量数据与回滚（已随 P0 一次性处理）

- **系统未上线**：无真实用户、无存量 `SQ-` 申请单、无生产数据。因此**不做存量迁移脚本、不做灰度开关、不做只读兼容、不做回滚方案**。
- **执行动作（2026-08-29）**：直接删除 `workPermitApplications` 表 + 删除 `workPermits`/子表上的 `applicationId` 列 + 删除 `work-permit-applications` 模块 + 全局清零引用；`drizzle/0000` 从干净 `schema.ts` 重新生成，新库从 0000 一次性重建（含 13 个新列、`workPermitTrainings.workPermitId`）。
- **重建/回滚手段**：因无外置迁移框架，任何结构问题 = Git 回退对应提交 + 删除 PGlite 数据目录后重新 seed（v6 目录已验证可重建）。
- **`converted` 隐藏态**：状态机已删除 `converted`，统一 `draft→…→completed/voided`，无中间号、无换号。

---

## 10. 分阶段实施计划与验收标准

| 阶段 | 范围 | 关键交付 | 验收标准 |
|---|---|---|---|
| **P0 数据结构** | schema | `workPermits` 加 13 列；`trainings` 改 `workPermitId`；**彻底删除 `workPermitApplications` 表与 `applicationId` 列** | `tsc --noEmit` 通过；干净 0000 可重建；全局无 `workPermitApplications`/`applicationId` 可执行引用 |
| **P1 服务合并** | `work-permits.service` | `createDraft`/`submit`/`approve` 单路径；迁入 `entry`/`training` 方法；停 `syncWorkPermitsFromApplications`；`public-actions` 改读 `workPermits` | 新建常规票即占 `GWP-` 号；审批链按 `chainTemplate`；入厂/培训 QR 正常；公开页仅 `work_permit` |
| **P2 前端收敛** | `frontend` | 合并申请单页到作业票；常量/状态机清理；打印字段库补 `jobName`/`entryQrToken` | 无"申请单"独立入口；草稿即 `workPermits.draft`；打印含新字段；无 `FOR00X`/`SQ-` 残留 |
| **P3 种子/看板/公开页** | `seed`/`dashboard`/public | 种子直写 `workPermits`；看板统一源；公开页 token 改票 | 重新 seed 后 30 张常规票均为 `GWP-`；看板/公开页正常 |
| **P4 收尾清理** | 数据/清理 | 去 `converted` 残留文案；前端 `EApplications` 页合并（见 P2）；全局 grep `workPermitApplications`/`applicationId`/`SQ-` 清零 | 全局无 `workPermitApplications`/`applicationId`/`SQ-`/`converted` 残留；前端无"申请单"独立入口 |

### 10.1 贯穿性验收（与既定口径一致）
- 常规票 `jsas` 必填、步骤级定级（高/中/低）、不评整体风险等级。
- AI 分析总次数 ≤3（首次 + 至多 2 次再分析），人工修订不限次，单票累计、退回不重置，后端强拦截第 4 次。
- 打印模板变量驱动：作业内容、风险分析（JSA）、交底随输入变化；无写死风险文本。
- 培训记录为入厂核验用途，不阻断归档。

---

## 11. 风险与开放问题

| 项 | 风险/问题 | 处置 |
|---|---|---|
| 审批模型分歧 | 申请单并行会签 vs `approval-routing` 链，历史数据可能不一致 | 以 `approval-routing` 为真相源；存量 `converted` 票的 `approvalChain` 已权威，无需回灌并行字段 |
| 编号断档 | 旧 `SQ-` 中间号（系统未上线无存量） | N/A：直接删除，新建即占 `GWP-`/`HWP-` 正式号，无中间号、无断档 |
| 双表过渡期 | 已消除 | 直接单表删除，无灰度、无双写、无过渡期 |
| 前端耦合 | 公开页/看板曾依赖申请单 ID | 已改读 `workPermits`/`workPermitId`；前端 `EApplications` 页合并见 P2 |
| PGlite 重建 | 迁移需重建库 | 沿用 v6 目录 + 重新 seed 验证 |

---

## 12. 后续动作

本设计为方案 B 的详细蓝图。确认后由高级项目经理拆解为开发任务清单（tasklist，含 P0–P4 验收标准），再进入实施。实施前应就以下开放问题与用户最终确认：
1. ~~存量 `SQ-` 编号的台账可追溯方式~~ — 已决议：系统未上线、直接删除，无存量可追溯诉求。
2. ~~特性开关灰度策略~~ — 已决议：直接一次性删除，不做灰度开关。
3. 危险票"监护人双签"字段是否随合并一并落到 `workPermits`（建议是）。
