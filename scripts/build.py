#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qi-neo.github.io 构建脚本

做五件事（全部幂等，重复运行结果一致）：

1. 从 GitHub API 抓取公开仓库，写入 assets/repos.json
2. 把项目卡片静态渲染进 index.html 的 REPOS:START / REPOS:END 之间
   （这样不执行 JS 的爬虫、弱网首屏、JS 挂掉时都有内容）
3. 重新计算内联脚本的 sha256，回填 CSP 里的 script-src 白名单
4. 按文件内容哈希刷新资源版本号（?v=），绕过 Pages 的 10 分钟缓存
5. 仅在 index.html / assets/repos.json 内容真的变化时刷新 sitemap 的 lastmod，
   避免每天定时任务都把日期改成"今天"、产生永远无法收敛的 bot commit

用法：
    python3 scripts/build.py              # 联网抓取
    python3 scripts/build.py --offline    # 只重排静态内容，用现有 repos.json
"""

import argparse
import base64
import datetime
import hashlib
import html
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USERNAME = "qi-neo"
API_URL = (
    f"https://api.github.com/users/{USERNAME}/repos"
    "?sort=updated&per_page=100&type=public"
)
REPOS_JSON = ROOT / "assets" / "repos.json"
INDEX = ROOT / "index.html"
SITEMAP = ROOT / "sitemap.xml"

# 与前端 LANG_CLASS 保持一致
LANG_CLASS = {
    "C++": "cpp", "C": "c", "C#": "csharp", "Python": "python",
    "JavaScript": "js", "TypeScript": "ts", "Shell": "shell",
    "CMake": "cmake", "HTML": "html", "Rust": "rust", "Go": "go",
}

# 与前端 pickIcon 的关键词规则保持一致（顺序即优先级）
ICONS_BY_KEYWORD = [
    (re.compile(r"lidar|雷达|unilidar", re.I), "📡"),
    (re.compile(r"suspension|悬架|car|车辆", re.I), "🚗"),
    (re.compile(r"motor|步进|esp32|esp", re.I), "⚙️"),
    (re.compile(r"camera|cam|视觉|image", re.I), "📷"),
    (re.compile(r"ros", re.I), "🤖"),
]

# GitHub 官方语言配色（与 style.css 的 .lang-* 保持一致）
LANG_COLORS = {
    "C++": "#f34b7d", "C": "#555555", "C#": "#178600", "Python": "#3572A5",
    "JavaScript": "#f1e05a", "TypeScript": "#3178c6", "Shell": "#89e051",
    "CMake": "#DA3434", "HTML": "#e34c26", "Rust": "#dea584", "Go": "#00ADD8",
    "Dockerfile": "#384d54", "Makefile": "#427819", "MATLAB": "#e16737",
}
DEFAULT_LANG_COLOR = "#8b949e"


def pick_icon(repo):
    hay = (repo.get("name", "") + " " + (repo.get("description") or "")).lower()
    for pattern, icon in ICONS_BY_KEYWORD:
        if pattern.search(hay):
            return icon
    return "📦"


def updated_label(iso):
    """静态卡片用绝对日期。
    用相对时间（「3 天前」）会让页面每天产生一次无意义变更，
    相对时间交给浏览器里的 JS 实时计算。"""
    if not iso:
        return ""
    try:
        then = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return ""
    return then.strftime("%Y-%m-%d") + " 更新"


def ssl_context():
    """macOS 上的 Python 常常没有系统根证书，按常见路径补一次"""
    context = ssl.create_default_context()
    candidates = [
        os.environ.get("SSL_CERT_FILE"),
        "/etc/ssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
        "/usr/local/etc/openssl/cert.pem",
    ]
    for path in candidates:
        if not path:
            continue
        try:
            context.load_verify_locations(path)
            return context
        except (OSError, ssl.SSLError):
            continue
    return context


def api_request(path):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": f"{USERNAME}-site-builder",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request("https://api.github.com" + path, headers=headers)
    with urllib.request.urlopen(request, timeout=30, context=ssl_context()) as response:
        return json.load(response)


def fetch_languages(name):
    """按字节占比取前 4 种语言，用于卡片底部的配色条"""
    try:
        data = api_request(f"/repos/{USERNAME}/{name}/languages")
    except (urllib.error.HTTPError, urllib.error.URLError):
        return []
    total = sum(data.values()) or 1
    items = sorted(data.items(), key=lambda kv: -kv[1])[:4]
    return [
        {
            "name": key,
            "percent": round(value * 100 / total, 2),
            "color": LANG_COLORS.get(key, DEFAULT_LANG_COLOR),
        }
        for key, value in items
    ]


def fetch_version(name):
    """优先取最新 release，其次取最新 tag"""
    try:
        return api_request(f"/repos/{USERNAME}/{name}/releases/latest").get("tag_name")
    except urllib.error.HTTPError:
        pass
    except urllib.error.URLError:
        return None
    try:
        tags = api_request(f"/repos/{USERNAME}/{name}/tags?per_page=1")
        return tags[0]["name"] if tags else None
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None


def has_detail_page(name):
    """projects/<name>.html 存在时，卡片上出现「项目详情」入口"""
    return (ROOT / "projects" / f"{name}.html").exists()


def fetch_repos():
    payload = api_request(f"/users/{USERNAME}/repos?sort=updated&per_page=100&type=public")

    repos = []
    for item in payload:
        if item.get("fork"):
            continue
        name = item.get("name", "")
        # 用户站点仓库本身不作为「项目」展示
        if name.lower() in {USERNAME.lower(), f"{USERNAME}.github.io".lower()}:
            continue
        repos.append(
            {
                "name": name,
                "description": item.get("description") or "",
                "language": item.get("language"),
                "stargazers_count": item.get("stargazers_count") or 0,
                "updated_at": item.get("updated_at"),
                "html_url": item.get("html_url", ""),
                "icon": pick_icon(item),
                "topics": (item.get("topics") or [])[:6],
                "languages": fetch_languages(name),
                "version": fetch_version(name),
                "detail_url": f"/projects/{name}.html" if has_detail_page(name) else None,
            }
        )
    return repos


def render_langbar(languages):
    """语言占比条：用内联 SVG，静态 HTML 里也不需要内联 style（CSP 不允许）"""
    if not languages:
        return ""
    rects = []
    x = 0.0
    for index, lang in enumerate(languages):
        # 最后一段补齐到 100%，避免百分比取整后留缝
        width = 100 - x if index == len(languages) - 1 else lang["percent"]
        rects.append(
            f'<rect x="{x:.2f}" y="0" width="{width:.2f}" height="4"'
            f' fill="{lang["color"]}"/>'
        )
        x += width
    return (
        '          <svg class="card-langbar" viewBox="0 0 100 4" preserveAspectRatio="none"'
        ' aria-hidden="true" focusable="false">' + "".join(rects) + "</svg>\n"
    )


def render_cards(repos):
    """生成与 app.js 完全一致的卡片结构（便于 JS 重渲染后无视觉跳变）"""
    blocks = []
    for repo in repos:
        lang = repo.get("language") or "其他"
        lang_cls = LANG_CLASS.get(lang, "other")
        detail = repo.get("detail_url")

        version = ""
        if repo.get("version"):
            version = (
                f'            <span class="card-version">'
                f'{html.escape(repo["version"])}</span>\n'
            )

        topics = repo.get("topics") or []
        chips = ""
        if topics:
            inner = "".join(
                f'<span class="chip">{html.escape(topic)}</span>'
                for topic in topics[:3]
            )
            chips = f'          <div class="card-chips">{inner}</div>\n'

        if detail:
            primary = (
                f'            <a class="card-link card-link-strong"'
                f' href="{html.escape(detail, quote=True)}">项目详情 →</a>\n'
            )
            secondary = (
                f'            <a class="card-link"'
                f' href="{html.escape(repo["html_url"], quote=True)}"'
                ' target="_blank" rel="noopener">GitHub ↗</a>\n'
            )
        else:
            primary = (
                f'            <a class="card-link"'
                f' href="{html.escape(repo["html_url"], quote=True)}"'
                ' target="_blank" rel="noopener">在 GitHub 查看 ↗</a>\n'
            )
            secondary = ""

        blocks.append(
            "\n"
            '        <article class="card">\n'
            '          <div class="card-top">\n'
            f'            <span class="card-icon" aria-hidden="true">{repo["icon"]}</span>\n'
            f'            <a class="card-name" href="{html.escape(repo["html_url"], quote=True)}"'
            ' target="_blank" rel="noopener">'
            f'{html.escape(repo["name"])}</a>\n'
            f"{version}"
            "          </div>\n"
            f'          <p class="card-desc">{html.escape(repo["description"] or "暂无描述")}</p>\n'
            f"{chips}"
            f"{render_langbar(repo.get('languages') or [])}"
            '          <div class="card-meta">\n'
            f'            <span class="lang"><span class="lang-dot lang-{lang_cls}"'
            f' aria-hidden="true"></span>{html.escape(lang)}</span>\n'
            f'            <span class="card-stars">★ {repo["stargazers_count"]}</span>\n'
            f'            <span>{updated_label(repo["updated_at"])}</span>\n'
            "          </div>\n"
            '          <div class="card-foot">\n'
            f"{primary}"
            f"{secondary}"
            "          </div>\n"
            "        </article>"
        )
    return "".join(blocks)


def update_index(html_text, repos):
    cards = render_cards(repos)
    pattern = re.compile(
        r"(<!-- REPOS:START.*?-->)(.*?)(\s*<!-- REPOS:END -->)", re.S
    )
    if not pattern.search(html_text):
        raise SystemExit("index.html 里找不到 REPOS:START / REPOS:END 标记")
    html_text = pattern.sub(lambda m: m.group(1) + cards + m.group(3), html_text, count=1)

    # 首屏统计数字（无 JS 时也是真实值）
    total_stars = sum(r["stargazers_count"] for r in repos)
    html_text = re.sub(
        r'(<strong data-stat="repos">)\d+(</strong>)',
        lambda m: f"{m.group(1)}{len(repos)}{m.group(2)}",
        html_text,
        count=1,
    )
    html_text = re.sub(
        r'(<strong data-stat="stars">)[^<]*(</strong>)',
        lambda m: f"{m.group(1)}{total_stars}{m.group(2)}",
        html_text,
        count=1,
    )

    # 状态栏初始文案：不执行 JS 时也不该一直停在「加载中…」
    html_text = re.sub(
        r'(<span id="projects-status"[^>]*>)[^<]*(</span>)',
        lambda m: f'{m.group(1)}构建时快照 · 共 {len(repos)} 个项目{m.group(2)}',
        html_text,
        count=1,
    )
    return html_text


def sha256_of_text(text):
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return "sha256-" + base64.b64encode(digest).decode("ascii")


INLINE_SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S)
SCRIPT_SRC_RE = re.compile(r"script-src 'self'[^;]*;")


def update_csp(html_text):
    """把所有内联脚本的 sha256 写进 CSP 的 script-src，避免被拦"""
    hashes = []
    for match in INLINE_SCRIPT_RE.finditer(html_text):
        digest = sha256_of_text(match.group(1))
        if digest not in hashes:
            hashes.append(digest)
    if not hashes:
        return html_text
    quoted = " ".join(f"'{h}'" for h in hashes)
    replacement = f"script-src 'self' {quoted};"
    if not SCRIPT_SRC_RE.search(html_text):
        raise SystemExit("CSP 里找不到 script-src 指令")
    return SCRIPT_SRC_RE.sub(lambda m: replacement, html_text, count=1)


def file_version(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def update_asset_versions(html_text):
    for name in ("style.css", "app.js"):
        version = file_version(ROOT / "assets" / name)
        html_text = re.sub(
            rf"/assets/{re.escape(name)}\?v=[0-9a-f]+",
            f"/assets/{name}?v={version}",
            html_text,
        )
    return html_text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="不联网，复用现有 repos.json")
    args = parser.parse_args()

    if args.offline:
        if not REPOS_JSON.exists():
            raise SystemExit("--offline 需要先有 assets/repos.json")
        repos = json.loads(REPOS_JSON.read_text("utf-8"))["repos"]
        print(f"[build] 离线模式，复用 {len(repos)} 个项目")
    else:
        try:
            repos = fetch_repos()
        except urllib.error.HTTPError as exc:
            raise SystemExit(f"GitHub API 返回 {exc.code}，终止构建（不覆盖已有数据）")
        except urllib.error.URLError as exc:
            raise SystemExit(f"网络不可用：{exc.reason}，终止构建（不覆盖已有数据）")
        print(f"[build] 拉到 {len(repos)} 个公开仓库")

    # 数据没变就沿用旧时间戳，避免每天定时任务都产生一次无意义提交
    stamp = (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    if REPOS_JSON.exists():
        try:
            previous = json.loads(REPOS_JSON.read_text("utf-8"))
            if previous.get("repos") == repos and previous.get("updated_at"):
                stamp = previous["updated_at"]
        except (ValueError, OSError):
            pass

    payload = {"username": USERNAME, "updated_at": stamp, "repos": repos}
    new_json = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    repos_changed = not REPOS_JSON.exists() or REPOS_JSON.read_text("utf-8") != new_json
    if repos_changed:
        REPOS_JSON.write_text(new_json, encoding="utf-8")
        print("[build] assets/repos.json 已更新")
    else:
        print("[build] assets/repos.json 无变化")

    old_index_text = INDEX.read_text("utf-8")
    index_text = update_index(old_index_text, repos)
    index_text = update_asset_versions(index_text)
    index_text = update_csp(index_text)
    index_changed = index_text != old_index_text
    if index_changed:
        INDEX.write_text(index_text, encoding="utf-8")

    # 其余页面（404、projects/*.html）只需刷新版本号与 CSP 哈希
    extra_pages = [ROOT / "404.html"] + sorted((ROOT / "projects").glob("*.html"))
    for page in extra_pages:
        if not page.exists():
            continue
        text = page.read_text("utf-8")
        text = update_asset_versions(text)
        text = update_csp(text)
        page.write_text(text, encoding="utf-8")

    # sitemap 的 lastmod 只在 index.html / repos.json 内容真的变化时更新。
    # 旧实现每次都写成"今天"，配合每日 GitHub Actions 会每天产生一次 bot commit
    # （内容其实没变）；这里保持"最近一次内容变更日期"语义。
    content_changed = index_changed or repos_changed
    if SITEMAP.exists():
        if content_changed:
            today = datetime.date.today().isoformat()
            text = SITEMAP.read_text("utf-8")
            if "<lastmod>" in text:
                text = re.sub(r"<lastmod>[^<]*</lastmod>", f"<lastmod>{today}</lastmod>", text)
                SITEMAP.write_text(text, encoding="utf-8")
                print(f"[build] 内容有变化，sitemap lastmod -> {today}")
        else:
            print("[build] 内容无变化，sitemap 保持不变")

    detail_pages = [p for p in (ROOT / "projects").glob("*.html")]
    print(
        f"[build] 已写入 {REPOS_JSON.relative_to(ROOT)}、index.html（{len(repos)} 张卡片）"
        + (f"；详情页 {len(detail_pages)} 个" if detail_pages else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
