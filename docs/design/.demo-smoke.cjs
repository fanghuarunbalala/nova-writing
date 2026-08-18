// jsdom 冒烟：真实执行 demo 内联脚本，切换视图/资料位/审批，断言渲染结果
const path = require("path");
const { JSDOM, VirtualConsole } = require(path.resolve(__dirname, "../../gui/node_modules/jsdom"));

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(
  require("fs").readFileSync(__dirname + "/app-redesign-demo.html", "utf8"),
  {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "file:///D:/workplace/NovelAI-Refact/NovelAI/docs/design/app-redesign-demo.html",
    virtualConsole: vc,
    beforeParse(window) {
      window.structuredClone = window.structuredClone || structuredClone;
      if (!window.Element.prototype.scrollTo) window.Element.prototype.scrollTo = () => {};
      window.onerror = (msg) => errors.push("onerror: " + msg);
    },
  }
);

const { window } = dom;
const doc = window.document;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => [...doc.querySelectorAll(s)];
const assert = (cond, label) => {
  if (cond) console.log("PASS  " + label);
  else { console.log("FAIL  " + label); errors.push("assert: " + label); }
};
const click = (sel) => {
  const el = $(sel);
  if (!el) { errors.push("click target missing: " + sel); return false; }
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  return true;
};

// --- 初始渲染（对话视图 + Win 窗控 + 审批面板开） ---
assert($$(".tabs button").length === 4, "顶栏四视图 tab");
assert($$(".winCtl button").length === 3, "Windows 三窗口按钮（最小化/最大化/关闭）");
assert($(".composer") && $(".composer textarea"), "聊天输入框");
assert($(".modeRow .sendBtn") && $(".modeRow .pauseBtn"), "发送/暂停在输入框底栏");
assert($(".composerBox").lastElementChild.classList.contains("modeRow"), "模式行在聊天框最底部");
assert($(".modeBtn"), "模式按钮（点击弹出列表）");
click('[data-act="modeMenu"]');
assert($$(".modeItem").length === 3, "模式下拉 3 项（图标+名称+说明）");
click('[data-act="modePick"][data-id="bypass"]');
assert(doc.body.textContent.includes("待生效"), "选择模式显示「待生效」chip");
assert($(".draftPanel") && $(".toolLine"), "草稿面板与工具行");
assert($(".sysMsg"), "审批系统消息");
// v0.8 审批整体弹窗：点时间线胶囊同步唤起（自动弹出走 boot 后 1.1s，冒烟不等）
click('[data-act="apModalOpen"]');
assert($(".apModal") && $$(".apListItem").length === 4, "审批弹窗：左清单 4 项（含设计草稿）");
assert($(".apDetail") && $$(".apListItem.active").length === 1, "右详情渲染当前选中组（清单单选高亮）");
assert(!$(".apCatalog"), "审批无目录列");
// 清单序：[0] Exit 设计草稿（初始选中）→ [1] 正文编辑 → [2] 删除 → [3] 角色写入
assert($(".apDetail").textContent.includes("提交设计草稿") && $(".apDesign"), "Exit 审批：固定标题 + 设计草稿全文视图");
assert($(".apDetail").textContent.includes("ExitComposeMode"), "Exit 审批身份行显示工具名");
click('[data-act="apSel"][data-id="1"]');
assert($(".apDetail").textContent.includes("将被覆盖") && $(".apCurText") && $(".apDetail").textContent.includes("雨幕里，林晚沿着河街奔逃"), "编辑显示当前内容（将被覆盖的原文）");
click('[data-act="apSel"][data-id="2"]');
assert($(".apDetail").textContent.includes("将被删除") && $(".apDetail").textContent.includes("碎片 1"), "删除显示既有数据（碎片列表）");
click('[data-act="apSel"][data-id="3"]');
assert($(".apDetail").textContent.includes("无既有数据"), "纯新建写入标注无既有数据");
click('[data-act="apLater"]');
assert($("#apAlertBar") && $("#apAlertBar").style.display === "flex", "稍后处理 → 挂起提示条常驻唤回");

// --- 切内容视图：四资料位（作用域 #sidebar：chat 右栏内容目录同样用 segTabs/dirRow） ---
click('[data-act="view"][data-id="content"]');
assert($("#sidebar .segTabs") && $$("#sidebar .segTabs button").length === 4, "内容视图四资料位 tab");
assert($(".inspector").classList.contains("closedDock"), "切到内容视图审批面板隐藏");
assert($$(".treeRow").length >= 10 && $(".treeChildren") && $(".treeTick"), "大纲树嵌套层级 + 引导线渲染");
assert($(".paneBody .unitHead"), "大纲单元详情渲染");

click('[data-act="contentTab"][data-id="manuscript"]');
assert($$(".dirRow").length >= 8, "正文卷·章目录");
assert($(".chapterTitle h2"), "正文阅读区章节标题");
assert($$(".draftBlock").length >= 1, "草稿段落块标记");
click('[data-act="chapSel"][data-id="c4"]');
assert(doc.body.textContent.includes("本章受阻"), "受阻章显示受阻横幅");
click('[data-act="chapSel"][data-id="c8"]');
assert(doc.body.textContent.includes("尚未落笔"), "未开笔章显示空态");

click('[data-act="contentTab"][data-id="characters"]');
assert($$("#sidebar .dirRow").length === 4, "人物目录 4 条");
assert($(".profileHead h2"), "人物档案详情");
click('[data-act="charSel"][data-id="ch2"]');
assert($(".profileHead h2").textContent.includes("沈砚"), "选择人物切换详情");

click('[data-act="contentTab"][data-id="locations"]');
assert($(".profileHead h2").textContent.length > 0, "地点档案详情");
assert(doc.body.textContent.includes("尚未关联"), "未关联地点提示");

// 大纲树交互：折叠 + 选中跳正文
click('[data-act="contentTab"][data-id="outline"]');
const before = $$(".treeRow").length;
click('[data-act="treeAll"][data-id="close"]');
const after = $$(".treeRow").length;
assert(after < before, "折叠全部生效");
click('[data-act="treeAll"][data-id="open"]');
click('[data-act="unitSel"][data-id="u1"]');
click('[data-act="jumpChapter"][data-id="c1"]');
assert($(".chapterTitle h2").textContent.includes("第 1 章"), "单元详情跳转正文");

// --- 计划视图 ---
click('[data-act="view"][data-id="plan"]');
assert($(".inspector").classList.contains("closedDock"), "计划视图审批面板保持隐藏");
assert($$(".statCard").length === 6, "计划总览 6 统计卡");
assert($$(".axisRow").length === 2, "规划/实现双状态轴");
assert($$(".progRow").length >= 10, "大纲进度行");
click('[data-act="planSel"][data-id="t1"]');
assert($(".todoCard"), "待办详情卡");
click('[data-act="todoGo"][data-id="t1"]');
assert($(".apModal"), "去审批跳回对话并打开审批弹窗");
click('[data-act="apDecide"][data-id="approve"]');
assert($(".apDetail").textContent.includes("已处理"), "批准后显示已处理横幅");
click('[data-act="apLater"]');
assert($("#apAlertBar") && $("#apAlertBar").style.display === "flex", "稍后处理 → 提示条常驻（3 项待决）");

// --- 书库视图（v0.9 完本解构 · 示例数据） ---
click('[data-act="view"][data-id="library"]');
assert($("#sidebar .dirHead").textContent.includes("书单"), "书库侧栏书单目录");
assert($$("#sidebar .dirRow").length === 4, "书单 4 本（含解析中/失败样例）");
assert(doc.body.textContent.includes("解析失败"), "书单状态 chip（解析失败）");
assert($(".subHead .kicker").textContent.includes("bk_yykj"), "选中书 kicker 显示 bookId");
assert($$(".libTabs button").length === 7, "主区七资料位 tab（卷章并入正文）");
assert($$(".statCard").length >= 5, "总览统计卡（卷/章/分段/字数/自然段）");
assert(doc.body.textContent.includes("已导入") && doc.body.textContent.includes("落库中"), "状态时间线（已导入→落库中→…）");
assert(doc.body.textContent.includes("style.md") && doc.body.textContent.includes("幕级大纲"), "解构产物就绪位");
// 解析中的书：五个产物 tab 禁用 + 进度面板
click('[data-act="libBookSel"][data-id="bk_cywj"]');
assert($$(".libTabs button[disabled]").length === 5, "解析中：大纲/人物/地点/风格/摘录产物 tab 禁用");
assert(doc.body.textContent.includes("conv_12") && /\d+\/\d+ 批/.test(doc.body.textContent), "解析进度面板（后台会话 + 批次进度）");
// 解析失败的书：确定性产物仍可读（卷章/正文）
click('[data-act="libBookSel"][data-id="bk_shiben"]');
assert(doc.body.textContent.includes("解析失败") && doc.body.textContent.includes("重试解析"), "失败书显示原因 + 重试入口");
// 正文（融合卷章）：双栏（左卷章目录 + 右章头/来源幕/分段批卡片/分页）
click('[data-act="libTab"][data-id="paras"]');
assert($$("#main .libDirCol .dirRow").length === 12 && $(".libDetailCol .chapterTitle h2"), "正文双栏：左卷章目录 12 章 + 右章头");
assert(doc.body.textContent.includes("来源幕") && doc.body.textContent.includes("护栏上限 24"), "章头来源幕（解耦提示）+ 护栏注记");
assert($$(".paraCard").length === 6, "分段批卡片（单页 6 批护栏）");
assert(/^bk_[a-z0-9]+-p\d{6}$/.test($(".pid").textContent.trim()), "paragraph id 契约格式（bk_…-pNNNNNN）");
click('[data-act="libChapSel"][data-id="3"]');
assert($$(".paraCard").length >= 1, "章目录切换章");
// 大体量书分页（第 2 章 8 批 → 两页）
click('[data-act="libBookSel"][data-id="bk_beihe"]');
click('[data-act="libTab"][data-id="paras"]');
click('[data-act="libChapSel"][data-id="2"]');
click('[data-act="libParaPage"][data-id="next"]');
assert(doc.body.textContent.includes("第 7–8 批"), "正文分页（下一页第 7–8 批）");
// 风格档案：paragraph id 引用可点跳正文并高亮
click('[data-act="libBookSel"][data-id="bk_yykj"]');
click('[data-act="libTab"][data-id="style"]');
assert($$(".pid").length >= 3 && doc.body.textContent.includes("写 id 契约"), "风格档案含 id 引用 chip + 契约注记");
click('[data-act="libPidJump"][data-id="bk_yykj-p000002"]');
assert($(".paraCard.flash"), "id 引用跳正文并高亮定位");
// 大纲：双栏（左幕级树 + 右单元详情）
click('[data-act="libTab"][data-id="outline"]');
assert($$(".treeRow").length >= 5 && $(".libDirCol"), "大纲双栏：左幕级树");
assert($(".libDetailCol .unitHead h2"), "大纲双栏：右单元详情默认选中");
click('[data-act="libUnitSel"][data-id="bk_yykj-sq2"]');
assert($(".libDetailCol").textContent.includes("掌柜的手抖") && $(".libDetailCol").textContent.includes("意图"), "切换单元 → 详情（意图/梗概）");
// 人物 / 地点：双栏 + 关联幕反查跳转
click('[data-act="libTab"][data-id="chars"]');
assert($$("#main .libDirCol .dirRow").length === 3 && $(".profileHead h2"), "人物资料位：左列表 + 右档案");
click('[data-act="libEntSel"][data-id="bk_yykj-chr2"]');
assert($(".profileHead h2").textContent.includes("掌柜"), "切换人物档案");
assert($$('.refChip[data-act="libUnitGo"]').length >= 1, "人物档案关联幕反查 chips");
click('.refChip[data-act="libUnitGo"]');
assert($(".libDetailCol .unitHead h2").textContent.includes("旧账重启"), "关联幕跳转大纲单元详情");
click('[data-act="libTab"][data-id="locs"]');
assert($$("#main .libDirCol .dirRow").length === 4 && $(".profileHead h2"), "地点资料位：左列表 + 右档案");
// 导入弹窗全流程（默认 导入并解析）
click('[data-act="libImportOpen"]');
assert($("#libImportMask").classList.contains("show") && $$(".libOpt").length === 2, "导入弹窗（解析选项两档）");
click('[data-act="libImportOpt"][data-id="import-only"]');
assert($$(".libOpt.on").length === 1 && $(".libOpt.on").dataset.id === "import-only", "解析选项单选切换（仅导入）");
click('[data-act="libImportOpt"][data-id="analyze"]');
click('[data-act="libImportGo"]');
assert($$("#sidebar .dirRow").length === 5, "导入后书单出现第 5 本");
assert($(".subHead .chip").textContent.includes("解析中"), "新书状态 = 解析中（导入即写 meta）");
// demo 控制条：解析进度重放
assert($('[data-act="libReplay"]'), "控制条书库示例组");
click('[data-act="libReplay"]');
assert($(".subHead .kicker").textContent.includes("bk_cywj") && doc.body.textContent.includes("解析进度"), "重放复位长夜余烬为解析中");

// --- 平台切换 / 窗控 / 主题 / 宽度 ---
click('[data-act="platform"][data-id="mac"]');
assert($$(".traffic .tl").length === 3, "macOS 红绿灯");
assert($$(".winCtl").length === 0, "切 mac 后无 Windows 窗控");
click('[data-act="wClose"]');
assert($(".closedMask").classList.contains("show"), "关闭出现退出遮罩");
click('[data-act="reopen"]');
click('[data-act="theme"][data-id="ink"]');
assert(doc.documentElement.dataset.theme === "ink", "切墨夜主题");
click('[data-act="simw"][data-id="1080px"]');
assert($(".stage").classList.contains("sim"), "模拟窗口宽度");
click('[data-act="settingsOpen"]');
assert($(".dialogMask").classList.contains("show"), "设置弹窗打开");
assert($$(".themeCard").length === 4, "设置·外观 4 主题卡");
// v0.9 设置·模型：profile 列表 + 能力自动识别 + 覆盖
click('[data-act="settingsTab"][data-id="models"]');
assert($$(".profCard").length === 3, "模型服务 3 张 profile 卡");
assert(doc.body.textContent.includes("deepseek-v4-flash") && doc.body.textContent.includes("claude-opus-5"), "profile 显示模型 ID");
assert(doc.body.textContent.includes("能力覆盖 1 项"), "gpt-5 能力覆盖标记（maxOut 示例）");
click('[data-act="profEdit"][data-id="p1"]');
assert(doc.body.textContent.includes("编辑模型服务") && $(".capFoldHead"), "编辑表单展开");
click('[data-act="capFold"]');
assert($("#pfCapMaxOut") && $("#pfCapMaxOut").placeholder.includes("8,192"), "能力高级区：maxOut 自动识别 placeholder");
assert($("#pfDetectLine").textContent.includes("reasoning-effort"), "识别行显示思考模式");
const pm = doc.querySelector('[data-pf="model"]');
pm.value = "totally-unknown-model";
pm.dispatchEvent(new window.Event("input", { bubbles: true }));
assert($("#pfDetectLine").textContent.includes("未能"), "未知模型识别提示切换");
assert($("#pfCapMaxOut").placeholder.includes("兜底"), "未识别模型能力 placeholder 定向刷新为兜底值（不重渲染）");
click('[data-act="profCancel"]');
// v0.9 设置·Agent：模型档位（Normal/Fast）+ 全局默认 + 三卡继承 + 校验/脏态/覆盖
click('[data-act="settingsTab"][data-id="agents"]');
assert($$(".agentCard").length === 3, "Agent 覆盖 3 张卡");
assert(doc.body.textContent.includes("模型档位") && doc.body.textContent.includes("Normal 常规"), "模型档位分区（Normal/Fast）");
assert(doc.querySelector('[data-rk="fast"]').value === "p1", "Fast 档默认绑定 DeepSeek");
assert(doc.querySelector('[data-rk="agents.Explore.profile"]').value === "fast", "Explore 默认使用 Fast 快速档");
assert(doc.body.textContent.includes("继承全局默认（Normal"), "模型下拉含「继承全局默认（Normal…）」");
const at = doc.querySelector('[data-rk="defaults.temperature"]');
at.value = "9";
at.dispatchEvent(new window.Event("input", { bubbles: true }));
assert($("#rtDirty") && $("#rtDirty").style.display === "", "输入后脏态提示出现");
click('[data-act="agentSave"]');
assert($("#toast").textContent.includes("温度"), "非法温度（9）保存被拦截");
at.value = "1.2";
at.dispatchEvent(new window.Event("input", { bubbles: true }));
assert(doc.querySelector('[data-rk="agents.novel.temperature"]').placeholder.includes("1.2"), "全局温度变化 → 继承 placeholder 联动刷新");
click('[data-act="agentSave"]');
assert($("#toast").textContent.includes("对新对话生效"), "合法保存 toast（新对话生效）");
const es = doc.querySelector('[data-rk="agents.Explore.profile"]');
es.value = "p3";
es.dispatchEvent(new window.Event("input", { bubbles: true }));
click('[data-act="agentSave"]');
assert(doc.querySelector(".agentCard.overridden .role").textContent === "Explore", "Explore 指定模型后「已覆盖」标记");
click('[data-act="agentReset"]');
assert(doc.querySelector('[data-rk="agents.Explore.profile"]').value === "fast" && $$(".agentCard.overridden").length === 1, "还原回到上次保存（Explore 仍为 Fast 档）");
click('[data-act="settingsClose"]');

// --- 侧栏开关 ---
click('[data-act="sideToggle"]');
assert($(".sidebar").classList.contains("collapsed"), "侧栏收起");
click('[data-act="sideToggle"]');

// --- 聊天发送（先生成态守卫：暂停后发送） ---
click('[data-act="view"][data-id="chat"]');
click('[data-act="genPause"]');
const ta = $("#chatInput");
ta.value = "测试发送一条";
ta.dispatchEvent(new window.Event("input", { bubbles: true }));
click('[data-act="send"]');
assert($$("#liveMsgs .msgUser").length === 1, "发送后追加用户气泡");

// --- AskUserQuestion 流内提问卡（与审批右栏互不影响） ---
assert($("#askGroupCard") && doc.body.textContent.includes("提交回答"), "提问卡初始渲染（pending 交互态）");
assert($("#askToolLine") && $("#askToolLine").textContent.includes("等待作答"), "提问工具行运行态（等待作答）");
click('.opt[data-qid="0"][data-oi="0"]');
assert(doc.querySelector('#askQItem-0 .qPill').classList.contains("chosen"), "单选点选后该问 pill 变已选");
const askOpenTa = doc.querySelector('.openInput[data-qid="3"]');
askOpenTa.value = "雾散了，渡口第一次来了一艘不认得的船";
askOpenTa.dispatchEvent(new window.Event("input", { bubbles: true }));
assert(doc.querySelector('[data-act="askSubmit"]').textContent.includes("2/4"), "开放题输入后提交计数刷新（2/4）");
click('[data-act="askSubmit"]');
assert(doc.querySelector("#askScene .recList") && $$("#askScene .recRow").length === 4, "提交后留痕为题目→答案行（4 行）");
assert($(".sysMsg.ok"), "收口胶囊（作者已作答）");
assert($("#askToolLine").textContent.includes("已作答"), "提问工具行转完成态");
click('[data-act="apModalOpen"]');
assert($$(".apListItem").length === 4, "提问交互不影响审批清单（弹窗重开仍 4 项）");
click('[data-act="apLater"]');
click('[data-act="askReplay"]');
assert($("#askGroupCard") && !$(".sysMsg.ok") && $("#askToolLine").textContent.includes("等待作答"), "重放提问恢复 pending 态");

setTimeout(() => {
  assert($$("#liveMsgs .msgAssistant").length === 1, "演示助手回复延迟出现");
  // 模式下拉原地切换不丢输入；审批挂起态文案
  const ta2 = $("#chatInput");
  if (ta2) ta2.value = "未发送的草稿";
  click('[data-act="modeMenu"]');
  click('[data-act="modePick"][data-id="review"]');
  assert($("#chatInput") && $("#chatInput").value === "未发送的草稿", "切模式不重渲染不丢输入");
  assert(doc.body.textContent.includes("待生效"), "待生效 chip 常驻显示");
  click('[data-act="genSet"][data-id="waiting"]');
  const lbl = doc.querySelector(".rsRow.waiting .rsLabel");
  assert(lbl && lbl.textContent.trim() === "正在审批", "审批挂起态文案 = 正在审批");
  click('[data-act="genSet"][data-id="generating"]');
  assert(doc.querySelector(".rsRow.generating .rsLabel"), "切回正在生成");
  console.log("");
  if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("=== ALL SMOKE TESTS PASSED ===");
  process.exit(0);
}, 700);
