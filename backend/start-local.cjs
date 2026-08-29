// 本地沙箱一键启动（仅本地开发工具，不参与生产运行路径）
// 作用：
//  1) 防多实例：检测 3100 端口，已监听则提示不重复启动；
//  2) 防 PGlite 残留锁：无进程占用时自动清理 postmaster.pid，避免"浏览器加载失败"；
//  3) 单实例启动后端。
// 用法：在 backend 目录下执行  node start-local.cjs
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3100);

// 从 .env 读取 PGlite 数据目录（用于定位残留锁文件）
function readDataDir() {
  try {
    const s = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
    const m = s.match(/^PGLITE_DATA_DIR\s*=\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

(async () => {
  console.log(`[start-local] 检查端口 ${PORT}...`);
  if (await portInUse(PORT)) {
    console.log(`[start-local] ${PORT} 已被监听：后端可能已在运行。直接访问 http://localhost:${PORT} 即可。`);
    console.log('[start-local] 若确认没有后端进程，请先释放该端口，再运行本脚本。');
    process.exit(0);
  }

  // 清理 PGlite 残留锁（端口未监听时残留锁必然属于已死进程，删除安全）
  const dataDir = readDataDir();
  if (dataDir) {
    const pidFile = path.join(dataDir, 'postmaster.pid');
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
        console.log(`[start-local] 已清理 PGlite 残留锁文件: ${pidFile}`);
      } catch (e) {
        console.log(`[start-local] 清理锁文件失败（可能被占用）: ${e.message}`);
      }
    }
  } else {
    console.log('[start-local] 未在 .env 中找到 PGLITE_DATA_DIR，跳过锁清理');
  }

  console.log(`[start-local] 启动后端 http://localhost:${PORT} ...`);
  const child = spawn(process.execPath, ['-r', './runtime-alias.cjs', 'dist/main.js'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.log('');
      console.log('[start-local] 后端异常退出。若反复启动失败（日志出现 WASM Aborted），很可能是 PGlite 数据目录损坏。');
      console.log(`[start-local] 恢复方法：备份后删除 ${dataDir || 'PGLITE_DATA_DIR'} 目录，重新运行本脚本即可重建（数据会重置为种子初始状态）。`);
    }
    process.exit(code ?? 0);
  });
})();
