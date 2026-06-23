from __future__ import annotations

import csv
import json
from datetime import date, datetime
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
OUTPUT_CSV = DATA_DIR / "工单统一明细_260618.csv"
PROJECT_CSV = DATA_DIR / "项目客诉专项跟进模板.csv"
EMBEDDED_JS = DATA_DIR / "embedded-data.js"
REFRESH_DATE = date(2026, 6, 22)

SOURCE_FILES = [
    ("质量工单", "质量工单6-22.xlsx"),
    ("支持工单", "支持工单-6-22.xlsx"),
    ("市场工单", "市场客诉-6-22.xlsx"),
    ("供应工单", "供应客诉-6-22.xlsx"),
]

STANDARD_COLUMNS = [
    "工单类型",
    "工单号",
    "工单号/客诉单号",
    "处理人员",
    "制单人/创建人",
    "制单时间",
    "单据状态",
    "工单状态",
    "是否结案",
    "未结案天数",
    "已流转天数",
    "风险等级",
    "客户名称",
    "联系人",
    "联系电话",
    "分公司/区域",
    "区域",
    "来源类型",
    "紧急程度",
    "服务等级",
    "投诉/问题现象",
    "失效现象/问题类型",
    "投诉内容",
    "问题简述",
    "物料代码",
    "物料描述",
    "初步/处理回复",
    "处理方案回复",
    "最终结案/工程师结案",
    "未结案原因",
    "当前卡点",
    "下一步规划",
    "预计闭环时间",
    "最新进展",
    "更新时间",
]


def clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "nat", "none"}:
        return ""
    return text


def first(row: dict[str, str], fields: list[str]) -> str:
    for field in fields:
        value = clean(row.get(field))
        if value:
            return value
    return ""


def parse_date(value: str) -> datetime | None:
    text = clean(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    try:
        parsed = pd.to_datetime(text, errors="coerce")
    except Exception:
        return None
    if pd.isna(parsed):
        return None
    return parsed.to_pydatetime()


def age_days(order_time: str) -> int:
    parsed = parse_date(order_time)
    if not parsed:
        return 0
    return max(0, (REFRESH_DATE - parsed.date()).days)


def risk_level(days: int) -> str:
    if days > 10:
        return "高风险"
    if days > 6:
        return "中风险"
    if days <= 4:
        return "低风险"
    return "关注/待观察"


def normalize_row(source_row: dict[str, str], ticket_type: str) -> dict[str, str]:
    row = {key: clean(value) for key, value in source_row.items()}
    ticket_id = first(row, ["工单号", "客诉单号", "单据编号", "支持单号"])
    owner = first(row, ["制单人/创建人", "处理人员", "制单人", "创建人", "起草人", "CC起草人"])
    order_time = first(row, ["制单时间", "创建时间", "起草时间", "客诉产生时间"])
    status = first(row, ["单据状态"])
    work_status = first(row, ["工单状态"])
    customer = first(row, ["客户名称"])
    contact = first(row, ["联系人", "联系人名称"])
    phone = first(row, ["联系电话", "联系人电话"])
    area = first(row, ["区域", "分公司/区域", "分公司", "分公司名称", "客户省份名称", "客户地址省"])
    problem = first(row, ["问题简述", "投诉内容", "反馈内容", "投诉内容描述", "投诉/问题现象", "初步回复", "处理回复", "客服初步回复"])
    phenomenon = first(row, ["失效现象/问题类型", "失效现象", "问题类型", "投诉类型", "不良类别", "客诉类型", "投诉类别", "失效类别"])
    material_code = first(row, [
        "物料代码",
        "物料编码",
        "产品编码",
        "产品代码",
        "商品编码",
        "投诉产品物料代码",
        "补发产品产品物料代码",
        "补发配件产品物料代码",
        "整灯售后物料代码",
        "延长质保物料代码",
    ])
    material_description = first(row, [
        "物料描述",
        "产品描述",
        "产品名称",
        "型号",
        "产品型号",
        "产品",
        "投诉产品物料描述",
        "补发产品产品物料名称",
        "补发配件代码描述",
        "整灯售后物料描述",
        "延长质保物料描述",
        "PDT描述",
    ])
    first_reply = first(row, ["初步/处理回复", "初步回复", "处理回复", "客服初步回复"])
    solution_reply = first(row, ["处理方案回复", "处理方案回复内容", "分公司处理回复", "客诉工程师处理回复"])
    final_reply = first(row, ["最终结案/工程师结案", "最终结案", "最终处理结果"])
    days = age_days(order_time)

    normalized = {
        **row,
        "工单类型": ticket_type,
        "工单号": ticket_id,
        "工单号/客诉单号": ticket_id,
        "处理人员": owner,
        "制单人/创建人": owner,
        "制单时间": order_time,
        "单据状态": status,
        "工单状态": work_status,
        "是否结案": "是" if status == "已结束" else "否",
        "未结案天数": str(days),
        "已流转天数": str(days),
        "风险等级": risk_level(days),
        "客户名称": customer,
        "联系人": contact,
        "联系电话": phone,
        "分公司/区域": area,
        "区域": area,
        "来源类型": first(row, ["来源类型", "投诉途径"]),
        "紧急程度": first(row, ["紧急程度"]),
        "服务等级": first(row, ["服务等级"]),
        "投诉/问题现象": phenomenon or problem,
        "失效现象/问题类型": phenomenon or problem,
        "投诉内容": problem,
        "问题简述": problem,
        "物料代码": material_code,
        "物料描述": material_description,
        "初步/处理回复": first_reply,
        "处理方案回复": solution_reply,
        "最终结案/工程师结案": final_reply,
        "未结案原因": first(row, ["未结案原因"]),
        "当前卡点": first(row, ["当前卡点"]),
        "下一步规划": first(row, ["下一步规划"]),
        "预计闭环时间": first(row, ["预计闭环时间"]),
        "最新进展": first(row, ["最新进展"]),
        "更新时间": first(row, ["更新时间"]),
    }
    return normalized


def load_excel(ticket_type: str, file_name: str) -> tuple[list[dict[str, str]], int]:
    path = RAW_DIR / file_name
    if not path.exists():
        raise FileNotFoundError(f"缺少原始数据文件：{path}")
    frame = pd.read_excel(path, sheet_name=0, dtype=str).fillna("")
    frame = frame.loc[~frame.apply(lambda item: all(clean(value) == "" for value in item), axis=1)]
    rows = [normalize_row(item, ticket_type) for item in frame.to_dict(orient="records")]
    active_rows = [row for row in rows if clean(row.get("单据状态")) != "已结束"]
    return active_rows, len(rows)


def write_csv(rows: list[dict[str, str]]) -> None:
    raw_columns: list[str] = []
    seen = set(STANDARD_COLUMNS)
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                raw_columns.append(key)
    columns = STANDARD_COLUMNS + raw_columns
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_project_rows() -> list[dict[str, str]]:
    if not PROJECT_CSV.exists():
        return []
    with PROJECT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return [{key: clean(value) for key, value in row.items()} for row in csv.DictReader(handle)]


def write_embedded(rows: list[dict[str, str]]) -> None:
    payload = {
        "tickets": rows,
        "projects": read_project_rows(),
    }
    EMBEDDED_JS.write_text(
        "window.WORKORDER_EMBEDDED_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )


def merge_value(existing: str, incoming: str) -> str:
    current = clean(existing)
    value = clean(incoming)
    if not value:
        return current
    if not current:
        return value
    parts = [item.strip() for item in current.split(" / ") if item.strip()]
    if value not in parts:
        parts.append(value)
    return " / ".join(parts)


def dedupe_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    by_id: dict[str, dict[str, str]] = {}
    for row in rows:
        ticket_id = clean(row.get("工单号"))
        if not ticket_id or ticket_id not in by_id:
            by_id[ticket_id or f"row-{len(by_id)}"] = dict(row)
            continue
        kept = by_id[ticket_id]
        for key, value in row.items():
            if key in {"物料代码", "物料描述"}:
                kept[key] = merge_value(kept.get(key, ""), value)
            elif not clean(kept.get(key)) and clean(value):
                kept[key] = clean(value)
    return list(by_id.values())


def summarize(rows: list[dict[str, str]], raw_counts: dict[str, int], active_counts: dict[str, int]) -> dict:
    summary = {}
    for ticket_type, _ in SOURCE_FILES:
        type_rows = [row for row in rows if row["工单类型"] == ticket_type]
        summary[ticket_type] = {
            "raw": raw_counts[ticket_type],
            "activeRowsBeforeDedupe": active_counts[ticket_type],
            "activeUnique": len(type_rows),
            "高风险": sum(row["风险等级"] == "高风险" for row in type_rows),
            "中风险": sum(row["风险等级"] == "中风险" for row in type_rows),
            "低风险": sum(row["风险等级"] == "低风险" for row in type_rows),
            "关注/待观察": sum(row["风险等级"] == "关注/待观察" for row in type_rows),
        }
    return {
        "totalActive": len(rows),
        "types": summary,
        "csv": str(OUTPUT_CSV),
        "embedded": str(EMBEDDED_JS),
    }


def main() -> None:
    all_rows: list[dict[str, str]] = []
    raw_counts: dict[str, int] = {}
    active_counts: dict[str, int] = {}
    for ticket_type, file_name in SOURCE_FILES:
        rows, raw_count = load_excel(ticket_type, file_name)
        raw_counts[ticket_type] = raw_count
        active_counts[ticket_type] = len(rows)
        all_rows.extend(rows)
    all_rows = dedupe_rows(all_rows)
    write_csv(all_rows)
    write_embedded(all_rows)
    print(json.dumps(summarize(all_rows, raw_counts, active_counts), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
