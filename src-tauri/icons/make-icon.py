"""Generate Pi Desktop app icon: dark rounded-square + official pi.dev "Pi" mark in app accent peach.

The mark geometry is transcribed from https://pi.dev/logo-auto.svg (800x800 viewBox,
pure orthogonal rects: P outline with evenodd hole + i-dot square). Super-sampled 4x
for anti-aliased edges.
"""
from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersample factor
N = SIZE * SS

# --- mark geometry, SVG coords * (N/800) --------------------------------------
s = N / 800.0
P = [(165.29, 165.29), (517.36, 165.29), (517.36, 400), (400, 400),
     (400, 517.36), (282.65, 517.36), (282.65, 634.72), (165.29, 634.72)]
P = [(x * s, y * s) for x, y in P]
HOLE = (282.65 * s, 282.65 * s, 400 * s, 400 * s)
DOT = (517.36 * s, 400 * s, 634.72 * s, 634.72 * s)

# --- colors --------------------------------------------------------------------
TOP, BOT = (0x1a, 0x1a, 0x1e), (0x0b, 0x0b, 0x0f)   # window bg gradient
BORDER = (0x2e, 0x2e, 0x33)                          # subtle edge
PEACH = (0xfa, 0xb2, 0x83)                           # --accent #fab283

# --- background: rounded square with vertical gradient -------------------------
grad = Image.new("RGBA", (N, N))
d = ImageDraw.Draw(grad)
for y in range(N):
    t = y / (N - 1)
    c = tuple(int(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3))
    d.line([(0, y), (N, y)], fill=c + (255,))

bg_mask = Image.new("L", (N, N), 0)
ImageDraw.Draw(bg_mask).rounded_rectangle(
    [24 * SS, 24 * SS, N - 24 * SS, N - 24 * SS], radius=210 * SS, fill=255)

bg = Image.new("RGBA", (N, N), (0, 0, 0, 0))
bg.paste(grad, (0, 0), bg_mask)
ImageDraw.Draw(bg).rounded_rectangle(
    [24 * SS, 24 * SS, N - 24 * SS, N - 24 * SS],
    radius=210 * SS, outline=BORDER + (255,), width=3 * SS)

# --- mark mask: P outline minus hole, plus i-dot --------------------------------
mark = Image.new("L", (N, N), 0)
md = ImageDraw.Draw(mark)
md.polygon(P, fill=255)
md.rectangle([int(v) for v in HOLE], fill=0)   # punch the bowl hole
md.rectangle([int(v) for v in DOT], fill=255)  # i-dot

bg.paste(PEACH + (255,), (0, 0), mark)

# --- downscale ------------------------------------------------------------------
bg = bg.resize((SIZE, SIZE), Image.LANCZOS)
bg.save("icon-source.png")
print("wrote icon-source.png", bg.size)
