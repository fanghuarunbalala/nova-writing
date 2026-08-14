/**
 * @novel/ui Stylelint 配置。
 *
 * 基线：stylelint-config-standard。策略：只保留"功能规则"，
 * 与项目既有风格/机制冲突的一律关闭（接入零噪音）：
 * - notation 三件套（alpha-value/color-function/hue-degree）会改写值，
 *   违背"绝对像素一致"原则；
 * - selector-class-pattern：全局 css 用 kebab、模块 css 用 camelCase
 *   （CSS Modules 惯例）混合，不做统一约束；
 * - declaration-property-value-no-unknown：-var(--x) 负值 token 引用误报；
 * - property-no-vendor-prefix：-webkit-background-clip 是 Safari 文本
 *   渐变的必要前缀；
 * - 其余关闭项（空行/特异性/大小写）为纯风格规则。
 *
 * custom-property-pattern 对齐 tokens.css 命名约定（匹配去掉 -- 后的名字）；
 * color-no-hex 仅作用于 *.module.css（颜色字面量必须走 token），与
 * tests/theme/cssDiscipline.test.ts 规则 a 互为兜底。
 */
export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: ["dist/**"],
  rules: {
    "alpha-value-notation": null,
    "color-function-notation": null,
    "hue-degree-notation": null,
    "selector-class-pattern": null,
    "declaration-block-single-line-max-declarations": null,
    "no-descending-specificity": null,
    "comment-empty-line-before": null,
    "rule-empty-line-before": null,
    "value-keyword-case": null,
    "media-feature-range-notation": null,
    "declaration-property-value-no-unknown": null,
    "declaration-property-value-keyword-no-deprecated": null,
    "custom-property-pattern": "^[a-z]+(-[a-z0-9]+)*$",
    "property-no-vendor-prefix": [
      true,
      // background-clip/backdrop-filter：Safari 文本渐变与毛玻璃必需；appearance：checkbox 样式
      { ignoreProperties: ["background-clip", "backdrop-filter", "appearance"] },
    ],
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global", "local"] }],
  },
  overrides: [
    {
      files: ["src/**/*.module.css"],
      rules: {
        "color-no-hex": true,
      },
    },
  ],
};
