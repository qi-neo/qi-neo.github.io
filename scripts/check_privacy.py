#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示仓隐私边界检查（零第三方依赖）。

策略见主仓 docs/PRIVACY.md：展示仓（profile / 个人主页）保留真实姓名与
公开联系邮箱用于求职联系，但不得出现学号、真实 Wi-Fi SSID 或任何口令/凭据。

用法：python3 scripts/check_privacy.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "__pycache__", "node_modules"}
FORBIDDEN = [
    ("学号", re.compile(r"182311123")),
    ("真实 SSID", re.compile(r"205-03")),
]
# 策略 / 校验文件自身允许含这些字面量（它们正是检测器）
POLICY_FILES = {"scripts/check_privacy.py", "scripts/check_hardcoded_counts.py"}

errors = []
scanned = 0
for path in sorted(ROOT.rglob("*")):
    if not path.is_file():
        continue
    rel = path.relative_to(ROOT).as_posix()
    if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
        continue
    if rel in POLICY_FILES:
        continue
    try:
        lines = path.read_text("utf-8", errors="ignore").split("\n")
    except OSError:
        continue
    scanned += 1
    for lineno, line in enumerate(lines, 1):
        for label, pattern in FORBIDDEN:
            if pattern.search(line):
                errors.append(f"{rel}:{lineno} 展示仓出现{label}：{line.strip()[:100]}")

if errors:
    for err in errors:
        print(f"[check_privacy] FAIL: {err}")
    sys.exit(1)
print(f"[check_privacy] OK：扫描 {scanned} 个文件，展示仓无学号 / 真实 SSID；姓名与联系邮箱属白名单")
