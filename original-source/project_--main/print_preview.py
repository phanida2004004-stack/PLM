"""Print confirmed brands on the original PL PDF, grouping consecutive same-brand rows.
Usage: python3 print_preview.py original.pdf output.pdf confirmed_brands.json
Only the supplied brand mapping is used; BOM/production data is never recalculated.
"""
import json
import re
import sys
from pathlib import Path
import fitz

NO_BOM = 'ไม่พบ BOM'
UNCONFIRMED = {'', '-', 'Conflict', 'รอตรวจสอบ', 'UNRESOLVED'}


def fit_label(page, label, rect, font='helv', maximum=7.0, minimum=3.7):
    """Fit text into its box without silently truncating the brand."""
    for size in [maximum - i * .25 for i in range(int((maximum - minimum) / .25) + 1)]:
        if fitz.get_text_length(label, fontname=font, fontsize=size) <= rect.width - 1:
            page.insert_textbox(rect, label, fontname=font, fontsize=size, align=1)
            return True
    # Longer labels need wrapping; keep original full brand rather than guess/shorten it.
    return page.insert_textbox(rect, label, fontname=font, fontsize=minimum, align=1) >= 0


def draw_right_brace(page, x, y_top, y_bottom):
    """Draw a } with its central point facing the brand name."""
    center = (y_top + y_bottom) / 2
    span = min(8, max(3, (y_bottom - y_top) / 5))
    tip = x + 5
    shape = page.new_shape()
    shape.draw_bezier(fitz.Point(x - 2, y_top), fitz.Point(x + 1, y_top),
                      fitz.Point(x + 1, y_top + span), fitz.Point(x + 1, y_top + span))
    shape.draw_line(fitz.Point(x + 1, y_top + span), fitz.Point(x + 1, center - span))
    shape.draw_bezier(fitz.Point(x + 1, center - span), fitz.Point(x + 1, center - 1),
                      fitz.Point(tip, center), fitz.Point(tip, center))
    shape.draw_bezier(fitz.Point(tip, center), fitz.Point(x + 1, center + 1),
                      fitz.Point(x + 1, center + span), fitz.Point(x + 1, center + span))
    shape.draw_line(fitz.Point(x + 1, center + span), fitz.Point(x + 1, y_bottom - span))
    shape.draw_bezier(fitz.Point(x + 1, y_bottom - span), fitz.Point(x + 1, y_bottom),
                      fitz.Point(x - 2, y_bottom), fitz.Point(x - 2, y_bottom))
    shape.finish(color=(0, 0, 0), width=.7)
    shape.commit()


def create_preview(source_path, output_path, brands=None):
    brands = {str(k).strip(): str(v or '').strip() for k, v in (brands or {}).items()}
    src = fitz.open(source_path)
    out = fitz.open()
    for source_page in src:
        width, height = source_page.rect.width, source_page.rect.height
        page = out.new_page(width=width, height=height)
        reserved = max(34, width * .0625)  # approved half-width BRAND column
        scale_x = (width - reserved) / width
        page.show_pdf_page(fitz.Rect(0, 0, width - reserved, height), src,
                           source_page.number, keep_proportion=False)
        # Preserve original header art while centering it on the physical page.
        header = fitz.Rect(60, 40, width - 60, 141)
        header_width = header.width * scale_x
        dest = fitz.Rect((width - header_width) / 2, 40,
                         (width + header_width) / 2, 141)
        page.draw_rect(fitz.Rect(0, 39, width, 141), color=None, fill=(1, 1, 1))
        page.show_pdf_page(dest, src, source_page.number, clip=header,
                           keep_proportion=False, overlay=True)
        words = source_page.get_text('words')
        sap_headers = [w for w in words if w[4].upper().strip('.') == 'SAP' and 100 < w[0] < 250]
        header_y = min((w[1] for w in sap_headers), default=None)
        if header_y is None:
            continue
        left, right = width - reserved + 3, width - 3
        page.insert_textbox(fitz.Rect(left, header_y - 1, right, header_y + 15),
                            'BRAND', fontsize=7.3, fontname='hebo', align=1)
        page.draw_line(fitz.Point(left, header_y + 16), fitz.Point(right, header_y + 16),
                       color=(.55, .55, .55), width=.4)
        rows = []
        seen = set()
        for w in words:
            code = w[4].strip()
            if not re.fullmatch(r'\d{7,9}', code) or not (165 <= w[0] <= 215):
                continue
            if w[1] <= header_y + 15:
                continue
            key = (round(w[1], 1), code)
            if key in seen:
                continue
            seen.add(key)
            rows.append({'y0': w[1], 'y1': w[3], 'brand': brands.get(code, '')})
        rows.sort(key=lambda r: r['y0'])

        # Only neighboring rows on the SAME PAGE may be grouped. Blank / no BOM breaks a group.
        index = 0
        while index < len(rows):
            first = rows[index]
            brand = first['brand']
            if brand in UNCONFIRMED:
                index += 1
                continue
            if brand == NO_BOM:
                rect = fitz.Rect(left, first['y0'] - 2, right, first['y1'] + 4)
                page.draw_rect(rect, color=None, fill=(.93, .93, .93))
                thai_font = Path(__file__).with_name('print_thai_font.ttf')
                if thai_font.exists():
                    page.insert_font(fontname='plthai', fontfile=str(thai_font))
                    fit_label(page, brand, rect, font='plthai', maximum=5.3, minimum=4.0)
                index += 1
                continue
            end = index + 1
            while end < len(rows) and rows[end]['brand'] == brand:
                end += 1
            last = rows[end - 1]
            top, bottom = first['y0'] - 2, last['y1'] + 4
            if end - index > 1:
                brace_x = left + 3
                draw_right_brace(page, brace_x, top, bottom)
                label_rect = fitz.Rect(left + 12, (top + bottom) / 2 - 9,
                                       right, (top + bottom) / 2 + 9)
            else:
                label_rect = fitz.Rect(left, top, right, bottom)
            fit_label(page, brand, label_rect)
            index = end
    out.save(output_path, garbage=4, deflate=True)
    out.close()
    src.close()


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit('Usage: python3 print_preview.py input.pdf output.pdf [brands.json]')
    mapping = {}
    if len(sys.argv) > 3:
        with open(sys.argv[3], encoding='utf-8') as handle:
            mapping = json.load(handle)
    create_preview(sys.argv[1], sys.argv[2], mapping)
