#!/usr/bin/env python3
"""校验保研通知数据，并检查官方通知链接。仅使用 Python 标准库。"""

from __future__ import annotations

import argparse
import json
import re
import socket
import ssl
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "notices.json"

REQUIRED_FIELDS = (
    "id",
    "university",
    "college",
    "category",
    "admissionYear",
    "title",
    "directions",
    "roboticsEligibility",
    "matchLevel",
    "publishDate",
    "deadline",
    "status",
    "officialUrl",
    "lastVerified",
    "notes",
)
ALLOWED_CATEGORIES = {"夏令营", "预推免"}
ALLOWED_STATUSES = {"报名中", "即将截止", "已截止", "待发布", "链接待核验"}
ALLOWED_MATCH_LEVELS = {"高", "中", "低"}
BLOCKED_DOMAINS = {
    "yz.chsi.com.cn",
    "chsi.com.cn",
    "kaoyan.com",
    "chinakaoyan.com",
    "eol.cn",
    "baidu.com",
    "zhihu.com",
    "weixin.qq.com",
    "mp.weixin.qq.com",
}
HOMEPAGE_NAMES = {"index.htm", "index.html", "index.shtml", "default.htm", "default.html"}
USER_AGENT = "Mozilla/5.0 (compatible; RoboticsPromotionTrackerLinkCheck/1.0)"


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.ok_links = 0

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warning(self, message: str) -> None:
        self.warnings.append(message)


def parse_iso_date(value: Any, field: str, record_id: str, report: Report, *, allow_empty: bool = False) -> date | None:
    if allow_empty and value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        report.error(f"[{record_id}] {field} 必须使用 YYYY-MM-DD 格式" + ("或空字符串" if allow_empty else ""))
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        report.error(f"[{record_id}] {field} 不是有效日期：{value}")
        return None


def host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def validate_official_url(url: Any, record_id: str, report: Report) -> str | None:
    if not isinstance(url, str) or not url.strip():
        report.error(f"[{record_id}] officialUrl 不能为空")
        return None

    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    path = parsed.path or "/"

    if parsed.scheme != "https":
        report.error(f"[{record_id}] officialUrl 必须使用 https：{url}")
    if not host:
        report.error(f"[{record_id}] officialUrl 缺少有效域名：{url}")
        return None
    if any(host_matches(host, domain) for domain in BLOCKED_DOMAINS):
        report.error(f"[{record_id}] officialUrl 使用了禁止的首页或第三方域名：{host}")
    if not host.endswith(".edu.cn"):
        report.error(f"[{record_id}] officialUrl 不是可识别的高校官方 .edu.cn 域名：{host}")
    if path in {"", "/"} or path.rstrip("/").split("/")[-1].lower() in HOMEPAGE_NAMES:
        report.error(f"[{record_id}] officialUrl 疑似首页，必须指向具体通知正文：{url}")
    return host


def expected_status(record: dict[str, Any], today: date) -> str | None:
    current = record.get("status")
    if current == "链接待核验":
        return "链接待核验"
    deadline_value = record.get("deadline")
    if current == "待发布" and deadline_value == "":
        return "待发布"
    if not isinstance(deadline_value, str) or not deadline_value:
        return "待发布"
    try:
        deadline = datetime.strptime(deadline_value, "%Y-%m-%d").date()
    except ValueError:
        return None
    days_left = (deadline - today).days
    if days_left < 0:
        return "已截止"
    if days_left <= 7:
        return "即将截止"
    return "报名中"


def validate_record(record: Any, index: int, report: Report, seen_ids: set[str], seen_urls: set[str]) -> None:
    if not isinstance(record, dict):
        report.error(f"[第 {index + 1} 条] 记录必须是 JSON 对象")
        return

    record_id = str(record.get("id") or f"第 {index + 1} 条")
    missing = [field for field in REQUIRED_FIELDS if field not in record]
    if missing:
        report.error(f"[{record_id}] 缺少字段：{', '.join(missing)}")
        return

    if not isinstance(record["id"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", record["id"]):
        report.error(f"[{record_id}] id 只能包含小写英文、数字和连字符")
    if record["id"] in seen_ids:
        report.error(f"[{record_id}] id 重复")
    seen_ids.add(record["id"])

    for field in ("university", "college", "title", "roboticsEligibility"):
        if not isinstance(record[field], str) or not record[field].strip():
            report.error(f"[{record_id}] {field} 必须是非空字符串")

    if record["category"] not in ALLOWED_CATEGORIES:
        report.error(f"[{record_id}] category 只能是：{', '.join(sorted(ALLOWED_CATEGORIES))}")
    if record["admissionYear"] != 2027:
        report.error(f"[{record_id}] admissionYear 必须是数字 2027")
    if record["matchLevel"] not in ALLOWED_MATCH_LEVELS:
        report.error(f"[{record_id}] matchLevel 只能是：高、中、低")
    if record["status"] not in ALLOWED_STATUSES:
        report.error(f"[{record_id}] status 不受支持：{record['status']}")
    if not isinstance(record["notes"], str):
        report.error(f"[{record_id}] notes 必须是字符串，没有备注时使用空字符串")

    directions = record["directions"]
    if not isinstance(directions, list) or not directions or not all(isinstance(item, str) and item.strip() for item in directions):
        report.error(f"[{record_id}] directions 必须是至少包含一个非空方向的字符串数组")
    elif len(set(directions)) != len(directions):
        report.error(f"[{record_id}] directions 中存在重复方向")

    publish_date = parse_iso_date(record["publishDate"], "publishDate", record_id, report)
    deadline = parse_iso_date(record["deadline"], "deadline", record_id, report, allow_empty=True)
    verified_date = parse_iso_date(record["lastVerified"], "lastVerified", record_id, report)

    if publish_date and publish_date.year != 2026:
        report.error(f"[{record_id}] publishDate 必须在 2026 年：{record['publishDate']}")
    if publish_date and publish_date > date.today():
        report.error(f"[{record_id}] publishDate 晚于今天，无法核验尚未发布的通知")
    if verified_date and verified_date > date.today():
        report.error(f"[{record_id}] lastVerified 不能晚于今天")
    if publish_date and deadline and deadline < publish_date:
        report.error(f"[{record_id}] deadline 早于 publishDate")
    if record["status"] == "待发布" and record["deadline"] != "":
        report.error(f"[{record_id}] 待发布记录的 deadline 应为空字符串")

    title_years = set(re.findall(r"20\d{2}", record["title"])) if isinstance(record["title"], str) else set()
    expected_title_year = "2026" if record["category"] == "夏令营" else "2027"
    if title_years and expected_title_year not in title_years:
        report.error(
            f"[{record_id}] 标题年份 {', '.join(sorted(title_years))} 与{record['category']}周期不一致，预期包含 {expected_title_year}"
        )

    expected = expected_status(record, date.today())
    if expected and record["status"] != expected:
        report.error(f"[{record_id}] status 应按今天重新计算为“{expected}”，当前为“{record['status']}”")

    validate_official_url(record["officialUrl"], record_id, report)
    normalized_url = record["officialUrl"].strip().rstrip("/")
    if normalized_url in seen_urls:
        report.error(f"[{record_id}] officialUrl 与另一条记录重复，疑似重复收录")
    seen_urls.add(normalized_url)


def fetch_link(record: dict[str, Any], timeout: float) -> tuple[str, str, str | None]:
    record_id = str(record["id"])
    url = str(record["officialUrl"])
    original_host = (urlparse(url).hostname or "").lower()
    context = ssl.create_default_context()

    for method in ("HEAD", "GET"):
        headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
        if method == "GET":
            headers["Range"] = "bytes=0-2047"
        request = Request(url, headers=headers, method=method)
        try:
            with urlopen(request, timeout=timeout, context=context) as response:
                final_url = response.geturl()
                final_host = (urlparse(final_url).hostname or "").lower()
                if not (final_host == original_host or final_host.endswith("." + original_host) or original_host.endswith("." + final_host)):
                    return record_id, "warning", f"链接跳转到不同域名：{final_host}（请人工核验）"
                return record_id, "ok", f"HTTP {response.status}"
        except HTTPError as exc:
            if method == "HEAD" and exc.code in {403, 405, 429, 500, 501}:
                continue
            if exc.code in {403, 429}:
                return record_id, "warning", f"HTTP {exc.code}，站点限制自动访问，请人工打开核验"
            if exc.code in {404, 410}:
                return record_id, "error", f"HTTP {exc.code}，应保留原链接并标记为“链接待核验”"
            return record_id, "warning", f"HTTP {exc.code}，请人工打开核验"
        except (URLError, TimeoutError, socket.timeout) as exc:
            reason = getattr(exc, "reason", exc)
            return record_id, "warning", f"自动访问失败：{reason}（不等同于链接失效）"
        except ssl.SSLError as exc:
            return record_id, "warning", f"TLS 校验失败：{exc}（请人工打开核验）"
    return record_id, "warning", "自动访问未得到结果，请人工打开核验"


def load_data(report: Report) -> list[dict[str, Any]]:
    try:
        raw = DATA_FILE.read_text(encoding="utf-8")
        payload = json.loads(raw)
    except FileNotFoundError:
        report.error(f"找不到数据文件：{DATA_FILE}")
        return []
    except json.JSONDecodeError as exc:
        report.error(f"notices.json 不是有效 JSON：第 {exc.lineno} 行第 {exc.colno} 列 {exc.msg}")
        return []

    if not isinstance(payload, list):
        report.error("notices.json 顶层必须是 JSON 数组")
        return []
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="检查保研通知数据与官方链接")
    parser.add_argument("--skip-network", action="store_true", help="只校验数据格式，不访问网络")
    parser.add_argument("--timeout", type=float, default=12.0, help="单个链接超时秒数（默认 12）")
    args = parser.parse_args()

    report = Report()
    records = load_data(report)
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()

    for index, record in enumerate(records):
        validate_record(record, index, report, seen_ids, seen_urls)

    if not args.skip_network and records and not report.errors:
        valid_records = [record for record in records if isinstance(record, dict) and record.get("officialUrl")]
        workers = min(8, max(1, len(valid_records)))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(fetch_link, record, args.timeout): record for record in valid_records}
            for future in as_completed(futures):
                record_id, level, message = future.result()
                if level == "ok":
                    report.ok_links += 1
                    print(f"  ✓ [{record_id}] {message}")
                elif level == "error":
                    report.error(f"[{record_id}] {message}")
                else:
                    report.warning(f"[{record_id}] {message}")

    for warning in report.warnings:
        print(f"警告：{warning}")
    for error in report.errors:
        print(f"错误：{error}")

    print()
    print(
        f"检查完成：{len(records)} 条记录，{len(report.errors)} 个错误，"
        f"{len(report.warnings)} 个警告，{report.ok_links} 个链接自动访问成功。"
    )
    if not records and not report.errors:
        print("数据文件当前为空；可在核验首批官方通知后添加记录。")

    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
