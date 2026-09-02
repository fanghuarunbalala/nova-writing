/**
 * AppearanceSettingsPanel
 *
 * 设置弹窗「外观」分类：主题选择卡片（图标 + 名称 + 一句话定位 + 双色预览点）。
 * 点击即时切换（useTheme → <html data-theme>，global.css 的 html.theming
 * 提供全局颜色过渡）并经 ThemeProvider 持久化 localStorage。
 * 双色预览点为主题调色板固定 hex（预览该主题自身颜色，不随当前主题变化）。
 */
import { Check, Droplets, Moon, Snowflake, Sun, type LucideIcon } from "lucide-react";
import { Icon } from "../shared/primitives/Icon.js";
import { useTheme, type Theme } from "../shared/theme/index.js";
import styles from "./AppearanceSettingsPanel.module.css";

interface ThemeCardMeta {
  readonly id: Theme;
  readonly label: string;
  readonly desc: string;
  readonly icon: LucideIcon;
  /** 双色预览点（该主题渐变首尾的近似色，固定 hex） */
  readonly dots: readonly [string, string];
}

const THEME_CARDS: readonly ThemeCardMeta[] = [
  { id: "paper", label: "宣纸白", desc: "暖白宣纸底 · 朱砂渐变（默认）", icon: Sun, dots: ["#d9a066", "#a0522d"] },
  { id: "ink", label: "墨夜", desc: "暖黑墨底 · 朱砂提亮", icon: Moon, dots: ["#2b2723", "#d0765a"] },
  { id: "celadon", label: "黛青", desc: "青蓝夜底 · 青瓷强调", icon: Droplets, dots: ["#24303a", "#6fc3b7"] },
  { id: "frost", label: "雪青", desc: "冷白瓷底 · 群青强调", icon: Snowflake, dots: ["#d9e2f2", "#4a5fb8"] },
];

export function AppearanceSettingsPanel() {
  const { theme, setTheme } = useTheme();
  return (
    <div className={styles.panel}>
      <p className={styles.hint}>主题即时生效并记住选择（写入本机，不影响项目数据）。</p>
      <div className={styles.grid} role="radiogroup" aria-label="界面主题">
        {THEME_CARDS.map((card) => {
          const active = card.id === theme;
          return (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={styles.card}
              data-active={active}
              onClick={() => setTheme(card.id)}
            >
              <span className={styles.iconWrap}>
                <Icon icon={card.icon} size="md" />
              </span>
              <span className={styles.text}>
                <span className={styles.name}>{card.label}</span>
                <span className={styles.desc}>{card.desc}</span>
              </span>
              <span className={styles.preview} aria-hidden="true">
                <span className={styles.dot} style={{ background: card.dots[0] }} />
                <span className={styles.dot} style={{ background: card.dots[1] }} />
              </span>
              {active ? (
                <span className={styles.check} aria-hidden="true">
                  <Icon icon={Check} size="xs" strokeWidth={2.4} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
