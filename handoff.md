# HANDOFF —— 项目交接与进度追踪

> **⚠️ 每次会话开始前，必须先读本文件。** 每次完成任务后，更新本文件。
> 本项目最后更新：2026-08-29 22:40

---

## 0. 项目一句话

EHS 电子化管理系统（作业票 + 隐患 + 培训 + 入厂 + 承包商协同）。技术栈：NestJS + drizzle-orm + PGlite（本地 WASM 库）/ PostgreSQL（生产）、React + TS + Vite。后端 3100、前端 5190。

**当前状态：承包商协同功能已实现一版，但用户确认了 7 点新决策，尚未按新决策修正代码（处于"方案定稿、待实施"状态）。**

---

## 1. 已完成的任务（commit 记录）

| Commit | 内容 |
|---|---|
| `5819ab2` | docs(承包商协同): 需求澄清确认版（md + 大白话 HTML），钉死流程 |
| `06eb274` | fix(承包商协同): 向导内嵌邀请卡片 + 详情页卡片放宽（后被新决策推翻部分） |
| `065e445` | feat(承包商协同): P0+P1+P2 服务端+前端（邀请/免登录填写/JSA/风险） |
| `2684dcb` | fix(安全): update 越权防护 + steps 落库 + 废弃草稿清理 |
| `d045655` | P0: 补回 12 个作业票级端点（briefing/training/ocr/board/annual） |
| `eaacac7` | P0: 作业票单表合并收口（删申请单，全部落 workPermits） |
| 更早 | 入厂签到、打印模板、FORM 清理等（见 git log） |

**已完成的核心能力**（单表合并后）：
- 作业票单表全生命周期（draft → approved → printed ⇄ paused → finished → completed）
- 安全交底/培训/巡检/OCR/看板/年度统计（12 个端点已补回）
- 安全修复：update 越权防护、巡检删除作用域、steps 落库、废弃草稿清理
- 承包商协同 v1（被新决策部分推翻）：免登录填写页、AI JSA（3 次）、风险派生勾选、邀请生成

---

## 2. 当前卡在哪里（最重要）

**用户 2026-08-29 晚确认了 7 点新决策，代码尚未按新决策修正。**

卡点清单（即"偏离 vs 应改为"）：
1. **员工表单还留着作业内容/JSA**（Apply.tsx）→ 应删，员工只填基础信息
2. **缺 `awaiting_contractor` / `contractor_submitted` 状态** → 提交即发邀请，不再直接送审
3. **发邀请是手动按钮** → 应改为"提交即自动生成二维码(可下载)+链接"
4. **危险票还有独立 worker-fill 第二张邀请** → 应合并进 contractor_fill 一张
5. **员工复核步骤不可配置** → 需新增流程开关（systemConfig，默认 ON，可关）
6. **旧数据/旧票未清理** → 用户确认系统未投用，可清库重建
7. **代码改动尚未开始**（方案已定稿，等实施）

**权威方案**：`docs/承包商协同-需求与方案（澄清确认版）.md`（唯一权威，v3 已含全部 7 点决策）

---

## 3. 下一步计划（实施顺序，见方案 §四 修正执行清单）

1. **清理**：重置 PGlite 数据（`D:/Users/45518/AppData/Local/Temp/ehs-pglite-v6`）；删除 worker_fill（后端端点/令牌 purpose、前端 WorkerFill.tsx/路由、saveWorkerFill/getWorkerFill/createWorkerInvite、worker-invite 端点）
2. **员工表单**：Apply.tsx 删 content/steps/jsas/runJsa/measures UI；确保邮箱字段所有票型可见；「提交」= 提交并自动生成邀请
3. **后端状态机**：提交→awaiting_contractor；施工方提交→contractor_submitted；复核开关 OFF→直接 pending_review
4. **复核开关**：systemConfig 加 `workflow.requireContractorReview`（默认 true）+ 设置页开关
5. **邀请展示**：提交成功页展示二维码（可下载/打印）+ 链接复制
6. **施工方页**：contractor-fill 并入危险票字段（时间/人员/监护/证书）
7. **回归**：前端 tsc / 后端 nest build / 实机全流程验证

---

## 4. 踩过的坑（别再重复踩！）

1. **误删 55 个前端文件事故**（2026-08-29）：
   - `git rm` 与其他命令串联 + `rm -rf dist` 时，frontend/src 下 components/theme/utils 及多个 pages 目录被误删。
   - **规则**：删除操作（git rm / rm -rf）必须**绝对路径单独一条命令**执行，随后立即 `git status | grep "^ D"` 检查附带损伤；绝不把删除和 build/其他命令串一条。
   - 恢复：`git checkout -- <具体目录>`（绝不 checkout 整个 src，会覆盖未提交改动）；遇 `.git/index.lock` 先确认无 git 进程再删锁。
2. **删 dist 被 safe-delete 守卫拦**：`nest build` 自身清 dist 报 trash 错误。必须先手动 `rm -rf "<abs>/backend/dist"`（单独命令）再 build。
3. **git 输出被吞**：commit/push 偶发显示 "nothing to commit / Everything up-to-date" 但实际成功。**判断依据是 `git log` 和 `git rev-parse origin/main`**，不要信 stdout。
4. **Git Bash 的 /tmp 映射问题**：node 是 Windows 程序，`/tmp/x.cjs` 会找 `C:\tmp\x.cjs`。临时脚本要放项目目录内（用完删）或绝对 Windows 路径。
5. **漏读方案文档导致跑偏**：之前只读了 tasklist，漏读 `作业票承包商协同-系统设计方案.md`（权威），导致实现偏离（员工表单多了作业内容/JSA）。**规则：改代码前必须读全方案 md（v3 权威）+ 流程规范阶段 1-6。**
6. **PGlite 查询**：无 psql。用临时 node 脚本 `new PGlite({dataDir:'D:/Users/45518/AppData/Local/Temp/ehs-pglite-v6'})` + `db.query`（放 backend 目录跑，需能 require @electric-sql/pglite）。
7. **token 校验 purpose 区分**：`getValid(token, purpose)` 强校验 purpose 精确匹配，新令牌类型（contractor_fill/worker_fill）必须同步 EXPIRED_MSG。
8. **安全修复口径**：update/暂停/恢复/详情权限口径统一为「管理员 / epermit:view_all / 申请人本人」；交底/培训端点保持按权限（epermit:onsite_check）不按归属（安全员要对他人票交底）。

---

## 5. 关键文件路径

### 后端（backend/src/）
| 文件 | 说明 |
|---|---|
| `database/schema.ts` | workPermits 单表 + 承包商协同字段（jsa_analysis_count/risk_hazards/plan_file 等） |
| `database/database.module.ts` | PGlite 连接 + 幂等补列（新增列在这里加） |
| `modules/work-permits/work-permits.service.ts` | 核心业务：生命周期 + 承包商协同方法（createContractorInvite/contractorAiJsa/deriveRiskHazards/submitContractorFill/saveWorkerFill 等） |
| `modules/work-permits/e-permits.controller.ts` | /e-permits 端点（含 contractor-invite / worker-invite） |
| `modules/public-actions/public-actions.controller.ts` | /public 免登录端点（contractor-fill / worker-fill / sign / approval / training） |
| `modules/tokens/tokens.service.ts` | 令牌 purpose（email_approval/mobile_sign/contractor_fill/worker_fill）+ EXPIRED_MSG |
| `modules/ai/ai.service.ts` | analyzeJsa / analyzeBriefingHazards |
| `modules/email/email.service.ts` | SMTP（未配，emailSkipped 兜底） |
| `modules/work-permits/briefing-template.ts` | 交底模板（从被删模块还原） |

### 前端（frontend/src/）
| 文件 | 说明 |
|---|---|
| `App.tsx` | 路由（含 /public/contractor-fill/:token、/public/worker-fill/:token） |
| `pages/EPermits/Apply.tsx` | 申请向导（**待删 content/steps/JSA**，改"提交即发邀请"） |
| `pages/EPermits/Detail.tsx` | 详情页（承包商协同卡片，待按新状态机调整） |
| `pages/Public/ContractorFill.tsx` | 施工方免登录页（待并入危险票字段） |
| `pages/Public/WorkerFill.tsx` | 作业人员页（**待删除**，合并进 ContractorFill） |
| `api/client.ts` | axios 实例 + 鉴权 |

### 文档（docs/）
| 文件 | 说明 |
|---|---|
| `承包商协同-需求与方案（澄清确认版）.md` | **唯一权威方案（v3）** |
| `承包商协同-需求说明（大白话确认版）.html` | 小白版可视化（以 md 为准） |
| `作业票承包商协同-系统设计方案.md` | 历史权威（v1.0 已闭环） |
| `作业票申请流程规范.md` | 阶段 1-6 字段归属权威 |
| `作业票承包商协同-开发任务清单.md` | T1-T22 任务清单 |
| `作业票系统-大白话版.html` | 全系统老板汇报版 |

### 其他
| 路径 | 说明 |
|---|---|
| `D:/Users/45518/AppData/Local/Temp/ehs-pglite-v6` | PGlite 数据目录（清库=删它，重启后重建） |
| 后端启动 | `cd backend && node start-local.cjs`（3100，用 dist 产物） |
| 前端启动 | `npm run dev`（5190，Vite 热更新） |

---

## 6. 环境约定

- 后端构建：先单独 `rm -rf "<abs>/backend/dist"` 再 `npx nest build`（见坑 2）
- 删除任何文件：绝对路径单独命令 + 立即 collateral 检查（见坑 1）
- 禁止后台进程追加 `&`；不写服务启动脚本
- 改代码前读：本 handoff.md + 权威方案 md + 流程规范阶段 1-6
