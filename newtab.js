/* 书签导航页：书签实时同步 + 自由加载导航页（自填网址/编辑/删除）+ 收藏夹置顶 + 三模式主题 */

const $ = (id) => document.getElementById(id);

const sideList = $("sideList");
const gridWrap = $("gridWrap");
const curGroupEl = $("curGroup");
const curCountEl = $("curCount");
const searchInput = $("searchInput");
const emptyBox = $("empty");
const clearBtn = $("clearBtn");
const themeBtn = $("themeBtn");
const sideFoot = $("sideFoot");
const greetLine = $("greetLine");
const addNavBtn = $("addNavBtn");
const modalMask = $("modalMask");
const modalTitle = $("modalTitle");
const edName = $("edName");
const edUrl = $("edUrl");
const edErr = $("edErr");
const edDel = $("edDel");
const edOk = $("edOk");
const edCancel = $("edCancel");

/* ---------- 自定义导航源：可自由添加 / 编辑 / 删除，保存在本机 ---------- */
const SOURCE_KEY = "nav_custom_sources_v2";
const PIN_KEY = "nav_pinned_groups_v2";

/* 首次使用时的默认导航源（可在界面里直接编辑或删除） */
const DEFAULT_SOURCES = [
  { id: "r1", name: "192.168.3.91:8899", url: "http://192.168.3.91:8899/" },
  { id: "r2", name: "143.47.123.115:8080", url: "http://143.47.123.115:8080/" },
];

function loadSources() {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((s) => s && typeof s.url === "string" && s.url.trim());
    }
  } catch (e) {}
  try { localStorage.setItem(SOURCE_KEY, JSON.stringify(DEFAULT_SOURCES)); } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_SOURCES));
}

let REMOTE_SOURCES = loadSources();
const remoteState = {}; // id -> {items: [...], ok: bool}

function saveSources() {
  try { localStorage.setItem(SOURCE_KEY, JSON.stringify(REMOTE_SOURCES)); } catch (e) {}
  for (const id of Object.keys(remoteState)) {
    if (!REMOTE_SOURCES.some((s) => s.id === id)) delete remoteState[id];
  }
}

function newId() {
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- 收藏夹置顶（持久化到本机） ---------- */
let pinnedGroups = [];
try {
  const p = JSON.parse(localStorage.getItem(PIN_KEY) || "[]");
  if (Array.isArray(p)) pinnedGroups = p.filter((t) => typeof t === "string");
} catch (e) {}

function savePinned() {
  try { localStorage.setItem(PIN_KEY, JSON.stringify(pinnedGroups)); } catch (e) {}
}
function togglePin(title) {
  const i = pinnedGroups.indexOf(title);
  if (i >= 0) pinnedGroups.splice(i, 1);
  else pinnedGroups.unshift(title); // 新置顶的排最前
  savePinned();
  renderSide();
  render();
}

/* ---------- 图标色板（暖色为主） ---------- */
const PALETTE = [
  "#c76f3d", "#b5673a", "#c0513a", "#b04a3e", "#a86a3f",
  "#8c7a3f", "#5f8a5a", "#4f7d6f", "#4a7294", "#8a6f52"
];
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

/* ---------- 书签收集：穿透系统根 + 二级菜单扁平化 ----------
 * Edge/Chrome 书签树最外层是系统文件夹（收藏夹栏 / 其他书签 / 移动设备书签）。
 * 这里先把这些系统根直接穿透，把它们下面的文件夹当作一级，直接用文件夹名，
 * 不再拼「收藏夹栏 / …」这类长前缀。
 * 一级文件夹：
 *   - 直接书签 → 一个分类（文件夹本身）
 *   - 每个直接子文件夹 → 提升为独立分类（默认用子文件夹名），内容为该子文件夹下全部书签
 * 只有出现重名时才用「父 / 子」消歧。
 */
const SYSTEM_ROOT_TITLES = new Set([
  "收藏夹栏", "书签栏", "其他书签", "移动设备书签",
  "Bookmarks Bar", "Other Bookmarks", "Mobile Bookmarks"
]);

function isSystemRoot(node) {
  return !!node && !!node.children && node.children.length > 0 &&
    SYSTEM_ROOT_TITLES.has((node.title || "").trim());
}

let flatGroups = []; // [{title, items:[{title,url}]}]
let allItems = [];

function collect(root) {
  flatGroups = [];
  // 1) 穿透系统根文件夹，得到真正的一级文件夹
  const levelOne = [];
  for (const node of root) {
    if (!node || node.url) continue;
    if (isSystemRoot(node)) {
      for (const child of node.children) levelOne.push(child);
    } else {
      levelOne.push(node);
    }
  }
  // 2) 组装分组
  const groups = []; // {title, items, parent}
  for (const node of levelOne) {
    if (!node || node.url) continue;
    const topTitle = node.title || "未命名";
    const direct = [];
    const subs = [];
    for (const child of node.children || []) {
      if (child.url) direct.push({ title: child.title || hostOf(child.url), url: child.url });
      else if (child.children && child.children.length) subs.push(child);
    }
    if (direct.length) groups.push({ title: topTitle, items: direct, parent: null });
    for (const sub of subs) {
      const items = [];
      walkCollect(sub.children, items);
      if (items.length) groups.push({ title: sub.title || "未命名", items, parent: topTitle });
    }
  }
  // 3) 重名消歧：同名分类出现多次时，带父级的用「父 / 子」
  const nameCount = {};
  for (const g of groups) nameCount[g.title] = (nameCount[g.title] || 0) + 1;
  for (const g of groups) {
    if (nameCount[g.title] > 1 && g.parent) g.title = g.parent + " / " + g.title;
  }
  flatGroups = groups;
  allItems = [];
  for (const g of flatGroups) {
    for (const it of g.items) allItems.push({ ...it, group: g.title });
  }
}

function walkCollect(nodes, out) {
  for (const n of nodes) {
    if (n.url) out.push({ title: n.title || hostOf(n.url), url: n.url });
    else walkCollect(n.children || [], out);
  }
}

/* ---------- 远程导航拉取 ---------- */
async function fetchRemote(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(src.url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "text/html");
    const links = [];
    const seen = new Set();
    doc.querySelectorAll("a[href]").forEach((a) => {
      const raw = a.getAttribute("href") || "";
      if (/^(javascript:|mailto:|tel:|#)/i.test(raw.trim())) return;
      let abs;
      try { abs = new URL(raw, src.url).href; } catch { return; }
      if (seen.has(abs)) return;
      seen.add(abs);
      const title = (a.textContent || "").trim().replace(/\s+/g, " ") || a.getAttribute("title") || hostOf(abs);
      links.push({ title: title.slice(0, 60), url: abs });
    });
    return { ok: true, items: links };
  } catch (e) {
    return { ok: false, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 元素构建 ---------- */
function favEl(item) {
  const wrap = document.createElement("span");
  wrap.className = "fav";
  const img = document.createElement("img");
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.loading = "lazy";
  const proto = item.url.startsWith("https") ? "https" : "http";
  img.src = proto + "://" + hostOf(item.url) + "/favicon.ico";
  img.onerror = () => {
    wrap.classList.add("fallback");
    wrap.style.background = hashColor(item.title);
    wrap.textContent = (item.title.charAt(0) || "·").toUpperCase();
  };
  wrap.appendChild(img);
  return wrap;
}

function tileEl(item, tag) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = item.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.appendChild(favEl(item));
  const t = document.createElement("div");
  t.className = "t-text";
  const t1 = document.createElement("div");
  t1.className = "t1";
  t1.textContent = item.title;
  const t2 = document.createElement("div");
  t2.className = "t2";
  t2.textContent = hostOf(item.url);
  t.append(t1, t2);
  if (tag) {
    const tagEl = document.createElement("div");
    tagEl.className = "t-tag";
    tagEl.textContent = tag;
    t.appendChild(tagEl);
  }
  a.appendChild(t);
  return a;
}

function groupBlock(title, items, tagPrefix) {
  const block = document.createElement("div");
  block.className = "group-block";
  const h = document.createElement("div");
  h.className = "g-title";
  h.textContent = title;
  const num = document.createElement("span");
  num.className = "g-num";
  num.textContent = items.length + " 项";
  h.appendChild(num);
  const grid = document.createElement("div");
  grid.className = "grid";
  items.forEach((it) => grid.appendChild(tileEl(it, tagPrefix ? tagPrefix + it.group : "")));
  block.append(h, grid);
  return block;
}

/* ---------- 渲染 ---------- */
let currentView = { type: "all" };
let searchQuery = "";

function render() {
  gridWrap.classList.toggle("remote-view", currentView.type === "remote");
  gridWrap.innerHTML = "";
  emptyBox.classList.add("hidden");
  let blocks = [];

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    const hit = (it) => it.title.toLowerCase().includes(q) || hostOf(it.url).toLowerCase().includes(q);
    const bookmarks = allItems.filter(hit);
    const remote = [];
    for (const s of REMOTE_SOURCES) {
      const st = remoteState[s.id];
      if (st && st.ok) for (const it of st.items) if (hit(it)) remote.push({ ...it, group: s.name });
    }
    curGroupEl.textContent = "搜索结果";
    curCountEl.textContent = (bookmarks.length + remote.length) + " 个匹配";
    if (bookmarks.length) blocks.push(groupBlock("书签", bookmarks, ""));
    if (remote.length) blocks.push(groupBlock("远程导航", remote, "来自 "));
    if (!bookmarks.length && !remote.length) emptyBox.classList.remove("hidden");
  } else if (currentView.type === "all") {
    curGroupEl.textContent = "全部书签";
    let total = allItems.length;
    for (const r of REMOTE_SOURCES) if (remoteState[r.id] && remoteState[r.id].ok) total += remoteState[r.id].items.length;
    curCountEl.textContent = total + " 个";
    for (const g of flatGroups) {
      if (g.items.length) blocks.push(groupBlock(g.title, g.items, ""));
    }
    for (const r of REMOTE_SOURCES) {
      const st = remoteState[r.id];
      if (st && st.ok && st.items.length) blocks.push(groupBlock("远程导航 · " + r.name, st.items, ""));
    }
  } else if (currentView.type === "group") {
    const g = currentView.group;
    curGroupEl.textContent = g.title;
    curCountEl.textContent = g.items.length + " 个书签";
    if (g.items.length) blocks.push(groupBlock(g.title, g.items, ""));
    else {
      const p = document.createElement("p");
      p.style.cssText = "color:var(--muted);padding:40px 0;text-align:center;";
      p.textContent = "这个分类下还没有书签。";
      blocks.push(p);
    }
  } else if (currentView.type === "remote") {
    const src = currentView.src;
    const st = remoteState[src.id];
    curGroupEl.textContent = "导航页 · " + src.name;
    curCountEl.textContent = "";

    // 顶部工具栏：在新标签页打开 / 刷新
    const bar = document.createElement("div");
    bar.className = "remote-bar";
    const openBtn = document.createElement("button");
    openBtn.className = "r-btn";
    openBtn.textContent = "↗ 在新标签页打开";
    openBtn.title = "直接打开 " + src.url;
    openBtn.addEventListener("click", () => { window.open(src.url, "_blank"); });
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "r-btn";
    refreshBtn.textContent = "↻ 重新加载";
    refreshBtn.addEventListener("click", () => { refreshSource(src); });
    bar.append(openBtn, refreshBtn);
    blocks.push(bar);

    // 提示：是否抓取到链接
    const tip = document.createElement("p");
    tip.className = "remote-tip";
    if (st && st.ok && st.items.length) {
      tip.textContent = "已抓取到 " + st.items.length + " 个链接，已列在下方；也可直接预览该页面。";
    } else if (st && st.ok) {
      tip.textContent = "已连上该页面，但没找到可抓取的链接（页面可能是动态加载）。下方为实时预览。";
    } else {
      tip.textContent = "未能连接该页面（服务未启动 / 网络不可达 / 需要权限）。下方是实时预览，若空白可点上方按钮在新标签页打开，或点 ✎ 改网址。";
    }
    blocks.push(tip);

    // 抓取到的链接列表（如有）
    if (st && st.ok && st.items.length) {
      blocks.push(groupBlock(src.name, st.items, ""));
    }

    // 内嵌实时预览（iframe）
    const frame = document.createElement("div");
    frame.className = "remote-frame";
    const iframe = document.createElement("iframe");
    iframe.src = src.url;
    iframe.referrerPolicy = "no-referrer";
    iframe.setAttribute("allowfullscreen", "");
    frame.appendChild(iframe);
    blocks.push(frame);
  }

  blocks.forEach((b) => gridWrap.appendChild(b));
}

/* ---------- 侧栏 ---------- */
function renderSide() {
  sideList.innerHTML = "";
  const mk = (type, label, num, extraCls, opts) => {
    opts = opts || {};
    const div = document.createElement("div");
    div.className = "cat" + (extraCls ? " " + extraCls : "");
    div.innerHTML = `<span class="c-ic"></span><span class="c-name"></span><span class="c-act"></span><span class="c-num"></span>`;
    div.querySelector(".c-ic").textContent = type === "remote" ? "🌐" : "📁";
    div.querySelector(".c-name").textContent = label;
    div.querySelector(".c-name").title = label;
    if (num !== null) div.querySelector(".c-num").textContent = num;

    // 操作按钮：📌 置顶（收藏夹）/ ✎ 编辑（导航页）
    const act = div.querySelector(".c-act");
    if (opts.onPin) {
      const pb = document.createElement("button");
      pb.className = "pin-btn" + (opts.pinned ? " on" : "");
      pb.textContent = "📌";
      pb.title = opts.pinned ? "取消置顶" : "置顶到最前";
      pb.addEventListener("click", (e) => { e.stopPropagation(); opts.onPin(); });
      act.appendChild(pb);
    }
    if (opts.onEdit) {
      const eb = document.createElement("button");
      eb.className = "edit-btn";
      eb.textContent = "✎";
      eb.title = "编辑该导航页（网址 / 名称）";
      eb.addEventListener("click", (e) => { e.stopPropagation(); opts.onEdit(); });
      act.appendChild(eb);
    }

    // 恢复当前选中项
    const isActive =
      (type === "group" && currentView.type === "group" && currentView.group && currentView.group.title === opts.id) ||
      (type === "remote" && currentView.type === "remote" && currentView.src && currentView.src.id === opts.id);
    if (isActive) div.classList.add("active");

    div.addEventListener("click", () => {
      document.querySelectorAll(".cat").forEach((c) => c.classList.remove("active"));
      div.classList.add("active");
      if (type === "group") {
        const g = flatGroups.find((x) => x.title === opts.id);
        if (g) currentView = { type: "group", group: g };
      }
      if (type === "remote") {
        const s = REMOTE_SOURCES.find((x) => x.id === opts.id);
        if (s) currentView = { type: "remote", src: s };
      }
      searchInput.value = "";
      searchQuery = "";
      render();
    });
    return div;
  };

  // 1) 自定义导航页（始终在侧栏最顶，可编辑）
  for (const r of REMOTE_SOURCES) {
    const st = remoteState[r.id];
    const cls = st && !st.ok ? "remote err" : "remote";
    const num = st && st.ok ? st.items.length : null;
    sideList.appendChild(mk("remote", r.name, num, cls, { id: r.id, onEdit: () => openEditor(r) }));
  }

  const divTop = document.createElement("div");
  divTop.className = "side-divider";
  sideList.appendChild(divTop);

  // 2) 收藏夹：置顶的排最前（按置顶先后），其余按 Edge 文件夹顺序
  const validPinned = pinnedGroups.filter((t) => flatGroups.some((g) => g.title === t));
  const pinnedSet = new Set(validPinned);
  const rest = flatGroups.filter((g) => !pinnedSet.has(g.title));
  for (const t of validPinned) {
    const g = flatGroups.find((x) => x.title === t);
    if (g) sideList.appendChild(mk("group", g.title, g.items.length, "pin-on", { id: g.title, onPin: () => togglePin(g.title), pinned: true }));
  }
  for (const g of rest) {
    sideList.appendChild(mk("group", g.title, g.items.length, "", { id: g.title, onPin: () => togglePin(g.title), pinned: false }));
  }

  sideFoot.textContent = REMOTE_SOURCES.length
    ? "书签实时同步 · 自动更新 · 导航页可自由加载"
    : "书签实时同步 · 自动更新";
}

/* ---------- 添加 / 编辑导航页弹窗 ---------- */
let editingObj = null; // 正在编辑的源对象（null = 新增）

function openEditor(src) {
  editingObj = src || null;
  modalTitle.textContent = src ? "编辑导航页" : "添加导航页";
  edName.value = src ? src.name : "";
  edUrl.value = src ? src.url : "";
  edErr.classList.add("hidden");
  edDel.classList.toggle("hidden", !src);
  modalMask.classList.remove("hidden");
  edName.focus();
}

function closeEditor() {
  modalMask.classList.add("hidden");
  editingObj = null;
}

function showErr(msg) {
  edErr.textContent = msg;
  edErr.classList.remove("hidden");
}

addNavBtn.addEventListener("click", () => openEditor(null));
edCancel.addEventListener("click", closeEditor);
modalMask.addEventListener("click", (e) => { if (e.target === modalMask) closeEditor(); });

edOk.addEventListener("click", () => {
  const name = edName.value.trim();
  let url = edUrl.value.trim();
  if (!url) { showErr("请填写网址"); return; }
  if (/\s/.test(url)) { showErr("网址不能包含空格"); return; }
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;
  let u;
  try { u = new URL(url); } catch (e) { showErr("网址格式不对，请检查（例如 http://192.168.1.100:8080/）"); return; }
  if (!/^https?:$/.test(u.protocol)) { showErr("仅支持 http / https 开头的网址"); return; }
  if (!u.hostname) { showErr("网址缺少主机名，请检查"); return; }
  const finalName = name || u.hostname || u.host;
  const normalized = u.href;
  if (editingObj) {
    editingObj.name = finalName;
    editingObj.url = normalized;
  } else {
    editingObj = { id: newId(), name: finalName, url: normalized };
    REMOTE_SOURCES.push(editingObj);
  }
  saveSources();
  const s = editingObj;
  closeEditor();
  if (s) refreshSource(s);
});

edDel.addEventListener("click", () => {
  if (!editingObj) return;
  const s = editingObj;
  if (!window.confirm("确定删除导航页「" + s.name + "」吗？")) return;
  REMOTE_SOURCES = REMOTE_SOURCES.filter((x) => x.id !== s.id);
  saveSources();
  if (currentView.type === "remote" && currentView.src && currentView.src.id === s.id) currentView = { type: "all" };
  closeEditor();
  renderSide();
  render();
});

/* ---------- 拉取远程导航 ---------- */
async function refreshSource(src) {
  if (!src) return;
  remoteState[src.id] = await fetchRemote(src);
  if (currentView.type === "remote" && currentView.src && currentView.src.id === src.id) render();
  renderSide();
}

async function fetchAllRemote() {
  await Promise.all(REMOTE_SOURCES.map(async (src) => {
    remoteState[src.id] = await fetchRemote(src);
  }));
  renderSide();
  render();
}

/* ---------- 主题三模式 ---------- */
const THEMES = ["system", "light", "dark"];
const THEME_ICON = { system: "🌓", light: "☀️", dark: "🌙" };
let theme = "system";
try { theme = localStorage.getItem("nav_theme") || "system"; } catch {}

function applyTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t === "system" ? "" : t;
  themeBtn.textContent = THEME_ICON[t] || "🌓";
  themeBtn.title = "主题：跟随系统 / 浅色 / 深色（当前：" + { system: "跟随系统", light: "浅色", dark: "深色" }[t] + "）";
  try { localStorage.setItem("nav_theme", t); } catch {}
}
themeBtn.addEventListener("click", () => {
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  applyTheme(next);
});

/* ---------- 日期与问候 ---------- */
function setGreet() {
  const now = new Date();
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${days[now.getDay()]}`;
  const h = now.getHours();
  const hello = h < 6 ? "夜深了" : h < 9 ? "早上好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  greetLine.textContent = dateStr + " · " + hello;
}

/* ---------- 事件 ---------- */
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  if (searchQuery.trim()) {
    document.querySelectorAll(".cat").forEach((c) => c.classList.remove("active"));
  } else {
    renderSide();
  }
  render();
});
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  renderSide();
  render();
  searchInput.focus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalMask.classList.contains("hidden")) {
    closeEditor();
    return;
  }
  if (e.key === "/" && document.activeElement !== searchInput && document.activeElement !== edName && document.activeElement !== edUrl) {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === "Escape") {
    searchInput.value = "";
    searchQuery = "";
    renderSide();
    render();
  }
});

/* ---------- 启动 ---------- */
setGreet();
applyTheme(theme);

chrome.bookmarks.getTree((tree) => {
  collect(tree[0].children || []);
  // 默认选中第一个书签分类（无书签分类时选中第一个导航页）
  if (flatGroups.length) currentView = { type: "group", group: flatGroups[0] };
  else if (REMOTE_SOURCES.length) currentView = { type: "remote", src: REMOTE_SOURCES[0] };
  else currentView = { type: "all" };
  renderSide();
  render();
});

// 拉取所有导航页
fetchAllRemote();

if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (theme === "system") render();
  });
}
