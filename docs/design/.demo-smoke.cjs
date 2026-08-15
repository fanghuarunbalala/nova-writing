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
    url: "file:///D:/workplace/NovelAI-Refact/NovelAI-Event/docs/design/app-redesign-demo.html",
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
assert($$(".tabs button").length === 3, "顶栏三视图 tab");
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
assert($$(".apCard").length === 4, "审批一批 4 张卡片（含 Exit 设计草稿）");
assert(!$(".apCatalog"), "审批无目录列");
assert(doc.body.textContent.includes("提交设计草稿") && $(".apDesign"), "Exit 审批：固定标题 + 设计草稿全文视图");
assert(doc.body.textContent.includes("ExitComposeMode"), "Exit 审批身份行显示工具名");
assert(doc.body.textContent.includes("将被覆盖") && $(".apCurText"), "编辑显示当前内容（将被覆盖的原文）");
assert(doc.body.textContent.includes("将被删除") && doc.body.textContent.includes("碎片 1"), "删除显示既有数据（碎片列表）");
assert(doc.body.textContent.includes("无既有数据"), "纯新建写入标注无既有数据");
click('[data-act="apAdd"]'); // 轮到模板[4] 地点编辑 北桥客栈（含既有档案）
assert(doc.body.textContent.includes("当前内容 · 将被覆盖") && doc.body.textContent.includes("雨夜唯一亮灯的檐下，掌柜记得每个渡客的鞋码。"), "写入/编辑遇既有数据展示当前档案");

// --- 切内容视图：四资料位 ---
click('[data-act="view"][data-id="content"]');
assert($(".segTabs") && $$(".segTabs button").length === 4, "内容视图四资料位 tab");
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
assert($$(".dirRow").length === 4, "人物目录 4 条");
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
assert($(".inspector") && !$(".inspector").classList.contains("closedDock"), "去审批跳回对话并打开审批面板");
click('[data-act="apDecide"][data-id="approve"]');
assert(doc.body.textContent.includes("已处理"), "批准后显示已处理横幅");
click('[data-act="apAdd"]');
assert($$(".apCard").length === 6, "模拟新增审批入列");

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
