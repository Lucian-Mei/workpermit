import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  applySkin,
  getSavedSkin,
  saveSkin,
  skinFromPreset,
  SKINS,
  type AccentName,
  type DensityName,
  type FontName,
  type ModeName,
  type RadiusName,
  type SavedSkin,
  type SkinPreset,
  type SurfaceName,
} from './skins';

interface ThemeContextValue {
  skin: SavedSkin;
  mode: ModeName;
  accent: AccentName;
  radius: RadiusName;
  surface: SurfaceName;
  font: FontName;
  density: DensityName;
  customColor?: string;
  skinId?: string;
  /** 一键套用整套皮肤模板 */
  applyPreset: (id: string) => void;
  applyPresetObj: (p: SkinPreset) => void;
  setMode: (m: ModeName) => void;
  setAccent: (a: AccentName) => void;
  setRadius: (r: RadiusName) => void;
  setSurface: (s: SurfaceName) => void;
  setFont: (f: FontName) => void;
  setDensity: (d: DensityName) => void;
  setCustomColor: (hex: string) => void;
  resetCustom: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkinState] = useState<SavedSkin>(() => getSavedSkin());

  useEffect(() => {
    applySkin(skin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((patch: Partial<SavedSkin>) => {
    setSkinState((prev) => {
      const next = { ...prev, ...patch };
      saveSkin(next);
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (id: string) => {
      const p = SKINS.find((s) => s.id === id);
      if (p) update(skinFromPreset(p));
    },
    [update],
  );
  const applyPresetObj = useCallback((p: SkinPreset) => update(skinFromPreset(p)), [update]);
  const setMode = useCallback((m: ModeName) => update({ mode: m, skinId: undefined }), [update]);
  const setAccent = useCallback(
    (a: AccentName) => update({ accent: a, custom: undefined, skinId: undefined }),
    [update],
  );
  const setRadius = useCallback((r: RadiusName) => update({ radius: r, skinId: undefined }), [update]);
  const setSurface = useCallback((s: SurfaceName) => update({ surface: s, skinId: undefined }), [update]);
  const setFont = useCallback((f: FontName) => update({ font: f, skinId: undefined }), [update]);
  const setDensity = useCallback((d: DensityName) => update({ density: d, skinId: undefined }), [update]);
  const setCustomColor = useCallback((hex: string) => update({ custom: hex, skinId: undefined }), [update]);
  const resetCustom = useCallback(() => update({ custom: undefined }), [update]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      skin,
      mode: skin.mode,
      accent: skin.accent,
      radius: skin.radius,
      surface: skin.surface,
      font: skin.font,
      density: skin.density,
      customColor: skin.custom,
      skinId: skin.skinId,
      applyPreset,
      applyPresetObj,
      setMode,
      setAccent,
      setRadius,
      setSurface,
      setFont,
      setDensity,
      setCustomColor,
      resetCustom,
    }),
    [
      skin,
      applyPreset,
      applyPresetObj,
      setMode,
      setAccent,
      setRadius,
      setSurface,
      setFont,
      setDensity,
      setCustomColor,
      resetCustom,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
