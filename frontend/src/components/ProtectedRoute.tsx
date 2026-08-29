import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { hasPerm } from '@/api/client';

// 受保护路由：未登录跳转登录；可选 requirePerms 做权限校验（满足任意一个即可）
export default function ProtectedRoute({
  children,
  requirePerms,
}: {
  children: React.ReactNode;
  requirePerms?: string | string[];
}) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (requirePerms) {
    const list = Array.isArray(requirePerms) ? requirePerms : [requirePerms];
    const ok = list.some((p) => hasPerm(user, p));
    if (!ok) {
      return (
        <div className="p-10 text-center text-muted-foreground">
          <div className="text-2xl mb-2">⛔ 无权限</div>
          <div>当前账号没有访问该页面的权限。</div>
        </div>
      );
    }
  }
  return <>{children}</>;
}
