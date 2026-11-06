#!/usr/bin/env python3
"""Generate README image assets for dsh-memento (docs/assets/).

Outputs (idempotent overwrite):
  dsh-memento-flow-light.svg / dsh-memento-flow-dark.svg
      Hero data-flow diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (ctx.memory, approval/asked, memory.db, systemPrompt, ...), so all
      five README languages share the same pair.
  dsh-memento-evidence-{zh,en}-{light,dark}.webp
      Rendered only when BENCHMARK holds real measured rows. This repository
      publishes no benchmark/RESULTS.md, so the list below is empty and the
      six raster files are not produced — the family skeleton's Pillow path
      and its CJK font probe stay in place for the day a benchmark lands.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow) — only for the evidence charts.
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]


def cjk_font(size: int):
    """Return a CJK-capable font, or exit loudly (never render tofu boxes)."""
    from PIL import ImageFont
    path = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
    if path is None:
        sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
                 "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render "
                 "Chinese as tofu boxes; install one of the probed fonts and "
                 "re-run.")
    return ImageFont.truetype(path, size)


# ---------------------------------------------------------------------------
# 1. Hero data-flow SVG (light + dark)
# ---------------------------------------------------------------------------
FLOW_NODES = [
    ("memory", "tool · add/replace/remove", "gate inside the service"),
    ("ctx.memory", "budget precheck", "two tracks × two layers"),
    ("approval/asked", "writePolicy: ask", "approval/decided"),
    ("memory.db", "node:sqlite · 0600 · WAL", "$DSH_HOME/dsh-memento"),
    ("systemPrompt", "snapshot · order -50", "frozen once per session"),
]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 430
    nw, nh, gap = 180, 104, 45
    y0 = 150
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" aria-label="dsh-memento data flow">',
        f'<title>dsh-memento data flow</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="58" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">dsh-memento'
        f'</text>',
        f'<text x="60" y="90" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="15">ctx.memory · approval/asked · '
        f'memory.db · systemPrompt</text>',
        f'<line x1="60" y1="112" x2="1140" y2="112" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub, note) in enumerate(FLOW_NODES):
        x = 60 + i * (nw + gap)
        accent = GREEN[skin] if i == len(FLOW_NODES) - 1 else (
            FAMILY if i in (2, 3) else s["border"])
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 34}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="16" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 60}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11">{sub}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 82}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11">{note}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 6
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 12}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 14} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # audit bar under the gate + store
    bx, bw, by, bh = 510, 630, 286, 44
    for cx in (510 + nw // 2, 735 + nw // 2):
        parts.append(
            f'<path d="M{cx} {y0 + nh}v{by - y0 - nh}" stroke="{FAMILY}" '
            f'stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="12" '
        f'fill="{s["box"]}" stroke="{FAMILY}" stroke-width="2"/>')
    parts.append(
        f'<text x="{bx + bw // 2}" y="{by + 28}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="13">audit = approval/asked + approval/decided + '
        f'audit table</text>')
    # read-only MCP bar
    mx, my, mw, mh = 60, 346, 1080, 42
    parts.append(
        f'<rect x="{mx}" y="{my}" width="{mw}" height="{mh}" rx="12" '
        f'fill="{s["box"]}" stroke="{s["border"]}" stroke-width="2"/>')
    parts.append(
        f'<text x="{mx + mw // 2}" y="{my + 27}" fill="{s["sub"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="13">dsh-memento-mcp · read-only · memory_search · '
        f'memory_stats</text>')
    parts.append(
        f'<text x="60" y="416" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="12">memory/* events: declared, not emitted '
        f'→ adaptive gate stays closed</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# 2. Evidence bar chart (only with real measured data)
# ---------------------------------------------------------------------------
# Per-row (label, value) quoted verbatim from the repository's own results
# file, plus the caption lines. Empty here: no benchmark/RESULTS.md ships.
BENCHMARK: list[tuple[str, float]] = []
EVIDENCE_TEXT = {
    "zh": dict(title="dsh-memento — 实测数据", sub="数据出自 ",
               note1="", note2=""),
    "en": dict(title="dsh-memento — measured data", sub="Source: ",
               note1="", note2=""),
}


def evidence(lang: str, skin: str, source: str) -> None:
    from PIL import Image, ImageDraw
    if not BENCHMARK:
        return
    s, t = SKIN[skin], EVIDENCE_TEXT[lang]
    w, h = 1600, 620
    img = Image.new("RGB", (w, h), s["bg"])
    d = ImageDraw.Draw(img)
    pad = 70
    d.text((pad, 44), t["title"], font=cjk_font(36), fill=s["text"])
    d.text((pad, 100), t["sub"] + source, font=cjk_font(19), fill=s["sub"])
    label_w, bar_max = 300, 960
    bar_x, row_h, bar_h, top = pad + label_w + 24, 56, 34, 170
    for i, (name, val) in enumerate(BENCHMARK):
        y = top + i * row_h
        lb = d.textbbox((0, 0), name, font=cjk_font(22))
        d.text((bar_x - 24 - (lb[2] - lb[0]), y + 4), name,
               font=cjk_font(22), fill=s["text"])
        d.rounded_rectangle([bar_x, y, bar_x + bar_max, y + bar_h],
                            radius=9, fill=s["track"])
        d.rounded_rectangle([bar_x, y, bar_x + int(bar_max * val), y + bar_h],
                            radius=9, fill=GREEN[skin])
        d.text((bar_x + bar_max + 18, y + 2), f"{val:.3f}",
               font=cjk_font(24), fill=s["text"])
    ny = top + len(BENCHMARK) * row_h + 18
    if t["note1"]:
        d.text((pad, ny), t["note1"], font=cjk_font(17), fill=s["sub"])
    if t["note2"]:
        d.text((pad, ny + 32), t["note2"], font=cjk_font(17), fill=s["sub"])
    img.save(os.path.join(OUT, f"dsh-memento-evidence-{lang}-{skin}.webp"),
             "WEBP", quality=90)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-memento-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    wrote = 2
    if BENCHMARK:
        for lang in ("zh", "en"):
            for skin in ("light", "dark"):
                evidence(lang, skin, "benchmark/RESULTS.md")
                wrote += 1
    print(f"wrote {wrote} SVG/WebP assets to docs/assets/ "
          f"(evidence charts: {len(BENCHMARK)} benchmark rows)")


if __name__ == "__main__":
    main()
