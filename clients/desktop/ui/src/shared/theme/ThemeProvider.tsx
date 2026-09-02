/**
 * ThemeProvider
 *
 * 多主题（宣纸白/墨夜/黛青/雪青）：useTheme() 读取与切换，
 * 写 <html data-theme="..."> 使 tokens.css 的 [data-theme] 覆盖块生效。
 * 只覆盖 L3 色层；语义混合 token 引用基色自动重derive——必须挂在 html 元素上
 * （挂 body 时 :root 级混合 token 已按旧基色解析，不会跟随）。
 *
 * 选择持久化 localStorage("novel.theme")；首帧前同步根属性（useLayoutEffect）
 * 避免暗色主题启动闪白；切换时挂 html.theming 类启用 0.35s 全局颜色过渡
 * （规则在 global.css，400ms 后摘除，避免长期覆盖组件自身 transition）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const THEMES = ["paper", "ink", "celadon", "frost"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "paper";

const STORAGE_KEY = "novel.theme";
const TRANSITION_MS = 400;

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.find((theme) => theme === stored) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // 隐私模式等存储不可用场景静默降级
  }
}

export interface ThemeContextValue {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** 测试用初始主题；缺省读 localStorage（无记录回落默认主题）。 */
  readonly initialTheme?: Theme;
  readonly children: ReactNode;
}

export function ThemeProvider({ initialTheme, children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => initialTheme ?? readStoredTheme(),
  );
  // 首帧前同步根属性：暗色主题不闪默认亮色底
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const transitionTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState((current) => {
      if (current === next) return current;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // 存储不可用：仅本次会话生效
      }
      const root = document.documentElement;
      root.classList.add("theming");
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(
        () => root.classList.remove("theming"),
        TRANSITION_MS,
      );
      return next;
    });
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
