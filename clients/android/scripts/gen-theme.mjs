#!/usr/bin/env node
/**
 * 从 docs/design/android-app-demo.html 的 oklch CSS 变量生成
 * app/src/main/kotlin/nova/agent/app/ui/theme/ThemeColors.kt
 *
 * 规则（与 demo 语义一一对应）：
 *  - 直读 token（20 色/主题）：bg…on-accent，oklch → sRGB hex（culori）
 *  - color-mix(in oklab) 派生 token（10 个/主题）：本脚本内置配方表；
 *      与 B 混合 → oklab 笛卡尔坐标线性插值；与 transparent 混合 → 保色相、alpha=p
 *  - grad-warn-text 三个停点（主题无关）一并换算
 *  - 幂等：输出字节稳定，重跑零 diff
 *
 * 依赖：cd scripts && npm install
 * 运行：clients/android 下执行 node scripts/gen-theme.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, rgb, oklab } from 'culori';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // clients/android
const DEMO = join(ROOT, '..', '..', 'docs', 'design', 'android-app-demo.html');
const OUT = join(ROOT, 'app', 'src', 'main', 'kotlin', 'nova', 'agent', 'app', 'ui', 'theme', 'ThemeColors.kt');

const THEMES = [
  { selector: ':root', kotlin: 'PaperPalette', cn: '宣纸白（默认浅色）' },
  { selector: '[data-theme="ink"]', kotlin: 'InkPalette', cn: '墨夜（暖深色）' },
  { selector: '[data-theme="celadon"]', kotlin: 'CeladonPalette', cn: '黛青（冷深色）' },
  { selector: '[data-theme="frost"]', kotlin: 'FrostPalette', cn: '雪青（冷浅色）' },
];

// 派生 token 配方 —— name: mix(base p% with other|null=transparent)
const MIXES = [
  { name: 'accent9', base: 'accent', p: 0.09, other: 'surface' },
  { name: 'accent8t', base: 'accent', p: 0.08, other: null },
  { name: 'accent11', base: 'accent', p: 0.11, other: 'surface' },
  { name: 'accent45', base: 'accent', p: 0.45, other: null },
  { name: 'warn6', base: 'warn', p: 0.06, other: null },
  { name: 'warn40', base: 'warn', p: 0.40, other: null },
  { name: 'danger12', base: 'danger', p: 0.12, other: 'surface' },
  { name: 'danger32', base: 'danger', p: 0.32, other: null },
  { name: 'chromeBg', base: 'surface', p: 0.82, other: null },
  { name: 'focusRing', base: 'accent', p: 0.42, other: null },
];

// 直读 token：CSS 名 → Kotlin 字段名
const TOKENS = [
  ['bg', 'bg'], ['surface', 'surface'], ['surface-2', 'surface2'],
  ['fg', 'fg'], ['muted', 'muted'], ['faint', 'faint'],
  ['border', 'border'], ['border-strong', 'borderStrong'],
  ['orange', 'orange'], ['accent', 'accent'], ['red', 'red'], ['accent-ink', 'accentInk'],
  ['success', 'success'], ['success-bg', 'successBg'],
  ['warn', 'warn'], ['warn-bg', 'warnBg'],
  ['danger', 'danger'], ['danger-bg', 'dangerBg'],
  ['info', 'info'], ['info-bg', 'infoBg'], ['on-accent', 'onAccent'],
];

// grad-warn-text 停点（demo :root 固定值，主题无关）
const WARN_GRAD = [
  ['warnText1', 'oklch(82% 0.055 85)'],
  ['warnText2', 'oklch(59% 0.07 80)'],
  ['warnText3', 'oklch(68% 0.07 75)'],
];

function extractBlock(html, selector) {
  const idx = html.indexOf(selector);
  if (idx < 0) throw new Error(`selector not found: ${selector}`);
  const open = html.indexOf('{', idx);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after: ${selector}`);
}

function parseVars(block) {
  const vars = new Map();
  for (const m of block.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim());
  }
  return vars;
}

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();

function toHex8(color) {
  const c = rgb(color); // culori rgb 为 0–1 浮点域
  return `0x${hex2((c.alpha ?? 1) * 255)}${hex2(c.r * 255)}${hex2(c.g * 255)}${hex2(c.b * 255)}`;
}

// culori 的 CSS 字符串解析不认 oklch 亮度的百分比写法（97.9% 会被当 97.9 饱和截断），先归一化
function parseCss(raw) {
  return parse(raw.replace(/(\d+(?:\.\d+)?)%/g, (_, n) => String(parseFloat(n) / 100)));
}

function oklabMix(a, b, p) {
  return {
    mode: 'oklab',
    l: a.l + (b.l - a.l) * p,
    a: a.a + (b.a - a.a) * p,
    b: a.b + (b.b - a.b) * p,
  };
}

const html = await readFile(DEMO, 'utf8');
const lines = [];

lines.push('package nova.agent.app.ui.theme');
lines.push('');
lines.push('import androidx.compose.ui.graphics.Color');
lines.push('');
lines.push('/**');
lines.push(' * ★ 本文件由 scripts/gen-theme.mjs 从 docs/design/android-app-demo.html 自动生成，勿手改。');
lines.push(' * 源 token：oklch CSS 变量 → sRGB；color-mix(in oklab) 派生色按同一语义在脚本内计算。');
lines.push(' * 重跑（幂等，应零 diff）：clients/android 下 `node scripts/gen-theme.mjs`');
lines.push(' */');
lines.push('');
lines.push('data class NovaPalette(');
const fieldComments = [];
for (const [css] of TOKENS) fieldComments.push(css);
for (const m of MIXES) fieldComments.push(`color-mix: ${m.base} ${(m.p * 100).toFixed(0)}% + ${m.other ?? 'transparent'}`);
for (let i = 0; i < fieldComments.length; i++) {
  const name = i < TOKENS.length ? TOKENS[i][1] : MIXES[i - TOKENS.length].name;
  lines.push(`    val ${name}: Color,${i < fieldComments.length - 1 ? '' : ''} // ${fieldComments[i]}`);
}
lines.push(')');
lines.push('');

for (const t of THEMES) {
  const vars = parseVars(extractBlock(html, t.selector));
  const okl = {}; // css token → oklab color
  for (const [css] of TOKENS) {
    const raw = vars.get(css);
    if (!raw) throw new Error(`token --color-${css} missing in ${t.selector}`);
    const c = parseCss(raw);
    if (!c) throw new Error(`cannot parse "${raw}" (${t.selector} --color-${css})`);
    okl[css] = oklab(c);
  }
  lines.push(`/** ${t.cn} */`);
  lines.push(`val ${t.kotlin} = NovaPalette(`);
  const parts = [];
  for (const [css, kt] of TOKENS) {
    parts.push(`    ${kt} = Color(${toHex8(okl[css])}), // ${vars.get(css)}`);
  }
  for (const m of MIXES) {
    const base = okl[m.base];
    let color, note;
    if (m.other) {
      color = oklabMix(base, okl[m.other], m.p);
      note = `mix ${m.base} ${(m.p * 100).toFixed(0)}% + ${m.other}`;
    } else {
      color = { ...base, alpha: m.p };
      note = `${m.base} @ ${(m.p * 100).toFixed(0)}% alpha`;
    }
    parts.push(`    ${m.name} = Color(${toHex8(color)}), // ${note}`);
  }
  lines.push(parts.join('\n').replace(/,\s*$/, ','));
  lines.push(')');
  lines.push('');
}

for (const [name, raw] of WARN_GRAD) {
  lines.push(`/** grad-warn-text 停点（主题无关）: ${raw} */`);
  lines.push(`val ${name} = Color(${toHex8(oklab(parseCss(raw)))})`);
  lines.push('');
}

lines.push('val NovaThemePalettes = listOf(PaperPalette, InkPalette, CeladonPalette, FrostPalette)');
lines.push('');

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, lines.join('\n'), 'utf8');
console.log(`written: ${OUT} (${THEMES.length} themes × ${TOKENS.length + MIXES.length} colors + ${WARN_GRAD.length} grad stops)`);
