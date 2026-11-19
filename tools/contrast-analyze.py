#!/usr/bin/env python3
"""WCAG contrast analysis for VICE ROYALE HUD text.

Reads bugcheck-20261119/contrast-shots/manifest.json (boxes + computed
colours recorded by tools/contrast-check.mjs) and the screenshots, samples
the real pixels in a 2px ring around each text element (excluding pixels
that belong to another measured element), and computes WCAG contrast
ratios of the text colour against the sampled background.

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


def ring_pixels(img, box, others, ring=2):
    """Pixels in a `ring`-px band around box, minus other elements' boxes
    (dilated by 1px so a neighbour's glyphs never pollute the sample)."""
    w, h = img.size
    x0 = max(0, box["x"] - ring)
    y0 = max(0, box["y"] - ring)
    x1 = min(w, box["x"] + box["w"] + ring)
    y1 = min(h, box["y"] + box["h"] + ring)
    px = img.load()
    out = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if box["x"] <= x < box["x"] + box["w"] and box["y"] <= y < box["y"] + box["h"]:
                continue
            skip = False
            for o in others:
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
    print(f"{'scenario':<12} {'element':<14} {'text':<22} {'colour':<16} {'size':>5} {'bar':>4} {'ratio':>6} {'p90':>6}  verdict")
    for sc in manifest["scenarios"]:
        img = Image.open(sc["shot"]).convert("RGB")
        els = sc["elements"]
        for el in els:
            others = [o for o in els if o is not el]
            samples = ring_pixels(img, el, others)
            if len(samples) < 20:
                print(f"{sc['name']:<12} {el['key']:<14} {'(too few bg px)':<22} {el['color']:<16} {el['size']:>5}  --   --    --   SKIP")
                continue
            lums = sorted(rel_luminance(s) for s in samples)
            med = statistics.median(lums)
            p90 = percentile(lums, 0.90)
            tl = rel_luminance(parse_rgb(el["color"]))
            r_med = ratio(tl, med)
            r_p90 = ratio(tl, p90)
            bar = 3.0 if is_large(el["size"], el["weight"]) else 4.5
            verdict = "PASS" if r_med >= bar else "FAIL"
            if r_med < bar:
                failures.append((sc["name"], el["key"], r_med, bar))
            elif r_p90 < bar:
                verdict = "PASS*"
            print(f"{sc['name']:<12} {el['key']:<14} {el['text'][:22]:<22} {el['color']:<16} {el['size']:>5.0f} {bar:>4.1f} {r_med:>6.2f} {r_p90:>6.2f}  {verdict}")
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
