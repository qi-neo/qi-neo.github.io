# qi-neo.github.io

王瑛琦（qi-neo）的个人主页 —— 嵌入式软件 / C++ / ROS2 传感器驱动。

- 线上地址：**https://qi-neo.github.io/**
- 托管：GitHub Pages（`main` 分支根目录，push 后自动构建，约 30–60 秒生效）

## 架构

项目列表**在构建时**生成，访客浏览器不再调用 GitHub API：

```
GitHub Actions（每天 / 手动触发）
  └─ scripts/build.py
       ├─ 抓取 GitHub 公开仓库      → assets/repos.json
       ├─ 渲染卡片写进 index.html   → 无 JS 也有内容（SEO / 弱网 / 首屏）
       ├─ 重算内联脚本 sha256       → 回填 CSP 白名单
       └─ 按文件内容刷新 ?v=        → 绕过 Pages 的 10 分钟缓存
```

好处：没有第三方脚本、没有 60 次/小时限流、不需要反爬检测、CSP 可以收紧到
`connect-src 'self'`，卡片在 HTML 里静态存在。

`app.js` 只做增量刷新：优先读 `localStorage`（6 小时），随后拉一次同源的
`assets/repos.json`；失败时保留构建时写入的静态卡片，不会白屏。

## 文件结构

```
index.html            页面骨架 + SEO/OG + 静态项目卡片（构建产物，勿手改卡片区）
404.html              同风格 404
manifest.json         PWA 清单（添加到主屏）
assets/style.css      样式（深/浅色、卡片光效、Dock、无障碍）
assets/app.js         交互（主题、光效、Dock、数据刷新）
assets/repos.json     项目数据（构建产物）
assets/og-cover.png   社交分享封面 1200×630
scripts/build.py      构建脚本
robots.txt / sitemap.xml / .nojekyll / favicon.ico
```

## 日常更新

**改文案、样式、交互**：直接改文件后

```bash
git add -A
git commit -m "说明这次改了什么"
git push
```

**只改项目数据**：在 GitHub 仓库的 Actions 页面手动跑一次「同步 GitHub 项目数据」，
或者等每天 11:17（北京时间）的定时任务。也可以本地跑：

```bash
GITHUB_TOKEN=$(gh auth token) python3 scripts/build.py
```

`scripts/build.py --offline` 可以在不联网时重新排版静态卡片。

**改了 HTML/CSS/JS 之后建议再跑一次 build**，它会把资源版本号 `?v=` 和 CSP 哈希刷新成最新值
（CSP 是 sha256 白名单，内联脚本一改就必须重新算，否则脚本会被浏览器拦掉）。

## 本地预览

```bash
python3 -m http.server 8000
# 打开 http://127.0.0.1:8000/
```

注意：本地的 `http://127.0.0.1` 只有自己能访问。要让别人看到，必须部署到公网
（当前用 GitHub Pages）。

## 自定义域名（可选）

1. 域名 DNS 添加 CNAME 指向 `qi-neo.github.io`
2. 仓库根目录新建 `CNAME` 文件，内容写域名（如 `qineo.dev`）
3. 仓库 Settings → Pages 勾选 Enforce HTTPS

## 说明

- `robots.txt` 目前只放行 Google / Bing / 百度 / Apple，其余爬虫禁止；改放行策略直接改该文件。
- 页面已不再依赖 WorkBuddy Cloud SDK（原先 72 KB 的第三方脚本已移除），
  如需回滚可查看 git 历史中的 `2da0cdb`。
