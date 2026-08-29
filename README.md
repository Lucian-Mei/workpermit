# EHS 隐患与作业管理系统

一套**完全自托管**的 E 级安全（环境 / 健康 / 安全）管理系统，覆盖：

- **隐患管理**：上报（含微信扫码免登录）→ AI 分析 → 派单 → 整改 → 验收。
- **作业票管理**：申请 → AI 风险分析 → 特种作业证书 OCR 识别 → 审核 → 特种作业额外审批 + 现场检查 → 批准 → 打印成两页（第一页作业票、第二页证书附件）→ 现场签字检查 → 归档。
- **权限体系**：员工账号全部在本系统内，用户名 = 姓名拼音，密码由系统下发；角色 / 权限可配置。
- **数据看板、列表管理、表单编辑、响应式布局**。
- **备份**：一键下载数据库备份（pg_dump SQL，失败退化为 JSON）；可选同步到飞书多维表格。

> 本系统**不依赖飞书多维表格**，所有业务数据都在本系统的 PostgreSQL 里。飞书只作为“可选备份目标”。

---

## 〇、系统架构（分层概览）

**请求流向**：用户 / 微信 → 前端（React）→ Nginx 反向代理 → 后端（NestJS + Drizzle）→ 数据库（PostgreSQL / PGlite），外部按需接入 AI / OCR / 飞书。

| 层 | 组成 |
| --- | --- |
| 用户端 | 系统管理员 / 安全员 / 审批人 / 普通员工；承包商经「微信扫码免登录」上报隐患 |
| 前端 | React 18 + Vite + Tailwind；运行时皮肤切换 + 玻璃拟态；页面见下方「目录结构 / 前端 pages」 |
| 接入层 | Nginx 反代：托管静态前端（容器内 :8080）+ `/api` → 后端 :3000，可选 HTTPS |
| 后端 | NestJS 10 模块化：认证权限、隐患、作业票、作业申请单、AI / OCR、看板 / 备份等 |
| 数据层 | PostgreSQL 16（生产 Docker 卷持久化）/ PGlite 0.5.4（本地沙箱 WASM），由 `DB_DRIVER` 切换 |
| 外部集成 | 微信扫码、AI 厂商（DeepSeek 等，可插拔）、OCR 厂商（阿里云等）、飞书多维表格（可选备份） |

> 完整可视化架构图见仓库根目录 **`ehs-architecture.html`**（浏览器直接打开，含分层卡片、角色与数据流向）。
> 配套**可视化帮助文档**已嵌入系统「系统设置 → 帮助文档」，源码位于 **`frontend/public/help.html`**（即原 `ehs-help.html`，玻璃拟态风格、与系统界面同源设计令牌、支持运行时明暗/强调色切换，含快速开始、角色权限、隐患/作业票状态流、作业申请单向导、部署与 FAQ），浏览器直接打开该文件亦可独立查看。

---

## 一、技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | NestJS 10 + Drizzle ORM 0.30 + PostgreSQL 16 |
| 数据库驱动 | `DB_DRIVER=pg` → PostgreSQL（生产 / Docker）；`DB_DRIVER=pglite` → **PGlite 0.5.4**（本地沙箱，进程内 WASM，免装数据库） |
| 前端 | React 18 + Vite 5 + Tailwind CSS 3；**运行时皮肤切换**（明暗 / 强调色 / 圆角 / 质感）+ 玻璃拟态 |
| AI | 默认 DeepSeek（可切换 OpenAI / 通义 / 豆包，做成可插拔） |
| OCR | 默认阿里云 OCR（支持多厂商，识别不了转人工审核） |
| 部署 | Docker Compose（nginx 反代 + 前端 + 后端 + Postgres，单台 2 核 4G 即可） |

---

## 二、目录结构

```
ehs-system/
├── backend/                # NestJS 后端
│   ├── src/
│   │   ├── database/        # schema.ts（Drizzle 表结构）+ seed 初始化
│   │   ├── common/         # JWT 守卫、权限守卫、装饰器、领域常量
│   │   ├── config/         # 读取 .env
│   │   ├── modules/
│   │   │   ├── auth/        # 登录、改密、拼音账号下发密码
│   │   │   ├── users/       # 员工账号管理
│   │   │   ├── roles/       # 角色与权限
│   │   │   ├── departments/  # 部门
│   │   │   ├── areas/        # 作业区域（下拉数据源）
│   │   │   ├── risk-levels/  # 风险等级（一般/较大/重大）
│   │   │   ├── hazard-types/ # 隐患分类
│   │   │   ├── hazards/     # 隐患（上报/AI/派单/整改/验收）
│   │   │   ├── work-permits/# 作业票（申请/AI/OCR/审核/批准/打印/检查）
│   │   │   ├── work-permit-applications/ # 作业申请单（含承包商安全培训与危险作业票）
│   │   │   ├── ai/          # 可插拔 AI（默认 DeepSeek）
│   │   │   ├── ocr/         # 可插拔 OCR（默认阿里云）
│   │   │   ├── files/       # 文件上传（含免登录公开上传）
│   │   │   ├── qr-codes/    # 微信扫码上报二维码
│   │   │   ├── email/       # 邮件通知（可选）
│   │   │   ├── lottery/     # 安全抽奖（活动激励，可选）
│   │   │   ├── dashboard/   # 看板统计
│   │   │   ├── backup/      # 下载备份 / 飞书同步
│   │   │   └── settings/     # 系统配置（AI 提示词）
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── Dockerfile
│   ├── drizzle.config.ts
│   └── package.json
├── frontend/               # React 前端
│   ├── src/
│   │   ├── pages/         # 各页面：登录 / 看板(Dashboard) / 大屏(Board) / 隐患 / 作业票 / 作业申请单 / 现场检查(Onsite) / 年度统计(Stats) / 员工权限 / 设置 / 微信扫码上报(AnonymousReport)
│   │   ├── components/     # Layout、ProtectedRoute、UI 组件
│   │   ├── context/        # 登录态
│   │   ├── api/            # axios 客户端
│   │   ├── constants.ts    # 状态/类型/权限常量（与后端对齐）
│   │   └── App.tsx         # 路由
│   ├── Dockerfile
│   └── vite.config.ts
├── nginx/                 # 网关反代配置
├── docker-compose.yml
├── .env.example
└── deploy.sh
```

---

## 三、本地快速预览（开发模式）

### 1. 数据库

```bash
# 起一个本地 Postgres（或你已有的）
docker run -d --name ehs_pg -e POSTGRES_USER=ehs -e POSTGRES_PASSWORD=ehs123456 -e POSTGRES_DB=ehs -p 5432:5432 postgres:16-alpine
```

### 2. 后端

```bash
cd backend
cp ../.env.example .env        # 或直接 export DATABASE_URL=postgresql://ehs:ehs123456@localhost:5432/ehs
npm install
npx drizzle-kit push          # 建表
npm run start                  # 监听 3000，首次启动自动初始化 admin 账号
```

### 3. 前端

```bash
cd frontend
npm install
npm run dev                   # 默认 5173，代理 /api 到 3000
```

打开 http://localhost:5173 ，用 `admin / Admin@123456` 登录（首次登录强制改密）。

---

## 四、服务器一键部署（阿里云 2 核 4G）

```bash
# 1) 把 ehs-system 整个目录上传到服务器
# 2) 生成并填写配置
cd ehs-system
cp .env.example .env
vim .env                    # 至少改：JWT_SECRET、DB_PASSWORD、AI_API_KEY、ALIYUN_OCR_*

# 3) 一键部署
chmod +x deploy.sh
./deploy.sh
```

部署完成后：

- 访问 `http://<服务器IP>`（nginx 80 端口）
- 后端 API：`http://<服务器IP>/api`
- 默认管理员：`admin / Admin@123456`

> 数据库数据在名为 `ehs_pg_data` 的卷里，升级镜像不会丢数据。上传文件在 `ehs_uploads` 卷里。

### HTTPS（可选）

把证书放到 `nginx/certs/fullchain.pem` 与 `nginx/certs/privkey.pem`，打开 `nginx/nginx.conf` 末尾注释的 443 server 块即可。

---

## 五、权限模型

账号 = 姓名拼音（如 `张三` → `zhangsan`），由系统自动生成；密码由系统下发随机值，**首次登录强制修改**。

内置 4 个角色（可在「角色与权限」里增改）：

| 角色 | 权限要点 |
| --- | --- |
| 系统管理员 admin | 全部权限 |
| 安全员 safety | 隐患派单 / 验收、作业票审核、现场检查 |
| 审批人 approver | 批准作业票（含特种作业） |
| 普通员工 employee | 上报隐患、提交自己的作业票申请 |

权限点形如 `hazard:create`、`work_permit:review`、`backup:download`，前端按权限隐藏菜单、后端按权限拦截，双重保险。

---

## 六、作业票流程（特种作业 vs 普通作业）

```
申请人填写（含作业内容）
   │
   ├─ 点「AI分析」→ 生成风险分析 + 防护措施建议（可一键填充到安全措施表）
   │
   ├─ 若【特种作业】：必须上传作业证照片/PDF
   │      → 系统 OCR 识别（阿里云）
   │      → 识别成功：提取字段（姓名/证号/有效期/发证机关…）
   │      → 识别不了：标记「转人工确认」，提醒申请人无需重试，由审核人员人工审核
   │
   └─ 提交
          │
          ▼
   后台 AI 复核（是否存在其他风险、措施是否到位）
          │
          ▼
   安全员审核（work_permit:review）
          │ 通过
          ├─ 普通作业 → 直接「已批准」
          └─ 特种作业 → 进入「审核中」，需审批人批准（work_permit:approve）
                                      │
                                      ▼
                                  已批准 → 可打印
                                      │
                                      ▼
                          现场张贴 + 现场检查签字（可多次）
                                      │
                                      ▼
                                  作业完成 → 归档（纸质归档）
```

**承包商没有系统账号怎么办？**
- 批准前尽量不需要签字；如必须，先在系统上填写姓名，打印后手写签字即可。
- 作业票打印模板第二页专门放证书附件，第一页是作业票正文。

**打印模板（两页）**
- 第一页：作业票（部门、地点、时间、作业人、监护人、作业内容、安全措施、AI 分析、审核/批准意见、签字区、现场检查记录表）。
- 第二页：特种作业证附件（照片 + OCR 提取信息），**证书不需要人员填写文字内容，只放照片和 OCR 信息**。

---

## 六（附）、作业申请单（引导式快速填写）

作业申请单是「普通作业 + 承包商培训 + 危险作业票」的统一入口，页面以**引导式快速填写**为主：

- 顶部「引导新建申请单」模块：一步看清 `作业申请 → 承包商安全培训 → 危险作业票 → 提交送审` 四步流程；
- **快捷模板**一键带入默认项：
  - **普通作业** —— 无需危险作业票；
  - **含危险作业** —— 自动预置「涉及危险作业」勾选，引导添加对应危险作业票；
  - **承包商作业** —— 重点提示完成承包商培训受训人签字与考核；
- 表单为四步向导：① 作业信息 → ② 承包商培训与签字 → ③ 危险作业票（按需添加）→ ④ 提交送审；
- 草稿可在列表「查看我的草稿」继续编辑；提交后进入作业票审核 / 批准流程。

---

## 七、微信扫码免登录上报

「隐患随手拍」页面 `/anonymous` 是**公开**的（不需要登录）：
- 扫码后填写自己的姓名即可上报，可拍照上传。
- 登录系统后，在「隐患管理 → 只看我的上报」能看到自己提交的历史。

把这个地址生成二维码张贴在现场即可：`http://<服务器IP>/anonymous`。

> 该接口带 IP 限流（1 小时最多 20 条 / 40 次上传），防止刷屏。

---

## 八、AI 与 OCR 配置

### AI（默认 DeepSeek）

在 `.env` 设置：

```
AI_PROVIDER=deepseek
AI_API_KEY=你的key
AI_API_BASE=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
```

换成其他家：实现 `backend/src/modules/ai/ai-provider.interface.ts` 的 `AiProvider`，在 `ai.module.ts` 的 `switch` 里注册即可，无需改业务代码。提示词可在后台「系统设置 → AI 提示词」里直接改。

### OCR（默认阿里云）

```
OCR_PROVIDER=aliyun
ALIYUN_OCR_ACCESS_KEY_ID=...
ALIYUN_OCR_ACCESS_KEY_SECRET=...
ALIYUN_OCR_REGION=cn-shanghai
```

支持多厂商（如住建局发的证识别不了就转人工）。实现 `ocr-provider.interface.ts` 的 `OcrProvider` 并注册即可。

---

## 九、备份

- **下载备份**：后台「系统设置 → 数据备份 → 立即备份并下载」。优先用 `pg_dump` 生成可恢复的 SQL；若容器内没有 `pg_dump`，退化为 JSON 导出。
- **飞书多维表格同步（可选）**：在 `.env` 填好 `FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_ID` 后，点「同步到飞书」即可把统计推送到多维表格。四项留空则只提供下载备份。

---

## 十、常见问题

**Q：表结构怎么更新？**
改 `backend/src/database/schema.ts` 后，在容器里跑 `npx drizzle-kit push`（开发期）或 `drizzle-kit migrate`（生产）。

**Q：AI / OCR 没配能用吗？**
能。没配时相关按钮会提示「AI 暂不可用」，但不影响隐患上报、作业票流转等核心流程；审核人员可人工完成分析。

**Q：想加新作业类型？**
在 `backend/src/common/constants/domain.ts` 的 `WORK_PERMIT_TYPES` 增加一项（标明是否特种作业、是否需要证书），前端 `frontend/src/constants.ts` 同步加一条即可。

**Q：想加新角色 / 权限？**
「角色与权限」页面可新建角色并勾选权限点；新增权限点需在 `domain.ts` 的 `PERMISSIONS` 里登记。
