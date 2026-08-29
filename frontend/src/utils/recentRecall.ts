// 常用信息本地记忆：在填写作业票等表单时，记住常用作业人/监护人/承包商负责人等，
// 以 <datalist> 下拉形式回显，减少重复输入。仅存于浏览器本地，不上传。
const PREFIX = 'ehs_recent_';
const MAX = 15;

// 分割多值字段（如"作业人"可填多个，逗号/顿号分隔）
function splitValues(raw: string): string[] {
  return (raw || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function rememberRecent(key: string, raw: string): void {
  const vals = splitValues(raw);
  if (!vals.length) return;
  try {
    const storeKey = PREFIX + key;
    const prev: string[] = JSON.parse(localStorage.getItem(storeKey) || '[]');
    // 新值置顶、去重、截断
    const next = [...vals, ...prev].filter((v, i, a) => a.indexOf(v) === i).slice(0, MAX);
    localStorage.setItem(storeKey, JSON.stringify(next));
  } catch {
    /* 忽略本地存储异常 */
  }
}

export function getRecent(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
