# EHS 电子化管理系统 — 部署与升级包说明

本目录为 **升级包**：含后端/前端构建产物 + 运行时文件，配合 `start-service.bat`（启动）与 `upgrade.bat`（升级）使用。

- 后端：NestJS，端口 **3100**，数据库用进程内 **PGlite**（单机免装库）。
- 前端：React + Vite，预览端口 **5190**，并把 `/api` 代理到 `localhost:3100`。
- 目标机只需 **Node.js 18+**（建议 20 LTS），无需安装 PostgreSQL。

---

## 一、目录结构

```
EHS-Upgrade-vX.Y.Z/
├── backend/
│   ├── dist/            # 后端构建产物（必带）
│   ├── runtime-alias.cjs# 运行时模块别名（必带）
│   └── .env.deploy      # .env 模板（首次复制为 .env，升级不覆盖）
├── frontend/
│   └── dist/            # 前端构建产物（必带）
├── start-service.bat    # 启动服务（双击即拉起前后端）
├── upgrade.bat          # 升级（停服→备份→替换 dist→启服）
└── README.md
```

> 本包为**完整版**：已含 `backend/node_modules` 与 `frontend/node_modules`，解压即跑，**无需联网 `npm install`**。
> （若你拿到的是精简版 dist-only，则首次需联网 `npm install` 一次，脚本会自动检测并安装。）

---

## 二、首次安装（新服务器）

1. 安装 **Node.js 18+**（勾选“Add to PATH”）。
2. 将本升级包解压到安装目录，例如 `C:\ehs-system`。
3. **双击 `start-service.bat`** 即可启动：
   - 脚本会：从 `.env.deploy` 生成 `.env` → 首次自动 `npm install` → 拉起前后端。
   - 弹出两个最小化窗口 `EHS-Backend` / `EHS-Frontend`，**保持它们开着**（关闭窗口即停止服务）。
4. 浏览器访问 `http://localhost:5190`（服务器上）或 `http://<公网IP>:5190`（外部）。
   - 管理员账号：`admin` / 密码 `admin123456`（首次登录强制改密）。
5. **务必在云服务器安全组 / Windows 防火墙放开入站端口 5190**（后端 3100 仅本机访问，无需对外）。

### 修改公网地址（二维码可用）
编辑 `C:\EHS\backend\.env`，把
```
APP_BASE_URL=http://localhost:5190
```
改为服务器公网地址，例如
```
APP_BASE_URL=http://47.100.60.182:5190
```
保存后停止旧进程再重跑 `start-service.bat`（见下方“重启”）。

---

## 三、升级（已有安装）

1. 把新的升级包解压到**临时目录**，例如 `D:\tmp\EHS-Upgrade-v1.1.0`。
2. 用记事本打开临时目录里的 `upgrade.bat`，把顶部
   ```
   set "INSTALL_DIR=C:\ehs-system"
   ```
   改为你实际的安装目录（与首次安装一致）。
3. **双击运行 `upgrade.bat`**：
   - 自动停止前后端（按端口 3100/5190）。
   - 备份旧 `dist` 到 `安装目录\backups\时间戳\`。
   - 用新包覆盖 `backend/dist`、`frontend/dist`、`runtime-alias.cjs` 与两个 bat。
   - **不会覆盖** `backend/.env` 与 `data/pglite` 数据目录。
   - 重新启动服务。

> 升级是**幂等**的：重复运行不会破坏数据；若 dist 没变则等价重启。

---

## 四、重启 / 回滚

- **单纯重启**：结束 `node.exe` 进程（任务管理器，或 `taskkill /f /im node.exe`），再双击 `start-service.bat`。
- **回滚版本**：把 `backups\某时间戳\dist` 拷回 `安装目录\backend\dist` 与 `frontend\dist`，再重启服务。

---

## 五、常见问题

- **访问不了 / 空白**：检查 5190 端口是否监听（`netstat -aon | findstr 5190`）；确认安全组与防火墙已放行 5190 入站。
- **后端起不来**：确认 `node` 在 PATH（`node -v`）；查看 `EHS-Backend` 最小化窗口的报错，或检查 `backend\.env` 中 `PGLITE_DATA_DIR` 指向的目录是否可写。
- **npm install 失败**：首次安装需联网；若服务器不能联网，需在一台能联网的同版本 Node 机器上 `npm install --production` 后，把整个 `node_modules` 一并拷过去。
- **端口被占用**：确保同一时间只有一个后端进程持有 3100（PGlite 不支持多实例并发写）。
