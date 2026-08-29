// 系统管理员（超级管理员）判定：永远可见/可操作全部数据。
// 1) 通配符 '*'（标准超级管理员约定）；2) 持有 admin 角色键。
// 所有权限守卫与数据可见性作用域都必须先过此判定，确保管理员永远能看到全部。
export function isSuperAdmin(user: any): boolean {
  if (!user) return false;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('*')) return true;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.includes('admin')) return true;
  return false;
}
