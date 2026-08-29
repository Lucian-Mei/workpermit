import React from 'react';
import { Shirt, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/theme/ThemeProvider';
import { ACCENTS, SURFACES } from '@/theme/skins';
import { cn } from './ui';
import { Popover } from './Popover';

// 收纳式皮肤设置：默认仅显示一个 Shirt 图标按钮（环色提示当前强调色），点击弹出 popover 调节
// 明/暗 + 材质（实/柔/玻）+ 6 种强调色，全局实时生效。弹出层统一走 Popover。
export default function SkinSwitcher() {
  const t = useTheme();
  const isDark = t.mode === 'dark';

  return (
    <Popover
      align="right"
      trigger={({ toggle, ref }) => (
        <button
          ref={ref}
          onClick={toggle}
          title="皮肤设置"
          aria-label="皮肤设置"
          aria-haspopup="dialog"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Shirt size={16} />
        </button>
      )}
    >
      {/* 模式：明 / 暗 */}
      <div className="mb-3">
        <div className="mb-1.5 px-0.5 text-xs font-medium text-muted-foreground">外观</div>
        <div className="flex items-center rounded-[var(--radius)] bg-muted/50 p-0.5">
          <button
            onClick={() => t.setMode('light')}
            aria-pressed={!isDark}
            className={cn(
              'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-4px)] text-xs font-medium transition-colors',
              !isDark ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Sun size={13} /> 明亮
          </button>
          <button
            onClick={() => t.setMode('dark')}
            aria-pressed={isDark}
            className={cn(
              'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-4px)] text-xs font-medium transition-colors',
              isDark ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Moon size={13} /> 暗色
          </button>
        </div>
      </div>

      {/* 材质：实 / 柔 / 玻 */}
      <div className="mb-3">
        <div className="mb-1.5 px-0.5 text-xs font-medium text-muted-foreground">材质</div>
        <div className="flex items-center rounded-[var(--radius)] bg-muted/50 p-0.5">
          {SURFACES.map((s) => (
            <button
              key={s.name}
              onClick={() => t.setSurface(s.name)}
              aria-pressed={t.surface === s.name}
              className={cn(
                'h-8 flex-1 rounded-[calc(var(--radius)-4px)] text-xs font-medium transition-colors',
                t.surface === s.name ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 强调色：6 色 */}
      <div>
        <div className="mb-1.5 px-0.5 text-xs font-medium text-muted-foreground">强调色</div>
        <div className="flex items-center gap-1.5 px-0.5">
          {ACCENTS.map((a) => {
            const active = !t.customColor && t.accent === a.name;
            return (
              <button
                key={a.name}
                onClick={() => t.setAccent(a.name)}
                title={a.label}
                aria-label={a.label}
                aria-pressed={active}
                className={cn(
                  'h-6 w-6 rounded-full ring-2 transition-transform hover:scale-110',
                  active ? 'ring-foreground/60' : 'ring-transparent',
                )}
                style={{ background: a.swatch }}
              />
            );
          })}
        </div>
        <div className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">
          当前：{ACCENTS.find((a) => a.name === t.accent)?.label || t.accent}
        </div>
      </div>
    </Popover>
  );
}
