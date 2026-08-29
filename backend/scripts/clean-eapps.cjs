/**
 * 快速清空所有电子作业申请单(e-applications) + 关联危险作业票(e-permits)
 * 串行删除 + 极小延时（规避 PGlite 单连接并发崩溃），无重试退避
 * 运行：node scripts/clean-eapps.cjs
 */
const BASE = 'http://localhost:3100/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // 8s 超时，防止 fetch 永久挂起
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    await sleep(12);
    return { ok: res.ok, status: res.status, data: json };
  } catch (e) {
    return { ok: false, status: 0, data: { message: `请求失败/超时: ${e.message}` } };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const login = await api('POST', '/auth/login', null, { username: 'admin', password: 'Admin@123456' });
  const token = login.data.token;
  console.log('登录成功，开始清理...');

  let deleted = 0, permitsDeleted = 0, round = 0;
  while (true) {
    round++;
    const listRes = await api('GET', `/e-applications?page=1&pageSize=50`, token);
    const items = listRes.data && listRes.data.items;
    if (!items) { console.log(`第 ${round} 轮列表失败: ${JSON.stringify(listRes.data).slice(0,120)}`); break; }
    if (items.length === 0) break;
    console.log(`第 ${round} 轮：取到 ${items.length} 条，开始删除...`);
    for (const item of items) {
      const wpRes = await api('GET', `/e-permits?applicationId=${item.id}&pageSize=100`, token);
      if (wpRes.ok && wpRes.data.items) {
        for (const wp of wpRes.data.items) {
          await api('DELETE', `/e-permits/${wp.id}`, token);
          permitsDeleted++;
        }
      }
      const dres = await api('DELETE', `/e-applications/${item.id}`, token);
      if (dres.ok) deleted++;
    }
    console.log(`  累计删除 ${deleted} 申请单 / ${permitsDeleted} 子票`);
    if (round > 50) { console.log('达到轮次上限，停止'); break; }
  }

  const verify = await api('GET', `/e-applications?page=1&pageSize=1`, token);
  console.log(`\n清理完成：删除 ${deleted} 申请单 + ${permitsDeleted} 子票`);
  console.log(`剩余 e-applications: ${verify.data && verify.data.total}`);
}
main().catch(e => { console.error('异常:', e); process.exit(1); });
