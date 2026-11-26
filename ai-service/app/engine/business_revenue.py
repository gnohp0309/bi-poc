"""Compute common revenue comparisons directly from the dataset snapshot."""
import re
import unicodedata
from decimal import Decimal, InvalidOperation

import pandas as pd
from app.engine.descriptive import OutlierEngine


def normalize(text):
    return "".join(c for c in unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
                   if not unicodedata.combining(c)).strip()


MONTH = r"(?:thang\s+)?(0?[1-9]|1[0-2])\s*(?:[/.-]|\s+nam\s+)\s*([1-9]\d{3})"
PERIOD_QUESTION = r"so sanh (?:tong )?doanh thu(?:\s+cung ky)?"
REVENUE_COLUMNS = {"revenue", "doanh thu", "doanh_thu", "sales_revenue"}
BRANCH_COLUMNS = {"branch", "chi nhanh", "chi_nhanh"}
DATE_COLUMNS = {"date", "ngay", "order_date", "ngay_ban"}
CATEGORY_COLUMNS = {"category", "danh muc", "danh_muc", "product_category", "nhom san pham"}
STATUS_COLUMNS = {"status", "trang thai", "trang_thai", "order_status"}
WHY_WORDS = r"(?:vi sao|tai sao|nguyen nhan|ly do)"
BRANCH_ID = r"[a-z0-9_-]+"
FULL_DATA = r"(?:(?:xet |tren |trong |voi )?(?:toan bo|ca) (?:du lieu|file)(?: nay)?|(?:tren|trong) (?:du lieu|file) nay)"
POLITE_REQUEST = r"(?:(?:ban )?hay )?(?:(?:cho (?:minh|toi|tui|em) (?:biet|hoi|xem)|(?:minh|toi|tui|em) muon biet) )?"
REVENUE_TERM = r"(?:tong(?: muc)? |muc )?doanh thu"
LOWEST = r"(?:thap nhat|nho nhat|it nhat|kem nhat)"
LOWER = rf"(?:lai )?(?:{LOWEST}|thap(?: hon(?: (?:cac |nhung )?chi nhanh (?:khac|con lai))?)?)"
RANK_REASON = rf"(?:(?:va )?(?:giai thich )?{WHY_WORDS}(?: la gi)?)"
RANK_QUESTION = re.compile(
    rf"{POLITE_REQUEST}(?:"
    rf"chi nhanh nao (?:dang )?(?:co|dat) {REVENUE_TERM} (?:{LOWEST}|thap hon)"
    rf"|{REVENUE_TERM} chi nhanh nao (?:la )?(?:{LOWEST}|thap hon)"
    rf"|{REVENUE_TERM} {LOWEST} (?:la cua|thuoc ve|thuoc) chi nhanh nao"
    rf"|(?:tim|xac dinh) chi nhanh co {REVENUE_TERM} {LOWEST}"
    rf"|chi nhanh co {REVENUE_TERM} {LOWEST} la (?:chi nhanh )?nao"
    rf"|xep hang (?:cac )?chi nhanh theo {REVENUE_TERM} (?:tu thap den cao|tang dan)"
    rf"|xep hang {REVENUE_TERM} theo chi nhanh (?:tu thap den cao|tang dan)"
    rf")(?: (?:{RANK_REASON}|{FULL_DATA})){{0,2}}(?: (?:giup|cho) (?:minh|toi|tui|em))?"
)
BRANCH_WHY = (
    re.compile(rf"{POLITE_REQUEST}(?:giai thich )?{WHY_WORDS} {REVENUE_TERM} (?:cua )?chi nhanh ({BRANCH_ID}) {LOWER}(?: {FULL_DATA})?"),
    re.compile(rf"{POLITE_REQUEST}chi nhanh ({BRANCH_ID}) {WHY_WORDS} {REVENUE_TERM} {LOWER}(?: {FULL_DATA})?"),
)
WHY_FOLLOW_UP = re.compile(
    rf"{POLITE_REQUEST}(?:con |giai thich )?{WHY_WORDS}"
    rf"(?: (?:doanh thu(?: cua (?:no|chi nhanh do))? )?(?:lai )?thap(?: hon| nhat)?"
    rf"| la gi)?(?: vay| the)?(?: giup (?:minh|toi|tui|em))?"
)
WHY_REVENUE = re.compile(
    rf"{POLITE_REQUEST}(?:(?:giai thich|phan tich)(?: giup (?:toi|minh|tui|em))? )?"
    rf"{WHY_WORDS} (?:vi sao |tai sao |do dau )?{REVENUE_TERM}\b"
)
CHANGE_DIRECTION = r"(?:giam|tang|thay doi|sut giam|thap hon|cao hon|it hon|nhieu hon)"
MONTH_CHANGE = rf"(?:lai )?{CHANGE_DIRECTION}(?: manh| dang ke| nhe)?"
CHANGE_WORD = re.compile(rf"\b{CHANGE_DIRECTION}\b")
PERIOD_SCOPE = rf"(?: cua)?(?: chi nhanh {BRANCH_ID})?"
WHY_COMPARE = re.compile(
    rf"{PERIOD_SCOPE} (?:{MONTH_CHANGE} )?(?:trong |vao )?"
    rf"<ky> (?:(?:{MONTH_CHANGE} )?(?:so voi|voi)|(?:lai )?(?:thap hon|cao hon|it hon|nhieu hon)) <ky>"
)
WHY_RANGE = re.compile(
    rf"{PERIOD_SCOPE} (?:{MONTH_CHANGE} )?tu <ky> (?:den|sang) <ky>(?: {MONTH_CHANGE})?"
)
WHY_DETAILS = re.compile(
    r"(?:hay )?(?:(?:phan tich|tach|cho biet)(?:(?: muc)? dong gop)? theo danh muc"
    r"(?: neu (?:du lieu cho phep|co the))?(?:,? va )?)?(?:neu gioi han(?: cua ket luan)?)?"
)
WHOLE_NUMBER = r"[+-]?(?:[1-9]\d{0,2}(?:\.\d{3}){1,4}|\d{1,15})"
EXACT_EXCLUSION = re.compile(
    rf"[?.!,; ]+(?:neu |sau khi )?(?:chi )?(?:bo|loai) (?:dung )?"
    rf"(?:mot )?dong (?:co )?doanh thu ({WHOLE_NUMBER})"
    r"(?:[?.!,; ]+giu nguyen cac dong con lai(?:, ke ca dong trung va ngay loi)?)?$"
)
BLANK_REVENUE = (r"(?:trong toan bo (?:file|du lieu),? )?(?:co )?bao nhieu dong (?:bi )?trong doanh thu"
                 r"(?: va nhung dong do thuoc chi nhanh nao)?[?. ]+tinh theo tung chi nhanh")
PERIOD_CLARIFICATION = ("Bạn muốn lấy kỳ nào làm mốc? Ví dụ tháng 3/2025 so với cùng tháng năm trước, "
                        "hoặc tháng 3/2025 so với tháng 2/2025.")


def branch_question_words(text):
    # Work on branch intent words only, leaving the original date and amount tokens intact.
    return " ".join(re.sub(r"[?!,;:.…]+", " ", text).split())


def business_plan(question, columns, history=()):
    if (len(history) >= 2 and history[-2].role == "user" and history[-1].role == "assistant"
            and history[-1].content == PERIOD_CLARIFICATION and re.match(MONTH, normalize(question))):
        prefix = "So sánh doanh thu cùng kỳ" if "cung ky" in normalize(history[-2].content) else "So sánh doanh thu"
        question = f"{prefix} {question}"
    text = " ".join(normalize(question).split()).rstrip("?.! ")
    for suffix in (" ve bieu do so sanh", " va ve bieu do", " ve bieu do"):
        if text.endswith(suffix):
            text = text[:-len(suffix)].rstrip(",. ")
            break
    revenue = find_column(columns, REVENUE_COLUMNS, "number")
    branch = find_column(columns, BRANCH_COLUMNS, "text")
    branch_words = branch_question_words(text)
    follow_up = WHY_FOLLOW_UP.fullmatch(branch_words)
    focused_branch = None if follow_up else explicit_branch_why(branch_words)
    if focused_branch is not None or follow_up:
        if focused_branch is not None:
            original = re.search(r"chi nh[aá]nh\s+([a-z0-9_-]+)", question, flags=re.IGNORECASE)
            focused_branch = original[1] if original else focused_branch
        branch_plan = branch_explanation_plan(columns, history, focused_branch, revenue, branch)
        if branch_plan is not None:
            return branch_plan
    why = WHY_REVENUE.match(text)
    if why and CHANGE_WORD.search(text[why.end():]):
        return revenue_change_plan(question, text[why.end():], columns, revenue, branch)
    exclusion = EXACT_EXCLUSION.search(text)
    rank_words = branch_question_words(text[:exclusion.start()]) if exclusion else branch_words
    if RANK_QUESTION.fullmatch(rank_words):
        if not revenue or not branch:
            return {"intent": "clarify", "clarification": "Bạn muốn dùng cột nào làm doanh thu và cột nào làm chi nhánh?"}
        config = {"operation": "branch_revenue", "value_column": revenue, "group_column": branch}
        if exclusion:
            # A Vietnamese grouping of three digits denotes a whole number here.
            config["excluded_integer"] = int(exclusion[1].replace(".", ""))
        return {"intent": "statistical", "statistics_config": config}
    if re.fullmatch(BLANK_REVENUE, text) and branch and revenue:
        return {"intent": "query", "query_config": {
            "groupBy": [{"column": branch, "alias": "chi_nhanh"}],
            "metrics": [{"column": revenue, "aggregate": "count_blank", "alias": "so_dong_trong_doanh_thu"}],
        }}
    period = re.fullmatch(
        POLITE_REQUEST + PERIOD_QUESTION + rf"(?:\s+(?:cua\s+)?chi nhanh\s+([a-z0-9]+))?(?:\s+(?:tu\s+)?{MONTH})?"
        + rf"(?:\s+(?:voi|so voi|va)\s+(?:(?:cung ky|cung thang)\s+)?(?:{MONTH}|nam truoc))?", text,
    )
    if not period:
        return None
    branch_value, month, year, other_month, other_year = period.groups()
    if not month or (not other_month and "cung ky" not in text and "nam truoc" not in text):
        return {"intent": "clarify", "clarification": PERIOD_CLARIFICATION}
    current = f"{int(year):04d}-{int(month):02d}"
    previous = (f"{int(other_year):04d}-{int(other_month):02d}" if other_month
                else f"{int(year)-1:04d}-{int(month):02d}")
    if previous == current or previous.startswith("0"):
        return {"intent": "clarify", "clarification": "Bạn hãy chọn hai tháng khác nhau để so sánh."}
    date = find_column(columns, DATE_COLUMNS, "date")
    if not revenue or not date or (branch_value and not branch):
        return {"intent": "clarify", "clarification": "Bạn muốn dùng cột nào làm ngày, doanh thu và chi nhánh nếu có?"}
    config = {"operation": "period_revenue", "value_column": revenue, "date_column": date,
              "months": [current, previous]}
    if branch_value:
        # Read the case of the label from the question as stored in the source text.
        original = re.search(r"chi nh[aá]nh\s+([a-z0-9]+)", question, flags=re.IGNORECASE)
        config.update(group_column=branch, group_values=[original[1] if original else branch_value.upper()])
    return {"intent": "statistical", "statistics_config": config}


def explicit_branch_why(text):
    for pattern in BRANCH_WHY:
        if match := pattern.fullmatch(text):
            return match[1]
    return None


def recent_branch_analysis(history):
    focus = None
    for turn in reversed(history):
        if turn.role == "user":
            text = branch_question_words(normalize(turn.content))
            if WHY_FOLLOW_UP.fullmatch(text):
                continue
            named = explicit_branch_why(text)
            if named is None:
                break
            focus = focus or named
        elif turn.role == "assistant":
            if turn.intent == "clarify":
                continue
            config = turn.statistics_config or {}
            if config.get("operation") == "branch_revenue":
                return config, focus or turn.branch_focus or config.get("focus_branch")
            break
    return None, focus


def branch_explanation_plan(columns, history, focus, revenue, branch):
    previous, reference = recent_branch_analysis(history)
    if focus is None and previous is None and reference is None:
        return None
    if focus is None and previous:
        revenue, branch = previous.get("value_column"), previous.get("group_column")
    if not revenue or not branch:
        return {"intent": "clarify", "clarification": "Bạn muốn dùng cột nào làm doanh thu và cột nào làm chi nhánh?"}
    config = {"operation": "branch_revenue", "value_column": revenue, "group_column": branch,
              "explain_branch": True}
    if focus or reference:
        config["focus_branch"] = focus or reference
    if previous and "excluded_integer" in previous:
        config["excluded_integer"] = previous["excluded_integer"]
    for key, names, kind in (("date_column", DATE_COLUMNS, "date"), ("status_column", STATUS_COLUMNS, "text")):
        column = find_column(columns, names, kind)
        if column and column != branch:
            config[key] = column
    return {"intent": "statistical", "statistics_config": config}


def revenue_change_plan(question, text, columns, revenue, branch):
    pieces = re.split(r"[?!;]+|\.\s+", text, maxsplit=1)
    comparison = pieces[0].rstrip(". ")
    details = pieces[1].strip() if len(pieces) > 1 else ""
    dates = re.findall(MONTH, comparison)
    shape = re.sub(MONTH, "<ky>", comparison)
    ranged = WHY_RANGE.fullmatch(shape)
    if len(dates) != 2 or not (ranged or WHY_COMPARE.fullmatch(shape)) or not WHY_DETAILS.fullmatch(details):
        if len(dates) == 2:
            return {"intent": "clarify", "clarification": (
                "Bạn đã nêu hai kỳ. Hãy xác nhận kỳ nào cần xem và kỳ nào làm gốc. "
                "Luồng phân tích này hỗ trợ chọn một chi nhánh và phân tích theo danh mục."
            )}
        return {"intent": "clarify", "clarification": (
            "Bạn muốn phân tích thay đổi doanh thu giữa hai tháng nào? "
            "Hãy nêu tháng, năm và chi nhánh nếu cần lọc. Ví dụ: Vì sao doanh thu chi nhánh A tháng 6/2025 giảm so với tháng 3/2025?"
        )}
    months = [f"{int(year):04d}-{int(month):02d}" for month, year in dates]
    if months[0] == months[1]:
        return {"intent": "clarify", "clarification": "Bạn hãy chọn hai tháng khác nhau để phân tích thay đổi doanh thu."}
    date = find_column(columns, DATE_COLUMNS, "date")
    branch_value = re.search(r"chi nh[aá]nh\s+([a-z0-9_-]+)", question, flags=re.IGNORECASE)
    if not revenue or not date or (branch_value and not branch):
        return {"intent": "clarify", "clarification": "Bạn muốn dùng cột nào làm ngày, doanh thu và chi nhánh nếu có?"}
    config = {"operation": "period_revenue", "value_column": revenue, "date_column": date,
              "months": months[::-1] if ranged else months, "explain_change": True}
    category = find_column(columns, CATEGORY_COLUMNS, "text")
    if category:
        config["category_column"] = category
    if branch_value:
        config.update(group_column=branch, group_values=[branch_value[1]])
    return {"intent": "statistical", "statistics_config": config}


def find_column(columns, names, kind):
    matches = [column.name for column in columns if column.kind == kind and
               (normalize(column.name).removeprefix("c_") in names or normalize(column.friendly_name) in names)]
    return matches[0] if len(matches) == 1 else None


def number(value):
    return f"{value:,.2f}".rstrip("0").rstrip(".").translate(str.maketrans(",.", ".,"))


def exact_integer_matches(series, integer):
    def matches(value):
        try:
            return Decimal(str(value)) == integer
        except InvalidOperation:
            return False
    return series.map(matches).astype(bool)


def rank_changing_outlier(frame, value, group, first_branches, raw_revenue):
    analysis_rows = frame.dropna(subset=[group, value])
    values = analysis_rows[value]
    if len(values) < 4:
        return None
    maximum = float(values.max())
    if not maximum.is_integer() or abs(maximum) > 999999999999999:
        return None
    integer = int(maximum)
    matches = exact_integer_matches(raw_revenue, integer)
    if matches.sum() != 1 or maximum <= OutlierEngine.detect_outliers_iqr(values)["upper_bound"]:
        return None
    remaining = analysis_rows.loc[~matches].groupby(group, observed=True)[value].sum()
    if len(remaining) < 2:
        return None
    lowest = set(map(str, remaining.index[remaining == remaining.min()]))
    return integer if lowest != set(first_branches) else None


def recorded_amount(value):
    if value is None or not str(value).strip():
        return None, False
    try:
        amount = Decimal(str(value))
        if amount.is_finite():
            return amount, False
    except InvalidOperation:
        pass
    return None, True


def branch_explanation(frame, parameters, result, scope, ranked, ties):
    requested = parameters.get("focus_branch")
    if requested is None and len(ties) > 1:
        return (f"{scope}, các chi nhánh {', '.join(ties)} đồng hạng thấp nhất. "
                "Bạn muốn xem chi nhánh nào trước?")
    focused = [row for row in ranked if row["Chi nhánh"].casefold() == requested.casefold()] if requested else ranked[:1]
    if len(focused) != 1:
        reason = (f"Chưa xác định được một chi nhánh {requested} có doanh thu hợp lệ trong phạm vi này. "
                  "Bạn hãy kiểm tra mã chi nhánh trong bảng.")
        result.update(status="insufficient_data", reason=reason)
        return reason
    branch = focused[0]
    nearest = min((row for row in ranked if row is not branch),
                  key=lambda row: abs(row["Tổng doanh thu"] - branch["Tổng doanh thu"]))
    name, reference = branch["Chi nhánh"], nearest["Chi nhánh"]
    value, other = branch["Tổng doanh thu"], nearest["Tổng doanh thu"]
    count, other_count = branch["Dòng có doanh thu"], nearest["Dòng có doanh thu"]
    average, other_average = branch["Doanh thu TB mỗi dòng"], nearest["Doanh thu TB mỗi dòng"]
    difference = value - other
    directional = f"{'thấp' if difference < 0 else 'cao'} hơn {number(abs(difference))}" if difference else "bằng nhau"
    summary = [
        f"{scope}, chi nhánh {name} có doanh thu {number(value)}. Chi nhánh gần nhất theo tổng doanh thu "
        f"là {reference} với {number(other)}. So với {reference}, doanh thu của {name} {directional}.",
        f"Hai chi nhánh lần lượt có {count} và {other_count} dòng hợp lệ. "
        f"Doanh thu bình quân mỗi dòng lần lượt là {number(average)} và {number(other_average)}.",
    ]
    if count == other_count and difference:
        summary.append("Số dòng hợp lệ bằng nhau, nên chênh lệch tổng đến từ mức bình quân khác nhau trong file.")
    if value > ranked[0]["Tổng doanh thu"]:
        summary.append(f"Chi nhánh thấp nhất trong bảng là {ranked[0]['Chi nhánh']} với "
                       f"{number(ranked[0]['Tổng doanh thu'])}.")

    group = parameters["group_column"]
    valid = frame.loc[frame[parameters["value_column"]].notna()]
    focus_rows, reference_rows = (valid.loc[valid[group].eq(label)] for label in (name, reference))
    date_column = parameters.get("date_column")
    if date_column:
        focus_months, reference_months = (
            set(pd.to_datetime(rows[date_column], errors="coerce", utc=True).dt.strftime("%Y-%m").dropna())
            for rows in (focus_rows, reference_rows)
        )
        if focus_months and reference_months and focus_months.isdisjoint(reference_months):
            summary.append(f"Các dòng có ngày hợp lệ của {name} và {reference} nằm ở các tháng khác nhau.")
    status_column = parameters.get("status_column")
    if status_column:
        left, right = (set(rows[status_column].dropna().astype(str)) for rows in (focus_rows, reference_rows))
        if len(left) == len(right) == 1 and left.isdisjoint(right):
            summary.append(f"Trạng thái ghi nhận của {name} là {next(iter(left))}, của {reference} là {next(iter(right))}.")
    outlier = result.get("rankChangingOutlier")
    if outlier is not None:
        summary.append(f"Thứ hạng thay đổi nếu loại đúng giá trị ngoại lệ {number(outlier)}.")
    summary.append("Các số liệu trên mô tả chênh lệch trong file. Chưa đủ bằng chứng để kết luận nguyên nhân kinh doanh.")
    result["branchComparison"] = {"branch": name, "referenceBranch": reference, "delta": difference}
    return "\n".join(summary)


def period_change(frame, dates, parameters, result, scope, table, chart, total):
    current_month, base_month = parameters["months"]
    category = parameters.get("category_column")
    metric = parameters["value_column"]
    flag = parameters.get("invalid_value_flag")
    periods, groups = {}, {}
    for month in (base_month, current_month):
        selected = frame.loc[dates.eq(month)]
        labels = selected[category] if category else [None] * len(selected)
        flags = selected[flag] if flag else [False] * len(selected)
        subtotal = valid = invalid = 0
        for value, label, flagged in zip(selected[metric], labels, flags):
            amount, bad_value = recorded_amount(value)
            invalid += bool(amount is None and (flagged or bad_value))
            if amount is not None:
                subtotal += amount
                valid += 1
            if category:
                # A missing category still contributes to the period total.
                group = groups.setdefault(label if pd.notna(label) else None, {})
                values = group.setdefault(month, [0, 0])
                if amount is not None:
                    values[0] += amount
                    values[1] += 1
        periods[month] = {"total": subtotal if valid else None, "rows": len(selected),
                          "validRows": valid, "invalidRows": invalid if flag or invalid else None}

    base, current = periods[base_month]["total"], periods[current_month]["total"]
    delta = None if base is None or current is None else current - base
    rate = None if delta is None or base == 0 else delta / base * 100
    used = sum(period["validRows"] for period in periods.values())
    result.update(title="Phân tích thay đổi doanh thu theo kỳ",
                  method=(scope + "Tính riêng hai tháng theo UTC, giữ dòng trùng và chỉ cộng doanh thu hợp lệ. "
                          "Mức đóng góp mô tả bằng doanh thu kỳ xem trừ doanh thu kỳ gốc trong từng danh mục."),
                  sample={"total": total, "used": used, "excluded": total - used, "groups": []},
                  periodComparison={"baseMonth": base_month, "currentMonth": current_month,
                                    "periods": periods, "delta": delta, "percentChange": rate})
    summary = [scope.strip()]
    for month, period in periods.items():
        amount, rows, valid = period["total"], period["rows"], period["validRows"]
        if rows == 0:
            summary.append(f"Tháng {month} không có dòng dữ liệu trong phạm vi.")
        elif amount is None:
            summary.append(f"Tháng {month} có {rows} dòng, chưa có doanh thu hợp lệ.")
        else:
            summary.append(f"Tháng {month} ghi nhận {number(amount)} từ {valid}/{rows} dòng có doanh thu hợp lệ.")
        if rows > valid:
            invalid = period["invalidRows"]
            summary.append(f"Tháng {month} có {rows - valid} dòng thiếu hoặc sai kiểu doanh thu."
                           + (f" Xác định được {invalid} dòng sai kiểu." if invalid else ""))
    if delta is None:
        reason = "Cần doanh thu hợp lệ ở cả hai kỳ để tính mức thay đổi."
        result.update(status="insufficient_data", reason=reason)
        summary.append(reason)
    else:
        direction = (f"{'tăng' if delta > 0 else 'giảm'} {number(abs(delta))}" if delta else "giữ nguyên")
        summary.append(f"Doanh thu ghi nhận {direction} so với tháng {base_month}."
                       + (f" Mức thay đổi là {number(rate)}%." if rate is not None
                          else " Kỳ gốc bằng 0 nên chưa tính tỷ lệ phần trăm."))

    base_label, current_label = f"Doanh thu {base_month}", f"Doanh thu {current_month}"
    values = [{"Kỳ": month, "Doanh thu": period["total"], "Dòng hợp lệ": period["validRows"],
               "Tổng số dòng": period["rows"]} for month, period in periods.items()]
    if category and groups and delta is not None:
        contributions = []
        for label, group in groups.items():
            base_sum, base_count = group.get(base_month, (0, 1))
            current_sum, current_count = group.get(current_month, (0, 1))
            before = base_sum if base_count else None
            after = current_sum if current_count else None
            contributions.append({"Danh mục": label if label is not None else "(Thiếu danh mục)",
                                  base_label: before, current_label: after,
                                  "Chênh lệch": after - before if before is not None and after is not None else None})
        contributions.sort(key=lambda row: (-abs(row["Chênh lệch"] or 0), str(row["Danh mục"])))
        changes = [row for row in contributions if row["Chênh lệch"]]
        if changes:
            summary.append("Đóng góp lớn nhất theo doanh thu ghi nhận: " + ", ".join(
                f"{row['Danh mục']} {'+' if row['Chênh lệch'] > 0 else ''}{number(row['Chênh lệch'])}"
                for row in changes[:3]) + ".")
        if any(row["Chênh lệch"] is None for row in contributions):
            result["warnings"].append("Danh mục có dòng nhưng thiếu toàn bộ doanh thu ở một kỳ được để trống chênh lệch.")
        if any(group.get(base_month) is None or group.get(current_month) is None for group in groups.values()):
            result["warnings"].append("Danh mục chỉ xuất hiện ở một kỳ được ghi 0 ở kỳ còn lại.")
        result["data"] = table(contributions[:50])
        if len(contributions) > 50:
            result["data"].update(rowCount=len(contributions), truncated=True)
    else:
        result["data"] = table(values)
        if not category:
            result["warnings"].append("Chưa xác định được cột danh mục để phân tích mức đóng góp.")
    summary.append("Kết quả mô tả thay đổi ghi nhận trong file. Chưa đủ dữ liệu để kết luận nguyên nhân kinh doanh.")
    points = [{"label": row["Kỳ"], "value": row["Doanh thu"]} for row in values if row["Doanh thu"] is not None]
    result.update(summary="\n".join(part for part in summary if part),
                  charts=[chart("bar", points, "Doanh thu từng kỳ", metric=metric, aggregate="sum")] if points else [])
    return result


def compare_revenue(frame, parameters, result, operation, table, chart, exclusion_matches=None, raw_revenue=None):
    value = parameters["value_column"]
    total = len(frame)
    excluded = parameters.get("excluded_integer")
    if operation == "period_revenue":
        result.update(title="So sánh doanh thu theo kỳ")
        if parameters.get("group_values"):
            group = parameters["group_column"]
            labels = {str(label).casefold() for label in parameters["group_values"]}
            frame = frame[frame[group].map(lambda label: str(label).casefold() in labels)]
            scope = "Chi nhánh " + ", ".join(map(str, parameters["group_values"])) + ". "
        else:
            scope = "Toàn bộ chi nhánh. "
        dates = pd.to_datetime(frame[parameters["date_column"]], errors="coerce", utc=True).dt.strftime("%Y-%m")
        if parameters.get("explain_change"):
            return period_change(frame, dates, parameters, result, scope, table, chart, total)
        rows = []
        for month in parameters["months"]:
            values = frame.loc[dates.eq(month), value].dropna()
            rows.append({"Kỳ": month, "Doanh thu": values.sum() if len(values) else None, "Dòng hợp lệ": len(values)})
        current, base = (row["Doanh thu"] for row in rows)
        if current is None or base is None:
            absent = ", ".join(row["Kỳ"] for row in rows if row["Doanh thu"] is None)
            result.update(status="insufficient_data", reason=f"Thiếu doanh thu hợp lệ cho kỳ {absent}.")
            summary = scope + f"Thiếu dữ liệu kỳ {absent}, nên chưa tính chênh lệch hay tỷ lệ thay đổi."
            for row in rows:
                if row["Doanh thu"] is not None:
                    summary += f" Kỳ {row['Kỳ']} có tổng doanh thu {number(row['Doanh thu'])}."
        else:
            delta = current - base
            summary = scope + f"Doanh thu {rows[0]['Kỳ']} là {number(current)}, so với {number(base)} ở kỳ {rows[1]['Kỳ']}."
            if delta:
                summary += f" Doanh thu {'tăng' if delta > 0 else 'giảm'} {number(abs(delta))}."
            else:
                summary += " Doanh thu hai kỳ bằng nhau."
            if base:
                summary += f" Tỷ lệ thay đổi so với kỳ gốc là {number(delta / base * 100)}%."
            else:
                summary += " Kỳ gốc bằng 0 nên không tính tỷ lệ thay đổi."
        points = [{"label": row["Kỳ"], "value": row["Doanh thu"]} for row in reversed(rows) if row["Doanh thu"] is not None]
        used = sum(row["Dòng hợp lệ"] for row in rows)
        result["method"] = (scope + "Cộng doanh thu hợp lệ trong từng tháng. "
                            "Tính chênh lệch và tỷ lệ thay đổi so với tháng được dùng làm mốc.")
        result["warnings"].append("Ngày được phân nhóm theo UTC. Biểu đồ chỉ vẽ các kỳ có doanh thu hợp lệ.")
        chart_title = "Doanh thu từng kỳ"
    else:
        result.update(title="So sánh doanh thu theo chi nhánh")
        group = parameters["group_column"]
        scope = "Trên toàn bộ dữ liệu"
        if excluded is not None:
            count = int(exclusion_matches.sum())
            if count != 1:
                reason = (f"Tìm thấy {count} dòng có doanh thu {number(excluded)}. "
                          "Để loại đúng một dòng, hãy kiểm tra giá trị hoặc thêm điều kiện định danh dòng.")
                result.update(status="insufficient_data", reason=reason, summary=reason)
                return result
            frame = frame.loc[~exclusion_matches]
            scope += f" sau khi loại đúng một dòng có doanh thu {number(excluded)}"
        result["method"] = scope + ", cộng doanh thu hợp lệ theo chi nhánh rồi xếp từ thấp đến cao."
        grouped = frame.dropna(subset=[group]).groupby(group, sort=True, observed=True)[value]
        rows = [{"Chi nhánh": str(label), "Tổng doanh thu": values.sum(min_count=1),
                 "Dòng có doanh thu": int(values.count()), "Doanh thu TB mỗi dòng": values.mean()}
                for label, values in grouped]
        ranked = sorted((row for row in rows if row["Dòng có doanh thu"]), key=lambda row: row["Tổng doanh thu"])
        rows = ranked + [row for row in rows if not row["Dòng có doanh thu"]]
        if len(ranked) < 2:
            summary = "Cần ít nhất hai chi nhánh có doanh thu hợp lệ để so sánh."
            result.update(status="insufficient_data", reason=summary)
        else:
            lowest, next_branch = ranked[:2]
            ties = [row["Chi nhánh"] for row in ranked if row["Tổng doanh thu"] == lowest["Tổng doanh thu"]]
            summary = f"{scope}, chi nhánh {', '.join(ties)} " + ("đồng hạng thấp nhất" if len(ties) > 1 else "có tổng doanh thu thấp nhất")
            summary += f" với {number(lowest['Tổng doanh thu'])}."
            if len(ties) == 1:
                summary += f" Thấp hơn chi nhánh {next_branch['Chi nhánh']} {number(next_branch['Tổng doanh thu'] - lowest['Tổng doanh thu'])}."
                summary += (f" Hai chi nhánh có lần lượt {lowest['Dòng có doanh thu']} và {next_branch['Dòng có doanh thu']} dòng hợp lệ, "
                            f"doanh thu bình quân mỗi dòng là {number(lowest['Doanh thu TB mỗi dòng'])} và {number(next_branch['Doanh thu TB mỗi dòng'])}.")
            summary += " Số dòng và mức bình quân mô tả chênh lệch trong file. Chưa đủ dữ liệu để kết luận nguyên nhân kinh doanh."
            if excluded is None and raw_revenue is not None:
                candidate = rank_changing_outlier(frame, value, group, ties, raw_revenue)
                if candidate is not None:
                    result["rankChangingOutlier"] = candidate
            if parameters.get("explain_branch"):
                summary = branch_explanation(frame, parameters, result, scope, ranked, ties)
        points = [{"label": row["Chi nhánh"], "value": row["Tổng doanh thu"]} for row in ranked]
        used = sum(row["Dòng có doanh thu"] for row in ranked)
        chart_title = "Tổng doanh thu theo chi nhánh"
    result.update(summary=summary, data=table(rows), charts=[chart("bar", points, chart_title, metric=value, aggregate="sum")] if points else [],
                  sample={"total": total, "used": used, "excluded": total - used, "groups": []})
    result["warnings"].append("Tổng dùng doanh thu hợp lệ và giữ nguyên dòng trùng. " +
        ("Giữ các giá trị khác ngoài dòng được yêu cầu loại." if excluded is not None else "Giữ nguyên giá trị ngoại lệ trong file."))
    return result
