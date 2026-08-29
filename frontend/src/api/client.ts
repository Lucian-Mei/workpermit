import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});
// S07：携带凭据（HttpOnly 刷新令牌 Cookie）随接口请求发送
api.defaults.withCredentials = true;

// 单飞刷新：多个并发 401 只触发一次 /auth/refresh，避免刷新风暴
let refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  if (!refreshing) {
    refreshing = (async () => {
      const { data } = await api.post('/auth/refresh');
      saveAuth(data.token, data.user);
      return data.token as string;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status;
    const original = err.config as any;
    // 已登录会话(携带过 token)遇到 401 才静默刷新；匿名/免登录页不刷新
    const isAuthUrl =
      original &&
      (String(original.url || '').includes('/auth/login') ||
        String(original.url || '').includes('/auth/refresh') ||
        String(original.url || '').includes('/auth/logout'));
    if (status === 401 && original && !original._retry && !isAuthUrl) {
      const hadToken = !!localStorage.getItem('token');
      if (!hadToken) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        return Promise.reject(err);
      }
      original._retry = true;
      try {
        const newToken = await doRefresh();
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshErr) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (location.pathname !== '/login') location.href = '/login';
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  },
);

export default api;

// 写入登录态：同时同步多账号列表（便于切换账号时令牌一致）
export function saveAuth(token: string, user: any) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  if (user && user.id) upsertAccount(token, user);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

// 已登录账号列表（多账号切换用）。每项含 token + 完整 user 对象。
const ACCOUNTS_KEY = 'ehs_accounts';

export interface StoredAccount {
  token: string;
  user: any;
}

export function getAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveAccounts(list: StoredAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}

// 新增/更新一个已登录账号，保持列表去重（按 user.id）并限制最多保留 6 个
export function upsertAccount(token: string, user: any) {
  const list = getAccounts().filter((a) => a.user && a.user.id !== user.id);
  list.unshift({ token, user });
  saveAccounts(list.slice(0, 6));
}

export function hasPerm(user: any, perm: string): boolean {
  if (!user) return false;
  // 系统管理员（admin 角色）或持有 `*` 通配符者即超级管理员，拥有全部权限，
  // 可执行任何操作（含代区域负责人审核、代经理批准），与后端 isSuperAdmin 对齐。
  if (user.roles?.includes('admin') || user.permissions?.includes('*')) return true;
  return user.permissions?.includes(perm) || false;
}
