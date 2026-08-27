/* 央视新闻每日摘要 - 前端逻辑（纯原生 JS，无框架）
   每日速览：新闻联播 / 央视财经 来源切换 + 分类浏览 + 搜索
   往期归类：按分类浏览全部历史条目（archive.json） */
"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  dates: [], current: null, data: null,
  view: "daily",                    // daily | archive
  src: "全部",                      // 每日视图来源：全部 | xwlb | jjxxll
  cat: "全部", q: "",
  arch: { data: null, src: "全部", cat: "全部" },
};

const SRC_ORDER = ["xwlb", "jjxxll"];
const SRC_LABEL = { xwlb: "新闻联播", jjxxll: "央视财经" };
const WD = ["日", "一", "二", "三", "四", "五", "六"];

/* ---------- 工具 ---------- */

function toast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms);
}

async function fetchJSON(url) {
  const res = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const weekdayOf = (dateStr) => WD[new Date(dateStr + "T12:00:00").getDay()];
const fmtMD = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/* ---------- 每日视图：来源相关 ---------- */

function srcItems() {
  const d = state.data;
  if (!d || !d.sources) return [];
  const tag = (arr, k) => (arr || []).map((it) =>
    ({ ...it, source: k, sourceName: SRC_LABEL[k] || (d.sources[k] && d.sources[k].name) || k }));
  if (state.src !== "全部") return tag(d.sources[state.src] && d.sources[state.src].items, state.src);
  let out = [];
  for (const k of SRC_ORDER) if (d.sources[k]) out = out.concat(tag(d.sources[k].items, k));
  return out;
}

function srcHighlights() {
  const d = state.data;
  if (!d || !d.sources) return [];
  const tag = (arr, k) => (arr || []).map((h) =>
    ({ ...h, sourceName: SRC_LABEL[k] || (d.sources[k] && d.sources[k].name) || k }));
  if (state.src !== "全部") {
    const s = d.sources[state.src];
    return tag(s && s.highlights, state.src);
  }
  let out = [];
  for (const k of SRC_ORDER) if (d.sources[k]) out = out.concat(tag(d.sources[k].highlights, k));
  return out;
}

function visibleCatOrder(items) {
  const order = [];
  const d = state.data;
  if (d && d.sources) {
    const pushKeys = (cats) => { if (cats) Object.keys(cats).forEach((c) => { if (!order.includes(c)) order.push(c); }); };
    if (state.src !== "全部") pushKeys(d.sources[state.src] && d.sources[state.src].categories);
    else SRC_ORDER.forEach((k) => { if (d.sources[k]) pushKeys(d.sources[k].categories); });
  }
  for (const it of items) if (!order.includes(it.category)) order.push(it.category);
  return order;
}

/* ---------- 加载 ---------- */

async function loadIndex(keepCurrent = false) {
  const idx = await fetchJSON("data/index.json");
  state.dates = idx.dates || [];
  renderDateStrip();
  if (!state.dates.length) {
    showState("还没有数据。GitHub Actions 会在每天 21:30（北京时间）后自动抓取当天内容。");
    return;
  }
  const want = keepCurrent && state.current && state.dates.includes(state.current)
    ? state.current
    : state.dates[state.dates.length - 1];
  await loadDay(want);
}

async function loadDay(d) {
  setView("daily");
  state.current = d;
  state.cat = "全部";
  state.src = "全部";
  state.q = "";
  $("searchInput").value = "";
  renderDateStrip();
  showSkeleton();
  try {
    state.data = await fetchJSON(`data/${d}.json`);
    renderAll();
  } catch (e) {
    showState(`加载 ${d} 失败：${e.message}`, true);
  }
}

/* ---------- 每日视图渲染 ---------- */

function renderDateStrip() {
  const strip = $("dateStrip");
  strip.innerHTML = "";
  for (const d of state.dates.slice(-14)) {
    const b = document.createElement("button");
    b.className = "dchip" + (d === state.current ? " active" : "");
    const dd = d.slice(5).replace("-", "/");
    b.innerHTML = `${dd}<span class="wd">${weekdayOf(d)}</span>`;
    b.onclick = () => loadDay(d);
    strip.appendChild(b);
  }
  strip.scrollLeft = strip.scrollWidth;
}

function renderAll() {
  const d = state.data;
  if (!d) return;
  hideState();
  $("dayMeta").innerHTML =
    `<b>${d.date}</b> 周${d.weekday} ｜ 共 ${d.count} 条 ｜ 更新于 ${d.fetched_at.slice(5, 16)}`;
  $("toolbar").hidden = false;

  const hl = srcHighlights();
  $("highlights").hidden = !hl.length;
  $("hlTitle").textContent = state.src === "全部" ? "⚡ 今日要点" : `⚡ 今日要点 · ${SRC_LABEL[state.src]}`;
  $("hlList").innerHTML = hl.map((h, i) =>
    `<li>${i === 0 && h.gist
      ? `<b>${esc(h.title)}</b><div class="gist">${esc(h.gist)}</div>`
      : esc(h.title)}<span class="hl-src">${esc(h.sourceName)}</span></li>`).join("");

  renderSrcTabs();
  renderCatChips();
  renderNews();
}

function renderSrcTabs() {
  const d = state.data;
  const tabs = [["全部", d.count]];
  for (const k of SRC_ORDER) {
    const s = d.sources && d.sources[k];
    if (s && s.count) tabs.push([k, s.count]);
  }
  $("srcTabs").innerHTML = tabs.map(([k, n]) =>
    `<button class="stab${state.src === k ? " active" : ""}" data-src="${k}">${
      k === "全部" ? "全部" : SRC_LABEL[k]} <span class="n">${n}</span></button>`).join("");
  $("srcTabs").querySelectorAll(".stab").forEach((b) =>
    b.onclick = () => { state.src = b.dataset.src; renderSrcTabs(); renderAll(); });
}

function renderCatChips() {
  const items = srcItems();
  const counts = {};
  for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
  const cats = ["全部", ...visibleCatOrder(items)];
  $("catChips").innerHTML = cats.map((c) =>
    `<button class="cat${c === state.cat ? " active" : ""}" data-cat="${esc(c)}">${
      c === "全部" ? `全部 <span class="n">${items.length}</span>`
                  : `${c} <span class="n">${counts[c] || 0}</span>`
    }</button>`).join("");
  $("catChips").querySelectorAll(".cat").forEach((b) =>
    b.onclick = () => { state.cat = b.dataset.cat; renderCatChips(); renderNews(); });
}

function renderNews() {
  const q = state.q.trim().toLowerCase();
  const list = srcItems().filter((it) =>
    (state.cat === "全部" || it.category === state.cat) &&
    (!q || (it.title + " " + it.gist + " " + (it.text || "")).toLowerCase().includes(q)));

  const box = $("newsList");
  if (!list.length) {
    box.innerHTML = "";
    showState(q || state.cat !== "全部" ? "没有匹配的新闻，换个条件试试" : "当天没有新闻条目");
    return;
  }
  hideState();
  box.innerHTML = list.map((it) => `
    <article class="news-item cat-${esc(it.category)}">
      <div class="top">
        <span class="badge">${esc(it.category)}</span>
        <span class="badge src-badge src-${esc(it.source)}">${esc(it.sourceName)}</span>
      </div>
      <h3>${esc(it.title)}</h3>
      ${it.gist ? `<p class="gist">${esc(it.gist)}</p>` : ""}
      <div class="src">来源：${esc(it.sourceName)} · <a href="${esc(it.url)}" target="_blank" rel="noopener">看原文 ↗</a></div>
    </article>`).join("");
}

/* ---------- 往期归类（归档视图） ---------- */

async function loadArchive() {
  if (state.arch.data) return state.arch.data;
  state.arch.data = await fetchJSON("data/archive.json");
  return state.arch.data;
}

function renderArchive() {
  const A = state.arch;
  const items = A.data.items || [];
  if (!items.length) {
    $("archStats").textContent = "暂无归档数据";
    $("archList").innerHTML = "";
    return;
  }
  const bySrc = { xwlb: 0, jjxxll: 0 };
  for (const it of items) bySrc[it.source] = (bySrc[it.source] || 0) + 1;
  const dates = [...new Set(items.map((it) => it.date))].sort();
  $("archStats").innerHTML =
    `共 <b>${items.length}</b> 条 ｜ ${dates.length} 天（${dates[0]} ~ ${dates[dates.length - 1]}）<br>` +
    `新闻联播 ${bySrc.xwlb || 0} 条 · 央视财经 ${bySrc.jjxxll || 0} 条 ｜ 更新于 ${A.data.updated_at.slice(5, 16)}`;
  renderArchSrcTabs();
  renderArchCatChips();
  renderArchList();
}

function renderArchSrcTabs() {
  const A = state.arch;
  const items = A.data.items || [];
  const tabs = [["全部", items.length]];
  for (const k of SRC_ORDER) {
    const n = items.filter((it) => it.source === k).length;
    if (n) tabs.push([k, n]);
  }
  $("archSrcTabs").innerHTML = tabs.map(([k, n]) =>
    `<button class="stab${A.src === k ? " active" : ""}" data-src="${k}">${
      k === "全部" ? "全部" : SRC_LABEL[k]} <span class="n">${n}</span></button>`).join("");
  $("archSrcTabs").querySelectorAll(".stab").forEach((b) =>
    b.onclick = () => { A.src = b.dataset.src; A.cat = "全部"; renderArchive(); });
}

function renderArchCatChips() {
  const A = state.arch;
  const items = (A.data.items || []).filter((it) => A.src === "全部" || it.source === A.src);
  const counts = {};
  for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
  const cats = ["全部", ...Object.keys(counts)];
  $("archCatChips").innerHTML = cats.map((c) =>
    `<button class="cat${c === A.cat ? " active" : ""}" data-cat="${esc(c)}">${
      c === "全部" ? `全部 <span class="n">${items.length}</span>`
                  : `${c} <span class="n">${counts[c] || 0}</span>`
    }</button>`).join("");
  $("archCatChips").querySelectorAll(".cat").forEach((b) =>
    b.onclick = () => { A.cat = b.dataset.cat; renderArchCatChips(); renderArchList(); });
}

function renderArchList() {
  const A = state.arch;
  const items = (A.data.items || []).filter((it) =>
    (A.src === "全部" || it.source === A.src) &&
    (A.cat === "全部" || it.category === A.cat));
  const byDate = {};
  for (const it of items) (byDate[it.date] = byDate[it.date] || []).push(it);
  const dates = Object.keys(byDate).sort().reverse();
  const box = $("archList");
  if (!dates.length) {
    box.innerHTML = '<div class="empty">该条件下暂无归类内容</div>';
    return;
  }
  box.innerHTML = dates.map((d) => `
    <div class="arch-day">
      <div class="arch-day-head">${d} <span class="wd">周${weekdayOf(d)}</span><span class="n">${byDate[d].length}条</span></div>
      <div class="arch-items">
        ${byDate[d].map((it) => `
          <article class="arch-item cat-${esc(it.category)}">
            <div class="top">
              <span class="badge">${esc(it.category)}</span>
              <span class="badge src-badge src-${esc(it.source)}">${SRC_LABEL[it.source] || it.source}</span>
            </div>
            <h3>${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</h3>
            ${it.gist ? `<p class="gist">${esc(it.gist)}</p>` : ""}
          </article>`).join("")}
      </div>
    </div>`).join("");
}

/* ---------- 视图切换 ---------- */

function setView(v) {
  state.view = v;
  document.querySelectorAll(".vbtn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === v));
  const isArch = v === "archive";
  $("toolbar").hidden = isArch;
  $("newsList").hidden = isArch;
  $("highlights").hidden = isArch;
  $("archiveView").hidden = !isArch;
  if (isArch) {
    hideState();
    if (!state.arch.data) {
      $("archStats").textContent = "加载中…";
      $("archList").innerHTML = "";
      loadArchive().then(renderArchive).catch((e) => showState("归档加载失败：" + e.message, true));
    } else {
      renderArchive();
    }
  } else if (state.data) {
    renderAll();
  }
}

/* ---------- 状态显示 ---------- */

function showState(msg, isError = false) {
  const el = $("stateMsg");
  el.textContent = msg;
  el.className = "state-msg" + (isError ? " error" : "");
  el.hidden = false;
}
function hideState() { $("stateMsg").hidden = true; }
function showSkeleton() {
  $("newsList").innerHTML = "";
  $("highlights").hidden = true;
  $("stateMsg").hidden = true;
  let html = "";
  for (let i = 0; i < 4; i++) html += '<div class="skeleton"></div>';
  $("newsList").innerHTML = html;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- 事件绑定 ---------- */

$("viewSwitch").querySelectorAll(".vbtn").forEach((b) =>
  b.onclick = () => setView(b.dataset.view));

$("refreshBtn").onclick = async () => {
  const btn = $("refreshBtn");
  btn.classList.add("spinning");
  try {
    state.arch.data = null; // 顺带刷新归档缓存
    await loadIndex(true);
    if (state.view === "archive") renderArchive();
    toast("数据已刷新");
  } catch (e) {
    toast("刷新失败：" + e.message);
  } finally {
    btn.classList.remove("spinning");
  }
};

$("datePick").onchange = (e) => {
  const v = e.target.value; // yyyy-mm-dd
  if (!v) return;
  if (!state.dates.includes(v)) {
    toast(`${v} 还没有数据。可在 GitHub 仓库 Run workflow 手动补抓该日期。`);
    return;
  }
  loadDay(v);
};

let searchTimer;
$("searchInput").oninput = (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value;
    if (state.data && state.view === "daily") renderNews();
  }, 180);
};

/* ---------- 启动 ---------- */

(async function init() {
  try {
    await loadIndex();
  } catch (e) {
    showState(`加载失败：${e.message}。请检查网络后点击"刷新"重试。`, true);
  }
})();
