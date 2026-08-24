# -*- coding: utf-8 -*-
"""
央视《新闻联播》抓取 + 归纳 + 网站数据生成

数据来源：央视网 tv.cctv.com《新闻联播》文字版（官方公开页面，服务端渲染）
归纳方式：本地规则（关键词分类 + 首句摘要），不调用任何大模型

本地用法：
    python cctv_news.py                     # 抓今天（未发布则自动回退昨天），输出 md/html
    python cctv_news.py 20260823            # 抓指定日期
    python cctv_news.py yesterday
    python cctv_news.py --open              # 跑完用浏览器打开网页版摘要

网站数据用法（GitHub Actions 里跑的就是这个）：
    python cctv_news.py --site              # 抓今天 + 补齐近30天缺失，写 docs/data/*.json
    python cctv_news.py --site --days 90    # 补齐近90天
    python cctv_news.py --site --from 2026-08-01 --to 2026-08-20   # 补抓指定区间
"""

import html as html_lib
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
FULLTEXT_DIR = os.path.join(DATA_DIR, "fulltext")
SITE_DATA_DIR = os.path.join(BASE_DIR, "docs", "data")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# 部署环境可能带失效代理，全部请求强制直连（本地/云端 runner 通用）
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


# ---------------------------------------------------------------- HTTP 基础

def http_get(url: str, timeout: int = 20, retries: int = 2) -> str:
    """带重试的 GET，返回解码后的 HTML 文本"""
    last_err = None
    for i in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with OPENER.open(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", "ignore")
        except Exception as e:
            last_err = e
            if i < retries:
                time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"请求失败 {url}: {last_err}")


# ---------------------------------------------------------------- 抓取央视网

def fetch_day_list(day: date) -> list:
    """抓某一天的新闻条目列表，返回 [{"url", "title"}]"""
    url = f"https://tv.cctv.com/lm/xwlb/day/{day:%Y%m%d}.shtml"
    page = http_get(url)

    # 日页面上每条新闻是一个 VIDE 链接（出现两次，其中一次带标题）
    items = {}
    for link, raw_title in re.findall(
            r'href="(https://tv\.cctv\.com/\d{4}/\d{2}/\d{2}/VIDE\w+\.shtml)"[^>]*>(.*?)</a>',
            page, re.S):
        title = re.sub(r"<[^>]+>", "", raw_title).strip()
        if not title:
            continue
        title = re.sub(r"^完整版\[视频\]", "", title).strip()
        if re.match(r"^完整版《新闻联播》", title):  # 跳过整期完整版视频本身
            continue
        items[link] = {"url": link, "title": title}

    return list(items.values())


def fetch_item_text(url: str) -> str:
    """抓单条新闻的正文（页面里 id=content_area 的 <p> 段落）"""
    page = http_get(url)
    m = re.search(r'id="content_area">(.*?)</div>', page, re.S)
    if not m:
        return ""
    paragraphs = []
    for p in re.findall(r"<p[^>]*>(.*?)</p>", m.group(1), re.S):
        text = re.sub(r"<[^>]+>", "", p)
        text = html_lib.unescape(text).strip()
        if text:
            paragraphs.append(text)
    body = "\n\n".join(paragraphs)
    return re.sub(r"^央视网消息[（(]新闻联播[）)][:：]?", "", body).strip()


def fetch_full_day(day: date) -> list:
    """抓取一天的全部条目（列表 + 逐条正文 + 分类）"""
    items = fetch_day_list(day)
    for it in items:
        try:
            it["text"] = fetch_item_text(it["url"])
        except Exception as e:
            print(f"  [warn] 正文抓取失败：{it['title']}（{e}）")
            it["text"] = ""
        time.sleep(0.4)  # 礼貌抓取，别给服务器压力
    for it in items:
        it["category"] = categorize(it["title"], it["text"])
        it["gist"] = first_sentence(it["text"]) if it["text"] else ""
    return items


# ---------------------------------------------------------------- 本地归纳

CATEGORY_RULES = [
    # 强时政词优先；"总理/中央/会议/考察"这类弱词容易误伤（如外国总理、科考），
    # 单独拆出来放在最后兜底
    ("时政要闻", ["习近平", "总书记", "中共中央", "国务院", "会见", "出席", "重要讲话",
                "调研", "部委"]),
    ("军事国防", ["军队", "解放军", "演习", "国防", "部队", "战机", "航母", "导弹", "军人"]),
    ("国际新闻", ["美国", "俄罗斯", "乌克兰", "加沙", "以色列", "伊朗", "朝鲜", "韩国", "日本",
                "印度", "欧盟", "英国", "法国", "德国", "联合国", "国际", "巴以", "中东",
                "外国", "总统", "访华", "峰会", "外交部", "大使馆", "加拿大", "关税"]),
    ("科技教育", ["航天", "卫星", "飞船", "火箭", "科技", "人工智能", "大数据", "芯片", "创新",
                "实验室", "研究", "教育", "开学", "高校", "科学", "机器人"]),
    ("经济财经", ["经济", "增长", "出口", "进口", "市场", "金融", "企业", "产业", "投资",
                "消费", "贸易", "粮食", "丰收", "乡村振兴", "工程", "建设", "项目",
                "电子商务", "银行", "农机"]),
    ("社会民生", ["民生", "医疗", "健康", "养老", "社保", "住房", "救灾", "防汛", "台风",
                "地震", "火灾", "安全", "交通", "铁路", "假期", "旅游", "体育", "奥运",
                "冠军", "文化", "演出", "文博", "生态", "环保", "治理"]),
    ("时政要闻", ["总理", "主席", "中央", "大会", "会议", "考察", "讲话"]),
]

CATEGORY_ORDER = list(dict.fromkeys([c for c, _ in CATEGORY_RULES])) + ["其他"]


def categorize(title: str, text: str) -> str:
    """按关键词优先级给新闻分类（标题命中的权重高于正文）"""
    sample = text[:300]
    for name, words in CATEGORY_RULES:
        if any(w in title for w in words):
            return name
    for name, words in CATEGORY_RULES:
        if any(w in sample for w in words):
            return name
    return "其他"


def first_sentence(text: str, limit: int = 80) -> str:
    """取正文第一句作为一句话摘要"""
    for sep in ["。", "！", "？"]:
        text = text.split(sep)[0] + sep if sep in text else text
    text = text.replace("\n", " ").strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def group_by_category(items) -> dict:
    by_cat = {}
    for it in items:
        by_cat.setdefault(it["category"], []).append(it)
    return by_cat


def local_highlights(items) -> list:
    """本地规则生成"今日要点"：头条带摘要 + 次重要的标题"""
    if not items:
        return []
    head = [{"title": items[0]["title"], "gist": first_sentence(items[0]["text"], 120)}]
    return head + [{"title": it["title"], "gist": it["gist"]} for it in items[1:4]]


# ---------------------------------------------------------------- 网站数据导出

def write_site_json(day: date, items) -> str:
    """把一天的数据写成 docs/data/YYYY-MM-DD.json（前端读这个）"""
    by_cat = group_by_category(items)
    data = {
        "date": f"{day:%Y-%m-%d}",
        "weekday": "一二三四五六日"[day.weekday()],
        "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(items),
        "highlights": local_highlights(items),
        "categories": {
            cat: [{"title": it["title"], "url": it["url"], "gist": it["gist"]}
                  for it in by_cat.get(cat, [])]
            for cat in CATEGORY_ORDER if by_cat.get(cat)
        },
        "items": [
            {"title": it["title"], "url": it["url"], "category": it["category"],
             "gist": it["gist"], "text": it["text"] or ""}
            for it in items
        ],
    }
    os.makedirs(SITE_DATA_DIR, exist_ok=True)
    path = os.path.join(SITE_DATA_DIR, f"{day:%Y-%m-%d}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    return path


def update_site_index():
    """扫描 docs/data/ 生成 index.json（前端据此列日期）"""
    dates = sorted(
        m.group(1) for p in os.listdir(SITE_DATA_DIR)
        if (m := re.match(r"(\d{4}-\d{2}-\d{2})\.json$", p))
    )
    index = {"updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
             "dates": dates}
    path = os.path.join(SITE_DATA_DIR, "index.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    return path


def site_update(days_back: int = 30, from_day=None, to_day=None) -> list:
    """网站模式主流程：抓今天+补近N天（或指定区间），返回成功写入的日期"""
    today = date.today()
    if from_day and to_day:
        d, targets = from_day, []
        while d <= to_day:
            targets.append(d)
            d += timedelta(days=1)
    else:
        targets = [today - timedelta(days=i) for i in range(days_back - 1, -1, -1)]

    done = []
    for d in targets:
        json_path = os.path.join(SITE_DATA_DIR, f"{d:%Y-%m-%d}.json")
        if os.path.exists(json_path):
            continue  # 已有数据就跳过（补齐式抓取）
        try:
            items = fetch_full_day(d)
        except Exception as e:
            print(f"[skip] {d:%Y-%m-%d} 抓取失败：{e}")
            continue
        if not items and d == today:
            continue  # 今天还没发布，下次再说
        if not items:
            print(f"[skip] {d:%Y-%m-%d} 无条目（可能是当天未发布或页面缺失）")
            continue
        write_site_json(d, items)
        done.append(f"{d:%Y-%m-%d}")
        print(f"[ok] {d:%Y-%m-%d} {len(items)}条 已写入")
    update_site_index()
    print(f"[done] 本次新增 {len(done)} 天，库中共 "
          f"{len(json.load(open(os.path.join(SITE_DATA_DIR, 'index.json'), encoding='utf-8'))['dates'])} 天")
    return done


# ---------------------------------------------------------------- 本地 md/html 输出
#（本地命令行模式用；网站模式不生成这两样，减少仓库体积）

def render_markdown(day: date, items, summary_md: str, by_cat: dict) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"# 《新闻联播》摘要 · {day:%Y-%m-%d}",
        "",
        f"> 抓取时间 {now} ｜ 共 {len(items)} 条 ｜ 本地规则归纳",
        "",
        "## 今日要点",
        "",
        summary_md,
        "",
        "## 分类明细",
        "",
    ]
    for cat in CATEGORY_ORDER:
        if cat not in by_cat:
            continue
        lines.append(f"### {cat}（{len(by_cat[cat])}条）")
        lines.append("")
        for it in by_cat[cat]:
            gist_part = f"：{it['gist']}" if it["gist"] else ""
            lines.append(f"- **[{it['title']}]({it['url']})**{gist_part}")
        lines.append("")
    lines += [
        "---",
        "*数据来源：央视网 tv.cctv.com《新闻联播》文字版*",
        "",
    ]
    return "\n".join(lines)


def save_fulltext(day: date, items):
    os.makedirs(FULLTEXT_DIR, exist_ok=True)
    path = os.path.join(FULLTEXT_DIR, f"{day:%Y-%m-%d}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# 新闻联播全文 · {day:%Y-%m-%d}\n\n")
        for it in items:
            f.write(f"## {it['title']}\n\n来源：{it['url']}\n\n")
            f.write((it["text"] or "（未抓到正文）") + "\n\n---\n\n")
    return path


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>新闻联播摘要 {title_day}</title>
<style>
  body {{ font-family: "Microsoft YaHei", system-ui, sans-serif; max-width: 46em;
         margin: 2em auto; padding: 0 1.2em; line-height: 1.7; color: #222; }}
  h1 {{ font-size: 1.6em; border-bottom: 2px solid #c00; padding-bottom: .3em; }}
  h2 {{ font-size: 1.25em; margin-top: 1.6em; color: #a00; }}
  h3 {{ font-size: 1.05em; margin-bottom: .3em; }}
  .meta {{ color: #666; font-size: .9em; }}
  a {{ color: #06c; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  li {{ margin: .35em 0; }}
  hr {{ border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }}
</style>
</head>
<body>
{body}
<p class="meta">数据来源：央视网 tv.cctv.com《新闻联播》文字版</p>
</body>
</html>
"""


def _inline_md(text: str) -> str:
    """处理行内 markdown：先转义 HTML，再加链接/加粗/斜体"""
    s = html_lib.escape(text)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" target="_blank">\1</a>', s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
    return re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", s)


def md_to_html(md: str, day: date) -> str:
    """把生成的 markdown 摘要转成 HTML（只覆盖用到的语法子集）"""
    out, in_list = [], False
    for ln in md.split("\n"):
        stripped = ln.strip()
        if not stripped:
            if in_list:
                out.append("</ul>")
                in_list = False
            continue
        if ln.startswith("### "):
            out.append(f"<h3>{_inline_md(ln[4:])}</h3>")
        elif ln.startswith("## "):
            out.append(f"<h2>{_inline_md(ln[3:])}</h2>")
        elif ln.startswith("# "):
            out.append(f"<h1>{_inline_md(ln[2:])}</h1>")
        elif stripped == "---":
            out.append("<hr>")
        elif ln.startswith("> "):
            out.append(f'<p class="meta">{_inline_md(ln[2:])}</p>')
        elif ln.startswith("- ") or re.match(r"^\d+\. ", ln):
            if not in_list:
                out.append("<ul>")
                in_list = True
            item = re.sub(r"^(- |\d+\. )", "", ln)
            out.append(f"<li>{_inline_md(item)}</li>")
        else:
            if in_list:
                out.append("</ul>")
                in_list = False
            out.append(f"<p>{_inline_md(ln)}</p>")
    if in_list:
        out.append("</ul>")
    return HTML_TEMPLATE.format(title_day=f"{day:%Y-%m-%d}", body="\n".join(out))


# ---------------------------------------------------------------- 主流程

def parse_date_arg(arg: str) -> date:
    if arg in ("today", None):
        return date.today()
    if arg == "yesterday":
        return date.today() - timedelta(days=1)
    digits = re.sub(r"\D", "", arg)
    if len(digits) == 8:
        return datetime.strptime(digits, "%Y%m%d").date()
    raise SystemExit(f"无法识别的日期：{arg}（示例：20260823 / 2026-08-23 / today / yesterday）")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 控制台中文兼容

    argv = sys.argv[1:]
    open_after = "--open" in argv

    # ---- 网站模式 ----
    if "--site" in argv:
        def opt(name, default=None):
            return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default
        days = int(opt("--days", 30))
        from_s, to_s = opt("--from"), opt("--to")
        from_day = to_day = None
        if from_s and to_s:
            from_day = parse_date_arg(from_s)
            to_day = parse_date_arg(to_s)
        site_update(days, from_day, to_day)
        return

    # ---- 本地命令行模式 ----
    args = [a for a in argv if not a.startswith("--")]
    day = parse_date_arg(args[0] if args else "today")

    print(f"[1/4] 抓取 {day:%Y-%m-%d} 《新闻联播》条目列表 …")
    items = []
    try:
        items = fetch_day_list(day)
    except Exception as e:
        print(f"[warn] 抓取失败：{e}")
    actual_day = day
    if not items and day == date.today():
        print("[info] 当天内容尚未发布（每晚约20:30后更新），改为抓取昨天 …")
        actual_day = day - timedelta(days=1)
        items = fetch_day_list(actual_day)
    if not items:
        raise SystemExit(f"[error] {day:%Y-%m-%d} 没有抓到任何条目")

    print(f"[2/4] 共 {len(items)} 条，逐条抓正文 …")
    items = fetch_full_day(actual_day)
    print(f"  正文抓到 {sum(1 for i in items if i['text'])} 条")

    print("[3/4] 分类与归纳 …")
    by_cat = group_by_category(items)
    hl = local_highlights(items)
    summary_md = "\n".join(
        [f"1. **{hl[0]['title']}**：{hl[0]['gist']}"] + [f"- {h['title']}" for h in hl[1:]]
        + ["", f"本期共 {len(items)} 条（" + "、".join(f"{c}{len(v)}条" for c, v in by_cat.items()) + "）。"]
    ) if hl else ""

    os.makedirs(DATA_DIR, exist_ok=True)
    md = render_markdown(actual_day, items, summary_md, by_cat)
    out_path = os.path.join(DATA_DIR, f"{actual_day:%Y-%m-%d}.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(md)
    html_path = os.path.join(DATA_DIR, f"{actual_day:%Y-%m-%d}.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(md_to_html(md, actual_day))
    ft_path = save_fulltext(actual_day, items)

    print(f"[4/4] 完成")
    print(f"  摘要 → {out_path}")
    print(f"  网页 → {html_path}")
    print(f"  全文 → {ft_path}")
    print("\n-------- 今日要点 --------")
    print(summary_md)

    if open_after:
        try:
            os.startfile(html_path)
        except Exception as e:
            print(f"[warn] 自动打开摘要失败：{e}")


if __name__ == "__main__":
    main()
