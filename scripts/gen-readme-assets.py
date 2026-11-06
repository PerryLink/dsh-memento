#!/usr/bin/env python3
"""README visuals for dsh-memento (docs/assets/).

Two figures, both derived from what this package actually runs — not from a
wish-list of memory features:

1. hero — 1440x576 WEBP, four files (zh|en x light|dark).
   Left column: kicker pill, title, a two-line value sentence, one subtitle,
   one meta line, footer. Right column: the memory seam itself — one store
   card holding the 2x2 track x scope plate matrix with the hard character
   budgets that ship as defaults (user 2000 / 2000, agent 4000 / 4000), the
   write path that every surface takes through the in-service approval gate
   (`memory` tool / `/memory` / `seed` -> precheck -> approval/asked ->
   approval/decided -> insert), the retrieval line (`memory_recall` on the
   case-insensitive substring provider, optional vector path), the next
   session's frozen `systemPrompt` segment (order -50) and the audit ribbon
   (approval pair + audit table + snapshot row). Every string is a class,
   file, config key, table or event name from this repository.

2. flow — 1100x660 SVG, light + dark.
   The repo's one structural fact is a loop between two sessions: session S1
   writes through the gate into the store, and session S2's first prompt
   assemble reads the same store and freezes it into systemPrompt. A five-node
   row cannot show a round trip, so the diagram is a loop: a session column on
   the left (S1 write above, S2 read below, a dashed "new session" rail
   between them), the store column on the right (entries / audit / proposals /
   meta plus the four budgets and the read-only MCP side door), the gated write
   lane across the top, the audit band as the middle spine, and the frozen read
   lane running back across the bottom. Text is identifiers and short English
   tokens only, so all five README languages share the same pair.

Run:  python scripts/gen-readme-assets.py
Needs: Pillow, msyh.ttc / msyhbd.ttc / consola.ttf / consolab.ttf and
       segoeui(b).ttf. Every label is measured before it is drawn, so a label
       that would leave its box aborts the run instead of shipping clipped.
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"
FONT_EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD,
           FONT_EN, FONT_EN_BOLD):
    if not os.path.exists(_p):
        sys.exit(f"FATAL: font missing: {_p}")

# Family palette + the page backgrounds the task fixes for this family.
SKIN = {
    "light": dict(bg_from="#f9f6fd", bg_to="#e4eaf8", card="#ffffff",
                  edge="#e4e1ee", text="#141419", sub="#4d5261",
                  faint="#8f94a4", accent="#4B67B4", accent2="#16a34a",
                  pill="#ece7f9", panel="#f7f4fd", track="#e7e2f2",
                  shadow=(32, 26, 64)),
    "dark": dict(bg_from="#131a2a", bg_to="#0c1016", card="#1b2231",
                 edge="#2e374b", text="#f0f3f9", sub="#a8b1c4",
                 faint="#8791a4", accent="#8496f5", accent2="#3fb950",
                 pill="#242d42", panel="#202939", track="#2b3549",
                 shadow=(0, 0, 0)),
}

_KINDS = {
    "cjk": FONT_CJK, "cjk_bold": FONT_CJK_BOLD,
    "mono": FONT_MONO, "mono_bold": FONT_MONO_BOLD,
    "en": FONT_EN, "en_bold": FONT_EN_BOLD,
}
_MEASURE = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def font(size: int, kind: str = "cjk") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(_KINDS[kind], size)


def tw(text: str, size: int, kind: str) -> float:
    return _MEASURE.textlength(text, font=font(size, kind))


def hx(s: str):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def ink(skin: str, key: str):
    return hx(SKIN[skin][key])


def fit_size(text: str, kind: str, size: int, maxw: float, floor: int) -> int:
    while size > floor and tw(text, size, kind) > maxw:
        size -= 1
    return size


def runs_width(segs, size: int) -> float:
    return sum(tw(text, size, kind) for text, kind in segs)


def fit_runs(segs, size: int, maxw: float, floor: int) -> int:
    while size > floor and runs_width(segs, size) > maxw:
        size -= 1
    return size


def must_fit(text: str, size: int, kind: str, maxw: float, where: str) -> None:
    w = tw(text, size, kind)
    if w > maxw:
        sys.exit(f"FATAL: {where}: {text!r} needs {w:.0f}px at {size}px, "
                 f"the box allows {maxw:.0f}px. Shorten it or widen the box.")


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    a, b = hx(c1), hx(c2)
    for y in range(h):
        t = 0.18 * (y / h) + 0.82 * (y / h) ** 1.6
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(a, b)))
    return img


def glow(img: Image.Image, cx: int, cy: int, r: int, color, alpha: int) -> Image.Image:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(9, 0, -1):
        rr = r * i / 9
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (int(alpha * (1 - i / 10)),))
    return Image.alpha_composite(img.convert("RGBA"),
                                 layer.filter(ImageFilter.GaussianBlur(16))).convert("RGB")


def card(img: Image.Image, box, skin: str, radius: int = 20,
         spread: int = 24) -> Image.Image:
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    for i in range(spread, 0, -3):
        sd.rounded_rectangle([x0 - i // 6, y0 + i // 2, x1 + i // 6, y1 + i],
                             radius=radius + i // 6,
                             fill=SKIN[skin]["shadow"] + (int(10 * (1 - i / spread)),))
    base = Image.alpha_composite(img.convert("RGBA"),
                                 sh.filter(ImageFilter.GaussianBlur(11)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=ink(skin, "card"),
                        outline=ink(skin, "edge"), width=2)
    return base.convert("RGB")


def text(img: Image.Image, xy, s: str, size: int, skin: str, color: str,
         kind: str = "cjk", maxw: float | None = None, where: str = "") -> None:
    if maxw is not None:
        must_fit(s, size, kind, maxw, where or s[:24])
    ImageDraw.Draw(img).text(xy, s, font=font(size, kind), fill=ink(skin, color))


def draw_runs(img: Image.Image, xy, segs, size: int, skin: str, color: str,
              maxw: float | None = None, where: str = "") -> float:
    total = runs_width(segs, size)
    if maxw is not None and total > maxw:
        sys.exit(f"FATAL: {where}: runs need {total:.0f}px at {size}px, "
                 f"the box allows {maxw:.0f}px.")
    d = ImageDraw.Draw(img)
    x, y = xy
    for s, kind in segs:
        d.text((x, y), s, font=font(size, kind), fill=ink(skin, color))
        x += tw(s, size, kind)
    return total


def labeled(img: Image.Image, xy, label: str, label_kind: str, body: str,
            body_kind: str, size: int, skin: str, label_color: str,
            body_color: str, gap: int = 9, maxw: float | None = None,
            where: str = "") -> float:
    d = ImageDraw.Draw(img)
    x, y = xy
    lw = tw(label, size, label_kind)
    bw = tw(body, size, body_kind)
    total = lw + gap + bw
    if maxw is not None and total > maxw:
        sys.exit(f"FATAL: {where}: label+body need {total:.0f}px at {size}px, "
                 f"the box allows {maxw:.0f}px.")
    d.text((x, y), label, font=font(size, label_kind),
           fill=ink(skin, label_color))
    d.text((x + lw + gap, y), body, font=font(size, body_kind),
           fill=ink(skin, body_color))
    return total


def pill(img: Image.Image, xy, s: str, skin: str, size: int = 12,
         kind: str = "mono", fg: str = "accent", bg: str = "pill",
         icon: str | None = None, padx: int = 16) -> int:
    d = ImageDraw.Draw(img)
    f = font(size, kind)
    w = tw(s, size, kind)
    x, y = xy
    h = size + 16
    total = w + padx * 2 + (21 if icon else 0)
    d.rounded_rectangle([x, y, x + total, y + h], radius=h // 2,
                        fill=ink(skin, bg))
    tx = x + padx
    if icon == "lock":
        lock(d, tx, y + (h - 12) / 2, 12, ink(skin, fg), ink(skin, bg))
        tx += 21
    d.text((tx, y + h / 2), s, font=f, fill=ink(skin, fg), anchor="lm")
    return total


def pill_width(s: str, size: int, kind: str, icon: str | None = None,
               padx: int = 16) -> int:
    return tw(s, size, kind) + padx * 2 + (21 if icon else 0)


def lock(d: ImageDraw.ImageDraw, x: float, y: float, s: float, color, bg) -> None:
    d.rounded_rectangle([x, y + s * 0.44, x + s, y + s], radius=s * 0.16,
                        fill=color)
    d.arc([x + s * 0.18, y, x + s * 0.82, y + s * 0.66], 180, 360,
          fill=color, width=max(2, int(s * 0.16)))
    d.ellipse([x + s * 0.42, y + s * 0.62, x + s * 0.58, y + s * 0.78], fill=bg)


def search_icon(d: ImageDraw.ImageDraw, x: float, y: float, s: float, color) -> None:
    d.ellipse([x, y, x + s * 0.68, y + s * 0.68], outline=color, width=2)
    d.line([(x + s * 0.58, y + s * 0.58), (x + s, y + s)], fill=color, width=2)


# ---------------------------------------------------------------------------
# hero copy (all values traced to README / lib/constants.mjs / lib/strings.mjs)
# ---------------------------------------------------------------------------
HERO = {
    "zh": dict(
        kicker=[("DSH 插件 · 记忆接缝", "cjk_bold")],
        value=["跨会话记住该记的事，", "每一次写入都过审批门。"],
        value_kind="cjk_bold",
        sub=[("两轨 × 两层 × 按 ", "cjk"), ("agent", "mono"),
             (" 隔离 · 硬预算", "cjk")],
        meta=[("本地 ", "cjk"), ("SQLite · WAL · 0600", "mono"),
              (" · 零网络 · 零凭据", "cjk")],
        gate="writePolicy: ask",
        write_label="写入", write_label_kind="cjk_bold",
        write="memory / /memory / seed → budget precheck → approval/asked → "
              "decided → insert",
        read_label="检索", read_label_kind="cjk_bold",
        read="memory_recall · case-insensitive substring · CJK-safe · "
             "vector optional",
        units="字符 / 层",
        cells=[("user", "user-global", "2000", "用户画像（全局偏好、沟通风格、雷区）"),
               ("user", "workspace", "2000", "本工作区的用户偏好"),
               ("agent", "user-global", "4000", "环境事实与约定（跨工作区）"),
               ("agent", "workspace", "4000", "本工作区的事实、约定与教训")],
        session_title="systemPrompt",
        session_meta=" · section order -50",
        frozen="frozen once",
        snapshot=["## 用户画像（全局偏好、沟通风格、雷区）",
                  "## 本工作区的事实、约定与教训"],
        audit_label="审计", audit_label_kind="cjk_bold",
        audit="asked + decided · audit table (*-denied) · snapshot row",
        side="dsh-memento-mcp · readOnly",
        foot="Apache-2.0 · v0.5.30 · PerryLink DSH plugin family",
    ),
    "en": dict(
        kicker=[("DSH PLUGIN · MEMORY SEAM", "mono_bold")],
        value=["Remember the things that matter,", "behind an approval gate."],
        value_kind="en_bold",
        sub=[("2 tracks × 2 layers × per-agent · ", "en"),
             ("hard budgets", "en")],
        meta=[("local ", "en"), ("SQLite · WAL · 0600", "mono"),
              (" · no network · no credentials", "en")],
        gate="writePolicy: ask",
        write_label="write", write_label_kind="en_bold",
        write="memory / /memory / seed → budget precheck → approval/asked → "
              "decided → insert",
        read_label="read", read_label_kind="en_bold",
        read="memory_recall · case-insensitive substring · CJK-safe · "
             "vector optional",
        units="chars / layer",
        cells=[("user", "user-global", "2000",
                "User profile: preferences, style, landmines"),
               ("user", "workspace", "2000", "Preferences for this workspace"),
               ("agent", "user-global", "4000",
                "Environment facts and conventions"),
               ("agent", "workspace", "4000",
                "Workspace facts, conventions, lessons")],
        session_title="systemPrompt",
        session_meta=" · section order -50",
        frozen="frozen once",
        snapshot=["## User profile (global preferences, communication style, "
                  "landmines)",
                  "## Workspace facts, conventions, and lessons"],
        audit_label="audit", audit_label_kind="en_bold",
        audit="asked + decided · audit table (*-denied) · snapshot row",
        side="dsh-memento-mcp · readOnly",
        foot="Apache-2.0 · v0.5.30 · PerryLink DSH plugin family",
    ),
}

RX0, RX1 = 736, 1408
STORE = (RX0, 78, RX1, 398)
SESSION = (RX0, 418, RX1, 518)
AUDIT = (RX0, 532, RX1, 562)


def hero_store(img: Image.Image, lang: str, skin: str) -> Image.Image:
    t = HERO[lang]
    img = card(img, STORE, skin)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = STORE
    pad = x0 + 24

    text(img, (pad, y0 + 18), "memory.db", 22, skin, "text", "mono_bold")
    text(img, (pad, y0 + 50), "node:sqlite · WAL · 0600 · $DSH_HOME", 13,
         skin, "sub", "mono", maxw=310, where="store db sub")

    gpw = pill_width(t["gate"], 11.5, "mono", icon="lock", padx=14)
    pill(img, (x1 - 24 - gpw, y0 + 16), t["gate"], skin, 11.5, "mono",
         icon="lock", padx=14)

    # write path band: every surface is forced through the in-service gate
    band = (pad, y0 + 86, x1 - 24, y0 + 124)
    d.rounded_rectangle(band, radius=10, fill=ink(skin, "panel"),
                        outline=ink(skin, "edge"))
    labeled(img, (pad + 12, band[1] + 13), t["write_label"],
            t["write_label_kind"], t["write"], "mono", 12, skin, "accent",
            "sub", gap=9, maxw=band[2] - band[0] - 24, where="write band")

    # 2x2 plate matrix: two tracks x two layers, four hard budgets
    cw, ch, gap = 304, 76, 8
    for i, (track, scope, budget, desc) in enumerate(t["cells"]):
        cx = pad + (i % 2) * (cw + 16)
        cy = y0 + 132 + (i // 2) * (ch + gap)
        d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=14,
                            fill=ink(skin, "panel"),
                            outline=ink(skin, "edge"))
        text(img, (cx + 16, cy + 10), track, 13.5, skin, "text", "mono_bold")
        tx = cx + 16 + tw(track, 13.5, "mono_bold") + 5
        text(img, (tx, cy + 12), "/ " + scope, 12, skin, "sub", "mono")
        nw = tw(budget, 16, "mono_bold")
        uw = tw(t["units"], 9.5, "cjk")
        text(img, (cx + cw - 16 - uw - 7 - nw, cy + 7), budget, 16, skin,
             "text", "mono_bold")
        text(img, (cx + cw - 16 - uw, cy + 12), t["units"], 9.5, skin,
             "faint", "cjk")
        text(img, (cx + 16, cy + 42), desc, 12, skin, "sub",
             "cjk" if lang == "zh" else "en",
             maxw=cw - 32, where="plate desc")

    # retrieval line: the read side of the same store
    ry = y0 + 296
    search_icon(d, pad, ry + 1, 13, ink(skin, "accent"))
    labeled(img, (pad + 22, ry), t["read_label"], t["read_label_kind"],
            t["read"], "mono", 12, skin, "accent", "sub", gap=9,
            maxw=x1 - 24 - (pad + 22), where="read line")
    return img


def hero_session(img: Image.Image, lang: str, skin: str) -> Image.Image:
    t = HERO[lang]
    img = card(img, SESSION, skin)
    x0, y0, x1, y1 = SESSION
    pad = x0 + 24
    text(img, (pad, y0 + 14), t["session_title"], 16, skin, "text", "mono_bold")
    sx = pad + tw(t["session_title"], 16, "mono_bold")
    text(img, (sx, y0 + 18), t["session_meta"], 12, skin, "sub", "mono",
         maxw=270, where="session meta")
    fpw = pill_width(t["frozen"], 11, "mono", padx=13)
    pill(img, (x1 - 24 - fpw, y0 + 10), t["frozen"], skin, 11, "mono",
         fg="accent2", padx=13)

    box = (pad, y0 + 42, x1 - 24, y0 + 92)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius=11, fill=ink(skin, "panel"),
                        outline=ink(skin, "edge"))
    for i, line in enumerate(t["snapshot"]):
        text(img, (pad + 12, y0 + 49 + i * 22), line, 12, skin, "sub",
             "cjk" if lang == "zh" else "en",
             maxw=box[2] - box[0] - 24, where="snapshot line")
    return img


def draw_hero(lang: str, skin: str) -> Image.Image:
    t = HERO[lang]
    img = gradient(1440, 576, SKIN[skin]["bg_from"], SKIN[skin]["bg_to"])
    img = glow(img, 1190, 90, 300, ink(skin, "accent"),
               22 if skin == "light" else 44)
    img = glow(img, 860, 520, 250, ink(skin, "accent"),
               12 if skin == "light" else 24)
    d = ImageDraw.Draw(img)

    # left column
    kw = runs_width(t["kicker"], 15)
    kh = 15 + 18
    d.rounded_rectangle([76, 60, 76 + kw + 34, 60 + kh], radius=kh // 2,
                        fill=ink(skin, "pill"))
    draw_runs(img, (93, 60 + 9), t["kicker"], 15, skin, "accent")

    title = "dsh-memento"
    tsize = fit_size(title, "mono_bold", 84, 584, 78)
    must_fit(title, tsize, "mono_bold", 584, "hero title")
    text(img, (74, 112), title, tsize, skin, "text", "mono_bold")

    y = 236
    for line in t["value"]:
        vkind = t["value_kind"]
        vsize = fit_size(line, vkind, 32, 584, 26)
        must_fit(line, vsize, vkind, 584, "hero value")
        text(img, (76, y), line, vsize, skin, "text", vkind)
        y += 42

    ssize = fit_runs(t["sub"], 26, 584, 25)
    draw_runs(img, (76, 336), t["sub"], ssize, skin, "sub", maxw=584,
              where="hero sub")

    msize = fit_runs(t["meta"], 20, 584, 20)
    draw_runs(img, (76, 388), t["meta"], msize, skin, "faint", maxw=584,
              where="hero meta")

    text(img, (76, 514), t["foot"], 15, skin, "faint", "mono",
         maxw=584, where="hero footer")

    # right column
    img = hero_store(img, lang, skin)
    img = hero_session(img, lang, skin)

    # next assemble: store -> next session's prompt segment
    d = ImageDraw.Draw(img)
    ax = 772
    d.line([(ax, STORE[3] + 1), (ax, SESSION[1] - 8)], fill=ink(skin, "accent"),
           width=2)
    d.polygon([(ax - 4, SESSION[1] - 9), (ax + 4, SESSION[1] - 9),
               (ax, SESSION[1] - 1)], fill=ink(skin, "accent"))
    text(img, (ax + 12, STORE[3] + 3),
         "next assemble · 同步读库并冻结" if lang == "zh"
         else "next assemble · sync read, then frozen",
         12, skin, "accent", "cjk" if lang == "zh" else "en")

    # audit ribbon
    d.rounded_rectangle(AUDIT, radius=15, fill=ink(skin, "panel"),
                        outline=ink(skin, "edge"))
    d.rounded_rectangle([AUDIT[0], AUDIT[1], AUDIT[0] + 5, AUDIT[3]],
                        radius=2.5, fill=ink(skin, "accent"))
    labeled(img, (AUDIT[0] + 20, AUDIT[1] + 8), t["audit_label"],
            t["audit_label_kind"], t["audit"], "mono", 12, skin, "accent",
            "sub", gap=9, maxw=490, where="audit ribbon")
    sw = tw(t["side"], 11, "mono")
    text(img, (AUDIT[2] - 20 - sw, AUDIT[1] + 9), t["side"], 11, skin,
         "faint", "mono")
    return img


# ---------------------------------------------------------------------------
# flow SVG (1100x660): the session -> gate -> store -> frozen read loop
# ---------------------------------------------------------------------------
LIGHT = dict(bg1="#f9f6fd", bg2="#e4eaf8", dots="#d9d3ea", text="#141419",
             sub="#4d5261", faint="#8f94a4", accent="#4B67B4",
             accent2="#16a34a", zone="#f8f6fd", zone_edge="#e7e3f1",
             card="#ffffff", edge="#e4e1ee", panel="#f4f1fb",
             track="#e6e1f2", shadow="#1b1735", shadow_op=".10")
DARK = dict(bg1="#131a2a", bg2="#0c1016", dots="#26314a", text="#f0f3f9",
            sub="#a8b1c4", faint="#8791a4", accent="#8496f5",
            accent2="#3fb950", zone="#151d2b", zone_edge="#2b3448",
            card="#1b2231", edge="#2e374b", panel="#202939",
            track="#2b3549", shadow="#000000", shadow_op=".55")

MONO = "Consolas, ui-monospace, SFMono-Regular, Menlo, monospace"
SANS = ("Segoe UI, Microsoft YaHei, ui-sans-serif, system-ui, "
        "sans-serif")


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def T(x, y, s, size, fill, weight=None, family=MONO, anchor=None, ls=None):
    attrs = [f'x="{x}"', f'y="{y}"', f'fill="{fill}"',
             f'font-family="{family}"', f'font-size="{size}"']
    if weight:
        attrs.append(f'font-weight="{weight}"')
    if anchor:
        attrs.append(f'text-anchor="{anchor}"')
    if ls:
        attrs.append(f'letter-spacing="{ls}"')
    return f'<text {" ".join(attrs)}>{esc(s)}</text>'


def R(x, y, w, h, fill, stroke=None, rx=0, sw=1, dash=None, flt=None, op=None):
    attrs = [f'x="{x}"', f'y="{y}"', f'width="{w}"', f'height="{h}"',
             f'fill="{fill}"']
    if rx:
        attrs.append(f'rx="{rx}"')
    if stroke:
        attrs += [f'stroke="{stroke}"', f'stroke-width="{sw}"']
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    if flt:
        attrs.append(f'filter="url(#{flt})"')
    if op:
        attrs.append(f'opacity="{op}"')
    return f'<rect {" ".join(attrs)}/>'


def P(d, stroke, width=2, fill="none", marker=None, dash=None):
    attrs = [f'd="{d}"', f'fill="{fill}"', f'stroke="{stroke}"',
             f'stroke-width="{width}"']
    if marker:
        attrs.append(f'marker-end="url(#{marker})"')
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    return f'<path {" ".join(attrs)}/>'


def flow_svg(skin: str) -> str:
    s = LIGHT if skin == "light" else DARK
    out = []
    add = out.append

    add('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" '
        'viewBox="0 0 1100 660" role="img" aria-labelledby="t d">')
    add('<title id="t">dsh-memento structure: a loop between two sessions — '
        'session S1 writes through the in-service approval gate into the '
        'SQLite store, the audit chain records it, and session S2\'s first '
        'assemble reads the store and freezes it into the systemPrompt '
        'segment</title>')
    add('<desc id="d">Left column: session S1 (memory tool, /memory command, '
        'adapter seed) and session S2 (systemPrompt segment order -50, '
        'frozen once, mid-turn memory_recall), separated by a new-session '
        'rail. Top lane: MemoryProtocolCore does the budget precheck and the '
        'unique substring match, then the approval gate (writePolicy ask, '
        'auto or off) carries approval/asked + approval/decided with the full '
        'changed text as the payload; denied writes still leave a *-denied '
        'row. Middle: the audit chain — session log approval pair, plugin '
        'audit table, and the snapshot row that matches system/message '
        'verbatim. Bottom lane: the next assemble reads the store '
        'synchronously and freezes one snapshot. Right column: memory.db '
        '(node:sqlite, WAL, 0600) with entries, audit, proposals and meta, '
        'the four per-track/per-layer budgets (2000 / 2000 / 4000 / 4000), '
        'and the read-only MCP side door.</desc>')
    add('<defs>')
    add(f'<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">'
        f'<stop offset="0" stop-color="{s["bg1"]}"/>'
        f'<stop offset="1" stop-color="{s["bg2"]}"/></linearGradient>')
    add(f'<filter id="soft" x="-30%" y="-30%" width="160%" height="180%">'
        f'<feDropShadow dx="0" dy="8" stdDeviation="11" '
        f'flood-color="{s["shadow"]}" flood-opacity="{s["shadow_op"]}"/>'
        f'</filter>')
    add(f'<pattern id="dots" width="26" height="26" '
        f'patternUnits="userSpaceOnUse"><circle cx="1.4" cy="1.4" r="1.4" '
        f'fill="{s["dots"]}"/></pattern>')
    add(f'<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" '
        f'markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" '
        f'orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" '
        f'fill="{s["accent"]}"/></marker>')
    add(f'<marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" '
        f'markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" '
        f'orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" '
        f'fill="{s["accent2"]}"/></marker>')
    add('</defs>')
    add(R(0, 0, 1100, 660, "url(#bg)"))
    add(R(0, 0, 1100, 660, "url(#dots)", op=".45"))

    # header
    add(T(44, 58, "dsh-memento", 32, s["text"], 700))
    add(T(44, 88, "one store, one gate, one frozen read — the loop between "
                  "two sessions", 15, s["sub"], family=SANS))
    add(T(1056, 56, "v0.5.30 · ctx.memory · node:sqlite · read-only MCP", 13,
          s["faint"], anchor="end"))
    add(f'<line x1="40" y1="104" x2="1060" y2="104" stroke="{s["edge"]}" '
        f'stroke-width="2"/>')

    # ---------------- left: session column ----------------
    add(R(40, 120, 260, 476, s["zone"], s["zone_edge"], rx=22))
    add(T(60, 148, "SESSION", 11, s["faint"], 700, ls="1.4"))
    add(T(60, 172, "S1 · write turn", 12.5, s["accent"], 700))
    add(R(56, 186, 228, 124, s["card"], s["edge"], rx=18, flt="soft"))
    add(T(72, 208, "memory tool", 16, s["text"], 700))
    add(T(72, 232, "add · replace · remove", 12.5, s["sub"], family=SANS))
    add(T(72, 252, "consolidate → proposal", 12.5, s["sub"], family=SANS))
    add(T(72, 272, "/memory cmd · adapters seed", 12.5, s["sub"], family=SANS))
    add(T(72, 294, "agentKey + workspaceKey", 11, s["faint"]))

    # new-session rail between the two halves of the loop
    add(P("M74 316 V376", s["faint"], 1.6, dash="5 5", marker="arr"))
    add(T(88, 340, "session ends", 11, s["faint"], family=SANS))
    add(T(88, 356, "next session starts", 11, s["faint"], family=SANS))

    add(T(60, 398, "S2 · next assemble", 12.5, s["accent"], 700))
    add(R(56, 412, 228, 166, s["card"], s["edge"], rx=18, flt="soft"))
    add(T(72, 434, "systemPrompt", 16, s["text"], 700))
    add(T(72, 458, "segment order -50", 12.5, s["sub"], family=SANS))
    add(T(72, 478, "snapshot frozen once", 12.5, s["sub"], family=SANS))
    add(T(72, 498, "memory_recall · mid-turn", 12.5, s["sub"], family=SANS))
    add(T(72, 520, "system/message · verbatim", 11, s["faint"]))
    add(R(72, 534, 92, 24, s["panel"], s["edge"], rx=12))
    add(T(118, 550, "frozen", 11, s["accent2"], 700, anchor="middle"))

    # ---------------- right: store column ----------------
    add(R(800, 120, 260, 476, s["zone"], s["zone_edge"], rx=22))
    add(T(820, 148, "STORE", 11, s["faint"], 700, ls="1.4"))
    add(T(820, 172, "memory.db", 18, s["text"], 700))
    add(T(820, 192, "node:sqlite · WAL · 0600", 11, s["sub"]))

    tables = [
        ("entries", "text · tags · version · recall", "track × scope"),
        ("audit", "asked · decided · *-denied", "chain"),
        ("proposals", "pending · max 8", "queue"),
        ("meta", "schema_version 4", "loud check"),
    ]
    for i, (name, sub, right) in enumerate(tables):
        y = 210 + i * 40
        add(T(820, y, name, 13, s["text"], 700))
        add(T(1040, y - 1, right, 11, s["faint"], anchor="end"))
        add(T(820, y + 17, sub, 11, s["faint"]))

    add(T(820, 392, "CHAR BUDGET · TRACK × SCOPE", 11, s["accent"], 700,
          ls="0.8"))
    budgets = [("user / user-global", "2000"), ("user / workspace", "2000"),
               ("agent / user-global", "4000"), ("agent / workspace", "4000")]
    for i, (label, cap) in enumerate(budgets):
        y = 408 + i * 22
        add(T(820, y, label, 11, s["sub"]))
        add(T(1040, y, cap, 11, s["text"], 700, anchor="end"))
    add(T(820, 508, "hard cap · never truncated", 11, s["faint"],
          family=SANS))

    add(R(820, 522, 220, 30, s["panel"], s["edge"], rx=10))
    add(T(834, 542, "dsh-memento-mcp · readOnly", 11, s["accent"], 700))
    add(T(820, 572, "no network · no credentials", 11, s["faint"],
          family=SANS))

    # ---------------- top lane: gated write ----------------
    add(T(320, 162, "WRITE PATH · GATED IN THE SERVICE", 11.5, s["accent"],
          700, ls="0.9"))
    add(R(320, 178, 200, 142, s["card"], s["edge"], rx=18, flt="soft"))
    add(T(336, 198, "protocol core", 11, s["accent"], 700))
    add(T(336, 220, "MemoryProtocolCore", 13.5, s["text"], 700))
    add(T(336, 240, "lib/protocol.mjs", 11, s["faint"]))
    add(T(336, 260, "budget precheck", 12, s["sub"], family=SANS))
    add(T(336, 280, "unique substring match", 12, s["sub"], family=SANS))
    add(T(336, 300, "0 / 2+ hits → error", 12, s["sub"], family=SANS))

    add(R(540, 178, 240, 142, s["card"], s["accent"], rx=18, sw=2.2,
          flt="soft"))
    add(T(556, 198, "approval gate", 11, s["accent"], 700))
    add(T(556, 220, "writePolicy", 14.5, s["text"], 700))
    for i, pol in enumerate(("ask", "auto", "off")):
        px = 556 + i * 46
        add(R(px, 230, 40, 18, s["panel"], s["edge"], rx=9))
        add(T(px + 20, 243, pol, 11, s["sub"], anchor="middle"))
    add(T(556, 264, "approval/asked → decided", 11, s["sub"]))
    add(T(556, 284, "payload = full changed text", 11, s["sub"]))
    add(T(556, 304, "denied → *-denied row", 11, s["sub"]))
    add(f'<circle cx="756" cy="214" r="3" fill="{s["accent"]}"/>')
    add(f'<circle cx="756" cy="214" r="7" fill="none" stroke="{s["accent"]}" '
        f'stroke-width="1.2" opacity=".5"/>')

    # arrows: session -> core -> gate -> store
    add(P("M288 249 H314", s["accent"], 2.2, marker="arr"))
    add(P("M520 249 H534", s["accent"], 2.2, marker="arr"))
    add(P("M780 249 H794", s["accent"], 2.2, marker="arr"))

    # ---------------- middle: audit chain ----------------
    add(R(320, 340, 460, 76, s["panel"], s["accent"], rx=18, sw=1.2,
          dash="6 5"))
    add(T(336, 358, "AUDIT CHAIN · REBUILDABLE", 11, s["accent"], 700,
          ls="0.8"))
    columns = [(336, "session log", "asked + decided"),
               (488, "audit table", "*-denied · snapshot"),
               (640, "system/message", "same text, verbatim")]
    for x, head, sub in columns:
        add(T(x, 378, head, 11.5, s["text"], 700))
        add(T(x, 396, sub, 11, s["faint"]))
    add(P("M660 320 V337", s["accent"], 1.6, dash="5 4", marker="arr"))
    add(P("M780 378 H796", s["accent"], 1.6, dash="5 4", marker="arr"))

    # ---------------- bottom lane: frozen read ----------------
    add(T(320, 436, "READ PATH · NO APPROVAL · FROZEN FOR THE SESSION", 11.5,
          s["accent"], 700, ls="0.9"))
    add(R(540, 452, 240, 126, s["card"], s["edge"], rx=18, flt="soft"))
    add(T(556, 472, "read provider", 11, s["accent"], 700))
    add(T(556, 494, "assemble · sync read", 14, s["text"], 700))
    add(T(556, 520, "SQLite sync read", 12, s["sub"], family=SANS))
    add(T(556, 540, "WeakMap per session", 12, s["sub"], family=SANS))
    add(T(556, 560, "first assemble only", 12, s["sub"], family=SANS))

    add(R(320, 452, 200, 126, s["card"], s["edge"], rx=18, flt="soft"))
    add(T(336, 472, "injected segment", 11, s["accent"], 700))
    add(T(336, 494, "frozen snapshot", 14, s["text"], 700))
    add(T(336, 520, "one render, then frozen", 12, s["sub"], family=SANS))
    add(T(336, 540, "section order -50", 12, s["sub"], family=SANS))
    add(T(336, 560, "prefix cache stable", 12, s["sub"], family=SANS))

    add(P("M800 515 H785", s["accent"], 2.2, marker="arr"))
    add(P("M540 515 H525", s["accent"], 2.2, marker="arr"))
    add(P("M320 515 H289", s["accent"], 2.2, marker="arr"))

    # footer
    add(f'<line x1="40" y1="604" x2="1060" y2="604" stroke="{s["edge"]}" '
        f'stroke-width="2"/>')
    add(T(44, 622, "budget enforced twice — precheck before the ask, recheck "
                   "after it — and never truncated", 12.5, s["sub"],
          family=SANS))
    add(T(44, 644, "2 tracks × 2 scopes × per-agent key · MCP side door is "
                   "readOnly · *-denied rows keep refused writes visible",
          11.5, s["faint"]))
    add('</svg>')
    return "\n".join(out) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    wrote = 0
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            hero = draw_hero(lang, skin)
            path = os.path.join(
                OUT, f"dsh-memento-hero-{lang}-{skin}.webp")
            hero.save(path, "WEBP", quality=90, method=6)
            wrote += 1
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"dsh-memento-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
        wrote += 1
    print(f"wrote {wrote} assets to docs/assets/ "
          f"(hero 1440x576 webp x4, flow 1100x660 svg x2)")


if __name__ == "__main__":
    main()
