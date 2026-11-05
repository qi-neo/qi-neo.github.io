#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""禁止展示层再出现「NN assertions passed」类硬编码自检数字。

P2-3：主页曾写死 63 assertions passed / 135 项断言，而定时同步脚本只覆盖
star / 语言 / 版本等仓库元数据，这些数字永远不会被刷新，长期与 CI 漂移。
策略是删掉具体数字、改成定性表述；本脚本把「写死数字」挡在合并前，
并由 scripts/build.py 在生成 index.html 后同步调用，双保险。

用法：
    python3 scripts/check_hardcoded_counts.py            # 扫描全站页面
    python3 scripts/check_hardcoded_counts.py --text X  # 调试：扫描一段文本
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = [ROOT / "index.html", ROOT / "404.html"] + sorted((ROOT / "projects").glob("*.html"))

# 只拦「数字 + assertions passed」与「数字 + 项断言 / 项离线自检」这类
# 明确的自检计数硬编码；终端示例 "all assertions passed · 0 failed" 不含前置数字，不受影响。
FORBIDDEN = [
    (re.compile(r"\b\d+\s+assertions?\s+passed\b", re.I), "写死的 assertions passed 计数"),
    (re.compile(r"离线自检\s*\d+\s*项", re.I), "写死的离线自检项数"),
    (re.compile(r"\d+\s*项断言", re.I), "写死的断言项数"),
]


def violations(text, label):
    found = []
    for lineno, line in enumerate(text.split("\n"), 1):
        for pattern, hint in FORBIDDEN:
            m = pattern.search(line)
            if m:
                found.append(f"{label}:{lineno} [{hint}] {m.group(0)!r} → {line.strip()[:100]}")
    return found


def assert_no_hardcoded_counts(text, label="index.html"):
    """供 build.py 在写回 index.html 前调用；命中即抛 SystemExit。"""
    hits = violations(text, label)
    if hits:
        for hit in hits:
            print(f"[check_hardcoded_counts] FAIL: {hit}")
        raise SystemExit(
            "[check_hardcoded_counts] 生成结果含写死的自检计数，"
            "请改为「数百项离线自检，详见仓库 CI」这类定性表述"
        )


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--text":
        return 0 if not violations(sys.argv[2], "<text>") else 1

    all_hits = []
    for page in PAGES:
        if page.exists():
            all_hits.extend(violations(page.read_text("utf-8"), page.relative_to(ROOT).as_posix()))
    if all_hits:
        for hit in all_hits:
            print(f"[check_hardcoded_counts] FAIL: {hit}")
        return 1
    print(f"[check_hardcoded_counts] OK：{len([p for p in PAGES if p.exists()])} 个页面无写死自检计数")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--text":
        for h in violations(sys.argv[2], "<text>"):
            print(f"[check_hardcoded_counts] FAIL: {h}")
    sys.exit(main())
