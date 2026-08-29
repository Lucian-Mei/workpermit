const BASE = 'http://localhost:3100/api';
const http = require('http');

function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = opts.body ? JSON.stringify(opts.body) : null;
    const r = http.request(BASE + path, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}),
      },
      ...(body ? { headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) } } : {}),
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, raw: d.slice(0, 200) }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const health = await req('/health');
  console.log('health:', health.status, JSON.stringify(health.data || health.raw));

  const login = await req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin@123456' } });
  if (login.status < 200 || login.status >= 300 || !login.data || !login.data.token) {
    console.log('LOGIN FAILED', login.status, JSON.stringify(login.data || login.raw));
    process.exit(1);
  }
  const token = login.data.token;

  const hz = await req('/hazards?pageSize=1', { token });
  const hzTotal = hz.data && hz.data.data ? hz.data.data.total : (hz.data && hz.data.total);

  const ea = await req('/e-applications?pageSize=1', { token });
  const eaTotal = ea.data && ea.data.data ? ea.data.data.total : (ea.data && ea.data.total);

  console.log('hazards total:', hzTotal);
  console.log('e-applications total:', eaTotal);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
