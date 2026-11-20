#!/usr/bin/env python3
"""WCAG contrast analysis for VICE ROYALE HUD text.

Reads bugcheck-20261119/contrast-shots/manifest.json (boxes + computed
colours recorded by tools/contrast-check.mjs) and the screenshots, samples
the real pixels inside each text element's box (minus the glyphs — pixels
near the text colour) and takes the median as the background the text
sits on: its own background fill, or the panel or scene showing through.
The outer ring is a fallback for elements whose interior has too few
non-glyph pixels.

Bar: 4.5:1 normal text, 3:1 large text (>=24px, or >=18.66px bold).
Verdict uses the MEDIAN ring luminance (the honest background); the p90
ratio is reported as the worst-case corner.
"""
import json
import math
import re
import statistics
import sys
from pathlib import Path

from PIL import Image

SHOTS = Path("/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/contrast-shots")


def parse_rgb(color):
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", color)
    if not m:
        raise ValueError(f"unparsable colour {color!r}")
    return tuple(int(v) for v in m.groups())


def rel_luminance(rgb):
    def lin(v):
        c = v / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(l1, l2):
    hi, lo = (l1, l2) if l1 >= l2 else (l2, l1)
    return (hi + 0.05) / (lo + 0.05)


def is_large(size, weight):
    return size >= 24 or (size >= 18.66 and weight >= 700)


def box_interior_pixels(img, box, text_rgb):
    """All pixels inside the box, minus (near-)text-coloured pixels (the
    glyphs). The median of what remains is the colour the text sits on:
    the element's own background fill (button, tab, key chip, toast
    banner), or the panel/scene showing through a transparent element.
    A border (2px, a small minority of the interior) cannot skew the
    median the way an edge ring can — the edge ring lands ON the border
    (toast's yellow border read 1.36; the button's dark border matched
    the text colour and emptied the sample)."""
    w, h = img.size
    x0 = max(0, box["x"])
    y0 = max(0, box["y"])
    x1 = min(w, box["x"] + box["w"])
    y1 = min(h, box["y"] + box["h"])
    px = img.load()
    out = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            c = px[x, y][:3]
            if sum(abs(a - b) for a, b in zip(c, text_rgb)) < 12:
                continue
            out.append(c)
    return out


def ring_pixels(img, box, others, ring=2):
    """Pixels in a `ring`-px band around box, minus other elements' boxes
    (dilated by 1px so a neighbour's glyphs never pollute the sample).
    An ancestor's box is NOT excluded: its box contains this element, so
    the ring around the child IS the ancestor's background — the colour
    the text actually sits on (e.g. ws-name inside its weapon-slot card).
    Fallback only: the inner ring is the primary sample (see above)."""
    w, h = img.size
    x0 = max(0, box["x"] - ring)
    y0 = max(0, box["y"] - ring)
    x1 = min(w, box["x"] + box["w"] + ring)
    y1 = min(h, box["y"] + box["h"] + ring)
    # Drop ancestors (a box that fully contains this element's box).
    neighbours = [o for o in others if not (
        o["x"] <= box["x"] and o["y"] <= box["y"]
        and o["x"] + o["w"] >= box["x"] + box["w"]
        and o["y"] + o["h"] >= box["y"] + box["h"])]
    px = img.load()
    out = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if box["x"] <= x < box["x"] + box["w"] and box["y"] <= y < box["y"] + box["h"]:
                continue
            skip = False
            for o in neighbours:
                if (o["x"] - 1 <= x < o["x"] + o["w"] + 1
                        and o["y"] - 1 <= y < o["y"] + o["h"] + 1):
                    skip = True
                    break
            if skip:
                continue
            out.append(px[x, y][:3])
    return out


def percentile(sorted_vals, p):
    if not sorted_vals:
        return float("nan")
    k = (len(sorted_vals) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def main():
    manifest = json.loads((SHOTS / "manifest.json").read_text())
    failures = []
    print(f"{'scenario':<12} {'element':<24} {'text':<22} {'colour':<16} {'size':>5} {'bar':>4} {'ratio':>6} {'p90':>6}  verdict")
    for sc in manifest["scenarios"]:
        img = Image.open(sc["shot"]).convert("RGB")
        els = sc["elements"]
        for el in els:
            bar = 3.0 if is_large(el["size"], el["weight"]) else 4.5
            tl = rel_luminance(parse_rgb(el["color"]))
            if el.get("canvas"):
                # Canvas map label: the dark outline hugs every glyph, so
                # the outline IS the adjacent background (the verdict).
                # The ring sample (map behind the outline) is reference only.
                outline = el["outline"].lstrip("#")
                ol = rel_luminance(tuple(int(outline[i:i + 2], 16) for i in (0, 2, 4)))
                r_out = ratio(tl, ol)
                others = [o for o in els if o is not el]
                samples = ring_pixels(img, el, others)
                r_ring = float("nan")
                if len(samples) >= 20:
                    r_ring = ratio(tl, statistics.median(sorted(rel_luminance(s) for s in samples)))
                verdict = "PASS" if r_out >= bar else "FAIL"
                if r_out < bar:
                    failures.append((sc["name"], el["key"], r_out, bar))
                print(f"{sc['name']:<12} {el['key']:<24} {el['text'][:22]:<22} {el['color']:<16} {el['size']:>5.0f} {bar:>4.1f} {r_out:>6.2f} {r_ring:>6.2f}  {verdict} (outline; ring {r_ring:.2f})")
                continue
            # Partially visible (box extends past the image edge): the
            # visible sliver is not a fair sample — the element is
            # measured in the scrolled capture where it is fully visible.
            iw, ih = img.size
            if (el["x"] < 0 or el["y"] < 0 or el["x"] + el["w"] > iw
                    or el["y"] + el["h"] > ih):
                print(f"{sc['name']:<12} {el['key']:<24} {'(partly off-screen)':<22} {el['color']:<16} {el['size']:>5}  --   --    --   SKIP")
                continue
            others = [o for o in els if o is not el]
            samples = box_interior_pixels(img, el, parse_rgb(el["color"]))
            if len(samples) < 20:
                samples = ring_pixels(img, el, others)
            if len(samples) < 20:
                print(f"{sc['name']:<12} {el['key']:<24} {'(too few bg px)':<22} {el['color']:<16} {el['size']:>5}  --   --    --   SKIP")
                continue
            lums = sorted(rel_luminance(s) for s in samples)
            med = statistics.median(lums)
            p90 = percentile(lums, 0.90)
            r_med = ratio(tl, med)
            r_p90 = ratio(tl, p90)
            verdict = "PASS" if r_med >= bar else "FAIL"
            if r_med < bar:
                failures.append((sc["name"], el["key"], r_med, bar))
            elif r_p90 < bar:
                verdict = "PASS*"
            print(f"{sc['name']:<12} {el['key']:<24} {el['text'][:22]:<22} {el['color']:<16} {el['size']:>5.0f} {bar:>4.1f} {r_med:>6.2f} {r_p90:>6.2f}  {verdict}")
    print()
    print("PASS* = median passes but the worst 10% of background pixels are below the bar.")
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for name, key, r, bar in failures:
            print(f"  {name}/{key}: {r:.2f} < {bar}")
        sys.exit(1)
    print("All measured HUD text meets its WCAG bar (median background).")


if __name__ == "__main__":
    main()
