/**
 * 系统对外访问地址（P0-10）
 *
 * 全系统所有「需要被用户点开」的链接都必须走这里，包括：
 *   - 邮件审批链接（同意/拒绝按钮）
 *   - 区域二维码 / 微信扫码免登录上报页
 *   - 作业票分享二维码（扫码 → 登录 → 跳详情）
 *   - 一级安全培训考试二维码
 *
 * 【为什么要收口】改造前这些链接散落在 6 个 service 里各写各的默认值
 * （localhost / localhost:5173 / localhost:5180 / localhost:5190 四种并存），
 * 部署到服务器后二维码扫出来指向 localhost，手机上必然打不开。
 *
 * 【取值优先级】APP_BASE_URL > PUBLIC_BASE_URL > 本地开发默认值
 * 部署到阿里云时只需在 .env 里设一处：APP_BASE_URL=http://47.100.60.182:8010
 * （用户已明确不做 ICP 备案，因此使用 IP + 端口的 HTTP 地址，不走域名。）
 */

const LOCAL_FALLBACK = 'http://localhost:5190';

/** 去掉结尾斜杠，避免拼出 `http://host//path` */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** 系统对外根地址，如 http://47.100.60.182:8010（结尾无斜杠） */
export function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || LOCAL_FALLBACK;
  return normalize(raw || LOCAL_FALLBACK);
}

/** 拼接前端路由地址，如 appUrl('/e-permits/view', id) */
export function appUrl(...segments: (string | number | null | undefined)[]): string {
  const path = segments
    .filter((s) => s !== null && s !== undefined && String(s) !== '')
    .map((s) => String(s).replace(/^\/+|\/+$/g, ''))
    .join('/');
  return path ? `${appBaseUrl()}/${path}` : appBaseUrl();
}

/** 作业票详情页地址（按渠道区分电子票 / 纸质票路由） */
export function permitDetailUrl(id: string, channel?: string | null): string {
  return appUrl(channel === 'electronic' ? 'e-permits' : 'work-permits', id);
}

/** 是否仍是本地地址（部署自检用：若为 true 说明忘了配 APP_BASE_URL） */
export function isLocalBaseUrl(): boolean {
  return /localhost|127\.0\.0\.1/i.test(appBaseUrl());
}
