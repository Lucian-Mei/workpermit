# EHS 电子化管理系统重新分析

> **分析基准**：当前 WorkBuddy 项目源码 `C:\Users\45518\WorkBuddy\EHS电子化管理系统\ehs-system`（2026-08-19），交叉核对 2026-08-05 的 7 份分析报告（基于 `ehs-win-deploy-20260805-v2.zip` 部署包）。
> **分析方法**：不盲信旧报告结论，逐条到当前源码中验证，并结合近期已落地的改造、你的实际使用场景重新排序。

---

## 一、旧报告的前提已发生重大变化

| 旧报告论断 | 当前事实 | 说明 |
|---|---|---|
| “部署包没有可维护源码，只有压缩后的 dist 和编译 JS” | **不成立** | WorkBuddy 项目中已有完整 `frontend/src`、`backend/src`、`package.json`、Vite/Nest 配置，且本分析直接核对源码。 |
| “前端源码类型检查失败，不能重新构建” | **不成立** | 当前 `frontend` 已多次 `npm run build` 成功；后端 `tsc --noEmit` 通过。`nest build` 在本地被沙箱 safe-delete 守卫拦截 `rm -rf dist`，属环境问题，不是源码错误。 |
| “系统运行在 8010 端口，使用旧 dist” | **不成立** | 当前本地验证环境为 前端 `http://localhost:5190`（serve_proxy.py 静态+代理）+ 后端 `http://localhost:3100`。 |
| “前端是单一 1.56MB JS 包，无源码映射” | **部分成立** | 源码存在，但构建配置仍是单入口大包，未做路由懒加载；`emptyOutDir: false` 导致 `dist/assets` 累积旧 hash 文件。 |
| “PGlite 数据目录在 `C:\EHS_system\...`” | **不成立** | 当前 `.env` 中 `PGLITE_DATA_DIR=D:/Users/45518/AppData/Local/Temp/ehs-pglite-v4`，与源码目录分离。 |

---

## 二、旧报告中仍然成立的问题（按风险排序）

### P0：应立即修复

| 编号 | 问题 | 当前源码状态 | 风险 | 建议修复 |
|---|---|---|---|---|
| **S01** | **培训/承包商/巡检接口完全匿名开放** | `TrainingController`、`ContractorsController`、`EOnsiteController.getInspections()` 均**无 `@UseGuards`**。根因：`main.ts` 未通过 `APP_GUARD` 注册全局 `JwtAuthGuard`，守卫全靠 Opt-in。 | 任何人可匿名增删改培训题库、承包商、读取入厂巡检记录。 | 注册全局 `JwtAuthGuard`，再对真正需要匿名的公共接口（考试、扫码登记）显式 `@Public()` 放行。 |
| **S02** | **停用账号的旧 JWT 仍可用** | `JwtStrategy.validate()` 只验证 token 签名与用户是否存在，**不校验 `user.status`**。 | 管理员停用账号后，已登录用户 7 天内仍可操作。 | 在 `JwtStrategy.validate()` 中增加 `status === 'active'` 检查，返回 401。 |
| **S03** | **CORS 接受任意来源且允许凭据** | `main.ts:17` `enableCors({ origin: true, credentials: true })`。 | 配合 XSS 或钓鱼站点可发起带身份凭证的跨站请求。 | 改为白名单数组，区分管理端域名、公共扫码域名；本地开发再单独放行。 |
| **S04** | **全局 DTO 校验未开启白名单** | `ValidationPipe({ whitelist: false, transform: false })`，无 `forbidNonWhitelisted`。 | 前端可提交接口未声明的字段，批量赋值、类型绕过。 | 改为 `whitelist: true, forbidNonWhitelisted: true, transform: true`，然后逐接口回归前端字段。 |
| **S05** | **匿名上传 + 上传目录静态暴露 + 无类型白名单** | `FilesController` 有 `@Public() anonymous-upload`；仅限制 20MB；`main.ts` 用 `express.static('/uploads')` 直出；无 MIME/魔数校验。 | 存储型 XSS（上传 HTML/SVG）、任意文件、信息泄露。 | 移除公共写接口或加 IP/行为风控；限制图片/PDF MIME+魔数；上传文件重命名为随机名；敏感附件改为鉴权下载。 |
| **S06** | **应用启动时执行 DDL/数据修复/种子** | `database.module.ts onModuleInit` 运行大量 `CREATE/ALTER`；`seed.service.ts` 启动灌数据；`lottery.service.ts` 运行期建表。 | 升级不可重复、启动即改 schema、多实例并发会损坏 PGlite（已实际发生过 `58P01` 崩溃）。 | 冻结当前 schema；将启动逻辑拆为版本化 migration，发布时独立执行；应用启动只做只读健康检查。 |

### P1：高优先级

| 编号 | 问题 | 当前源码状态 | 风险/影响 | 建议修复 |
|---|---|---|---|---|
| **S07** | **JWT 存 localStorage，默认 7 天，无刷新撤销** | `frontend/src/api/client.ts` 写 `localStorage.setItem('token',...)`；`auth.module.ts` 默认 `'7d'`。 | XSS 可窃取令牌；离职/丢机后长期有效。 | 缩短 Access Token 至 15–30 分钟；增加 Refresh Token 轮换与撤销；敏感操作可改用 HttpOnly Cookie。 |
| **S08** | **登录无速率限制/失败锁定** | 无 `@nestjs/throttler`，无登录风控。 | 暴力破解、撞库、短信/邮件轰炸。 | 加 `ThrottlerModule`，登录接口按 IP/账号限速，失败多次锁定或验证码。 |
| **S09** | **邮件审批用 GET 直接改状态** | `GET /api/public/approval/:token?action=approve` 直接调用 `executeApproval`。 | 邮件安全扫描预取可能误审批；不符合幂等/安全方法语义。 | 改为 GET 显示确认页，POST 带一次性 token 执行；记录 UA/IP。 |
| **S10** | **后端公共 HTML 页面未转义插值** | `public-actions.controller.ts` 的 `page()` 模板直接把 `applicantName`、`signerName` 等拼入 HTML。 | 存储/反射型 XSS。 | 使用模板引擎转义，或返回 JSON 由前端 React 渲染。 |
| **S11** | **验证码/考试会话存在进程内存 Map** | `hazards.service.ts captchas = new Map()`、`public-actions.service.ts examStore = new Map()`。 | 服务重启失效、多实例不共享、无持久过期。 | 迁移到 Redis 或数据库，带 TTL 和一次性消费。 |
| **S12** | **培训合格身份应按身份证号匹配** | `training.service.ts:98` `eq(trainingRecords.name, name)`；当前按**姓名**精确匹配，无 stable worker ID，也无身份证字段关联。 | 同名人员错认；无法与身份证/手机号/承包商人员主档唯一关联，培训合格记录易被冒领。 | 培训记录与考试以**身份证号**作为唯一键（必要时应叠加手机号/工号双因子）；建立 `worker` 主档，培训记录关联 `worker_id`。 |
| **S13** | **状态字段为自由 varchar，无枚举约束** | `schema.ts` 多处 `status: varchar({ default: 'draft' })`；无 `pgEnum`。 | 非法状态可入库；状态机只在前端/服务层约定。 | 使用 pgEnum + CHECK；状态迁移收口到一个 service。 |
| **S14** | **无并发控制/乐观锁** | 未看到 `version` 字段或 `select for update` 模式。 | 并发审批、并发整改可能互相覆盖。 | 关键表加 `version` 或 `updated_at` 条件更新；状态变更用事务。 |

### P2：结构性/体验性

| 编号 | 问题 | 当前状态 | 建议 |
|---|---|---|---|
| **S15** | **电子申请单与作业票重复建模** | 两套 controller/service/schema，启动时还有同步/清理逻辑。 | 这是旧架构债，但近期业务已跑通。不要一次性破坏性重构；建议用兼容层+双读校验，逐步合并。 |
| **S16** | **人员进厂仅“登记+培训校验”，无准入判定** | 只有 `entry_registrations` 文本登记 + 培训合格校验，无 `worker/credential/access_decision/access_event` 准入模型。当前已实现的正是**“登记 + 培训校验”**这一轻量模式，并非强准入控制。 | 若你真正需要门岗强管控（禁止未培训/证件过期人员入厂），这是最大功能缺口；若当前“登记+培训校验”已满足现场需求，则不必上准入引擎。 |
| **S17** | **无 PWA/离线/Service Worker** | 纯在线 SPA。 | 现场弱网场景需要；但优先级应低于 S01–S05 安全基线。 |
| **S18** | **前端仍是大 JS 包，无路由懒加载** | `vite.config.ts` 单入口。 | 弱网首屏慢；可后续按模块拆包。 |
| **S19** | **构建产物目录不清理** | `emptyOutDir: false`，`dist/assets` 累积旧 hash 文件。 | 改为 `true` 并确认 `public/` 包含所有需要的根目录文件。 |
| **S20** | **无自动化测试与监控** | 无单元/集成/E2E 测试，无 SLO/告警。 | 在安全基线修复后补权限+状态机+E2E 测试。 |

---

## 三、旧报告中已被修正或部分修正的问题

以下问题在 8/5 报告中存在，但当前源码已做过实质性改造（主要基于 2026-08-01 前后的任务 #133–#166 及后续移动端改造）：

| 旧报告问题 | 当前状态 | 证据 |
|---|---|---|
| 申请单下达被危险票状态阻塞 | **已修复** | `work-permit-applications.service.ts` 不再检查危险票状态；详情页仅提示。 |
| 父单信息未预填到作业票 | **已修复** | `createDraft` 自动复制 area/location/content/监护人/作业人/计划时间。 |
| 危险票提交父单条件过严 | **已修复** | 父单 `approved/printed/paused/finished/completed` 均允许，仅 draft/reviewing 拒绝。 |
| EPermits 列表不能独立新建常规票 | **已修复** | 列表新增「新建常规作业票」按钮，直接创建 `type='routine'`。 |
| 申请单提交后跳电子看板 | **已修复** | 提交后停留 `/e-applications/:id` 详情页。 |
| 常规票显示特种作业证 OCR | **已修复** | 仅 `isHazardous=true` 时显示特种作业证。 |
| 左侧审批意见/审批链重复 | **已修复** | 详情页已删除左侧重复 Section。 |
| 审批链未显示审批人+权限框 | **已修复** | `schema` 增加 `ehsApproverId/areaApproverId/deptApproverId`，详情页显示审批人与权限控制。 |
| 移动端完全不可用/仅桌面布局 | **部分修复** | 已加全局响应式 CSS、Layout 底部快捷栏、设备预览器；但表格未卡片化、表单未分步。 |
| 被停用账号 JWT 仍可用 | **逻辑上未修复**，但登录时会拦截 | 已修复的是**登录入口**校验 status；token 签发后的校验仍未做（见 S02）。 |

---

## 四、我基于你的使用场景的新增判断

结合你反复提的需求（看移动端效果、Mate 60 Pro 真机预览、响应式适配、手机界面要像手机），当前最影响你**实际使用**的其实是三类问题：

### 1. 移动端“能用”≠“好用”
当前系统在手机上是“桌面布局被 Tailwind 压成单列 + 底部加了一个快捷栏”，填报表单仍然是完整长表单，列表仍然是表格。你之前说的“未做响应式适配的真实状态”就是这个意思。如果现场工人要快速上报隐患或审批，现在的界面 still 是桌面思维。

### 2. 预览器只是镜子，不是系统问题
`device-preview.html` 本身是个开发/验收工具。把它修成“看起来像真机”只能帮你验收；真正决定手机体验的是前端页面。建议预览器做到“能看清圆角和挖孔”即可，不必再堆 CSS 细节。

### 3. 安全基线必须先于大功能
S01（未授权接口）是真实存在的后门。即使系统只在内部局域网跑，培训/承包商/巡检接口匿名可写也是不可接受的。修复它只需要注册全局 guard + 标记公共接口，工作量小、收益极大，应该排在大规模移动端重构之前。

---

## 五、修正后的优先级建议

### 第一阶段：止血（1–3 天，安全基线）
1. **注册全局 JwtAuthGuard**（修复 S01、堵住匿名写培训/承包商/巡检）。
2. **JWT validate 校验 status**（修复 S02）。
3. **CORS 改白名单**（修复 S03）。
4. **DTO 开启白名单+转换**（修复 S04，先在前端回归字段）。
5. **上传接口加 MIME/魔数白名单，敏感附件鉴权下载**（修复 S05）。
6. **登录限流**（修复 S08，至少防暴力破解）。

### 第二阶段：稳定发布链路（2–5 天）
1. 修复 `emptyOutDir: false` 或每次构建前清 `dist/assets`（S19）。
2. 解决 `nest build` 在沙箱下的删除问题，建立可重复的构建脚本。
3. 为关键接口补最小集合的回归测试（登录、培训 CRUD、承包商 CRUD、巡检列表）。

### 第三阶段：移动端真正适配（1–2 周）
1. 隐患上报改为“拍照 → 选位置 → 描述 → 提交”四步，底部固定提交。
2. 列表改为卡片 + 状态时间线；管理统计入口收起。
3. 作业申请改为分步向导 + 草稿自动保存。
4. 增加图片压缩、上传进度、失败重试。
5. 加 PWA manifest + service worker（S17）。

### 第四阶段：业务深水区（视需求决定）
1. 统一 Permit 聚合，逐步合并申请单/作业票双模型（S15）。
2. 建立承包商人员主档 + 证件/培训/保险有效期 + 准入规则引擎（S16）。
3. 对接门禁/闸机，实现真正的人员进厂强管控。

---

## 六、关键决策点需要你确认

1. **是否先修安全基线？** S01–S05 是真实后门，但修复后需要重新测试所有匿名公共页面（培训考试、扫码登记、匿名隐患上报），防止误拦截。
2. **移动端要走到哪一步？** 当前“能用”已经做到；要变成“现场好用”需要第三阶段（分步表单 + 卡片列表 + PWA）。
3. **是否要建承包商人员主档和门禁联动？** 这是 S16 的深水区，投入大，但决定了系统到底是“登记系统”还是“准入控制系统”。
4. **是否保留 PGlite？** 旧报告建议生产迁 PostgreSQL。若只是单机/演示，PGlite 够用；若要正式运行，必须迁移，因为 PGlite 已实际发生过并发写损坏（`58P01` 事件）。

---

## 七、修复已启动（2026-08-19 晚间）

用户确认开始修复 S01–S20。本轮已完成**体验/前端类**修复（含一处后端守卫）；安全基线 S01–S05 已实施完成，S06 完成评估并记录后续路线（见下表）。

| 项 | 修复内容 | 涉及文件 |
|---|---|---|
| **免登录上报自动退出** | 根因：`GET /areas` 需 `area:manage` 权限，匿名上报页拉取区域列表返回 401，前端拦截器误弹回登录页。修复：① 后端 `AreasController.list()` 加 `@Public()`；② `PermissionGuard` 增加 `@Public()` 短路（标记公共接口的接口同时跳过权限校验）；③ 前端 401 拦截器改为“仅当原本携带 token（会话过期）才清登录态并跳登录页”，匿名页不再被弹回。 | backend `modules/areas/areas.controller.ts`、`common/guards/permission.guard.ts`；frontend `src/api/client.ts` |
| **登录页二维码** | 移除“手机扫码登录本系统”提示与二维码（保留免登录上报入口） | frontend `src/pages/Login.tsx` |
| **顶栏三按钮统一** | 新建共享 `Popover` 组件（Portal 渲染、实底色背景、fixed 定位、移动端限宽限高滚动、外部点击/Esc 关闭），皮肤/消息/账号三个弹出层统一复用，修复账号菜单透明与皮肤菜单移动端溢出 | frontend `src/components/Popover.tsx` + `SkinSwitcher.tsx` / `NotificationBell.tsx` / `Layout.tsx` |

**安全基线（S01–S05 已完成，S06 已评估）**：

| 项 | 结论 / 修复 | 涉及文件 |
|---|---|---|
| **S01 全局守卫** | 注册 `APP_GUARD: JwtAuthGuard`，培训/承包商/巡检等原本完全匿名的写接口默认受保护；仅对真匿名端点显式 `@Public()`：`/auth/login`、`/public/*`（整控制器）、`/training/exam`（GET+POST，考试页为匿名路由）、`/areas`、`/hazards/captcha`、`/hazards/anonymous`、`/files/anonymous-upload`。已验证匿名公共页可访问、受保护接口无 token 返回 401。 | backend `src/app.module.ts`、`common/guards/jwt-auth.guard.ts`、`modules/{auth,public-actions,training,areas,hazards,files}/*` |
| **S02 停用账号 JWT** | `JwtStrategy.validate()` 增加 `user.status !== 'active'` 抛 401，管理员停用后旧 token 立即失效（登录入口原已校验）。 | backend `common/strategies/jwt.strategy.ts` |
| **S03 CORS 白名单** | `enableCors` 由 `origin:true` 改为白名单：env `CORS_ORIGINS` 显式 Origin 优先；未配置时默认放行本机 localhost/127.0.0.1 与内网私有网段（本地/局域网预览不受影响）。 | backend `src/main.ts` |
| **S04 DTO 白名单** | 全局 `ValidationPipe({ whitelist:true, transform:true })` 剥离未声明字段（防批量赋值）。审计确认仅 `LoginDto`/`ChangePwdDto` 是真实 class DTO（其余 Body 均为 `any`/内联类型，运行期跳过白名单），已为其补 `@Allow()` 保留声明字段。`forbidNonWhitelisted` 待前端字段回归审计后再开启。 | backend `src/main.ts`、`modules/auth/auth.controller.ts` |
| **S05 上传安全** | `FilesService.save()` 增加 MIME 白名单（jpeg/png/gif/webp/pdf）+ 文件头魔数校验，拒绝伪装成图片的 HTML/SVG/脚本；扩展名按 MIME 白名单映射（不再信任原始文件名）；匿名上传保留 IP 限流。`/uploads` 静态目录仅暴露白名单内类型，配合魔数校验无 HTML 执行面。 | backend `modules/files/files.service.ts` |
| **S06 启动 DDL** | 评估结论（本轮不改代码）：`database.module.onModuleInit` 全部 `IF NOT EXISTS`、破坏性清理已改 `runOnce` 打标记（`system_flags`），幂等可重复启动；`lottery.service` 运行期建表为新增风险点。彻底版本化 migration 属架构改动，需外部 PG + 发布流程配合，见后续路线。 | backend `database/database.module.ts`（评估） |

**S06 后续路线（待立项，建议 S07–S20 之后）**：
1. 冻结 schema，把 `onModuleInit` 的全部 DDL 固化为 `drizzle/0001_*.sql` 版本化迁移；
2. 发布时先独立执行迁移、再启动应用，应用启动只做只读健康检查（`to_regclass` 校验核心表）；
3. `lottery.service` 运行期建表并入主迁移；
4. 多实例部署前必须完成（PGlite 仅支持单实例写，多实例并发写会触发 `58P01`）。

**S07–S20 处置情况（2026-08-19 深夜）**：

| 项 | 处置 | 涉及文件 |
|---|---|---|
| **S07 JWT 存储/有效期** | **代码修复（2026-08-21）**。① Access Token 缩短为 30 分钟（`auth.module.ts` 默认 `JWT_EXPIRES_IN`）；② 新增 `refresh_tokens` 表（user_id / token_hash sha256 / expires_at / revoked_at / replaced_by / ua / ip），启动幂等建表+索引；③ 登录签发短 AT + Refresh Token，明文仅置 HttpOnly Cookie（`ehs_rt`，path=/api，sameSite=lax，非 https 不 Secure），DB 仅存 hash；④ `/auth/refresh` 实现**轮换**（旧令牌标记 replaced_by 并吊销，DB 写入新 hash），`/auth/logout` 吊销当前令牌 + 清 cookie；⑤ 改密后吊销该用户全部刷新令牌并下发新会话；⑥ 前端 `client.ts` `withCredentials:true` + 401 拦截器**单飞静默刷新**并重试，`AuthContext.logout` 先调 `/auth/logout`。**验证**：登录设 cookie→刷新轮换 ME=200→无 cookie 刷新 401→登出后刷新 401；代理 5190 正确透传 Set-Cookie（HttpOnly;SameSite=Lax;Path=/api）。XSS 窃取 localStorge token 后仅 30 分钟有效，且无法续期。 | backend `database/schema.ts`、`database/database.module.ts`、`modules/auth/{auth.service,auth.controller,auth.module}.ts`；frontend `src/api/client.ts`、`src/context/AuthContext.tsx`、`pages/ChangePassword.tsx` |
| **S08 登录限流** | `AuthService.login` 增加内存计数限流：窗口 10 分钟，同 IP+账号 8 次 / 同 IP 30 次 / 同账号 20 次触发 429（`HttpException` 429），成功登录清零。单实例部署下有效；多实例需换共享存储。**验证**：连续 8 次错误后第 8 次起返回 429，正确密码也被拦截。 | backend `modules/auth/auth.service.ts`、`auth.controller.ts` |
| **S09 邮件审批 GET 不再改状态** | GET `/public/approval/:token` 仅展示确认页（不再解析 `?action=` 执行）；执行唯一通道为 POST（确认页按钮改为原生 form POST）；`executeApproval` 记录操作 IP/UA 到令牌 meta。**防邮件安全网关预取误审批。** | backend `modules/public-actions/public-actions.controller.ts`、`public-actions.service.ts` |
| **S10 公共 HTML 转义** | 新增 `esc()` HTML 转义工具，审批/签字/培训/签到/错误页全部插值转义（姓名、票号、作业内容、提示语等）。防存储/反射型 XSS。 | backend `modules/public-actions/public-actions.controller.ts` |
| **S11 内存会话存储** | `examStore` 增加惰性过期清理（30 分钟超时自动删除，与 `captchas` 的 TTL+一次性策略对齐），防内存无限增长。单实例部署下内存存储可接受；多实例需迁 DB/Redis（已记入 S06 路线）。 | backend `modules/public-actions/public-actions.service.ts` |
| **S12 培训身份按身份证匹配** | **代码修复（判断：需要）**。① `training_records` 增加 `id_card` 列（schema + 迁移 + 索引）；② 独立考试页提交记录身份证（前端 `Training/Exam.tsx` 增加身份证输入，`EntryRegister.tsx` 增加身份证字段）；③ `findValidRecord` 严格按身份证匹配（提供身份证即不再按姓名兜底，杜绝同名错认），未提供时回落手机号/姓名（旧数据）；④ 入厂登记 `workerRegister` 同步按身份证优先。**验证**：TEST123 命中、同名不同证 TEST999 不命中。 | backend `database/{training.schema, database.module}.ts`、`modules/training/{training.service,training.controller}.ts`、`modules/public-actions/*`；frontend `pages/Training/Exam.tsx`、`pages/Public/EntryRegister.tsx` |
| **S13 状态枚举约束** | `ensureStatusCheck` 启动迁移：对 `work_permits`/`work_permit_applications`/`hazards` 的 status 加 CHECK 约束。安全策略：先查存量 DISTINCT 值，仅当全部在合法集合内才加约束；存在未知值则跳过并告警，绝不导致启动失败。**已验证三条约束全部落库。** | backend `database/database.module.ts` |
| **S14 并发控制** | 审批链三步（review/approveEhs/approve）改为 CAS 条件更新：`UPDATE ... WHERE id=? AND status=<期望状态>`，0 行则抛"状态已变更，请刷新后重试"。数据库原子比较-交换，并发重复审批不会互相覆盖。 | backend `modules/work-permits/work-permits.service.ts` |
| **S15 双模型合并** | **代码修复（2026-08-21，非破坏性）**。按文档"兼容层 + 双读校验"路线，不破坏结构、不改写双模型、不删业务数据：① 移除原**无条件** `DELETE FROM work_permits WHERE application_id IS NOT NULL AND channel='electronic'`（这是"模拟数据莫名消失/审批签字丢失"根因，每次重启删光所有挂申请单的电子票）；② 新增 `verifyDualModelConsistency()`：仅读取校验——危险申请单缺对应作业票**仅告警**、孤儿电子票（application_id 指向已删除的申请单，属垃圾残留）**安全删除**；纸质票与挂合法申请单的电子票一律不碰；③ 启动时日志确认`双读校验通过`。**验证**：后端启动日志 `[migrate][S15] 双读校验通过：危险申请单均有对应作业票，无孤儿票`；smoke 12/12 未回归。 | backend `database/database.module.ts` |
| **S16 准入控制** | **判断：无需代码修复**。你已明确当前"登记+培训校验"轻量模式即所需；强准入引擎（证件/有效期/闸机联动）仅在需要门岗强管控时立项。 | —（判断） |
| **S17 PWA** | 新增 `public/manifest.webmanifest` + `public/sw.js`（保守策略：带 hash 静态资源缓存优先、页面网络优先离线回退、`/api` `/uploads` 数据请求不缓存）+ `main.tsx` 注册 + index.html manifest link。 | frontend `public/manifest.webmanifest`、`public/sw.js`、`src/main.tsx`、`index.html` |
| **S18 路由懒加载** | `App.tsx` 全部页面改为 `React.lazy` + `<Suspense>`。**主包从 1528KB → 278KB（gzip 89KB）**，页面独立分包（xlsx/图表等三方库也已拆出）。 | frontend `src/App.tsx` |
| **S19 构建清理** | `vite.config.ts` `emptyOutDir:false`（保持 false：本地 safe-delete 守卫会拦截 vite 内部的 `fs.rm`，故构建前手动 `rm -rf dist`；根文件全部来自 public/，不会误删）。 | frontend `vite.config.ts` |
| **S20 自动化测试** | 新增 `backend/scripts/smoke-test.mjs` + `npm run smoke`：覆盖匿名公开 200、受保护 401、登录、带 token 访问、上传白名单拒绝/放行。**当前 12/12 通过。** | backend `scripts/smoke-test.mjs`、`package.json` |

---

## 八、手机端内容取舍与菜单整合分析（建议稿，待确认）

> 仅分析，未改代码。结论供用户在下一轮移动端重构时决策。

### 1. 手机端应展示什么（按现场角色取舍）

手机用户主要是**现场人员/班组长/区域负责人**，不是管理员。建议手机端只保留“现场作业 + 个人待办”，把管理/设置类收起或仅管理员可见：

| 优先级 | 手机端保留 | 说明 |
|---|---|---|
| 必留 | 隐患随手拍 / 上报、我的隐患 | 现场最高频动作 |
| 必留 | 待办（审批/检查/交底/签字）、消息中心 | 责任人移动处理 |
| 必留 | 作业票申请（电子申请单）、我的作业 | 现场发起与查看 |
| 选留 | EHS 仪表盘（精简版卡片） | 给负责人看态势，非必填 |
| 收起 | 年度作业统计、电子作业看板、入场记录、一级安全培训、部门隐患 | 管理视角，手机可不放或折叠进“更多” |
| 仅管理员 | 员工账号、角色权限、部门管理、系统设置 | 桌面端处理 |

### 2. 底部 5 个菜单建议（替代左列菜单）

手机端（<768px）隐藏左侧菜单，改用底部 Tab（参考现有 NavTab 结构扩展为 5 个）：

1. **首页**（仪表盘精简版）
2. **隐患**（随手拍 + 我的隐患）
3. **作业**（申请单 / 作业票）
4. **待办**（审批/检查/交底/签字聚合，带角标）
5. **我的**（账号、消息、设置、更多入口）

第 5 个“我的”承接原左列的账号/设置与“更多”抽屉，原“更多”按钮可取消。

### 3. 当前左列菜单设计评估（桌面端）

当前 `NAV_GROUPS` 共 **5 组 12 项**，问题：
- **项过多、密度高**：12 项全平铺，现场角色几乎用不到一半（如 年度作业统计、电子作业看板、入场记录、一级安全培训）。
- **分组语义交叉**：“电子化作业票”组里混了 统计/申请/管理/看板/记录/培训/现场台 7 项，职责不单一。
- **权限过滤已做但未分层**：无权限项会隐藏，但有权限的用户仍面对长列表。

**整合建议（桌面端也适用）**：
- 按角色/场景重组为 3–4 组：**总览**（仪表盘）、**现场作业**（隐患、申请单、作业票、看板、现场台）、**待办与消息**（审批、检查、入场记录）、**管理**（员工/权限/部门/设置/培训），把“年度统计”并入总览或管理。
- 高频项置顶，管理类默认折叠。
- 手机端直接复用整合后的“现场作业 + 待办”作为底部 Tab，避免两套菜单逻辑分裂。

---

## 九、与 7 份旧报告的核心差异总结

| 维度 | 旧报告（8/5 部署包） | 当前重新分析（8/19 源码） |
|---|---|---|
| 源码 availability | 认为没有可维护源码 | **有完整源码，且构建通过** |
| 前端构建 | 认为无法构建 | **可构建，但有大包/不清理问题** |
| 未授权接口 | 列为 P0 但未给出根因 | **根因是未注册全局 guard，修复点极明确** |
| 已修复的业务流程 | 未反映 | **申请单/作业票流程已大幅改造并落地** |
| 移动端 | 认为“基本无响应式” | **已有响应式基础，但未到现场好用** |
| 最大风险 | 泛化为“不可维护” | **具体化为 S01 匿名写接口、S02 停用 token、S05 上传安全** |
| 建议顺序 | 阶段 0 取源码 | **当前已有源码，应直接进入安全基线修复** |
