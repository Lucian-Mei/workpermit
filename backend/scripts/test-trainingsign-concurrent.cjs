const BASE = 'http://localhost:3100/api';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, data: json };
}
const SIG = (i) => `data:image/png;base64,AAAA${i}`;
const CONC = 10;

(async () => {
  const login = await api('POST', '/auth/login', null, { username: 'admin', password: 'Admin@123456' });
  const token = login.data.token;
  const c = await api('POST', '/e-applications', token, {});
  const id = c.data.id;
  await api('PUT', `/e-applications/${id}`, token, { jobName: '并发签字测试', content: '内容', planStart: new Date().toISOString(), planEnd: new Date(Date.now()+2*86400000).toISOString(), operatorNames: ['张三'], department: '生产一部' });
  await api('POST', `/e-applications/${id}/training`, token, { trainer: '王培训', trainingTopics: '安全操作规程', testResult: '合格' });
  const tk = await api('POST', `/e-applications/${id}/training/sign-tokens`, token, {});
  const signToken = tk.data.token;

  // 并发 10 人同时签字（同一令牌）
  const jobs = [];
  for (let i = 0; i < CONC; i++) jobs.push(api('POST', `/public/sign/${signToken}`, null, { signImg: SIG(i) }));
  const results = await Promise.all(jobs);
  const okCount = results.filter(r => r.ok).length;
  console.log(`并发提交: ${okCount}/${CONC} 成功`);

  const app = await api('GET', `/e-applications/${id}`, token, null);
  const sigs = app.data.training?.traineeSignatures || [];
  console.log(`培训签字数: ${sigs.length} (应为${CONC})`);
  console.log(sigs.length === CONC && okCount === CONC ? '并发签字: OK 无丢更新' : '并发签字: FAIL 出现丢更新');
})().catch(e => { console.error('异常:', e); process.exit(1); });
