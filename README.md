# qi-neo.github.io

王瑛琦（qi-neo）的个人主页 —— 嵌入式软件 / C++ / ROS2 传感器驱动。

- 线上地址：**https://qi-neo.github.io/**
- 托管：GitHub Pages（`main` 分支根目录，push 后自动构建，约 30–60 秒生效）

## 文件结构

```
index.html          页面结构（含 CSP、SEO meta）
assets/style.css    样式（深/浅色主题、Dock、卡片光效）
assets/app.js       交互逻辑（GitHub API 拉取项目、云端缓存、兜底数据）
robots.txt          爬虫规则
sitemap.xml         站点地图
```

## 更新站点

```bash
cd qi-neo.github.io
# 修改文件后
git add -A
git commit -m "说明这次改了什么"
git push
```

推送后到 Actions / Pages 里看构建状态，或直接刷新线上地址。

## 说明

- 页面里的 `publishableKey` 是前端可公开携带的公共配置（来自 WorkBuddy `publicConfig`），
  不是私钥；如需轮换请到 WorkBuddy 控制台重新生成后同步修改 `assets/app.js`。
- 项目列表实时从 GitHub API 拉取，失败 / 限流时用 `app.js` 里的 `FALLBACK_REPOS` 兜底。
