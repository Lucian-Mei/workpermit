// 皮肤系统 v3 —— 真正的「皮肤」：不止换颜色。
// 一套皮肤 = 明暗(mode) + 主色(accent) + 圆角(radius) + 材质(surface) + 字体(font) + 密度(density)。
// 这些维度分别映射到 <html> 上的 [data-mode]/[data-accent]/[data-radius]/
// [data-surface]/[data-font]/[data-density]，由 index.css 对应属性块驱动。
// 自定义主色走内联变量（最高优先级）。

export type ModeName = 'dark' | 'light';
export type AccentName = 'green' | 'cyan' | 'blue' | 'violet' | 'amber' | 'indigo';
export type RadiusName = 'sm' | 'md' | 'lg' | 'xl';
export type SurfaceName = 'flat' | 'soft' | 'glass';
export type FontName = 'sans' | 'rounded' | 'mono';
export type DensityName = 'compact' | 'cozy' | 'comfortable';

export interface AccentPreset {
  name: AccentName;
  label: string;
  swatch: string;
}
export interface ModePreset {
  name: ModeName;
  label: string;
}
export interface RadiusPreset {
  name: RadiusName;
  label: string;
}
export interface SurfacePreset {
  name: SurfaceName;
  label: string;
}
export interface FontPreset {
  name: FontName;
  label: string;
}
export interface DensityPreset {
  name: DensityName;
  label: string;
}

/** 一套完整皮肤模板（用户可一键套用，也可在此基础上微调） */
export interface SkinPreset {
  id: string;
  name: string;
  description: string;
  mode: ModeName;
  accent: AccentName;
  radius: RadiusName;
  surface: SurfaceName;
  font: FontName;
  density: DensityName;
  /** 预览色（用于选择器里的渐变卡片） */
  preview: string[];
}

export const ACCENTS: AccentPreset[] = [
  { name: 'green', label: '安全绿', swatch: '#16a34a' },
  { name: 'cyan', label: '科技青', swatch: '#0ea5e9' },
  { name: 'blue', label: '信赖蓝', swatch: '#2563eb' },
  { name: 'violet', label: '优雅紫', swatch: '#7c3aed' },
  { name: 'amber', label: '暖阳橙', swatch: '#d97706' },
  { name: 'indigo', label: '靛蓝', swatch: '#4f46e5' },
];

export const MODES: ModePreset[] = [
  { name: 'dark', label: '暗色' },
  { name: 'light', label: '明亮' },
];

export const RADII: RadiusPreset[] = [
  { name: 'sm', label: '小巧' },
  { name: 'md', label: '适中' },
  { name: 'lg', label: '圆润' },
  { name: 'xl', label: '超大' },
];

export const SURFACES: SurfacePreset[] = [
  { name: 'flat', label: '扁平' },
  { name: 'soft', label: '柔和' },
  { name: 'glass', label: '磨砂玻璃' },
];

export const FONTS: FontPreset[] = [
  { name: 'sans', label: '无衬线' },
  { name: 'rounded', label: '圆体' },
  { name: 'mono', label: '等宽' },
];

export const DENSITIES: DensityPreset[] = [
  { name: 'compact', label: '紧凑' },
  { name: 'cozy', label: '适中' },
  { name: 'comfortable', label: '宽松' },
];

// 5 套真正不同的「EHS 界面方案」——每套 = 明暗 + 主色 + 圆角 + 材质 + 字体 + 密度
export const SKINS: SkinPreset[] = [
  {
    id: 'trust',
    name: '信赖蓝',
    description: '明亮专业 · 信赖蓝（推荐默认）',
    mode: 'light',
    accent: 'blue',
    radius: 'md',
    surface: 'glass',
    font: 'sans',
    density: 'comfortable',
    preview: ['#f7f9fc', '#2c5be5', '#e2e8f5'],
  },
  {
    id: 'safety',
    name: '安全绿',
    description: '明亮保守 · 行业经典安全绿',
    mode: 'light',
    accent: 'green',
    radius: 'md',
    surface: 'soft',
    font: 'sans',
    density: 'comfortable',
    preview: ['#f0fdf4', '#16a34a', '#dcfce7'],
  },
  {
    id: 'violet',
    name: '优雅紫',
    description: '明亮优雅 · 圆润紫调',
    mode: 'light',
    accent: 'violet',
    radius: 'lg',
    surface: 'soft',
    font: 'rounded',
    density: 'cozy',
    preview: ['#faf8ff', '#8b5cf6', '#ece7fb'],
  },
  {
    id: 'amber',
    name: '暖阳橙',
    description: '明亮度 · 电子现场作业暖橙',
    mode: 'light',
    accent: 'amber',
    radius: 'md',
    surface: 'flat',
    font: 'sans',
    density: 'comfortable',
    preview: ['#fffbf3', '#f59e0b', '#fdeccd'],
  },
  {
    id: 'command',
    name: '指挥深空',
    description: '暗色指挥台 · 大屏监控',
    mode: 'dark',
    accent: 'indigo',
    radius: 'md',
    surface: 'soft',
    font: 'sans',
    density: 'cozy',
    preview: ['#0c0f15', '#4f46e5', '#1a2230'],
  },
];

const STORAGE_KEY = 'ehs-skin';

export interface SavedSkin {
  mode: ModeName;
  accent: AccentName;
  radius: RadiusName;
  surface: SurfaceName;
  font: FontName;
  density: DensityName;
  /** 自定义主色（hex），存在时覆盖预设主色 */
  custom?: string;
  /** 当前套用的皮肤模板 id（仅用于 UI 高亮） */
  skinId?: string;
}

export function getDefaultSkin(): SavedSkin {
  const base = SKINS.find((s) => s.id === 'trust') ?? SKINS[0];
  return {
    mode: base.mode,
    accent: base.accent,
    radius: base.radius,
    surface: base.surface,
    font: base.font,
    density: base.density,
    skinId: base.id,
  };
}

export function getSavedSkin(): SavedSkin {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const valid =
        (p.mode === 'dark' || p.mode === 'light') &&
        typeof p.accent === 'string' &&
        typeof p.radius === 'string' &&
        typeof p.surface === 'string' &&
        typeof p.font === 'string' &&
        typeof p.density === 'string';
      if (valid) {
        // 淘汰旧默认皮肤（翡翠指挥台 / 商务简约），统一升级为信赖蓝专业风
        if (p.skinId === 'command' || p.skinId === 'biz' || !p.skinId)
          return getDefaultSkin();
        return p as SavedSkin;
      }
    }
  } catch {
    /* ignore */
  }
  return getDefaultSkin();
}

/** 由一套模板生成完整皮肤（用于一键套用） */
export function skinFromPreset(p: SkinPreset): SavedSkin {
  return {
    mode: p.mode,
    accent: p.accent,
    radius: p.radius,
    surface: p.surface,
    font: p.font,
    density: p.density,
    skinId: p.id,
  };
}

function hexToHslChannels(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** 把自定义主色通道写进 documentElement（明暗都适配） */
function applyCustomAccent(el: HTMLElement, hex: string, mode: ModeName) {
  const c = hexToHslChannels(hex);
  if (!c) return;
  const softL = mode === 'light' ? 95 : 14;
  const fgL = mode === 'light' ? 28 : 80;
  const pFg = c.l > 62 ? '222 30% 8%' : '0 0% 100%';
  el.style.setProperty('--primary', `${c.h} ${c.s}% ${Math.min(60, Math.max(45, c.l))}%`);
  el.style.setProperty('--primary-foreground', pFg);
  el.style.setProperty('--primary-soft', `${c.h} ${c.s}% ${softL}%`);
  el.style.setProperty('--accent', `${c.h} ${c.s}% ${softL}%`);
  el.style.setProperty('--accent-foreground', `${c.h} ${c.s}% ${fgL}%`);
  el.style.setProperty('--ring', `${c.h} ${c.s}% ${Math.min(65, Math.max(50, c.l))}%`);
  el.style.setProperty('--sidebar-primary', `${c.h} ${c.s}% ${Math.min(70, Math.max(55, c.l))}%`);
  el.style.setProperty('--info', `${c.h} ${c.s}% ${Math.min(65, Math.max(50, c.l))}%`);
  el.style.setProperty('--chart-1', `${c.h} ${c.s}% ${Math.min(70, Math.max(55, c.l))}%`);
}

const INLINE_VARS = [
  '--primary',
  '--primary-foreground',
  '--primary-soft',
  '--accent',
  '--accent-foreground',
  '--ring',
  '--sidebar-primary',
  '--info',
  '--chart-1',
];

export function applySkin(skin: SavedSkin) {
  const el = document.documentElement;
  // 清掉上一次可能写入的内联自定义变量
  INLINE_VARS.forEach((varName) => el.style.removeProperty(varName));

  // 明暗模式（CSS 用 [data-mode='dark'] 区分，未设 data-mode 视为亮色）
  if (skin.mode === 'dark') el.setAttribute('data-mode', 'dark');
  else el.removeAttribute('data-mode');

  // 主色（green 即默认，无需属性）
  if (skin.accent === 'green') el.removeAttribute('data-accent');
  else el.setAttribute('data-accent', skin.accent);

  // 其余维度：圆角 / 材质 / 字体 / 密度
  el.setAttribute('data-radius', skin.radius);
  el.setAttribute('data-surface', skin.surface);
  el.setAttribute('data-font', skin.font);
  el.setAttribute('data-density', skin.density);

  // 自定义主色（覆盖一切）
  if (skin.custom) applyCustomAccent(el, skin.custom, skin.mode);
}

export function saveSkin(skin: SavedSkin) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skin));
  } catch {
    /* ignore */
  }
  applySkin(skin);
}
