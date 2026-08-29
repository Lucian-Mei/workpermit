// 懒加载包装：chunk 加载失败时（通常是浏览器缓存了引用旧 hash chunk 的旧 index.html）自动 reload 一次，
// 拉取最新 index.html + 新 chunk 后重新加载路由，整个过程对用户几乎无感。
// 每个标签页（sessionStorage）只重试一次，避免真的缺 chunk 时死循环刷新。
import { lazy, ComponentType, LazyExoticComponent } from 'react';

const RELOAD_FLAG = 'ehs_lazy_chunk_retry';

function isChunkLoadError(e: any): boolean {
  const msg = String(e?.message || e || '');
  return (
    /Failed to fetch dynamically imported module/.test(msg) ||
    /Loading chunk \d+ failed/.test(msg) ||
    /Importing a module script failed/.test(msg) ||
    /Loading CSS chunk/.test(msg)
  );
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (e) {
      if (isChunkLoadError(e) && !sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        location.reload();
        // 永远 pending：等 reload 完成后页面重新加载，不会进入错误页
        return new Promise<{ default: T }>(() => {});
      }
      throw e;
    }
  });
}
