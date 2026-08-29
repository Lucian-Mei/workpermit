# -*- coding: utf-8 -*-
import urllib.request, json, sys

BASE = "http://127.0.0.1:3000/api"

def call(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}

print("=== 1) admin 登录 ===")
st, admin = call("POST", "/auth/login", body={"username": "admin", "password": "Admin@123456"})
print("status:", st, "| has token:", "token" in admin)
admin_token = admin.get("token")
admin_id = admin.get("user", {}).get("id")
assert admin_token, "admin 登录失败"

print("\n=== 2) 创建部门负责人（approver 角色）===")
st, created = call("POST", "/users", token=admin_token,
                   body={"name": "验收测试负责人V", "roleKeys": ["approver"], "department": "测试部"})
print("status:", st, "| resp:", json.dumps(created, ensure_ascii=False))
test_id = created.get("id")
test_username = created.get("username")
test_pw = created.get("plainPassword")
assert test_id, "创建用户失败"
print("test_id:", test_id, "| username:", test_username, "| plainPassword:", test_pw)

print("\n=== 3) 取部门列表 ===")
st, depts = call("GET", "/departments", token=admin_token)
print("status:", st, "| 部门数:", len(depts) if isinstance(depts, list) else depts)
assert isinstance(depts, list) and depts, "部门列表为空"
dept = depts[0]
dept_id = dept["id"]
dept_name = dept["name"]
print("选定部门:", dept_name, "| id:", dept_id)

print("\n=== 4) [BUG-FIX] 仅传 managerUserIds 更新部门（复现原报错场景）===")
st, put = call("PUT", f"/departments/{dept_id}", token=admin_token,
                body={"managerUserIds": [test_id, admin_id]})
print("status:", st, "| resp:", json.dumps(put, ensure_ascii=False))
assert st == 200 and put.get("success") is True, "部门更新失败（可能仍报空 set SQL 错误）"

print("\n=== 5) GET /departments 校验 managers 已写入 ===")
st, depts = call("GET", "/departments", token=admin_token)
target = next((d for d in depts if d["id"] == dept_id), None)
mgrs = target.get("managers", []) if target else []
print("部门:", dept_name, "| managers:", json.dumps(mgrs, ensure_ascii=False))
mgr_ids = {m["id"] for m in mgrs}
assert test_id in mgr_ids and admin_id in mgr_ids, "managers 未正确写入"

print("\n=== 6) 以部门负责人登录 ===")
st, tlogin = call("POST", "/auth/login", body={"username": test_username, "password": test_pw})
print("status:", st, "| has token:", "token" in tlogin, "| error:", tlogin.get("error"))
assert "token" in tlogin, "部门负责人登录失败"
test_token = tlogin["token"]

print("\n=== 7) GET /auth/me 校验 managedDepartments ===")
st, me = call("GET", "/auth/me", token=test_token)
u = me.get("user", me)
print("name:", u.get("name"), "| managedDepartments:", u.get("managedDepartments"))
assert dept_name in (u.get("managedDepartments") or []), "managedDepartments 未包含该部门"

print("\n=== 8) GET /hazards/department（按 managedDepartments 过滤）===")
st, hz = call("GET", "/hazards/department?limit=5", token=test_token)
print("status:", st, "| 类型:", type(hz).__name__)
if isinstance(hz, dict):
    print("keys:", list(hz.keys()))

print("\n=== 9) GET /hazards/department/stats ===")
st, stats = call("GET", "/hazards/department/stats", token=test_token)
print("status:", st, "| stats:", json.dumps(stats, ensure_ascii=False)[:400])

print("\n✅ 全部通过：部门负责人链路（含空 set 修复）验证成功")
