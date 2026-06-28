#!/usr/bin/env python3
"""Generate dHunt extension icons matching the dashboard brand-logo design."""

import cairo
import math
import os

ORANGE = (0xf9 / 255, 0x73 / 255, 0x16 / 255)   # #f97316
RADIUS_RATIO = 0.22   # border-radius as fraction of icon size

def rounded_rect(ctx, size, radius):
    r = radius
    s = size
    ctx.new_sub_path()
    ctx.arc(s - r,     r,     r,  -math.pi / 2,  0)
    ctx.arc(s - r, s - r,     r,   0,             math.pi / 2)
    ctx.arc(    r, s - r,     r,   math.pi / 2,   math.pi)
    ctx.arc(    r,     r,     r,   math.pi,       3 * math.pi / 2)
    ctx.close_path()

def create_icon(size):
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surface)

    # Orange rounded-square background
    rounded_rect(ctx, size, size * RADIUS_RATIO)
    ctx.set_source_rgb(*ORANGE)
    ctx.fill()

    # White bold "dH" text, centered
    ctx.set_source_rgb(1, 1, 1)
    ctx.select_font_face("DejaVu Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)

    # Slightly larger ratio for small sizes so "dH" stays legible
    font_size = size * (0.46 if size <= 32 else 0.40)
    ctx.set_font_size(font_size)

    text = "dH"
    te = ctx.text_extents(text)
    x = (size - te.width)  / 2 - te.x_bearing
    y = (size - te.height) / 2 - te.y_bearing
    ctx.move_to(x, y)
    ctx.show_text(text)

    return surface

os.makedirs(os.path.dirname(__file__), exist_ok=True)
for s in [16, 32, 48, 128]:
    surface = create_icon(s)
    path = os.path.join(os.path.dirname(__file__), f"icon{s}.png")
    surface.write_to_png(path)
    print(f"  created {path}")
