/* 书签导航页：书签实时同步 + 远程导航分组 + 三模式主题 + 二级菜单扁平化 */

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

const REMOTE_SOURCES = [];

const remoteState = {};

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

let flatGroups = [];
let allItems = [];

function collect(root) {
  flatGroups = [];
  for (const node of root) {
    if (node.url) continue;
    const topTitle = node.title || "未命名";
    const direct = [];
    const subs = [];
    for (const child of node.children || []) {
      if (child.url) direct.push({ title: child.title || hostOf(child.url), url: child.url });
      else if (child.children && child.children.length) subs.push(child);
    }
    if (direct.length) flatGroups.push({ title: topTitle, items: direct });
    for (const sub of subs) {
      const items = [];
      walkCollect(sub.children, items);
      if (items.length) {
        flatGroups.push({ title: topTitle + " / " + (sub.title || "未命名"), items });
      }
    }
  }
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

function favEl(item) {
  const wrap = document.createElement("span");
  wrap.className = "fav";
  const img = document.createElement("img");
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.loading = "lazy";
  img.src = "https://" + hostOf(item.url) + "/favicon.ico";
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

let currentView = { type: "all" };
let searchQuery = "";

function render() {
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
    blocks.push(groupBlock(g.title, g.items, ""));
  } else if (currentView.type === "remote") {
    const src = currentView.src;
    const st = remoteState[src.id];
    curGroupEl.textContent = "远程导航 · " + src.name;
    curCountEl.textContent = (st && st.ok ? st.items.length : 0) + " 个链接";
    if (st && st.ok) blocks.push(groupBlock(src.name, st.items, ""));
    else {
      const p = document.createElement("p");
      p.style.cssText = "color:var(--muted);padding:40px 0;text-align:center;";
      p.textContent = "无法访问该导航页（服务未启动或网络不可达），可稍后刷新重试。";
      blocks.push(p);
    }
  }

  blocks.forEach((b) => gridWrap.appendChild(b));
}

function renderSide() {
  sideList.innerHTML = "";
  const mk = (type, label, num, extraCls) => {
    const div = document.createElement("div");
    div.className = "cat" + (extraCls ? " " + extraCls : "");
    div.innerHTML = `<span class="c-ic"></span><span class="c-name"></span><span class="c-num"></span>`;
    div.querySelector(".c-ic").textContent = type === "remote" ? "🌐" : "📁";
    div.querySelector(".c-name").textContent = label;
    div.querySelector(".c-name").title = label;
    if (num !== null) div.querySelector(".c-num").textContent = num;
    const isActive =
      (type === "group" && currentView.type === "group" && currentView.group && currentView.group.title === label) ||
      (type === "remote" && currentView.type === "remote" && currentView.src && currentView.src.name === label);
    if (isActive) div.classList.add("active");
    div.addEventListener("click", () => {
      document.querySelectorAll(".cat").forEach((c) => c.classList.remove("active"));
      div.classList.add("active");
      if (type === "group") currentView = { type: "group", group: flatGroups.find((g) => g.title === label) };
      if (type === "remote") currentView = { type: "remote", src: REMOTE_SOURCES.find((s) => s.name === label) };
      searchInput.value = "";
      searchQuery = "";
      render();
    });
    return div;
  };

  if (REMOTE_SOURCES.length) {
    for (const r of REMOTE_SOURCES) {
      const st = remoteState[r.id];
      const cls = st && !st.ok ? "remote err" : "remote";
      const num = st && st.ok ? st.items.length : null;
      sideList.appendChild(mk("remote", r.name, num, cls));
    }
    const divTop = document.createElement("div");
    divTop.className = "side-divider";
    sideList.appendChild(divTop);
  }

  for (const g of flatGroups) sideList.appendChild(mk("group", g.title, g.items.length));

  sideFoot.textContent = REMOTE_SOURCES.length
    ? "书签实时同步 · 自动更新 · 远程分组已接入"
    : "书签实时同步 · 自动更新";
}

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

function setGreet() {
  const now = new Date();
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${days[now.getDay()]}`;
  const h = now.getHours();
  const hello = h < 6 ? "夜深了" : h < 9 ? "早上好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  greetLine.textContent = dateStr + " · " + hello;
}

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
  if (e.key === "/" && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === "Escape") {
    searchInput.value = "";
    searchQuery = "";
    renderSide();
    render();
  }
});

setGreet();
applyTheme(theme);

chrome.bookmarks.getTree((tree) => {
  collect(tree[0].children || []);
  if (flatGroups.length) currentView = { type: "group", group: flatGroups[0] };
  else if (REMOTE_SOURCES.length) currentView = { type: "remote", src: REMOTE_SOURCES[0] };
  else currentView = { type: "all" };
  renderSide();
  render();
});

(async () => {
  await Promise.all(REMOTE_SOURCES.map(async (src) => {
    remoteState[src.id] = await fetchRemote(src);
  }));
  renderSide();
  render();
})();

if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (theme === "system") render();
  });
}
