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
    const q = http.request(opt, (res) => { let s=''; res.on('data',c=>s+=c); res.on('end',()=>resolve({status:res.statusCode,body:s})); });
    q.on('error', reject); if (data) q.write(data); q.end();
  });
}
(async()=>{
  const login = await req('POST','/api/auth/login',{username:'admin',password:'Admin@123456'});
  const token = (JSON.parse(login.body).token)||'';
  console.log('login status:', login.status, 'token len:', token.length);
  for (const p of ['/api/departments','/api/users','/api/areas']) {
    const r = await req('GET', p, null, token);
    let arr = [];
    try { const j = JSON.parse(r.body); arr = Array.isArray(j)?j:(j.items||j.data||[]); } catch(e){}
    let mock = 0;
    arr.forEach(x=>{ if((x.username&&/^mock_/.test(x.username))||x.abbreviation==='MOCK'||x.code==='MOCK') mock++; });
    console.log(p, '=> status', r.status, '| total', arr.length, '| MOCK标记', mock);
  }
})().catch(e=>{console.error('ERR',e);process.exit(1);});
