# 作业票承包商协同改造 — 开发任务清单

> 编制：高级项目经理（关德豪）　|　依据：`docs/作业票申请流程规范.md`　|　日期：2026-08-28
> 技术栈：NestJS + drizzle-orm + PGlite（后端）；React + TS + Vite（前端）
> 范围：仅作业票**申请—审批—交底**协同流程改造，不含执行期移动端既有功能重写

## 规范摘要（Spec Summary）
**原始需求**（逐条已纳入流程规范）：
1. 内部人员填基本信息 → 邮件 + 二维码发承包商负责人（需新增承包商负责人邮箱）
2. 链接/扫码 → 限时免登陆页 → 看基本信息 → 填作业内容/传方案 → AI JSA
3. AI 结果可手工改（含增步骤）+ 可二次 AI 分析
4. 二次分析后仍可改，每次最多修改 3 次
5. 输出 JSA 同时下方生成风险提示（危害/后果/措施，源自交底模板）
6. 承包商可手工改危害与措施，确认后提交
7. 提交内容（排除未勾选）进审批矩阵 → 批准后进交底
8. 交底按最终确认版重新推荐并完成现场交底
9. 危险票挂靠常规票 → 发承包商作业人员填施工时间/人员/监护/证书/内容/JSA/危害措施
10. 危险票不挂靠：部门主管 → 区域负责人 → EHS 工程师 → 工程部经理（区域负责人插在部门主管与 EHS 之间，终点=工程部经理）

**关键设计决策**：危害识别与控制措施做成**单一数据流**（AI 生成 JSA → 自动派生 riskHazards → 承包商一次确认），消除 3 处重复录入。

**技术栈**：NestJS / drizzle-orm / PGlite；AI 已具备 `analyzeJsa`/`analyzeBriefingHazards`（deepseek/openai/offline）；免登陆已具备 `public-actions` + `action_tokens`（TTL/单次）；二维码已具备 `qr-codes`；邮件已封装 nodemailer（SMTP 未配）；上传已具备 `files`。

---

## 开发任务（Dev Tasks）

### [ ] P0-1 新增承包商邮箱字段
**描述**：`contractors` 表加 `email`；`work_permit_applications` 表加 `contractorEmail`；申请页增加邮箱输入与格式校验；列表/详情可显。
**验收标准**：
- 迁移后两表可存/读邮箱
- 申请页邮箱为空或格式错时拦截提交
- 阶段 1 退出准则所需的 `contractorEmail` 非空校验生效
**文件**：`src/database/schema.ts`、`src/database/contractors.schema.ts`、申请页组件、`work-permit-applications.service.ts`
**参考**：流程规范 第三节 阶段1

### [ ] P0-2 邀请令牌与二维码生成
**描述**：`action_tokens` 增加 `contractor_fill`/`worker_fill` purpose（字段已支持 `expiresAt/multi/targetId`）；新增接口生成限时链接(72h) + 二维码；二维码卡片下方渲染 `jobName` + `planStart` 日期；提供复制链接。
**验收标准**：
- 调接口得 72h 有效令牌与可下载/复制的二维码
- 过期令牌访问返回 410
- 二维码内容含 token，扫码进入公开页
**文件**：`src/modules/public-actions/*`、`src/modules/qr-codes/*`、申请页"发送邀请"按钮
**参考**：流程规范 第三节 阶段2、C6

### [ ] P0-3 邮件发送与降级
**描述**：`email.service` 新增"承包商填写邀请"模板（含链接）；读 `systemConfig(email_config).enabled`；未配置时返回 `emailSkipped=true`，前端提示"用链接/二维码"。
**验收标准**：
- 配 SMTP 实际发出邮件
- 未配 SMTP 时流程不阻塞，前端显示降级提示
**文件**：`src/modules/email/email.service.ts`、申请页
**参考**：流程规范 第三节 阶段2、C7

### [ ] P1-1 承包商免登陆填写公开页
**描述**：`GET /public/contractor-fill/:token`（@Public()）；页面含基本信息只读区 + 作业内容输入 + 施工方案上传(files) + 提交；校验令牌有效性与过期。
**验收标准**：
- 凭有效令牌可查看基本信息、填内容、传方案、提交
- 无效/过期令牌返回拒绝页
- 提交后 A 表状态 → `contractor_submitted`
**文件**：`src/modules/public-actions/*`、前端 `ContractorFillPage`
**参考**：流程规范 第三节 阶段3

### [ ] P1-2 AI JSA 生成与二次分析限 3 次
**描述**：填写页"AI JSA"按钮调 `ai.analyzeJsa`，结果写入 `jsas`；新增 `jsaAnalysisCount`（**AI 调用总次数上限 3**，按申请单累计、退回不重置），达 3 置灰按钮并提示"AI 分析次数已用完（3/3），可继续手工完善后提交"；再分析以当前手工修订版为上下文续写。提示词要求**专业术语 + 具体执行动作/量化参数**（禁口语化）。
**验收标准**：
- 点击生成 JSA（[{step,hazard,control,risk}]）
- 第 4 次调用被后端拦截（非仅前端置灰）并提示
- 每次分析后人工可**无限次**编辑，不消耗次数
- 抽检产出：术语规范且每条 control 含可执行动作/参数
**文件**：`src/modules/ai/ai.service.ts`、`ContractorFillPage`
**参考**：流程规范 第四节 4.3、C5

### [ ] P1-3 风险清单自动派生与一次确认
**描述**：JSA 生成后调 `analyzeBriefingHazards`：汇总 JSA 各步 `hazard/control` 去重 ∪ `measure_templates` 按 `type` 补漏 → 写入 **[新]** `riskHazards` `[{hazard,consequence,measures[],checked}]`；前端支持增删行 + 勾选确认。
**验收标准**：
- `riskHazards` 非空且含模板补漏的固有风险
- 承包商仅需增删/勾选，非从空白录入
- `checked=false` 项不进审批/交底
**文件**：`src/modules/ai/ai.service.ts`、`schema.ts`(新增字段)、`ContractorFillPage`
**参考**：流程规范 第四节、C2/C3

### [ ] P1-4 提交进审批 + 交底引用终版
**描述**：`contractor_submitted` → 员工复核 → `pending_review` → 按 `riskLevel` 生成 `approvalChain`；审批视图只取 `riskHazards[checked]`；交底 `safetyBriefings.points` 引用终版（jsas + riskHazards[checked]），现场逐条勾选。
**验收标准**：
- 审批人只见 `checked=true` 项
- 交底 `points` 与承包商确认版一致，不重识别危害
- 未全勾选不许 `done`
**文件**：`work-permit-applications.service.ts`、`safety-briefings.service.ts`、交底页
**参考**：流程规范 第三节 阶段5/6、C3/C4

### [ ] P2-1 危险票作业人员填写公开页
**描述**：`GET /public/worker-fill/:token`；填施工时间 `startTime/endTime`、作业人员 `operatorNames`、监护 `supervisorName/Contact`、证书上传(files)、作业内容、`jsas`、`riskHazards`。
**验收标准**：
- 危险票作业人员可独立完成填写并提交
- 证书文件落 `files` 模块
**文件**：`src/modules/public-actions/*`、前端 `WorkerFillPage`
**参考**：流程规范 第二节 2.2、第三节 阶段3

### [ ] P2-2 挂靠/不挂靠双审批链
**描述**：危险票审批矩阵路由：挂靠 → 部门主管→EHS工程师→工程部经理（3 节点，原路径）；不挂靠 → 部门主管→区域负责人→EHS工程师→工程部经理（4 节点，区域负责人插在部门主管与 EHS 之间，终点同为工程部经理）。按 `linkedRoutineId` 是否为空分支生成 `approvalChain`。
**验收标准**：
- 两种链路 `approvalChain` 节点与顺序正确
- 按序会签，前节点未批后节点不可操作
**文件**：`work-permits.service.ts` 审批路由、`schema.ts`(areaApproverId 已存在)
**参考**：流程规范 第二节 2.2（不挂靠链已确认：部门主管→区域负责人→EHS工程师→工程部经理）

### [ ] P3-1 入厂名单同步（可选）
**描述**：危险票作业人员填写后同步至 `entry_registrations`，作为入厂核验名单。
**验收标准**：填写的作业人员出现在入厂核验列表

### [ ] P3-2 分析审计留痕（可选）
**描述**：记录 `jsaAnalysisCount`、`jsaModifiedRound`、确认人、时间；`action_tokens.usedAt/usedBy` 已留痕。
**验收标准**：可在后台查看某票 JSA 分析次数与确认轨迹

### [ ] P3-3 短信校验（可选）
**描述**：令牌绑定负责人手机，提交时短信验证码校验（需短信服务）。
**验收标准**：无短信服务时该功能可关闭

---

## 质量门禁（Quality Requirements）
- [ ] 危害识别零重复录入：全链仅阶段 3 一次人工确认（流程规范 第四节）
- [ ] C1–C8 八条风险控制点全部通过自测（流程规范 第五节）
- [ ] 常规票 / 危险票挂靠 / 危险票不挂靠 三条路径均可 `draft → completed`
- [ ] 令牌过期、邮件未配置两种降级路径不阻塞主流程
- [ ] 无后台进程命令；不向命令追加 `&`
- [ ] 移动端/公开页响应式可用
- [ ] 图片来源仅 Unsplash / picsum，禁 Pexels

## 技术备注（Technical Notes）
- **开发栈**：NestJS + drizzle-orm + PGlite；React+TS+Vite
- **可复用底座**：`ai`(analyzeJsa/analyzeBriefingHazards)、`public-actions`(@Public + action_tokens)、`qr-codes`、`email`(nodemailer)、`files`(上传)、`measure_templates`(74条)
- **需新增字段**：`contractorEmail`、`contractorFillToken`(或复用 action_tokens)、`jsaAnalysisCount`、`jsaModifiedRound`、`riskHazards`
- **已确认口径**：① AI 分析**总次数上限 3**（人工修订不限次，按申请单累计不重置）；② AI 产出**保持专业性**（规范安全术语 + 具体执行动作/量化参数，禁口语化）；③ 不挂靠审批链终点 = 工程部经理
- **时间预期**：P0≈3天、P1≈5天、P2≈3天、P3 可选；首版需 2–3 轮修订收敛
- **图形化规划**：`docs/作业票流程整体规划.html`（流程图 + 信息流 + 输入输出 + 路线图）
