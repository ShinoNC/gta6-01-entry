#!/usr/bin/env python3
"""Generate the chunky 16-bit pixel-art textures for VICE ROYALE.

Every texture is drawn pixel by pixel at a small grid (32 or 64 cells) and
saved as a PNG, so the game loads them as images instead of carrying the art
as source text in the dossier. Sunset palette throughout: coral pink, warm
orange, teal, deep purple. Run from the entry root:

    python3 tools/gen_textures.py

Output goes to game/assets/.
"""
import os
import random

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "game", "assets")
os.makedirs(OUT, exist_ok=True)

# Sunset palette (hex -> RGB).
PALETTE = {
    "coral": (255, 122, 102),
    "peach": (255, 183, 140),
    "cream": (255, 226, 178),
    "orange": (255, 150, 66),
    "pink": (255, 107, 157),
    "purple": (122, 74, 168),
    "dusk": (64, 48, 110),
    "teal": (38, 178, 178),
    "sea": (23, 120, 150),
    "foam": (190, 240, 235),
    "sand": (240, 205, 140),
    "sand_dark": (214, 172, 106),
    "asphalt": (74, 72, 94),
    "asphalt_light": (98, 96, 118),
    "concrete": (168, 160, 148),
    "concrete_dark": (132, 124, 114),
    "glass_lit": (255, 214, 120),
    "glass_dark": (44, 62, 96),
    "glass_sky": (140, 200, 235),
    "leaf": (46, 160, 84),
    "leaf_dark": (28, 112, 58),
    "leaf_light": (96, 205, 110),
    "trunk": (122, 84, 52),
    "red": (214, 48, 62),
    "red_dark": (150, 28, 44),
    "blue": (52, 110, 220),
    "blue_dark": (30, 70, 160),
    "taxi": (255, 200, 40),
    "taxi_dark": (190, 140, 20),
    "neon_pink": (255, 80, 180),
    "neon_cyan": (80, 240, 255),
    "white": (245, 240, 230),
    "black": (24, 20, 32),
}


def img(size, base):
    """A fresh square image filled with one palette colour."""
    return Image.new("RGB", (size, size), PALETTE[base])


def save(image, name):
    path = os.path.join(OUT, name)
    image.save(path, optimize=True)
    print(f"{name}: {os.path.getsize(path)} bytes")


def windows(px, size, rng, x0, y0, cols, rows, cw, ch, gapx, gapy, lit_chance):
    """Draw a grid of lit/unlit windows on a pixel access object."""
    for r in range(rows):
        for c in range(cols):
            x = x0 + c * (cw + gapx)
            y = y0 + r * (ch + gapy)
            lit = rng.random() < lit_chance
            col = PALETTE["glass_lit" if lit else "glass_dark"]
            for yy in range(y, min(y + ch, size)):
                for xx in range(x, min(x + cw, size)):
                    px[xx, yy] = col
            # One bright pixel glint in the corner of each lit window.
            if lit:
                px[x, y] = PALETTE["white"]


def speckle(px, size, rng, colours, count):
    for _ in range(count):
        x = rng.randrange(size)
        y = rng.randrange(size)
        px[x, y] = PALETTE[rng.choice(colours)]


def facade(name, base, trim, seed, lit_chance, balcony):
    """A building face: flat wall, window grid, trim band, optional balconies."""
    size = 64
    im = img(size, base)
    px = im.load()
    rng = random.Random(seed)
    # Subtle vertical shading so the wall is not one flat block.
    for x in range(size):
        shade = rng.choice([0, 0, 0, -8, 8])
        for y in range(size):
            r, g, b = px[x, y]
            px[x, y] = (max(0, r + shade), max(0, g + shade), max(0, b + shade))
    # Trim band along the top and bottom.
    for y in list(range(0, 3)) + list(range(size - 3, size)):
        for x in range(size):
            px[x, y] = PALETTE[trim]
    windows(px, size, rng, 6, 8, 4, 5, 8, 6, 6, 4, lit_chance)
    if balcony:
        # Thin railing lines under every other window row.
        for r in (1, 3):
            y = 8 + r * 10 + 7
            for x in range(6, size - 6):
                px[x, y] = PALETTE["dusk"]
                if x % 4 == 0:
                    px[x, y + 1] = PALETTE["dusk"]
    save(im, name)


def road():
    """Asphalt strip with a dashed centre line; tiles along its length."""
    size = 64
    im = img(size, "asphalt")
    px = im.load()
    rng = random.Random(11)
    speckle(px, size, rng, ["asphalt_light", "black"], 220)
    # White edge lines.
    for y in range(size):
        for x in (1, 2, 3, size - 4, size - 3, size - 2):
            px[x, y] = PALETTE["white"]
    # Yellow dashed centre line (two dashes per tile, tiles seamlessly).
    for y in range(size):
        if (y % 32) < 18:
            for dx in (-2, -1, 0, 1, 2):
                px[size // 2 + dx, y] = PALETTE["glass_lit"]
    save(im, "road.png")


def sidewalk():
    """Pavement slabs with dark joints and a warm kerb stripe."""
    size = 64
    im = img(size, "concrete")
    px = im.load()
    rng = random.Random(22)
    speckle(px, size, rng, ["concrete_dark", "cream"], 180)
    for i in range(size):
        px[i, 0] = PALETTE["concrete_dark"]
        px[i, 31] = PALETTE["concrete_dark"]
        px[i, 32] = PALETTE["concrete_dark"]
        px[0, i] = PALETTE["concrete_dark"]
        px[31, i] = PALETTE["concrete_dark"]
        px[32, i] = PALETTE["concrete_dark"]
    # Kerb stripe along one edge.
    for y in range(size):
        px[size - 2, y] = PALETTE["orange"]
        px[size - 1, y] = PALETTE["orange"]
    save(im, "sidewalk.png")


def sand():
    """Warm beach sand with speckles and a few shell dots."""
    size = 64
    im = img(size, "sand")
    px = im.load()
    rng = random.Random(33)
    speckle(px, size, rng, ["sand_dark", "cream", "peach"], 420)
    for _ in range(8):
        x = rng.randrange(4, size - 4)
        y = rng.randrange(4, size - 4)
        px[x, y] = PALETTE["white"]
        px[x + 1, y] = PALETTE["pink"]
    save(im, "sand.png")


def palm():
    """Palm fronds on a transparent background, for crossed leaf planes."""
    size = 64
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = im.load()
    rng = random.Random(44)
    cx, cy = size // 2, size - 6
    # Seven fronds fanning out from the trunk top.
    for f in range(7):
        angle = -170 + f * 28
        length = rng.randint(22, 30)
        colour = PALETTE[rng.choice(["leaf", "leaf_dark", "leaf_light"])]
        for t in range(length):
            # Arc: fronds rise then droop.
            import math

            rad = math.radians(angle)
            x = int(cx + math.cos(rad) * t)
            y = int(cy + math.sin(rad) * t * 0.55 + t * t * 0.02)
            if 0 <= x < size and 0 <= y < size:
                px[x, y] = colour + (255,)
                if 0 <= x + 1 < size:
                    px[x + 1, y] = colour + (255,)
                # Leaflets: short side strokes along the frond.
                if t % 3 == 0 and 0 <= y + 2 < size:
                    px[x, y + 2] = colour + (255,)
    save(im, "palm.png")


def car_body(name, base, dark, seed):
    """A car body panel: paint, door seams, window band, headlight dots."""
    size = 64
    im = img(size, base)
    px = im.load()
    rng = random.Random(seed)
    # Paint shading: darker toward the bottom.
    for y in range(size):
        shade = -int(y * 0.5)
        for x in range(size):
            r, g, b = px[x, y]
            px[x, y] = (max(0, r + shade), max(0, g + shade), max(0, b + shade))
    # Window band.
    for y in range(10, 24):
        for x in range(10, size - 10):
            px[x, y] = PALETTE["glass_sky"]
    # Door seams.
    for x in (20, 44):
        for y in range(26, size - 6):
            px[x, y] = PALETTE[dark]
    # Headlight dots.
    for x, y in ((4, 44), (5, 44), (size - 5, 44), (size - 6, 44)):
        px[x, y] = PALETTE["glass_lit"]
    save(im, name)


def water():
    """Teal sea with lighter wave streaks; tiles in both directions."""
    size = 64
    im = img(size, "sea")
    px = im.load()
    rng = random.Random(55)
    for _ in range(26):
        x = rng.randrange(0, size - 10)
        y = rng.randrange(size)
        length = rng.randint(4, 10)
        col = PALETTE[rng.choice(["teal", "foam"])]
        for i in range(length):
            px[(x + i) % size, y] = col
    speckle(px, size, rng, ["teal"], 120)
    save(im, "water.png")


def roof():
    """A flat rooftop: warm concrete, edge trim, AC boxes, a skylight."""
    size = 64
    im = img(size, "concrete_dark")
    px = im.load()
    rng = random.Random(66)
    speckle(px, size, rng, ["concrete", "asphalt_light"], 200)
    for i in range(size):
        px[i, 0] = PALETTE["orange"]
        px[i, 1] = PALETTE["orange"]
        px[0, i] = PALETTE["orange"]
        px[1, i] = PALETTE["orange"]
    # Two AC units.
    for (ax, ay) in ((10, 12), (38, 36)):
        for y in range(ay, ay + 10):
            for x in range(ax, ax + 12):
                px[x, y] = PALETTE["concrete"]
        for x in range(ax + 2, ax + 10, 3):
            px[x, ay + 2] = PALETTE["dusk"]
    # Skylight.
    for y in range(40, 50):
        for x in range(10, 24):
            px[x, y] = PALETTE["glass_sky"]
    save(im, "roof.png")


def facade_deco():
    """Art-deco facade: deep purple wall, vertical neon fins, lit windows."""
    size = 64
    im = img(size, "purple")
    px = im.load()
    rng = random.Random(4)
    # Vertical shading stripes, deco-style.
    for x in range(size):
        shade = -12 if x % 8 < 4 else 10
        for y in range(size):
            r, g, b = px[x, y]
            px[x, y] = (max(0, r + shade), max(0, g + shade), max(0, b + shade))
    # Neon fin strips down the face.
    for x in (14, 30, 46):
        for y in range(4, size - 4):
            px[x, y] = PALETTE["neon_cyan"]
            px[x + 1, y] = PALETTE["neon_cyan"]
    # Stepped crown along the top.
    for x in range(size):
        px[x, 0] = PALETTE["cream"]
        px[x, 1] = PALETTE["cream"]
    windows(px, size, rng, 6, 8, 4, 5, 8, 6, 6, 4, 0.5)
    save(im, "facade-d.png")


def billboard():
    """A rooftop billboard: sunset gradient, sun disc, palm silhouettes and
    the words VICE ROYALE in blocky neon lettering."""
    width, height = 128, 64
    im = Image.new("RGB", (width, height))
    px = im.load()
    sky = ["dusk", "purple", "pink", "coral", "orange", "cream"]
    for y in range(height):
        col = PALETTE[sky[min(len(sky) - 1, y * len(sky) // height)]]
        for x in range(width):
            px[x, y] = col
    # Sun disc, low on the horizon.
    import math

    cx, cy, r = 96, 40, 14
    for y in range(height):
        for x in range(width):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                px[x, y] = PALETTE["glass_lit"]
    # Palm silhouettes along the bottom.
    for (tx, th) in ((12, 18), (30, 14), (116, 16)):
        for y in range(height - th, height):
            px[tx, y] = PALETTE["black"]
        for f in range(5):
            angle = -170 + f * 32
            for t in range(8):
                rad = math.radians(angle)
                x = int(tx + math.cos(rad) * t)
                y = int(height - th + math.sin(rad) * t * 0.5 + t * t * 0.08)
                if 0 <= x < width and 0 <= y < height:
                    px[x, y] = PALETTE["black"]
    # Blocky lettering: VICE over ROYALE, drawn from a 3x5 pixel font.
    font = {
        "S": ("011", "100", "010", "001", "110"),
        "O": ("010", "101", "101", "101", "010"),
        "L": ("100", "100", "100", "100", "111"),
        "A": ("010", "101", "111", "101", "101"),
        "R": ("110", "101", "110", "101", "101"),
        "I": ("111", "010", "010", "010", "111"),
        "K": ("101", "101", "110", "101", "101"),
        "E": ("111", "100", "110", "100", "111"),
        "Y": ("101", "101", "010", "010", "010"),
        "V": ("101", "101", "101", "101", "010"),
        "C": ("011", "100", "100", "100", "011"),
    }

    def draw_word(word, x0, y0, scale, colour):
        x = x0
        for ch in word:
            glyph = font[ch]
            for row in range(5):
                for col in range(3):
                    if glyph[row][col] == "1":
                        for dy in range(scale):
                            for dx in range(scale):
                                px[x + col * scale + dx, y0 + row * scale + dy] = PALETTE[colour]
            x += 4 * scale

    draw_word("VICE", 8, 8, 2, "neon_pink")
    draw_word("ROYALE", 8, 26, 3, "neon_cyan")
    save(im, "billboard.png")


def main():
    facade("facade-a.png", "coral", "cream", 1, 0.45, False)
    facade("facade-b.png", "teal", "foam", 2, 0.35, True)
    facade("facade-c.png", "cream", "orange", 3, 0.55, False)
    facade_deco()
    road()
    sidewalk()
    sand()
    palm()
    car_body("car-red.png", "red", "red_dark", 7)
    car_body("car-blue.png", "blue", "blue_dark", 8)
    car_body("car-taxi.png", "taxi", "taxi_dark", 9)
    water()
    roof()
    billboard()
    print("Done. Textures in", OUT)


if __name__ == "__main__":
    main()
