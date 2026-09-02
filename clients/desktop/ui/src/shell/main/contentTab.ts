/**
 * 内容视图 pane 类型（大纲 / 正文 / 人物 / 地点）。
 *
 * 导航入口只有侧栏「内容」组（ContentSection）；内容视图本身不再渲染
 * 顶部 tab 栏，仅按当前 pane 渲染对应域内容。
 */
export type ContentTab = "outline" | "manuscript" | "characters" | "locations";
