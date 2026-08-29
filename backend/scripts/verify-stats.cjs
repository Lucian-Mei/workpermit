/* eslint-disable */
const http = require('http');
const BASE = 'http://localhost:3000';
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = require('url').parse(BASE + path);
    const opt = { method, hostname: r.hostname, port: r.port, path: r.path, headers: { 'Content-Type': 'application/json' } };
    if (token) opt.headers['Authorization'] = 'Bearer ' + token;
    if (data) opt.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opt, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
(async () => {
  const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'Admin@123456' });
  const tok = (JSON.parse(login.body).token) || '';
  console.log('login status:', login.status, 'token len:', tok.length);
  for (const p of ['/api/hazards/stats', '/api/work-permits/stats', '/api/work-permit-applications/stats']) {
    const r = await req('GET', p, null, tok);
    console.log('\n===', p, '(status', r.status, ') ===');
    try {
      const j = JSON.parse(r.body);
      console.log('total:', j.total, '| open:', j.open, '| byStatus:', JSON.stringify(j.byStatus));
    } catch (e) { console.log('raw:', r.body.slice(0, 300)); }
  }
  // 抽样一条 MOCK 隐患详情字段是否齐全
  const list = await req('GET', '/api/hazards?pageSize=1&keyword=MOCK', null, tok);
  console.log('\n=== sample MOCK hazard ===');
  try {
    const j = JSON.parse(list.body);
    const row = (j.rows && j.rows[0]) || (j.data && j.data[0]) || null;
    console.log(row ? JSON.stringify(row, null, 1).slice(0, 800) : list.body.slice(0, 300));
  } catch (e) { console.log(list.body.slice(0, 300)); }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
