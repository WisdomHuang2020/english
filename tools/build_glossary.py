#!/usr/bin/env python3
"""把《SSE常用英语2026-07-18整理版.xlsx》转成站点用的数据文件。

用法（在仓库根执行）：
    python tools/build_glossary.py "D:/01-Work/DESIGN/设计资料/书籍/英语/SSE常用英语2026-07-18整理版.xlsx"

产物：assets/js/glossary-data.js
    window.PK_GLOSSARY = { meta, abbr:[{en,cn,items:[{en,cn}]}], words:[{en,cn}], quotes:[{en,cn,src}] }

原则：
  · **逐字保留原表内容**（不擅自纠错）。原表的笔误、口径问题统一记在
    assets/js/glossary-notes.js 的 errata 里，页面上单独展示，改表与改站分开。
  · 只做空白归一（多空格/换行压成单空格），不改用词。
"""
import json
import sys
from pathlib import Path

import openpyxl

DEFAULTS = [
    r"D:/01-Work/DESIGN/设计资料/书籍/英语/SSE常用英语2026-07-18整理版.xlsx",
]

ABBR_COLS = 3   # 每组：序号 / 英文 / 中文
WORD_COLS = 3


def norm(v):
    if v is None:
        return ""
    return " ".join(str(v).split())


def read_abbr(wb):
    ws = wb["常用缩写"]
    cats = []
    for c in range(1, ws.max_column + 1, ABBR_COLS):
        en = norm(ws.cell(row=2, column=c + 1).value)
        cn = norm(ws.cell(row=2, column=c + 2).value)
        if not en:
            continue
        items = []
        for r in range(3, ws.max_row + 1):
            e = ws.cell(row=r, column=c + 1).value
            n = ws.cell(row=r, column=c + 2).value
            if e is None:
                continue
            items.append({"en": norm(e), "cn": norm(n)})
        cats.append({"en": en, "cn": cn, "items": items})
    return cats


def read_words(wb):
    ws = wb["新单词"]
    buckets = {}
    for r in range(1, ws.max_row + 1):
        for c in range(1, ws.max_column + 1, WORD_COLS):
            num = ws.cell(row=r, column=c).value
            en = ws.cell(row=r, column=c + 1).value
            cn = ws.cell(row=r, column=c + 2).value
            if en is None:
                continue
            try:
                n = int(str(num).strip())
            except (TypeError, ValueError):
                continue
            buckets[n] = {"en": norm(en), "cn": norm(cn)}
    return [buckets[k] for k in sorted(buckets)]


def read_quotes(wb):
    """精句表排版错位，不能按固定行序读。

    实测版式（2026-11-10）：
        row2 = 序号1·英文1 / row3 = 译文1 / row4 = 出处1
        row5 = 序号2·英文2 / row6 = 译文2 / row7 = 出处2
        row8 = 英文3（无序号） / row9 = 序号3·译文3 / row10 = 出处3
        row11 = 英文4（无序号） / row12 = 序号4·译文4 / row13 = 出处4

    即前两条是「序号行里带英文」，后两条是「英文单独一行、序号行里带译文」。
    因此按**语言与形态**归类，而不是按行号：
        含中日韩字符 → 译文；以 - — 《 开头 → 出处；其余 → 英文原句
    """
    ws = wb["英语精句"]
    lines = []
    for r in range(1, ws.max_row + 1):
        b = norm(ws.cell(row=r, column=2).value)
        if b:
            lines.append(b)

    def has_cjk(s):
        return any("\u4e00" <= ch <= "\u9fff" for ch in s)

    quotes, cur = [], None
    for b in lines:
        if b.startswith(("-", "—", "《")):
            if cur is not None:
                s = b.lstrip("-— ").strip()
                # 只有整串被书名号包住时才剥掉外壳，避免把「Forrest Gump《阿甘正传》」的尾号也吃掉
                if s.startswith("《") and s.endswith("》"):
                    s = s.strip("《》")
                cur["src"] = s
            continue
        kind = "cn" if has_cjk(b) else "en"
        if cur is None or cur[kind]:
            if cur is not None and (cur["en"] or cur["cn"]):
                quotes.append(cur)
            cur = {"en": "", "cn": "", "src": ""}
        cur[kind] = b
    if cur is not None and (cur["en"] or cur["cn"]):
        quotes.append(cur)
    return quotes


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULTS[0])
    if not src.exists():
        print(f"找不到源文件：{src}", file=sys.stderr)
        return 1
    wb = openpyxl.load_workbook(src, data_only=True)
    abbr = read_abbr(wb)
    words = read_words(wb)
    quotes = read_quotes(wb)

    meta = {
        "source": src.name,
        "sourceDate": "2026-07-18",
        "built": "2026-11-10",
        "abbrCount": sum(len(c["items"]) for c in abbr),
        "wordCount": len(words),
        "quoteCount": len(quotes),
    }
    out = Path("assets/js/glossary-data.js")
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"meta": meta, "abbr": abbr, "words": words, "quotes": quotes},
                         ensure_ascii=False, separators=(",", ":"))
    out.write_text(
        "/* 自动生成，勿手改 —— 由 tools/build_glossary.py 从 "
        f"{src.name} 生成于 {meta['built']} */\n"
        "window.PK_GLOSSARY=" + payload + ";\n",
        encoding="utf-8",
    )
    print(f"写出 {out}：{meta['abbrCount']} 缩写 / {meta['wordCount']} 词 / {meta['quoteCount']} 精句")
    for q in quotes:
        print("  ·", q["en"][:52], "|", q["cn"][:24], "|", q["src"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
