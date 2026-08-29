import React, { createContext, useContext, useEffect, useState } from 'react';
import api, { saveAuth, getStoredUser, getAccounts, saveAccounts, upsertAccount } from '@/api/client';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  department?: string;
  managedDepartments?: string[];
  mustChangePassword?: boolean;
  roles?: string[];
  permissions: string[];
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  accounts: AuthUser[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  switchAccount: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [loading, setLoading] = useState(false);

  // 其他已登录账号（排除当前活跃账号），从 localStorage 同步读取
  // 用 useState 缓存，避免每次 render 都读 localStorage
  const [accounts, setAccounts] = useState<AuthUser[]>(() =>
    getAccounts()
      .filter((a) => a.user && (!getStoredUser() || a.user.id !== getStoredUser()!.id))
      .map((a) => a.user),
  );

  async function refresh() {
    try {
      const { data } = await api.get('/auth/me');
      const u = data.user || data;
      setUser(u);
      localStorage.setItem('user', JSON.stringify(u));
    } catch {
      /* ignore */
    }
  }

  async function login(username: string, password: string) {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      saveAuth(data.token, data.user);
      upsertAccount(data.token, data.user);
      setUser(data.user);
      setAccounts(
        getAccounts()
          .filter((a) => a.user && a.user.id !== data.user.id)
          .map((a) => a.user),
      );
      if (data.user.mustChangePassword) {
        location.href = '/change-password';
      } else {
        location.href = '/';
      }
    } finally {
      setLoading(false);
    }
  }

  function switchAccount(id: string) {
    const acc = getAccounts().find((a) => a.user.id === id);
    if (!acc) return;
    saveAuth(acc.token, acc.user);
    setUser(acc.user);
  }

  function logout() {
    // 先吊销后端刷新令牌(HttpOnly Cookie)，再清本地
    api.post('/auth/logout').catch(() => {});
    const list = getAccounts().filter((a) => !user || a.user.id !== user.id);
    saveAccounts(list);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setAccounts([]);
    location.href = '/login';
  }

  // 每次应用加载都重新同步会话：防止 token/用户对象陈旧导致列表被错误过滤或显示空。
  // 401 由 api interceptor 统一处理（清 token 并跳登录）。
  useEffect(() => {
    refresh();
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, accounts, login, logout, switchAccount, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
