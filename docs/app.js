/* 新闻联播每日摘要 - 前端逻辑（纯原生 JS，无框架） */
"use strict";

const $ = (id) => document.getElementById(id);
const state = { dates: [], current: null, data: null, cat: "全部", q: "" };

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

const fmtMD = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const weekdayOf = (dateStr) => WD[new Date(dateStr + "T12:00:00").getDay()];

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
  state.current = d;
  state.cat = "全部";
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

/* ---------- 渲染 ---------- */

function renderDateStrip() {
  const strip = $("dateStrip");
  strip.innerHTML = "";
  // 最多显示最近 14 个有数据的日期，最新的在最右（自动滚到可见）
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
  hideState();
  $("dayMeta").innerHTML =
    `<b>${d.date}</b> 周${d.weekday} ｜ 共 ${d.count} 条 ｜ 更新于 ${d.fetched_at.slice(5, 16)}`;
  $("toolbar").hidden = false;

  // 今日要点
  const hl = d.highlights || [];
  $("highlights").hidden = !hl.length;
  $("hlList").innerHTML = hl.map((h, i) =>
    `<li>${i === 0 && h.gist
      ? `<b>${esc(h.title)}</b><div class="gist">${esc(h.gist)}</div>`
      : esc(h.title)}</li>`).join("");

  renderCatChips();
  renderNews();
}

function renderCatChips() {
  const counts = {};
  for (const it of state.data.items) counts[it.category] = (counts[it.category] || 0) + 1;
  const cats = ["全部", ...Object.keys(state.data.categories)];
  $("catChips").innerHTML = cats.map((c) =>
    `<button class="cat${c === state.cat ? " active" : ""}" data-cat="${esc(c)}">${
      c === "全部" ? `全部 <span class="n">${state.data.count}</span>`
                  : `${c} <span class="n">${counts[c] || 0}</span>`
    }</button>`).join("");
  $("catChips").querySelectorAll(".cat").forEach((b) =>
    b.onclick = () => { state.cat = b.dataset.cat; renderCatChips(); renderNews(); });
}

function renderNews() {
  const q = state.q.trim().toLowerCase();
  const list = state.data.items.filter((it) =>
    (state.cat === "全部" || it.category === state.cat) &&
    (!q || (it.title + " " + it.gist + " " + it.text).toLowerCase().includes(q)));

  const box = $("newsList");
  if (!list.length) {
    box.innerHTML = "";
    showState(q || state.cat !== "全部" ? "没有匹配的新闻，换个条件试试" : "当天没有新闻条目");
    return;
  }
  hideState();
  box.innerHTML = list.map((it) => `
    <article class="news-item cat-${esc(it.category)}">
      <div class="top"><span class="badge">${esc(it.category)}</span></div>
      <h3>${esc(it.title)}</h3>
      ${it.gist ? `<p class="gist">${esc(it.gist)}</p>` : ""}
      <div class="src">来源：央视网 · <a href="${esc(it.url)}" target="_blank" rel="noopener">看原文 ↗</a></div>
    </article>`).join("");
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
  showState("");
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

$("refreshBtn").onclick = async () => {
  const btn = $("refreshBtn");
  btn.classList.add("spinning");
  try {
    await loadIndex(true);
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
  }
  if (state.dates.includes(v)) loadDay(v);
};

let searchTimer;
$("searchInput").oninput = (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value;
    if (state.data) renderNews();
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
