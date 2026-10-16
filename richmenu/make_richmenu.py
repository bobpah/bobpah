"""Generate the LINE rich menu image (2500x1686, 3x2 grid).

Usage: python3 richmenu/make_richmenu.py
Output: richmenu/richmenu.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
COLS, ROWS = 3, 2
CW, CH = W // COLS, H // ROWS
FONT = "/usr/share/fonts/opentype/tlwg/Loma-Bold.otf"

BG = (14, 23, 38)
CARD = (24, 38, 61)
ACCENT = (6, 199, 85)  # LINE green
GOLD = (245, 183, 49)
WHITE = (240, 244, 250)
MUTED = (150, 165, 190)

BUTTONS = [
    ("ส่งสลิป", "ถ่าย / เลือกรูป", "camera", ACCENT),
    ("บันทึกเอง", "พิมพ์ +รับ / -จ่าย", "pen", GOLD),
    ("แดชบอร์ด", "กราฟ & ภาพรวม", "chart", (77, 163, 255)),
    ("สรุปยอด", "วันนี้ & เดือนนี้", "doc", (186, 104, 255)),
    ("รออนุมัติ", "รายการที่ค้าง", "clock", (255, 112, 87)),
    ("วิธีใช้", "คำสั่งทั้งหมด", "help", MUTED),
]


def icon(d, kind, cx, cy, col):
    s = 95
    w = 16
    if kind == "camera":
        d.rounded_rectangle([cx - s, cy - s * 0.65, cx + s, cy + s * 0.75], 28, outline=col, width=w)
        d.rectangle([cx - 40, cy - s * 0.65 - 30, cx + 40, cy - s * 0.65], fill=col)
        d.ellipse([cx - 45, cy - 40, cx + 45, cy + 50], outline=col, width=w)
    elif kind == "pen":
        d.rounded_rectangle([cx - s * 0.8, cy - s, cx + s * 0.6, cy + s], 20, outline=col, width=w)
        for i in range(3):
            y = cy - 45 + i * 45
            d.line([cx - 45, y, cx + 25, y], fill=col, width=12)
        d.line([cx + 40, cy + 70, cx + 120, cy - 30], fill=col, width=26)
    elif kind == "chart":
        d.line([cx - s, cy + s, cx + s, cy + s], fill=col, width=w)
        for i, h in enumerate([70, 130, 95, 175]):
            x = cx - s + 18 + i * 48
            d.rectangle([x, cy + s - h, x + 32, cy + s - 10], fill=col)
    elif kind == "doc":
        d.rounded_rectangle([cx - s * 0.75, cy - s, cx + s * 0.75, cy + s], 20, outline=col, width=w)
        d.text((cx, cy + 5), "฿", font=ImageFont.truetype(FONT, 130), fill=col, anchor="mm")
    elif kind == "clock":
        d.ellipse([cx - s, cy - s, cx + s, cy + s], outline=col, width=w)
        d.line([cx, cy, cx, cy - 60], fill=col, width=w)
        d.line([cx, cy, cx + 50, cy + 25], fill=col, width=w)
    elif kind == "help":
        d.ellipse([cx - s, cy - s, cx + s, cy + s], outline=col, width=w)
        d.text((cx, cy + 5), "?", font=ImageFont.truetype(FONT, 150), fill=col, anchor="mm")


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    title = ImageFont.truetype(FONT, 108)
    sub = ImageFont.truetype(FONT, 62)
    pad = 22
    for i, (label, hint, kind, col) in enumerate(BUTTONS):
        c, r = i % COLS, i // COLS
        x0, y0 = c * CW + pad, r * CH + pad
        x1, y1 = (c + 1) * CW - pad, (r + 1) * CH - pad
        d.rounded_rectangle([x0, y0, x1, y1], 48, fill=CARD)
        d.rounded_rectangle([x0, y0, x1, y0 + 14], 7, fill=col)
        cx = (x0 + x1) // 2
        icon(d, kind, cx, y0 + 250, col)
        d.text((cx, y0 + 500), label, font=title, fill=WHITE, anchor="mm")
        d.text((cx, y0 + 640), hint, font=sub, fill=MUTED, anchor="mm")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "richmenu.png")
    img.save(out, optimize=True)
    print(out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
