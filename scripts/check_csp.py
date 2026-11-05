#!/usr/bin/env python3
# 校验 index.html 的 CSP 内联脚本白名单与实际内联脚本是否一致（P1-7）。
#
# 背景：主页用 sha256 白名单放行内联 <script>（首屏主题初始化 theme-init、
# 结构化数据 ld+json），CSP 的 script-src 里写死对应的 'sha256-...'。一旦改了
# 内联脚本内容却忘了同步 CSP，浏览器会直接拒绝执行该脚本（首屏主题切换、SEO
# 结构化数据全失效），且没有任何本地报错——只在真机上表现为"主题切换按钮没用"。
#
# 本脚本在 CI（push / PR）里跑，双向比对：
#   1) 每个内联脚本的 sha256 都必须出现在 CSP 白名单中（脚本改了要同步 CSP）；
#   2) CSP 白名单里每个 sha256 都必须有对应的内联脚本（CSP 漂移也要被发现）。
# 任何一方对不上就退出非零，把"改了脚本忘了改 CSP"挡在合并之前。

import base64
import hashlib
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDEX = HERE.parent / "index.html"


def extract_csp_hashes(html: str) -> set[str]:
    m = re.search(
        r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', html, re.IGNORECASE
    )
    if not m:
        raise SystemExit("ERROR: 找不到 Content-Security-Policy 的 meta 标签")
    csp = m.group(1)
    return set(re.findall(r"sha256-([A-Za-z0-9+/=]+)", csp))


def inline_script_hashes(html: str) -> set[str]:
    # 捕获所有 <script ...>...</script>；带 src 的是外链（由 'self' 放行），跳过。
    scripts = re.findall(r"<script\b([^>]*)>(.*?)</script>", html, re.DOTALL | re.IGNORECASE)
    hashes: set[str] = set()
    for attrs, content in scripts:
        if re.search(r"\bsrc=", attrs, re.IGNORECASE):
            continue
        digest = hashlib.sha256(content.encode("utf-8")).digest()
        hashes.add(base64.b64encode(digest).decode("ascii"))
    return hashes


def main() -> int:
    if not INDEX.exists():
        print(f"ERROR: 找不到 {INDEX}")
        return 1
    html = INDEX.read_text(encoding="utf-8")

    csp_hashes = extract_csp_hashes(html)
    inline_hashes = inline_script_hashes(html)

    errors: list[str] = []
    if not csp_hashes:
        errors.append("CSP 里没有任何 sha256 白名单项（script-src 配置异常）")
    if not inline_hashes:
        errors.append("页面没有任何内联 <script>（不应发生，检查提取逻辑）")

    # 内联脚本的 hash 不在白名单：脚本改了但 CSP 没更新
    missing = inline_hashes - csp_hashes
    if missing:
        errors.append(
            "以下内联脚本的 sha256 未出现在 CSP 白名单（脚本变了但 CSP 没更新）:\n  "
            + "\n  ".join(sorted(missing))
        )
    # 白名单里有、但页面没有对应脚本：CSP 漂移
    extra = csp_hashes - inline_hashes
    if extra:
        errors.append(
            "以下 CSP sha256 没有对应的内联脚本（白名单漂移）:\n  "
            + "\n  ".join(sorted(extra))
        )

    if errors:
        print("CSP 校验失败:")
        for e in errors:
            print(" -", e)
        return 1

    print(f"CSP 校验通过：{len(inline_hashes)} 个内联脚本的 sha256 全部在白名单中")
    return 0


if __name__ == "__main__":
    sys.exit(main())
