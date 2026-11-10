"""Evidence-based workflows. Language models select columns; only this engine calculates."""
import numpy as np
import pandas as pd
from scipy import stats


def compare_groups(frame, parameters, base, execute_selected):
    p = parameters
    value, group = p['value_column'], p['group_column']
    clean = frame.dropna(subset=[value, group])
    grouped = list(clean.groupby(group, sort=True, observed=True))
    if not 2 <= len(grouped) <= 50:
        raise ValueError('Cần 2–50 nhóm; chọn các nhóm cần so sánh.')
    series = [g[value] for _, g in grouped]
    alpha = float(p.get('alpha', .05))
    rows, assumptions = [], []
    normal = True
    for name, values in zip((str(n) for n, _ in grouped), series):
        eligible = 3 <= len(values) <= 5000 and values.nunique() > 1
        probability = float(stats.shapiro(values).pvalue) if eligible else None
        passes = probability is not None and probability >= alpha
        normal = normal and passes
        rows.append({'group': name, 'n': len(values), 'mean': float(values.mean()),
                     'median': float(values.median()), 'shapiro_p': probability})
        assumptions.append({'name': 'Shapiro–Wilk nhóm ' + name,
                            'status': ('passed' if passes else 'failed') if eligible else 'not_checked',
                            'detail': f'p={probability}; alpha={alpha}' if eligible else 'Cần 3–5000 giá trị không hằng; không tự lấy mẫu.'})
    levene = None
    if all(len(g) >= 2 for g in series):
        probability = float(stats.levene(*series, center='median').pvalue)
        if np.isfinite(probability):
            levene = probability
    equal = levene is not None and levene >= alpha
    assumptions.append({'name': 'Phương sai (Levene, tâm median)',
                        'status': ('passed' if equal else 'failed') if levene is not None else 'not_checked',
                        'detail': f'p={levene}; alpha={alpha}. Welch không đòi phương sai bằng nhau.'})
    operation = ('independent_ttest' if normal else 'mann_whitney') if len(series) == 2 else ('anova' if normal and equal else 'kruskal_wallis')
    reason = ('Hai nhóm, chưa bác bỏ chuẩn tính: dùng Welch.' if normal else 'Hai nhóm, chưa đáp ứng chuẩn tính: dùng Mann–Whitney U.') if len(series) == 2 else ('Nhiều nhóm, chưa bác bỏ chuẩn tính và đồng nhất phương sai: dùng ANOVA.' if normal and equal else 'Nhiều nhóm, chưa đáp ứng chuẩn tính hoặc đồng nhất phương sai: dùng Kruskal–Wallis.')
    confirmed = p.get('independent') is True
    assumptions.insert(0, {'name': 'Tính độc lập của quan sát', 'status': 'passed' if confirmed else 'not_checked',
                          'detail': 'Do người dùng xác nhận; không suy ra từ số liệu.' if confirmed else 'Bạn xác nhận các quan sát độc lập, không phải đo lặp/ghép cặp trên cùng đối tượng chứ?'})
    base.update(title='Kiểm tra điều kiện so sánh nhóm', summary=reason,
                data={'columns': list(rows[0]), 'rows': rows, 'rowCount': len(rows), 'truncated': False},
                assumptions=assumptions, selection={'operation': operation, 'reason': reason},
                sample={'total': len(frame), 'used': len(clean), 'missing': len(frame)-len(clean), 'excluded': 0,
                        'groups': [{'name': r['group'], 'count': r['n']} for r in rows]})
    if not confirmed:
        base['status'] = 'needs_confirmation'
        base['summary'] += '\n' + assumptions[0]['detail'] + ' Chưa chạy kiểm định khác biệt.'
        return base
    selected = {k: v for k, v in p.items() if k != 'independent'}
    if operation == 'independent_ttest':
        selected['equal_variance'] = False
    report = execute_selected(operation, selected)
    report['assumptions'] = assumptions + [a for a in report.get('assumptions', []) if a['name'] not in ('Thiết kế thu thập dữ liệu', 'Phân phối và điều kiện suy luận')]
    report['selection'] = base['selection']
    report['summary'] = reason + '\n' + report['summary']
    if operation in ('mann_whitney', 'kruskal_wallis'):
        report['warnings'].append('Phép phi tham số kiểm tra phân phối/thứ hạng, không trực tiếp kiểm định trung bình. Không diễn giải như chênh lệch mean.')
    report['warnings'].append('Kiểm tra giả định và chọn phép thử trên cùng dữ liệu mang tính khám phá; cần thiết kế nghiên cứu độc lập để xác nhận.')
    return report


def insights(frame, parameters, base):
    names = parameters['columns']
    date_column = parameters.get('date_column')
    rows, findings, charts = [], [], []
    for name in names:
        values = frame[name].dropna()
        if values.empty:
            findings.append(f'{name}: không có giá trị số hợp lệ để phân tích.')
            continue
        q1, q3 = values.quantile([.25, .75])
        low, high = q1 - 1.5*(q3-q1), q3 + 1.5*(q3-q1)
        unusual = values[(values < low) | (values > high)]
        rows.append({'column': name, 'valid': len(values), 'missing': len(frame)-len(values),
                     'mean': float(values.mean()), 'median': float(values.median()),
                     'iqr_lower': float(low), 'iqr_upper': float(high), 'outliers': len(unusual),
                     'min': float(values.min()), 'max': float(values.max())})
        findings.append(f'{name}: {len(values)} giá trị hợp lệ, {len(unusual)} ngoại lệ IQR (1.5); min={values.min():.15g}, max={values.max():.15g}.')
        if date_column:
            dates = pd.to_datetime(frame[date_column], errors='coerce', utc=True)
            valid = dates.notna() & frame[name].notna()
            months = dates.loc[valid].dt.strftime('%Y-%m')
            sums = frame.loc[valid, name].groupby(months).sum().sort_index()
            if not sums.empty:
                points = [{'label': str(k), 'value': float(v)} for k, v in sums.items()]
                charts.append({'chartType': 'line', 'name': 'Tổng ' + name + ' theo tháng (UTC)', 'rows': points,
                               'dimension': date_column, 'metric': name, 'aggregate': 'sum'})
                peak = sums.idxmax()
                peak_values = frame.loc[valid & dates.dt.strftime('%Y-%m').eq(peak), name]
                peak_outliers = peak_values[(peak_values < low) | (peak_values > high)]
                findings.append(f'{name}: tháng cao nhất {peak}, tổng={sums.loc[peak]:.15g}; có {len(peak_outliers)} ngoại lệ, tổng đóng góp={peak_outliers.sum():.15g}.')
                if len(sums) >= 2:
                    first, last = float(sums.iloc[0]), float(sums.iloc[-1])
                    findings.append(f'{name}: tổng tháng đầu {sums.index[0]}={first:.15g}, tháng cuối {sums.index[-1]}={last:.15g}, chênh lệch={last-first:.15g}. Đây là so sánh hai mốc, chưa chứng minh xu hướng dài hạn.')
            base['warnings'].append(f'{name}: bỏ {len(frame)-int(valid.sum())} dòng thiếu ngày/số khỏi tổng tháng; không tự điền các tháng vắng dữ liệu.')
    base.update(title='Insights từ dữ liệu thực', summary='\n'.join(findings) or 'Không có đủ dữ liệu.',
                data={'columns': list(rows[0]) if rows else [], 'rows': rows, 'rowCount': len(rows), 'truncated': False},
                charts=charts[:10], sample={'total': len(frame), 'used': int(frame[names].notna().any(axis=1).sum()),
                                          'missing': int(frame[names].isna().all(axis=1).sum()), 'excluded': 0, 'groups': []})
    base['warnings'].append('Nhận định khám phá dựa trên IQR và tổng tháng; ngoại lệ không mặc nhiên là lỗi. Không suy đoán nguyên nhân hoặc tự sửa/xóa dữ liệu.')
    return base
