# 电子申请单（EApplications）与作业票管理（EPermits）页面流转梳理与修改建议

> 说明：本文基于当前代码实现整理，并已根据实际业务规则校正：**电子申请单先独立审批下达，危险作业票在申请单批准后再行申请和审批**。申请单能否下达不与危险作业票状态挂钩。

---

## 一、正确业务理解

| 概念 | 定位 |
|---|---|
| **电子申请单** | 作业总体申请：干什么、在哪干、谁干、什么时间、是否含危险作业。它是一套作业的「总开关」。 |
| **作业票（EPermits）** | 具体执行许可：常规作业一张票；若涉及危险作业，需在申请单批准后再开对应的危险作业票。 |

**关键顺序**：

```text
发起电子申请单
  → 申请单独立审批（部门审核 / 管理部门审批）
  → 申请单批准 approved
  → 下达 / 打印（作业进入执行态）
  → 若含危险作业，再开具对应的危险作业票
       → 危险作业票独立审批链
       → 危险作业票 approved 后打印执行
  → 作业完工 → 申请单完工 → 归档
```

> 注意：申请单下达时，危险作业票**可以尚未创建、尚未提交、尚未审批**。不能因为「含危险作业」就卡住申请单审批或下达。

---

## 二、当前页面职责

| 页面 | 核心职责 | 对应实体 |
|---|---|---|
| **电子申请单 EApplications** | 发起作业总体申请；填写作业申请单基础信息、勾选是否含危险作业、办理承包商安全培训；审批通过并下达；查看关联作业票状态。 | `workPermitApplications`（channel='electronic'） |
| **作业票管理 EPermits** | 管理常规作业票和危险作业票；填写安全措施/JSA/特种作业证；走分级审批链；打印/现场签字/完工/归档。 | `workPermits`（channel='electronic'） |

---

## 三、正确信息流转

```text
┌─────────────────────────────────────────────────────────────────┐
│  电子申请单（EApplications）                                     │
│  1. 填写作业申请单：作业名称/区域/时间/承包商/管理部门/监护人/内容  │
│  2. 勾选「是否含危险作业」（involvesHazardous）                  │
│  3. 提交 → 部门审核 → 管理部门审批 → approved                    │
│  4. 下达 / 打印（printed）                                       │
│  5. 含危险作业时，再添加关联危险作业票                           │
└──────────────────────┬──────────────────────────────────────────┘
                       │ applicationId（父单 → 子票）
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  作业票（EPermits）                                              │
│  A. 常规票：可从申请单发起，也可独立创建                         │
│     提交后走 2 级审批链（主管 → 安全员）                         │
│  B. 危险票：申请单 approved 后，从申请单详情发起                 │
│     提交后按风险等级走 2/3/4 级审批链                            │
│  C. 填写安全措施、JSA、特种作业证（仅危险票）                     │
│  D. 审批通过 → 打印 → 现场签字 → 完工 → 归档                    │
└─────────────────────────────────────────────────────────────────┘
```

### 关键字段关系

| 字段 | 含义 | 流向 |
|---|---|---|
| `workPermits.applicationId` | 作业票指向父申请单 | 申请单 → 作业票 |
| `workPermits.isHazardous` | 是否危险作业 | 由 `type` 决定；危险票 true，常规票 false |
| `workPermits.training` | 常规票关联的承包商安全培训 | 通过父单 `trainingId` 反查 |
| `workPermits.workCode` | 6 位作业代码，用于门卫扫码 | 首次打印时生成 |
| `workPermitApplications.involvesHazardous` | 父单是否含危险作业 | 仅作标记，不阻塞父单审批/下达 |

---

## 四、正确审批流转

### 4.1 电子申请单审批

```text
draft
  ↓ 提交
pending_review
  ↓ 部门审核 + 管理部门审批（并行会签）
approved
  ↓ 下达 / 打印（此时不要求危险票已审批）
printed
  ↓ 完工
finished
  ↓ 归档
completed
```

### 4.2 常规作业票审批

```text
draft
  ↓ 提交
pending_review（安全员审核）
  ↓ 通过
approved
  ↓ 打印
printed
  ↓ 完工
finished
  ↓ 归档
completed
```

### 4.3 危险作业票审批

```text
draft
  ↓ 提交（父单需 approved，但父单不需要 printed）
pending_review（主管审核）
  ↓ 通过
ehs_reviewing（EHS 工程师批准）
  ↓ 通过
reviewing（工程部经理批准）
  ↓ 通过
approved
  ↓ 打印
printed
  ↓ 完工
finished
  ↓ 归档
completed
```

---

## 五、当前页面跳转路径

| 起点 | 操作 | 终点 |
|---|---|---|
| EApplications List | 开始填写电子申请单 | `/e-applications/apply` |
| EApplications Apply | 提交申请单 | **已改为**停留在 `/e-applications/:id` 详情页 |
| EApplications Detail | 下达 / 打印 | 本页刷新 |
| EApplications Detail | 添加危险作业票 | `/e-permits/apply/:wpId?from=:appId` |
| EApplications Detail | 添加常规作业票 | `/e-permits/apply/:wpId?from=:appId` |
| EPermits List | 申请电子票（含危险作业） | `/e-applications` |
| EPermits List | **新建常规作业票（已支持）** | `POST /e-permits {type:'routine'}` → `/e-permits/apply/:wpId` |
| EPermits Apply | 提交后（来自申请单） | `/e-applications/apply/:fromAppId` |
| EPermits Apply | 提交后（独立创建） | `/e-permits/view/:wpId` |

---

## 六、已发现的问题与修复状态

| 问题 | 位置 | 状态 |
|---|---|---|
| 申请单下达被危险票审批状态阻塞 | `frontend/src/pages/EApplications/Detail.tsx` | **已修复**：移除 `allHazardReady` 对危险票状态的判断，改为仅提示。 |
| 左侧审批意见/审批链与右侧重复 | `frontend/src/pages/EPermits/Detail.tsx` | **已修复**：删除左侧两个 Section。 |
| 常规票显示特种作业证 OCR | `frontend/src/pages/EPermits/Detail.tsx` | **已修复**：仅 `isHazardous=true` 时显示。 |
| 申请单提交后跳电子看板而非详情 | `frontend/src/pages/EApplications/Apply.tsx` | **已修复**：提交后停留 `/e-applications/:id`。 |
| 父单信息未预填到作业票 | `backend/.../work-permits.service.ts` createDraft | **已修复**：自动复制 area/location/content/监护人/作业人/计划时间（空值不覆盖）。 |
| EPermits 列表不能独立新建常规票 | `frontend/src/pages/EPermits/List.tsx` | **已修复**：新增「新建常规作业票」按钮。 |
| 危险票提交父单条件过严（卡 printed） | `backend/.../work-permits.service.ts` submit + 前端 Apply | **已修复**：父单 approved/printed/paused/finished/completed 均允许，仅 draft/reviewing 拒绝。 |
| 申请单详情缺危险票待办提示 | `frontend/src/pages/EApplications/Detail.tsx` | **已修复**：涉及危险作业未开/待审批时给蓝色提示（不阻断下达）。 |

---

## 七、改造项设计与落地情况

> 以下 7.2–7.6 已于 **2026-08-01 下午** 全部落地（代码位置与验证见第六节、第十节），7.1 为设计原则继续保留。

### 7.1 页面职责重新划分

| 页面 | 建议职责 |
|---|---|
| **电子申请单 EApplications** | 作业总入口：只负责作业申请单基础信息、是否含危险作业、承包商安全培训、申请单自身审批、下达。不等待作业票审批。 |
| **作业票管理 EPermits** | 作业票执行中心：支持独立创建常规票；危险票必须从申请单发起；负责安全措施/JSA/特种作业证/审批链/现场执行。 |

### 7.2 申请单提交后跳转优化

- **当前**：提交后跳到 `/e-board`（电子作业台）。
- **建议**：提交后留在 `/e-applications/:id` 详情页，方便用户继续添加危险作业票或下达。
- **涉及文件**：`frontend/src/pages/EApplications/Apply.tsx`

### 7.3 危险票提交前置条件放宽

- **当前**：危险票提交要求父单 `approved/completed`。
- **建议**：保持父单 `approved` 即可提交危险票；父单 `printed` 后仍可继续发起新的危险票（实际现场常需补开）。
- **涉及文件**：`backend/src/modules/work-permits/work-permits.service.ts` 中的 `submit` 闸门

### 7.4 申请单下达后联动提示

- 申请单下达后，若 `involvesHazardous=true` 且尚未关联危险票，在详情页顶部显示温馨提示：
  > 「本作业已下达，请尽快开具对应的危险作业票。」
- 已关联的危险票列表展示其审批状态，但不影响申请单状态。

### 7.5 常规票支持独立创建

- 在 `EPermits/List.tsx` 增加「新建常规作业票」按钮，直接创建 `type='routine'` 的票。
- 常规票归档时按现有逻辑校验承包商安全培训（若有父单）或直接放行（若无父单）。

### 7.6 父单信息预填到作业票

- 从申请单发起作业票时，自动把父单的 `jobName/area/location/planStart/planEnd/contractorUnit/managementDept/supervisorName/content` 带到作业票草稿，减少重复录入。
- **涉及文件**：`backend/src/modules/work-permits/work-permits.service.ts` 的 `createDraft`

---

## 八、建议改造清单

| 优先级 | 改造项 | 涉及文件 | 状态 |
|---|---|---|---|
| P0 | 父单创建子票时自动复制基础信息 | `backend/src/modules/work-permits/work-permits.service.ts` | ✅ 已完成 |
| P0 | 申请单提交后跳转详情而非电子看板 | `frontend/src/pages/EApplications/Apply.tsx` | ✅ 已完成 |
| P1 | EPermits 列表支持独立新建常规票 | `frontend/src/pages/EPermits/List.tsx` + `e-permits.controller.ts` | ✅ 已完成 |
| P1 | 危险票提交父单条件保持 `approved`（不提升为 printed） | `backend/src/modules/work-permits/work-permits.service.ts` | ✅ 已完成 |
| P2 | 申请单详情页增加危险票待办提示 | `frontend/src/pages/EApplications/Detail.tsx` | ✅ 已完成 |
| P2 | 申请单归档时不强制要求危险票已归档，仅校验现场签字 | `backend/src/modules/work-permit-applications/work-permit-applications.service.ts` | ⬜ 可选 |

---

## 九、总结

- **电子申请单**是作业总开关，应独立审批、独立下达，不受危险作业票状态影响。
- **危险作业票**在申请单批准后再申请、再审批，是申请单的下游执行凭证；父单下达（printed）后仍可补开。
- **常规作业票**可以独立创建，也可以挂在申请单下。
- 已落地的关键改造：申请单提交后停留详情；父单信息自动预填到作业票；EPermits 列表独立新建常规票；危险票提交父单条件放宽（approved 及之后均允许）；申请单详情危险票待办提示；常规票隐藏特种作业证 OCR；左侧重复审批信息删除。

---

## 十、本轮落地验证（2026-08-01 下午，端到端）

| 改造项 | 验证方式 | 结果 |
|---|---|---|
| 父单信息预填到作业票 | 用含 `area=外围 门卫室` / `content=一般作业…` 的申请单建常规票，比对字段 | **PREFILL area&content match: True** |
| 独立新建常规票 | 直接 `POST /e-permits {type:'routine'}` | 200，返回票 `applicationId=null` |
| 危险票提交父单条件放宽 | 以 `printed` 状态申请单建 `hot_work` 危险票并提交 | 报错为「特种作业需上传作业证」（而非「请先审批」），证明父单状态不再阻塞 |
| 提交后跳转详情 / 待办提示 / 列表按钮 | 前端构建通过，逻辑已落实 | 需浏览器手测（构建 0 错误） |

> 服务状态：后端 `http://localhost:3100/api`、前端预览 `http://localhost:5190/` 均已重启并加载新代码。
