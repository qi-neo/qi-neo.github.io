/* =========================================================
   qi-neo 个人主页 · 交互
   - 项目数据：构建时由 scripts/build.py 生成 assets/repos.json（同源）
     页面里的卡片本身就是构建快照，即使 JS 不执行 / 加载失败也有内容
   - 没有运行时 GitHub API 调用 → 没有 60 次/小时限流，也不需要反爬检测
   - 主题 / 卡片光效 / Dock 全部尊重 prefers-reduced-motion
   ========================================================= */
"use strict";

const REPOS_URL = "assets/repos.json";
const CACHE_KEY = "qi-neo-repos-v2";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小时内直接用本地缓存，不再发请求

/* 语言 → CSS class（静态卡片同样用这套 class，避免内联 style 被 CSP 拦） */
const LANG_CLASS = {
  "C++": "cpp", C: "c", "C#": "csharp", Python: "python", JavaScript: "js",
  TypeScript: "ts", Shell: "shell", CMake: "cmake", HTML: "html",
  Rust: "rust", Go: "go"
};

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {
    return false;
  }
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const day = 86400000;
  if (diff < day) return "今天更新";
  if (diff < 30 * day) return Math.floor(diff / day) + " 天前更新";
  if (diff < 365 * day) return Math.floor(diff / (30 * day)) + " 个月前更新";
  return Math.floor(diff / (365 * day)) + " 年前更新";
}

function langDotClass(lang) {
  const key = LANG_CLASS[lang];
  return "lang-dot" + (key ? " lang-" + key : " lang-other");
}

/* 语言占比条：内联 SVG，避免用内联 style（CSP 不允许） */
function buildLangbar(languages) {
  if (!Array.isArray(languages) || !languages.length) return null;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "card-langbar");
  svg.setAttribute("viewBox", "0 0 100 4");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  let x = 0;
  languages.forEach((lang, index) => {
    const width = index === languages.length - 1 ? 100 - x : Number(lang.percent) || 0;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", x.toFixed(2));
    rect.setAttribute("y", "0");
    rect.setAttribute("width", width.toFixed(2));
    rect.setAttribute("height", "4");
    rect.setAttribute("fill", lang.color);
    svg.appendChild(rect);
    x += width;
  });
  return svg;
}

/* ---------- 渲染：全部用 DOM API + textContent，仓库描述里的 < > 不会破版 ---------- */
function renderRepos(repos, mode) {
  const grid = document.getElementById("projects-grid");
  if (!grid || !Array.isArray(repos) || !repos.length) return;

  const frag = document.createDocumentFragment();
  repos.forEach((repo) => {
    const card = document.createElement("article");
    card.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";
    const icon = document.createElement("span");
    icon.className = "card-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = repo.icon || "📦";
    const name = document.createElement("a");
    name.className = "card-name";
    name.href = repo.html_url;
    name.target = "_blank";
    name.rel = "noopener";
    name.textContent = repo.name;
    top.append(icon, name);
    if (repo.version) {
      const version = document.createElement("span");
      version.className = "card-version";
      version.textContent = repo.version;
      top.append(version);
    }

    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = repo.description || "暂无描述";

    let chips = null;
    if (Array.isArray(repo.topics) && repo.topics.length) {
      chips = document.createElement("div");
      chips.className = "card-chips";
      repo.topics.slice(0, 3).forEach((topic) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = topic;
        chips.appendChild(chip);
      });
    }

    const langbar = buildLangbar(repo.languages);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const lang = document.createElement("span");
    lang.className = "lang";
    const dot = document.createElement("span");
    dot.className = langDotClass(repo.language);
    dot.setAttribute("aria-hidden", "true");
    const langText = document.createElement("span");
    langText.textContent = repo.language || "其他";
    lang.append(dot, langText);
    const stars = document.createElement("span");
    stars.className = "card-stars";
    stars.textContent = "★ " + (repo.stargazers_count || 0);
    const updated = document.createElement("span");
    updated.textContent = relativeTime(repo.updated_at);
    meta.append(lang, stars, updated);

    const foot = document.createElement("div");
    foot.className = "card-foot";
    if (repo.detail_url) {
      const detail = document.createElement("a");
      detail.className = "card-link card-link-strong";
      detail.href = repo.detail_url;
      detail.textContent = "项目详情 →";
      const github = document.createElement("a");
      github.className = "card-link";
      github.href = repo.html_url;
      github.target = "_blank";
      github.rel = "noopener";
      github.textContent = "GitHub ↗";
      foot.append(detail, github);
    } else {
      const link = document.createElement("a");
      link.className = "card-link";
      link.href = repo.html_url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "在 GitHub 查看 ↗";
      foot.append(link);
    }

    card.append(top, desc);
    if (chips) card.append(chips);
    if (langbar) card.append(langbar);
    card.append(meta, foot);
    frag.append(card);
  });
  grid.replaceChildren(frag);

  const labels = {
    live: "已同步",
    cache: "本地缓存",
    snapshot: "构建时快照"
  };
  setStatus((labels[mode] || labels.snapshot) + " · 共 " + repos.length + " 个项目");
  updateStats(repos);
  window.dispatchEvent(new CustomEvent("qi-neo:repos-rendered"));
}

function setStatus(text) {
  const status = document.getElementById("projects-status");
  if (status) status.textContent = text;
}

function updateStats(repos) {
  const reposEl = document.querySelector('[data-stat="repos"]');
  const starsEl = document.querySelector('[data-stat="stars"]');
  if (reposEl) reposEl.textContent = repos.length;
  if (starsEl) starsEl.textContent = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
}

/* ---------- 本地缓存（弱网 / 离线时也能保持最新一次的内容） ---------- */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.repos) || !parsed.repos.length) return null;
    return { repos: parsed.repos, t: parsed.t || 0 };
  } catch (e) {
    return null;
  }
}

function writeCache(repos) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), repos: repos }));
  } catch (e) {}
}

/* ---------- 加载项目数据 ---------- */
async function loadProjects() {
  // 详情页 / 404 没有项目网格，不必发请求
  if (!document.getElementById("projects-grid")) return;

  const cached = readCache();

  // 1) 有缓存就立刻画出来（静态内容已存在时这只是等价替换，避免白屏等待）
  if (cached) renderRepos(cached.repos, "cache");
  if (cached && Date.now() - cached.t < CACHE_TTL) return;

  // 2) 后台刷新同源 JSON（构建产物，无第三方、无限流）
  try {
    const res = await fetch(REPOS_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const repos = Array.isArray(data) ? data : data && data.repos;
    if (!Array.isArray(repos) || !repos.length) throw new Error("数据为空");
    writeCache(repos);
    renderRepos(repos, "live");
  } catch (err) {
    // 3) 失败：保留构建时写入的静态卡片，不破坏页面
    console.warn("[repos] 刷新失败，保留构建时快照：", err);
    if (!cached) {
      const grid = document.getElementById("projects-grid");
      const count = grid ? grid.querySelectorAll(".card").length : 0;
      setStatus("构建时快照" + (count ? " · 共 " + count + " 个项目" : ""));
    }
  }
}

/* ---------- 主题切换 ---------- */
function initTheme() {
  const root = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function current() {
    return root.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  function sync() {
    if (!btn) return;
    const isDark = current() === "dark";
    // aria-pressed 表示「深色模式是否开启」，读屏用户能听到状态
    btn.setAttribute("aria-pressed", String(isDark));
    btn.setAttribute("aria-label", isDark ? "切换到浅色主题" : "切换到深色主题");
  }

  sync();
  if (btn) {
    btn.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {}
      sync();
    });
  }

  // 用户没有手动选择过时，跟随系统切换
  if (mq && typeof mq.addEventListener === "function") {
    mq.addEventListener("change", (event) => {
      let saved = null;
      try {
        saved = localStorage.getItem("theme");
      } catch (e) {}
      if (saved) return;
      root.setAttribute("data-theme", event.matches ? "light" : "dark");
      sync();
    });
  }
}

/* ---------- 跟随鼠标的光感 ----------
   作用对象：「关于我」卡片 + 所有项目卡片。
   强度只由「鼠标到卡片边缘的距离」决定，所以鼠标在页面任意位置移动都会
   点亮附近的卡片；每帧最多一次布局读取，鼠标静止时完全不读 DOM。
   注意：不因 prefers-reduced-motion 关闭——这是指针反馈，不是自动播放的动画。 */
function initCardProximity() {
  const RADIUS = 260;   // 距卡片边界多远开始有光（px）
  const FALLOFF = 1.7;  // 越大光衰减越快，光斑越集中
  const GLOW_SELECTOR = ".card, .about-card";

  let targets = [];
  let items = [];
  let raf = null;
  let dirty = true;
  let lastX = null;
  let lastY = null;

  function collect() {
    targets = Array.prototype.slice.call(document.querySelectorAll(GLOW_SELECTOR));
    items = [];
    dirty = true;
  }

  function measure(force) {
    if (!force && !dirty && items.length) return;
    dirty = false;
    items = targets.map((el) => ({ el: el, r: el.getBoundingClientRect() }));
  }

  function paint(cx, cy) {
    measure(false);
    for (let i = 0; i < items.length; i++) {
      const el = items[i].el;
      const r = items[i].r;
      const dx = Math.max(r.left - cx, 0, cx - r.right);
      const dy = Math.max(r.top - cy, 0, cy - r.bottom);
      const dist = Math.hypot(dx, dy);
      const glow = dist < RADIUS ? Math.pow(1 - dist / RADIUS, FALLOFF) : 0;
      if (glow > 0) {
        // 光斑位置夹在卡片内，让边缘聚光朝向鼠标
        const x = Math.max(0, Math.min(cx - r.left, r.width));
        const y = Math.max(0, Math.min(cy - r.top, r.height));
        el.style.setProperty("--mx", x + "px");
        el.style.setProperty("--my", y + "px");
      }
      el.style.setProperty("--glow", glow.toFixed(3));
    }
  }

  function onMove(event) {
    lastX = event.clientX;
    lastY = event.clientY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (lastX === null) return;
      paint(lastX, lastY);
    });
  }

  // 项目卡片被重新渲染后，DOM 节点换了，需要重新收集
  function refresh() {
    collect();
    if (lastX !== null) paint(lastX, lastY);
  }

  collect();
  measure(true);

  document.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("scroll", () => { dirty = true; }, { passive: true });
  window.addEventListener("resize", () => { dirty = true; }, { passive: true });
  window.addEventListener("qi-neo:repos-rendered", refresh);
  document.addEventListener("mouseleave", () => {
    for (let i = 0; i < items.length; i++) items[i].el.style.setProperty("--glow", "0");
  });
}

/* ---------- 苹果风格 Dock：图标放大 + 拖动弹性回弹 ---------- */
function initDock() {
  if (prefersReducedMotion()) return; // 系统要求减少动效时不做放大/回弹
  const dock = document.getElementById("dock");
  if (!dock) return;
  const items = Array.prototype.slice.call(dock.querySelectorAll(".dock-item"));

  function magnify(event) {
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dist = Math.abs(event.clientX - centerX);
      const scale = 1 + Math.max(0, (70 - dist) / 70) * 0.55;
      items[i].style.transform = "scale(" + scale + ")";
    }
  }

  dock.addEventListener("pointerleave", () => {
    for (let i = 0; i < items.length; i++) items[i].style.transform = "scale(1)";
  });

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let curX = 0;
  let curY = 0;
  let activeId = null;
  let rafId = null;

  function elasticReturn() {
    if (rafId) cancelAnimationFrame(rafId);
    for (let i = 0; i < items.length; i++) items[i].style.transform = "scale(1)";
    const k = 0.14;
    const damp = 0.11; // 欠阻尼 → 多段回弹
    let x = curX;
    let y = curY;
    let vx = 0;
    let vy = 0;
    function frame() {
      const ax = -k * x - damp * vx;
      const ay = -k * y - damp * vy;
      vx += ax;
      vy += ay;
      x += vx;
      y += vy;
      dock.style.transform = "translate(calc(-50% + " + x + "px), " + y + "px)";
      if (Math.abs(x) < 0.4 && Math.abs(vx) < 0.4 && Math.abs(y) < 0.4 && Math.abs(vy) < 0.4) {
        curX = 0;
        curY = 0;
        dock.style.transform = "translate(-50%, 0)";
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  dock.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    startX = event.clientX - curX;
    startY = event.clientY - curY;
    activeId = event.pointerId;
  });
  dock.addEventListener("pointermove", (event) => {
    if (!dragging) {
      magnify(event);
      return;
    }
    const nx = event.clientX - startX;
    const ny = event.clientY - startY;
    if (!moved && (Math.abs(nx - curX) > 4 || Math.abs(ny - curY) > 4)) {
      moved = true;
      try {
        dock.setPointerCapture(activeId);
      } catch (e) {}
      dock.style.transition = "none";
    }
    if (moved) {
      curX = nx;
      curY = ny;
      dock.style.transform = "translate(calc(-50% + " + curX + "px), " + curY + "px)";
    } else {
      magnify(event);
    }
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      try {
        dock.releasePointerCapture(activeId);
      } catch (e) {}
      elasticReturn();
    }
  }
  dock.addEventListener("pointerup", endDrag);
  dock.addEventListener("pointercancel", endDrag);
}

/* ---------- 项目详情页：全屏滑动翻阅 ----------
   竖向 slide 用 CSS scroll-snap 实现（无 JS 也能滚），JS 只负责：
   圆点高亮、页码、点圆点跳转、方向键翻页。 */
function initDeck() {
  const deck = document.querySelector(".deck");
  if (!deck) return;
  const slides = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
  if (!slides.length) return;

  const dots = Array.prototype.slice.call(document.querySelectorAll(".deck-nav a"));
  const counter = document.querySelector(".deck-counter");
  const reduce = prefersReducedMotion();
  let active = -1;

  function pad(value) {
    return (value < 10 ? "0" : "") + value;
  }

  function setActive(index) {
    if (index < 0 || index === active) return;
    active = index;
    dots.forEach((dot, i) => dot.setAttribute("aria-current", i === index ? "true" : "false"));
    if (counter) counter.textContent = pad(index + 1) + " / " + pad(slides.length);
  }

  function go(index) {
    const target = slides[Math.max(0, Math.min(slides.length - 1, index))];
    if (!target) return;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(slides.indexOf(entry.target));
      });
    }, { rootMargin: "-48% 0px -48% 0px", threshold: 0 });
    slides.forEach((slide) => observer.observe(slide));
  }
  setActive(0);

  dots.forEach((dot) => {
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.querySelector(dot.getAttribute("href"));
      const index = slides.indexOf(target);
      if (index >= 0) go(index);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === "ArrowDown" || key === "PageDown") {
      event.preventDefault();
      go(active + 1);
    } else if (key === "ArrowUp" || key === "PageUp") {
      event.preventDefault();
      go(active - 1);
    } else if (key === "Home") {
      event.preventDefault();
      go(0);
    } else if (key === "End") {
      event.preventDefault();
      go(slides.length - 1);
    }
  });
}

/* ---------- 横向卡片：拖动/滑动手感 + 圆点 + 左右按钮 ---------- */
function initCarousels() {
  const wraps = document.querySelectorAll("[data-carousel]");
  if (!wraps.length) return;
  const reduce = prefersReducedMotion();

  Array.prototype.forEach.call(wraps, (wrap) => {
    const track = wrap.querySelector(".carousel");
    if (!track) return;
    const items = Array.prototype.slice.call(track.children);
    if (!items.length) return;

    const prev = wrap.querySelector("[data-prev]");
    const next = wrap.querySelector("[data-next]");
    const dotsWrap = wrap.querySelector(".carousel-dots");
    let dots = [];

    if (dotsWrap) {
      dots = items.map((_, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "carousel-dot";
        dot.setAttribute("aria-label", "第 " + (index + 1) + " 张");
        dot.addEventListener("click", () => scrollToIndex(index));
        dotsWrap.appendChild(dot);
        return dot;
      });
    }

    function scrollToIndex(index) {
      const item = items[Math.max(0, Math.min(items.length - 1, index))];
      if (!item) return;
      const trackRect = track.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const left = itemRect.left - trackRect.left + track.scrollLeft - 2;
      track.scrollTo({ left: left, behavior: reduce ? "auto" : "smooth" });
    }

    function currentIndex() {
      const trackRect = track.getBoundingClientRect();
      const center = trackRect.left + trackRect.width / 2;
      let best = 0;
      let bestDist = Infinity;
      items.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const dist = Math.abs(rect.left + rect.width / 2 - center);
        if (dist < bestDist) {
          bestDist = dist;
          best = index;
        }
      });
      return best;
    }

    function sync() {
      const index = currentIndex();
      dots.forEach((dot, i) => dot.setAttribute("aria-current", i === index ? "true" : "false"));
    }

    if (prev) prev.addEventListener("click", () => scrollToIndex(currentIndex() - 1));
    if (next) next.addEventListener("click", () => scrollToIndex(currentIndex() + 1));

    let raf = null;
    track.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        sync();
      });
    }, { passive: true });

    track.setAttribute("tabindex", "0");
    sync();
  });
}

/* ---------- 滚动进场：进入视口后淡入上移 ---------- */
function initReveal() {
  const items = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
  if (!items.length) return;

  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-in"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });

  items.forEach((el) => {
    // 首屏已经在视口里的直接显示，避免加载瞬间闪动
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      el.classList.add("is-in");
    } else {
      observer.observe(el);
    }
  });
}

/* ---------- 启动（各模块独立兜底，单点失败不影响整体） ---------- */
function boot() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  try { initTheme(); } catch (e) { console.warn(e); }
  try { initCardProximity(); } catch (e) { console.warn(e); }
  try { initDock(); } catch (e) { console.warn(e); }
  try { initDeck(); } catch (e) { console.warn(e); }
  try { initCarousels(); } catch (e) { console.warn(e); }
  try { initReveal(); } catch (e) { console.warn(e); }
  try { loadProjects(); } catch (e) { console.warn(e); }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
