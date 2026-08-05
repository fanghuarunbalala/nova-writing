/**
 * ThemeProvider
 *
 * 提供 useTheme() 读取与切换主题。通过 effect 设置 <html data-theme="..."> 根属性，
 * 使 [data-theme] 选择器（dark 调色板预留）生效。V1 仅实现 light。
 *
 * 注意：spec 草稿中渲染 <html> 节点在 React 下会产生嵌套 html，这里按文档意图
 * （设置根属性）以 document.documentElement 实现。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

export interface ThemeContextValue {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  readonly initialTheme?: Theme;
  readonly children: ReactNode;
}

export function ThemeProvider({ initialTheme = "light", children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
