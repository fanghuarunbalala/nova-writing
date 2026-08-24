#!/usr/bin/env node
/**
 * novel-fetch —— 网文平台信息工具箱（MCP stdio server，当前支持起点中文网）
 *
 * 数据通路：移动端 SSR pageContext（https://m.qidian.com/... 页面内嵌
 * `<script id="vite-plugin-ssr_pageContext">` JSON）——免浏览器、规避 PC 站
 * 验证码风控。通路验证于 2026-08-24（rank/book/search/author/chapter 全通，
 * 见 PRD novel-fetch-外部工具 §0）。
 *
 * 工具：novel_fetch（单工具多 action）
 *   - search   kw 关键词 → 书/作者搜索结果
 *   - book     book_id 或书页 URL → 书详情（简介/基础信息/月票/推荐票/收藏 + 最近章节）
 *   - catalog  book_id 或书页 URL + 可选 volume → 目录（卷概览+最近 10 章 / 指定卷全部章节，链接可直接传 chapter）
 *   - rank     rank_type + page → 排行榜 TOP 列表
 *   - author   author 作者名或作者页 URL → 作者作品列表
 *   - chapter  url 章节页 URL → 正文按自然段分片（每片 ≤300 字，带编号）
 *
 * 进程模型：stdio 每会话实例（MCP 生态标准）——无状态、随会话退出回收。
 *
 * 边界：仅起点域名；VIP 未订阅返回限免试读并明示；60s 同目标 URL 防重；
 * 不缓存；失败降级中文错误。
 *
 * 多平台扩展约定：后续支持番茄/晋江等平台时，同 server 扩可选 platform
 * 参数（兼容变更），不改工具名。
 */
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const MOBILE_BASE_URL = "https://m.qidian.com";

const MOBILE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
};

/** 起点域名白名单 */
const QIDIAN_HOST_RE = /(^|\.)qidian\.com$/;

/** 单请求超时（毫秒） */
const FETCH_TIMEOUT_MS = 15000;
/** 同目标 URL 防重窗口（毫秒） */
const DEDUP_WINDOW_MS = 60000;
/** 分片单条限长（字） */
const SEGMENT_MAX_CHARS = 300;
/** 排行榜单页条目上限 */
const RANK_MAX_RESULTS = 50;

/** 榜单类型映射（移动端路径，复用 oh-story-claudecode 验证过的映射） */
const RANK_TYPES = {
  yuepiao: { label: "月票榜", path: "/rank/yuepiao/" },
  recom: { label: "推荐票榜", path: "/rank/rec/" },
  hotsales: { label: "畅销榜", path: "/rank/hotsales/" },
  readindex: { label: "阅读指数榜", path: "/rank/readindex/" },
  newbook: { label: "新书榜", path: "/rank/newbook/" },
  sign: { label: "签约榜", path: "/rank/sign/" },
  newauthor: { label: "新人榜", path: "/rank/newauthor/" },
  newfans: { label: "书友榜", path: "/rank/newfans/" },
  sanjiang: { label: "三江推荐", path: "/sanjiang/" },
};

// ---------------------------------------------------------------------------
// 网络与解析
// ---------------------------------------------------------------------------

/** 防重表：目标 URL → { 抓取时间戳, pageData }（60s 窗口内复用，防高频打目标站） */
const recentFetches = new Map();

/**
 * 抓取移动端页面并提取 SSR pageContext JSON。
 * 60s 防重窗口内同 URL 直接复用上次结果（catalog 概览→指定卷等连续调用同页场景）；
 * 复用为进程内内存对象，不落盘、不跨进程。
 * @param {string} pathname 移动端路径（如 /rank/yuepiao/）或完整 URL
 * @returns {Promise<{ pageData: object }>} pageData 可能为空对象
 */
async function fetchMobilePage(pathname) {
  const url = pathname.startsWith("http") ? pathname : `${MOBILE_BASE_URL}${pathname}`;

  const last = recentFetches.get(url);
  const now = Date.now();
  if (last !== undefined && now - last.ts < DEDUP_WINDOW_MS) {
    return { pageData: last.pageData };
  }

  const res = await fetch(url, {
    headers: MOBILE_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`抓取失败（HTTP ${res.status}）：${res.statusText || "请稍后再试"}`);
  }
  const html = await res.text();

  const m = html.match(
    /<script[^>]+id=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) {
    throw new Error("页面解析失败：未找到 SSR 数据（页面可能改版或被拦截），请稍后再试");
  }
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error("页面解析失败：SSR 数据格式异常，请稍后再试");
  }
  const pageData = data?.pageContext?.pageProps?.pageData ?? {};
  recentFetches.set(url, { ts: now, pageData });
  return { pageData };
}

/** 多字段名取值兜底（起点字段多态普遍：bName/bookName、bid/bookId…） */
function first(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

/** 简介清洗：去 HTML 标签、折叠空白，超 max 字在句末截断 */
function cleanDesc(raw, max = 100) {
  const desc = String(raw || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (desc.length <= max) return desc;
  const cut = desc.slice(0, max);
  const sentence = cut.match(/^[\s\S]*[。！？]/);
  return (sentence ? sentence[0] : cut) + "…";
}

/** 字数格式化：纯数字 → 万单位（6471169 → 647.1万字） */
function formatWords(raw) {
  const v = String(raw || "").trim();
  if (v === "") return "";
  const num = Number(v.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return "";
  if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, "")}万字`;
  return `${Math.round(num)}字`;
}

/** 过滤无效数值（-1 等占位值） */
function validNum(raw) {
  const v = String(raw ?? "").trim();
  if (v === "" || v === "-1" || v === "0") return "";
  return v;
}

/**
 * 正文按自然段分片：起点正文 HTML 为**不闭合**的 `<p>文本<p>文本` 结构，
 * 按 `<p>` 分割取文本；单段 ≤300 字直接成片，超长按句切分。
 * @param {string} rawHtml 章节正文 HTML
 * @returns {string[]} 分片文本数组
 */
function splitSegments(rawHtml) {
  const parts = String(rawHtml || "").split(/<p[^>]*>/i);
  const paras = parts
    .slice(1)
    .map((p) => p.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim())
    .filter(Boolean);
  const segments = [];
  for (const para of paras) {
    if (para.length <= SEGMENT_MAX_CHARS) {
      segments.push(para);
      continue;
    }
    // 超长段落按句末标点切分
    const sentences = para.split(/(?<=[。！？；!?;])/);
    let buf = "";
    for (const s of sentences) {
      if (buf && buf.length + s.length > SEGMENT_MAX_CHARS) {
        segments.push(buf);
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf) segments.push(buf);
  }
  return segments;
}

/** 渲染分片列表（编号 + 字数 + 30 字预览） */
function renderSegments(segments) {
  return segments
    .map((s, i) => `#${i + 1}（约 ${s.length} 字）｜ ${s.slice(0, 30)}${s.length > 30 ? "…" : ""}`)
    .join("\n");
}

/**
 * 校验并规范化章节 URL；支持移动端 `/book/{bid}/{cid}` 与
 * PC `/chapter/{bid}/{cid}/` 双形态。
 * @returns {{ bid: string, cid: string }}
 */
function parseChapterUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`无效的 URL：${rawUrl}`);
  }
  if (!QIDIAN_HOST_RE.test(u.hostname)) {
    throw new Error(`仅支持起点域名（qidian.com），收到：${u.hostname}`);
  }
  const m =
    u.pathname.match(/\/book\/(\d+)\/(\d+)\/?/i) ||
    u.pathname.match(/\/chapter\/(\d+)\/(\d+)\/?/i);
  if (!m) throw new Error(`无法从 URL 解析书 ID 与章节 ID：${rawUrl}`);
  return { bid: m[1], cid: m[2] };
}

// ---------------------------------------------------------------------------
// 各 action 实现
// ---------------------------------------------------------------------------

/** search：关键词搜索书/作者 */
async function actionSearch(kw) {
  if (!kw || !String(kw).trim()) throw new Error("action=search 需要 kw 参数（书名或作者名关键词）");
  const q = encodeURIComponent(String(kw).trim());
  const { pageData } = await fetchMobilePage(`/search?kw=${q}`);
  const books = pageData.bookInfo?.records || [];
  const authors = pageData.author || [];
  const lines = [`搜索「${kw}」结果：`, ""];
  if (Array.isArray(books) && books.length) {
    lines.push(`书籍（${books.length}）：`);
    books.slice(0, 10).forEach((b, i) => {
      const name = first(b, ["bName", "bookName", "title"]);
      if (!name) return;
      const author = first(b, ["bAuth", "authorName", "author"]);
      const cat = first(b, ["cat", "categoryName"]);
      const desc = cleanDesc(first(b, ["desc", "intro"]));
      const bid = first(b, ["bid", "bookId"]);
      lines.push(
        `  ${i + 1}. 《${name}》｜ ${author ? `作者：${author} ｜` : ""}${cat ? `分类：${cat} ｜` : ""}${bid ? `book_id：${bid}` : ""}`,
      );
      if (desc) lines.push(`     简介：${desc}`);
    });
  } else {
    lines.push("未找到匹配的书籍。");
  }
  if (Array.isArray(authors) && authors.length) {
    lines.push("", `作者（${authors.length}）：`);
    authors.slice(0, 5).forEach((a) => {
      const name = first(a, ["aName", "authorName", "name"]);
      const aid = first(a, ["aid", "authorId"]);
      if (name) lines.push(`  ${name}${aid ? `（author_id：${aid}）` : ""}`);
    });
    lines.push("", "查作者作品可用 action=author（传作者名或作者页 URL）");
  }
  return lines.join("\n");
}

/** 解析书 ID：book_id 直用，否则从书页 URL 提取（book/catalog 共用） */
function parseBookId(bookId, url) {
  if (bookId && String(bookId).trim()) return String(bookId).trim();
  if (url) {
    const m = String(url).match(/\/book\/(\d+)\/?/i);
    if (m) return m[1];
    throw new Error(`无法从 URL 解析书 ID：${url}`);
  }
  throw new Error("需要 book_id 参数（或书页 URL）");
}

/** 渲染章节行：序号隐含在章节名中，附字数与可直接传给 action=chapter 的链接 */
function chapterLine(ch, bid, idx) {
  const name = first(ch, ["cN", "chapterName"]);
  const cid = first(ch, ["id", "chapterId"]);
  const cnt = formatWords(first(ch, ["cnt", "wordsCount"]));
  return `${idx}. ${name}${cnt ? `（${cnt}）` : ""}｜ https://m.qidian.com/book/${bid}/${cid}`;
}

/** book：书详情（简介/基础信息/月票/推荐票/收藏 + 最近章节） */
async function actionBook(bookId, url) {
  const bid = parseBookId(bookId, url);

  const { pageData } = await fetchMobilePage(`/book/${bid}/`);
  const bi = pageData.bookInfo;
  if (!bi) throw new Error(`未找到书籍信息（book_id=${bid}）`);
  const lines = [
    `《${first(bi, ["bookName", "bName"])}》`,
    `作者：${first(bi, ["authorName", "bAuth"])}${first(bi, ["authorId", "cAuthorId"]) ? `（author_id：${first(bi, ["authorId", "cAuthorId"])}）` : ""}`,
  ];
  // chanAlias 为拼音子类目（如 dushi），无展示价值；用中文类目字段
  const catMain = first(bi, ["chanName", "cat"]);
  const catSub = first(bi, ["subCateName"]);
  const meta = [
    [catMain, catSub].filter(Boolean).join("·"),
    first(bi, ["bookStatus"]),
    formatWords(first(bi, ["wordsCnt", "showWordsCnt"])),
  ].filter(Boolean);
  if (meta.length) lines.push(`分类/状态/字数：${meta.join(" ｜ ")}`);
  const tags = bi.bookTag || bi.bookLabels;
  if (Array.isArray(tags) && tags.length) lines.push(`标签：${tags.slice(0, 8).join("、")}`);
  const stats = [
    validNum(first(bi, ["monthTicket"])) ? `月票：${first(bi, ["monthTicket"])}` : "",
    validNum(first(bi, ["recomAll", "recomWeek"])) ? `推荐票：${first(bi, ["recomAll", "recomWeek"])}` : "",
    validNum(first(bi, ["clickTotal"])) ? `点击：${first(bi, ["clickTotal"])}` : "",
    validNum(first(bi, ["favoriteCnt", "collect"])) ? `收藏：${first(bi, ["favoriteCnt", "collect"])}` : "",
  ].filter(Boolean);
  if (stats.length) lines.push(stats.join(" ｜ "));
  if (bi.isVip) lines.push("收费：VIP（付费章节）");
  if (bi.isSign || bi.signStatus) lines.push("签约：已签约");
  const desc = cleanDesc(first(bi, ["desc", "intro"]), 300);
  if (desc) lines.push("", `简介：${desc}`);
  // 最近章节（书详情页 SSR 自带 recentChapters，零额外请求）
  const recent = Array.isArray(pageData.recentChapters) ? pageData.recentChapters.slice(0, 5) : [];
  if (recent.length) {
    lines.push("", "最近更新：");
    recent.forEach((ch, i) => lines.push(chapterLine(ch, bid, i + 1)));
    lines.push("", "完整目录可用 action=catalog（传 book_id，可选 volume 列指定卷）。");
  }
  return lines.join("\n");
}

/**
 * catalog：目录浏览。
 * 无 volume：卷概览（序号/卷名/章数/免费·VIP）+ 最近 10 章（卷末倒序收集）；
 * 指定 volume：该卷全部章节（输出链接可直接传 action=chapter）。
 * VIP 判据：卷级 hS（false 免费 / true 需订阅，未订阅仅返回试读）。
 */
async function actionCatalog(bookId, url, volume) {
  const bid = parseBookId(bookId, url);
  const { pageData } = await fetchMobilePage(`/book/${bid}/catalog/`);
  const vs = Array.isArray(pageData.vs) ? pageData.vs : [];
  if (!vs.length) throw new Error(`目录解析失败：未找到卷数据（book_id=${bid}）`);
  const bookName = first(pageData, ["bookName"]) || `book_id=${bid}`;
  const total = first(pageData, ["chapterTotalCnt"]);

  // 指定卷：该卷全部章节
  if (volume !== undefined && volume !== null && volume !== "") {
    const idx = Number(volume);
    if (!Number.isInteger(idx) || idx < 1 || idx > vs.length) {
      throw new Error(`volume 需为 1-${vs.length} 的整数，收到：${volume}`);
    }
    const v = vs[idx - 1];
    const cs = Array.isArray(v.cs) ? v.cs : [];
    const vipMark = v.hS ? "VIP——未订阅仅返回试读" : "免费";
    const lines = [
      `《${bookName}》卷 ${idx}「${first(v, ["vN"])}」：${cs.length} 章 ｜ ${vipMark}`,
      "",
    ];
    cs.forEach((ch, i) => lines.push(chapterLine(ch, bid, i + 1)));
    lines.push("", "抓某章正文：action=chapter + 该章 url。");
    return lines.join("\n");
  }

  // 默认：卷概览 + 最近 10 章（卷倒序、卷内倒序收集）
  const lines = [
    `《${bookName}》目录：${vs.length} 卷${total ? ` · 共 ${total} 章` : ""}`,
    "",
  ];
  vs.forEach((v, i) => {
    lines.push(
      `卷 ${i + 1} ｜ ${first(v, ["vN"])} ｜ ${first(v, ["cCnt"])} 章 ｜ ${v.hS ? "VIP" : "免费"}`,
    );
  });
  const recent = [];
  for (let i = vs.length - 1; i >= 0 && recent.length < 10; i--) {
    const cs = Array.isArray(vs[i].cs) ? vs[i].cs : [];
    for (let j = cs.length - 1; j >= 0 && recent.length < 10; j--) {
      recent.push(cs[j]);
    }
  }
  if (recent.length) {
    lines.push("", "最近更新（卷末倒序）：");
    recent.forEach((ch, i) => lines.push(chapterLine(ch, bid, i + 1)));
  }
  lines.push(
    "",
    `查看某卷章节列表：action=catalog + book_id + volume=N（1-${vs.length}）；`,
    "抓某章正文：action=chapter + 该章 url。",
  );
  return lines.join("\n");
}

/** rank：排行榜 */
async function actionRank(rankType, page) {
  const rt = RANK_TYPES[rankType];
  if (!rt) {
    const available = Object.entries(RANK_TYPES)
      .map(([k, v]) => `${k}（${v.label}）`)
      .join("、");
    throw new Error(`未知榜单类型：${rankType}。可选：${available}`);
  }
  const p = Math.max(1, Number(page) || 1);
  const suffix = p > 1 ? `?page=${p}` : "";
  const { pageData } = await fetchMobilePage(`${rt.path}${suffix}`);
  const records = pageData.records || [];
  if (!records.length) throw new Error(`榜单「${rt.label}」未获取到数据（可能被拦截或页面改版）`);
  const lines = [`【${rt.label}】TOP ${Math.min(records.length, RANK_MAX_RESULTS)}：`, ""];
  records.slice(0, RANK_MAX_RESULTS).forEach((r, i) => {
    const name = first(r, ["bName", "bookName"]);
    if (!name) return;
    const author = first(r, ["bAuth", "author"]);
    const cat = [first(r, ["cat"]), first(r, ["subCat"])].filter(Boolean).join("·");
    const rankVal = first(r, ["rankCnt", "rankValue"]);
    const cnt = first(r, ["cnt", "wordCount"]);
    const bid = first(r, ["bid", "bookId"]);
    lines.push(
      `${i + 1}. 《${name}》｜ ${author ? `作者：${author} ｜` : ""}${cat ? `分类：${cat} ｜` : ""}${cnt ? `字数：${cnt} ｜` : ""}${rankVal ? `${rankVal}` : ""}${bid ? `（book_id：${bid}）` : ""}`,
    );
    const desc = cleanDesc(first(r, ["desc"]));
    if (desc) lines.push(`     简介：${desc}`);
  });
  lines.push("", "查书详情可用 action=book（传 book_id）");
  return lines.join("\n");
}

/** author：作者作品列表（入参：作者名 / 作者页 URL / 纯 author_id） */
async function actionAuthor(authorRef) {
  if (!authorRef || !String(authorRef).trim()) {
    throw new Error("action=author 需要 author 参数（作者名或作者页 URL）");
  }
  let path;
  const ref = String(authorRef).trim();
  const urlMatch = ref.match(/\/author\/(\d+)/);
  if (urlMatch) {
    path = `/author/${urlMatch[1]}`;
  } else if (/^\d+$/.test(ref)) {
    path = `/author/${ref}`;
  } else {
    // 作者名：先搜索拿 author_id，再查作品
    const { pageData } = await fetchMobilePage(`/search?kw=${encodeURIComponent(ref)}`);
    const authors = pageData.author || [];
    const hit =
      (Array.isArray(authors) ? authors : []).find((a) =>
        first(a, ["aName", "authorName", "name"]).includes(ref),
      ) || (Array.isArray(authors) ? authors : [])[0];
    const aid = first(hit, ["aid", "authorId"]);
    if (!aid) throw new Error(`未找到作者「${ref}」，请提供作者页 URL 或 author_id`);
    path = `/author/${aid}`;
  }

  // 注意：作者页 URL 无尾斜杠（带斜杠 404）
  const { pageData } = await fetchMobilePage(path);
  const info = pageData.info;
  const name = first(info, ["aName", "authorName", "name"]) || ref;
  const books = pageData.allBook || [];
  const lines = [`作者「${name}」作品（${Array.isArray(books) ? books.length : 0} 部）：`, ""];
  (Array.isArray(books) ? books : []).slice(0, 30).forEach((b, i) => {
    const bname = first(b, ["bName", "bookName"]);
    if (!bname) return;
    const cat = first(b, ["cat", "chanName"]);
    const status = first(b, ["bookStatus", "status"]);
    const cnt = formatWords(first(b, ["cnt", "wordsCnt"]));
    const bid = first(b, ["bid", "bookId"]);
    lines.push(
      `${i + 1}. 《${bname}》｜ ${cat ? `分类：${cat} ｜` : ""}${status ? `状态：${status} ｜` : ""}${cnt ? `字数：${cnt} ｜` : ""}${bid ? `book_id：${bid}` : ""}`,
    );
  });
  if (lines.length <= 2) lines.push("（暂无作品数据）");
  lines.push("", "查书详情可用 action=book（传 book_id）");
  return lines.join("\n");
}

/** chapter：章节分片抓取（免费全量；VIP 未订阅返回限免试读并明示） */
async function actionChapter(rawUrl) {
  if (!rawUrl || !String(rawUrl).trim()) throw new Error("action=chapter 需要 url 参数（起点章节页 URL）");
  const { bid, cid } = parseChapterUrl(String(rawUrl).trim());
  const { pageData } = await fetchMobilePage(`/book/${bid}/${cid}`);
  const ci = pageData.chapterInfo;
  const bi = pageData.bookInfo;
  if (!ci) throw new Error("章节解析失败：未找到章节内容");
  const content = String(ci.content || "").trim();
  const isBuy = Number(ci.isBuy) === 1;
  const isVip = Boolean(bi?.isVip);

  const bookName = first(bi, ["bookName", "bName"]);
  const chapterName = first(ci, ["chapterName", "cN"]);
  // 章节名通常自带中文序号（chapterOrder 为内部序号，无展示价值）
  const header = [`《${bookName}》${chapterName ? `「${chapterName}」` : ""}`, ""];
  const vipNote = [];
  if (isVip && !isBuy) {
    vipNote.push("⚠ 本书为 VIP 作品，当前返回限免试读内容；完整章节需订阅支持。");
  }
  const segments = splitSegments(content);
  if (!segments.length) {
    return [...header, ...vipNote, "（本段无正文内容）"].join("\n");
  }
  return [
    ...header,
    ...vipNote,
    `共 ${segments.length} 个片段（每片 ≤${SEGMENT_MAX_CHARS} 字）：`,
    "",
    renderSegments(segments),
    "",
    "请作者挑选要收录的片段号（如\"第 1、3 段\"）。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// MCP server 装配（serveStdio 接收工厂函数：每连接创建实例）
// ---------------------------------------------------------------------------

const toolDescription = [
  "网文平台信息工具箱（当前支持起点中文网 qidian.com）：搜索书籍/作者、查询书详情（简介与基础数据）、排行榜（月票/推荐票/畅销/收藏/新书等）、作者作品列表、抓取章节正文分片。供作者查找与参考喜欢的文字（分片按自然段切分，挑选后可作写作参照）。",
  "",
  "## 何时使用",
  "1. 作者想了解某本书的简介/基础信息/月票·推荐票数据（\"这本书讲什么\"\"这本数据怎么样\"）；",
  "2. 作者想看某本书的目录、找某一章（\"诡秘之主第三卷有哪些章\"——catalog 列目录，章节链接可直接接着抓）；",
  "3. 作者想找当前排行榜上的书（\"现在月票榜前十都是什么\"）；",
  "4. 作者想查某个作者写了哪些作品（\"这个作者还有别的书吗\"）；",
  "5. 作者提供起点章节 URL，想参考/收录其中的片段（\"帮我抓下这段\"）；",
  "6. 低优先级供给工具——核心工具无法完成这些查找时才使用。",
  "",
  "## 使用方式",
  "调用时指定 action，按 action 传对应参数：",
  "- action=search：按关键词搜书/作者，传 kw（书名或作者名）；",
  "- action=book：查书详情（简介/分类/字数/状态/月票/推荐票/收藏 + 最近章节），传 book_id 或书页 URL；",
  "- action=catalog：查书目录（卷概览+最近 10 章；传 volume 列指定卷全部章节，输出章节链接可直接传 action=chapter），传 book_id 或书页 URL；",
  "- action=rank：查排行榜，传 rank_type（yuepiao 月票 / recom 推荐票 / hotsales 畅销 / readindex 阅读指数 / newbook 新书 / sign 签约 / newauthor 新人 / newfans 书友 / sanjiang 三江）+ 可选 page；",
  "- action=author：查作者作品列表，传 author（作者名或作者页 URL）；",
  "- action=chapter：抓取章节分片（每片 ≤300 字、带编号），传 url（章节页 URL），返回列表供作者挑选。",
  "",
  "## 边界",
  "- 仅起点域名（www.qidian.com / m.qidian.com 等 qidian.com 及其子域）；",
  "- VIP 章节未订阅只返回限免试读内容并明示提示；",
  "- 即取即用：不缓存、不批量抓取、不存储全文；",
  "- 抓取/解析失败（网络错误/页面改版/风控拦截）返回错误与建议，请作者手动处理。",
].join("\n");

const inputSchema = fromJsonSchema({
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["search", "book", "catalog", "rank", "author", "chapter"],
      description:
        "要执行的操作：search 搜索书籍/作者；book 书详情（简介/基础信息/最近章节）；catalog 目录浏览（卷概览或指定卷章节列表）；rank 排行榜；author 作者作品列表；chapter 章节分片抓取。",
    },
    kw: { type: "string", description: "action=search 时必填：书名或作者名关键词。" },
    url: {
      type: "string",
      description:
        "action=chapter 时必填：起点章节页 URL（如 https://m.qidian.com/book/1041637443/924064845）；action=book / action=author 也可传书页/作者页 URL 代替 id。",
    },
    book_id: { type: "string", description: "action=book 时使用：起点书 ID（数字字符串）。" },
    author: {
      type: "string",
      description: "action=author 时必填：作者名（或作者页 URL / author_id）。",
    },
    rank_type: {
      type: "string",
      enum: Object.keys(RANK_TYPES),
      description: `action=rank 时必填：榜单类型。${Object.entries(RANK_TYPES)
        .map(([k, v]) => `${k}=${v.label}`)
        .join("，")}。`,
    },
    page: { type: "number", description: "action=rank 时可选：页码（默认 1）。" },
    volume: {
      type: "number",
      description:
        "action=catalog 时可选：卷序号（从 1 起）。缺省返回卷概览+最近 10 章；指定后返回该卷全部章节（含可直接传给 action=chapter 的章节链接）。",
    },
  },
  required: ["action"],
  additionalProperties: false,
});

await serveStdio(() => {
  const server = new McpServer(
    { name: "novel-fetch", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "novel_fetch",
    {
      title: "网文平台信息工具箱",
      description: toolDescription,
      inputSchema,
    },
    async (args) => {
      try {
        const { action } = args;
        let text;
        switch (action) {
          case "search":
            text = await actionSearch(args.kw);
            break;
          case "book":
            text = await actionBook(args.book_id, args.url);
            break;
          case "catalog":
            text = await actionCatalog(args.book_id, args.url, args.volume);
            break;
          case "rank":
            text = await actionRank(args.rank_type, args.page);
            break;
          case "author":
            text = await actionAuthor(args.author);
            break;
          case "chapter":
            text = await actionChapter(args.url);
            break;
          default:
            throw new Error(`未知 action：${action}（可选 search/book/rank/author/chapter）`);
        }
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `[novel-fetch] ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
});
