const BASE = 'http://localhost:3100/api';
async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, data: json };
}
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const CONC = 5;

(async () => {
  const login = await api('POST', '/auth/login', null, { username: 'admin', password: 'Admin@123456' });
  const token = login.data.token;
  // 创建一张作业票（paper）
  const c = await api('POST', '/work-permits', token, { type: 'hot_work', content: '动火作业测试', location: '车间', applicantName: '张三', department: '生产一部', planStart: new Date().toISOString(), planEnd: new Date(Date.now()+2*86400000).toISOString() });
  if (!c.ok) { console.log('创建作业票 FAIL:', c.data.message); process.exit(1); }
  const pid = c.data.id;
  console.log('创建作业票: OK');
  // 生成签字令牌
  const tk = await api('POST', `/work-permits/${pid}/sign-tokens`, token, { role: 'worker', multi: true });
  const signToken = tk.data.token;
  console.log('生成令牌:', tk.ok ? 'OK' : 'FAIL ' + tk.data.message);
  // GET 签字信息（应为 work_permit，非 generic）
  const info = await api('GET', `/public/sign/${signToken}`, null, null);
  console.log('公开签字信息:', info.ok ? `targetType=${info.data.targetType}, generic=${info.data.generic}` : 'FAIL');
  // 并发 5 人签字
  const jobs = [];
  for (let i = 0; i < CONC; i++) jobs.push(api('POST', `/public/sign/${signToken}`, null, { role: 'worker', signImg: SIG + i }));
  const r = await Promise.all(jobs);
  const okCount = r.filter(x => x.ok).length;
  const wp = await api('GET', `/work-permits/${pid}`, token, null);
  const sigs = wp.data.signatures || [];
  console.log(`并发签字: ${okCount}/${CONC} 成功, 签字数=${sigs.length} (应为${CONC})`);
  console.log(sigs.length === CONC && okCount === CONC ? '作业票通用签字: OK' : '作业票通用签字: FAIL');
})().catch(e => { console.error('异常:', e); process.exit(1); });
