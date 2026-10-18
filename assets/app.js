/* =========================================================
   qi-nee 个人主页 · 项目列表 + 交互光效 + 安全加固
   - 实时拉取 GitHub API（公开仓库自动同步），带本地缓存 + 节流
   - 拉取失败 / 限流 / 机器人访问时使用兜底数据，避免页面打挂
   - 主题切换持久化到 localStorage
   - 鼠标光层（华为沉浸光感）+ 卡片边缘聚光
   - 苹果风格悬浮 Dock：图标放大 + 拖动弹性回弹
   - 安全：CSP 由 HTML meta 控制；本文件负责缓存/节流/反爬/异常兜底
   ========================================================= */

const USERNAME = "qi-neo";

/* =========================================================
   云服务接入（WorkBuddy Cloud Service）
   - 项目缓存从 localStorage 迁移到云端 Database，成为跨访客共享缓存：
     只有“过期/缺失”时才由真实访客拉取 GitHub 并写回云端，其余访客直接读云端，
     大幅降低对 GitHub API 的调用频次与限流风险。
   - endpoint / publishableKey 均为前端可安全携带的公开配置（来自 publicConfig）。
   ========================================================= */
const CLOUD_CONFIG = {
  endpoint: "https://qi-neo-home.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_huTvDbmXP32XTMboDkzpLu_CYtUzVFPVNuRK2omOvKEhnfALojKpjXI"
};
const CLOUD_TTL = 15 * 60 * 1000; // 云端缓存有效期 15 分钟

// 初始化云端客户端（CDN 全局变量 WorkBuddyCloud，由 index.html 的 <script> 提前加载）
let cloud = null;
try {
  if (typeof WorkBuddyCloud !== "undefined" && WorkBuddyCloud && WorkBuddyCloud.createWorkBuddyCloud) {
    cloud = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: CLOUD_CONFIG.endpoint,
      oauthRelayBaseUrl: CLOUD_CONFIG.oauthRelayBaseUrl,
      publishableKey: CLOUD_CONFIG.publishableKey
    });
  }
} catch (e) {
  console.warn("[cloud] 客户端初始化失败，将回退到本地缓存：", e);
  cloud = null;
}

// 读取云端缓存：命中且未过期则直接返回 repos，否则返回 null
async function readCloudCache() {
  if (!cloud) return null;
  try {
    const { data, error } = await cloud.database
      .from("github_repos_cache")
      .select("username, repos, updated_at")
      .eq("username", USERNAME)
      .maybeSingle();
    if (error) { console.warn("[cloud] 读取失败：", error); return null; }
    if (data && Array.isArray(data.repos)) {
      const age = Date.now() - new Date(data.updated_at).getTime();
      if (age < CLOUD_TTL) return data.repos; // 新鲜缓存，直接复用
    }
    return null; // 缺失或过期
  } catch (e) {
    console.warn("[cloud] 读取异常：", e);
    return null;
  }
}

// 写回云端缓存（命中 username 主键则更新，否则插入）
async function writeCloudCache(repos) {
  if (!cloud || !repos || !repos.length) return;
  try {
    const { error } = await cloud.database
      .from("github_repos_cache")
      .upsert({ username: USERNAME, repos, updated_at: new Date().toISOString() })
      .select();
    if (error) console.warn("[cloud] 写回失败：", error);
  } catch (e) {
    console.warn("[cloud] 写回异常：", e);
  }
}

// 兜底数据：与当前 GitHub 公开仓库保持一致（离线 / 限流 / 机器人访问时展示）
const FALLBACK_REPOS = [
  {
    name: "active-suspension-lidar-preview",
    description: "基于激光雷达路面预瞄的主动悬架系统",
    language: "C++",
    stargazers_count: 1,
    updated_at: "2026-10-18T12:18:35Z",
    html_url: "https://github.com/qi-neo/active-suspension-lidar-preview",
    icon: "🚗"
  },
  {
    name: "unilidar-driver",
    description:
      "Unitree L1 LiDAR ROS2 driver with self-implemented UDP protocol parsing — no official static library",
    language: "C++",
    stargazers_count: 0,
    updated_at: "2026-10-15T08:43:53Z",
    html_url: "https://github.com/qi-neo/unilidar-driver",
    icon: "📡"
  },
  {
    name: "maixcam-esp32-tcp-stepper-motor",
    description: "Maixcam Pro + ESP32 通过 socket TCP 通信控制步进电机",
    language: "C++",
    stargazers_count: 1,
    updated_at: "2026-10-12T02:56:53Z",
    html_url: "https://github.com/qi-neo/maixcam-esp32-tcp-stepper-motor",
    icon: "⚙️"
  }
];

// 语言 -> GitHub 官方配色（用于语言圆点）
const LANG_COLORS = {
  "C++": "#f34b7d", C: "#555555", Python: "#3572A5", "C#": "#178600",
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Shell: "#89e051",
  CMake: "#DA3434", HTML: "#e34c26", Rust: "#dea584", Go: "#00ADD8"
};

const ICONS_BY_KEYWORD = [
  { test: /lidar|雷达|unilidar/i, icon: "📡" },
  { test: /suspension|悬架|car|车辆/i, icon: "🚗" },
  { test: /motor|步进|esp32|esp/i, icon: "⚙️" },
  { test: /camera|cam|视觉|image/i, icon: "📷" },
  { test: /ros/i, icon: "🤖" }
];

function pickIcon(repo) {
  const hay = (repo.name + " " + (repo.description || "")).toLowerCase();
  for (const rule of ICONS_BY_KEYWORD) {
    if (rule.test.test(hay)) return rule.icon;
  }
  return "📦";
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const day = 86400000;
  if (diff < day) return "今天更新";
  if (diff < 30 * day) return Math.floor(diff / day) + " 天前更新";
  if (diff < 365 * day) return Math.floor(diff / (30 * day)) + " 个月前更新";
  return Math.floor(diff / (365 * day)) + " 年前更新";
}

/* =========================================================
   安全加固：全局异常兜底（任何脚本错误都被隔离，绝不白屏）
   ========================================================= */
window.addEventListener("error", (e) => {
  console.warn("[security] 已隔离页面脚本异常：", e && e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.warn("[security] 已隔离未处理的 Promise 异常：", e && e.reason);
});

/* =========================================================
   安全加固：GitHub 数据缓存 + 节流（防止限流 403 把页面打挂）
   ========================================================= */
const CACHE_KEY = "qi-neo-repos-cache";
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟
let fetching = false;

function getCached() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && Array.isArray(c.repos) && Date.now() - c.t < CACHE_TTL) return c.repos;
  } catch (_) {}
  return null;
}
function setCache(repos) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), repos }));
  } catch (_) {}
}

// 带在途锁的拉取，避免并发重复请求（节流的第一道闸）
async function fetchRepos() {
  if (fetching) return null;
  fetching = true;
  try {
    const res = await fetch(
      `https://api.github.com/users/${USERNAME}/repos?sort=updated&per_page=100&type=public`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const all = await res.json();
    const repos = all
      .filter((r) => !r.fork && r.name.toLowerCase() !== USERNAME.toLowerCase())
      .map((r) => ({
        name: r.name,
        description: r.description,
        language: r.language,
        stargazers_count: r.stargazers_count,
        updated_at: r.updated_at,
        html_url: r.html_url
      }));
    if (!repos.length) throw new Error("empty");
    return repos;
  } catch (err) {
    console.warn("[security] GitHub 实时拉取失败：", err);
    return null;
  } finally {
    fetching = false;
  }
}

/* =========================================================
   安全加固：机器人 / 无头浏览器特征识别（反爬）
   命中则只返回兜底数据，避免消耗 API 配额 / 被限流
   ========================================================= */
function isBot() {
  const n = navigator, w = window;
  if (n.webdriver) return true;
  if (!n.languages || n.languages.length === 0) return true;
  if (/Headless|PhantomJS|selenium|Playwright|Puppeteer|jsdom/i.test(n.userAgent)) return true;
  // 无头浏览器常被检测为 0 尺寸窗口
  if (typeof w.outerWidth === "number" && w.outerWidth === 0 && w.outerHeight === 0) return true;
  // 缺少触控/指针能力且 UA 极简，大概率是脚本客户端
  if (!("ontouchstart" in w) && !matchMedia("(pointer:fine)").matches && /^(curl|wget|python|go-http|java)/i.test(n.userAgent)) return true;
  return false;
}

/* ---------- 卡片边缘聚光（鼠标靠近卡片时照亮边框） ---------- */
function attachCardSpotlight(card) {
  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", e.clientX - r.left + "px");
    card.style.setProperty("--my", e.clientY - r.top + "px");
  });
}

function renderRepos(repos, mode) {
  const grid = document.getElementById("projects-grid");
  const status = document.getElementById("projects-status");
  if (!grid) return;
  grid.innerHTML = "";

  repos.forEach((repo) => {
    const lang = repo.language || "其他";
    const color = LANG_COLORS[lang] || "#8b949e";
    const icon = repo.icon || pickIcon(repo);
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <span class="card-icon">${icon}</span>
        <a class="card-name" href="${repo.html_url}" target="_blank" rel="noopener">${repo.name}</a>
      </div>
      <p class="card-desc">${repo.description || "暂无描述"}</p>
      <div class="card-meta">
        <span class="lang"><span class="lang-dot"></span>${lang}</span>
        <span class="card-stars">★ ${repo.stargazers_count}</span>
        <span>${relativeTime(repo.updated_at)}</span>
      </div>
      <div class="card-foot">
        <a class="card-link" href="${repo.html_url}" target="_blank" rel="noopener">在 GitHub 查看 ↗</a>
      </div>
    `;
    attachCardSpotlight(card);
    grid.appendChild(card);
    // 语言圆点颜色通过 CSSOM 设置（不受 CSP style-src 限制，避免内联 style 被拦）
    const dot = card.querySelector(".lang-dot");
    if (dot) dot.style.background = color;
  });

  const labels = {
    live: `已实时同步 · 共 ${repos.length} 个项目`,
    cloud: `云端同步 · 共 ${repos.length} 个项目`,
    cache: `已缓存同步 · 共 ${repos.length} 个项目`,
    fallback: `离线兜底 · 共 ${repos.length} 个项目`
  };
  if (status) status.textContent = labels[mode] || labels.fallback;

  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const reposEl = document.querySelector('[data-stat="repos"]');
  const starsEl = document.querySelector('[data-stat="stars"]');
  if (reposEl) reposEl.textContent = repos.length;
  if (starsEl) starsEl.textContent = totalStars;
}

async function loadProjects() {
  // 1) 优先读云端共享缓存（跨访客共享，命中新鲜缓存则无需再打 GitHub）
  const cloudRepos = await readCloudCache();
  if (cloudRepos && cloudRepos.length) {
    renderRepos(cloudRepos, "cloud");
    return;
  }

  // 2) 云端缺失/过期：先用本地缓存即时渲染（零网络、零限流风险）
  const cached = getCached();
  if (cached && cached.length) renderRepos(cached, "cache");

  // 3) 机器人：不发起实时请求，直接返回（已用缓存或兜底）
  if (isBot()) {
    if (!cached || !cached.length) renderRepos(FALLBACK_REPOS, "fallback");
    return;
  }

  // 4) 真人：后台拉取最新数据，写回云端共享缓存并刷新本地缓存
  const repos = await fetchRepos();
  if (repos && repos.length) {
    setCache(repos);
    writeCloudCache(repos);
    renderRepos(repos, "live");
  } else if (!cached || !cached.length) {
    renderRepos(FALLBACK_REPOS, "fallback");
  }
}

/* ---------- 主题切换 ---------- */
function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);

  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    });
  }
}

/* ---------- 卡片光感：鼠标进入项目区时所有卡片带微光，离光标最近的最亮 ---------- */
function initCardProximity() {
  let raf = null;
  const BASE = 0.18;   // 进入项目区后每张卡片的常驻微光（保证“所有卡片都有光感”）
  const BOOST = 0.82;  // 离光标最近时额外叠加的亮度
  const RADIUS = 110;  // 距光标多近开始额外增亮（像素）—— 缩短光效蔓延长度
  const MARGIN = 60;   // 项目区上下扩展的感应范围
  document.addEventListener("mousemove", (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const grid = document.getElementById("projects-grid");
      const cards = document.querySelectorAll(".card");
      const rect = grid ? grid.getBoundingClientRect() : null;
      // 只有鼠标处于项目区（含上下余量）内，卡片才亮；其余区域完全无光
      const inSection =
        rect && e.clientY >= rect.top - MARGIN && e.clientY <= rect.bottom + MARGIN;
      cards.forEach((card) => {
        const r = card.getBoundingClientRect();
        // 指针在卡片内的投影点（限制范围，使边框聚光朝向光标）
        const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
        const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
        // 指针到卡片最近边的距离
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        const dist = Math.hypot(dx, dy);
        const near = dist < RADIUS ? 1 - dist / RADIUS : 0;
        let glow = inSection ? BASE + near * BOOST : 0;
        if (glow > 1) glow = 1;
        card.style.setProperty("--mx", x + "px");
        card.style.setProperty("--my", y + "px");
        card.style.setProperty("--glow", glow.toFixed(3));
      });
    });
  });
  // 鼠标离开页面时熄灭所有卡片光
  document.addEventListener("mouseleave", () => {
    document.querySelectorAll(".card").forEach((c) => c.style.setProperty("--glow", "0"));
  });
}

/* ---------- 苹果风格 Dock：图标放大 + 拖动弹性回弹 ---------- */
function initDock() {
  const dock = document.getElementById("dock");
  if (!dock) return;
  const items = [...dock.querySelectorAll(".dock-item")];

  function magnify(e) {
    items.forEach((it) => {
      const r = it.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const dist = Math.abs(e.clientX - cx);
      const scale = 1 + Math.max(0, (70 - dist) / 70) * 0.55;
      it.style.transform = `scale(${scale})`;
    });
  }
  dock.addEventListener("pointerleave", () => {
    items.forEach((it) => (it.style.transform = "scale(1)"));
  });

  let dragging = false, moved = false, startX = 0, startY = 0;
  let curX = 0, curY = 0, activeId = null, rafId = null;

  function elasticReturn() {
    if (rafId) cancelAnimationFrame(rafId);
    items.forEach((it) => (it.style.transform = "scale(1)"));
    const k = 0.14, damp = 0.11; // 欠阻尼 -> 多段回弹
    let x = curX, y = curY, vx = 0, vy = 0;
    function frame() {
      const ax = -k * x - damp * vx;
      const ay = -k * y - damp * vy;
      vx += ax; vy += ay; x += vx; y += vy;
      dock.style.transform = `translate(calc(-50% + ${x}px), ${y}px)`;
      if (Math.abs(x) < 0.4 && Math.abs(vx) < 0.4 && Math.abs(y) < 0.4 && Math.abs(vy) < 0.4) {
        curX = 0; curY = 0;
        dock.style.transform = "translate(-50%, 0)";
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  dock.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false;
    startX = e.clientX - curX; startY = e.clientY - curY;
    activeId = e.pointerId;
  });
  dock.addEventListener("pointermove", (e) => {
    if (!dragging) { magnify(e); return; }
    const nx = e.clientX - startX, ny = e.clientY - startY;
    if (!moved && (Math.abs(nx - curX) > 4 || Math.abs(ny - curY) > 4)) {
      moved = true;
      try { dock.setPointerCapture(activeId); } catch (_) {}
      dock.style.transition = "none";
    }
    if (moved) {
      curX = nx; curY = ny;
      dock.style.transform = `translate(calc(-50% + ${curX}px), ${curY}px)`;
    } else {
      magnify(e);
    }
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      try { dock.releasePointerCapture(activeId); } catch (_) {}
      elasticReturn();
    }
  }
  dock.addEventListener("pointerup", endDrag);
  dock.addEventListener("pointercancel", endDrag);
}

/* ---------- 启动（各模块独立兜底，单点失败不影响整体） ---------- */
(function boot() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  try { initTheme(); } catch (e) { console.warn(e); }
  try { initCardProximity(); } catch (e) { console.warn(e); }
  try { initDock(); } catch (e) { console.warn(e); }
  try { loadProjects(); } catch (e) { console.warn(e); }
})();
