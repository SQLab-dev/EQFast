#!/usr/bin/env python3
"""Convert JMA2001 travel-time text lines to JSON used by the map renderer.

Input line format:
    P <p_time> S <s_time> <depth_km> <distance_km>

Example:
    P    0.416 S    0.703   0      2

Output JSON schema:
{
  "depths": [...],
  "distances": [...],
  "pTimes": [[...], ...],
  "sTimes": [[...], ...]
}
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Iterable


LINE_RE = re.compile(
    r"^\s*P\s+([+-]?\d+(?:\.\d+)?)\s+S\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*$",
    re.IGNORECASE,
)


def parse_lines(lines: Iterable[str]) -> list[tuple[float, float, float, float]]:
    rows: list[tuple[float, float, float, float]] = []
    for idx, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("..."):
            continue

        m = LINE_RE.match(line)
        if not m:
            continue

        p_time = float(m.group(1))
        s_time = float(m.group(2))
        depth_km = float(m.group(3))
        distance_km = float(m.group(4))
        rows.append((p_time, s_time, depth_km, distance_km))

    if not rows:
        raise ValueError("No valid rows were parsed. Check input format.")

    return rows


def linear_fill_1d(values: list[float | None]) -> list[float | None]:
    result = values[:]
    n = len(result)

    known = [i for i, v in enumerate(result) if v is not None]
    if not known:
        return result

    first = known[0]
    for i in range(0, first):
        result[i] = result[first]

    last = known[-1]
    for i in range(last + 1, n):
        result[i] = result[last]

    for a, b in zip(known, known[1:]):
        va = result[a]
        vb = result[b]
        if va is None or vb is None:
            continue
        gap = b - a
        if gap <= 1:
            continue
        step = (vb - va) / gap
        for i in range(a + 1, b):
            result[i] = va + step * (i - a)

    return result


def fill_missing_grid(grid: list[list[float | None]]) -> list[list[float | None]]:
    # Fill along distance axis first.
    by_row = [linear_fill_1d(row) for row in grid]

    # Fill along depth axis for remaining gaps.
    if not by_row:
        return by_row
    h, w = len(by_row), len(by_row[0])
    for x in range(w):
        col = [by_row[y][x] for y in range(h)]
        col_filled = linear_fill_1d(col)
        for y in range(h):
            by_row[y][x] = col_filled[y]

    return by_row


def to_matrix(
    rows: list[tuple[float, float, float, float]],
) -> tuple[list[float], list[float], list[list[float | None]], list[list[float | None]]]:
    depths = sorted({depth for _, _, depth, _ in rows})
    distances = sorted({dist for _, _, _, dist in rows})

    depth_index = {d: i for i, d in enumerate(depths)}
    dist_index = {d: i for i, d in enumerate(distances)}

    p_grid: list[list[float | None]] = [
        [None for _ in distances] for _ in depths
    ]
    s_grid: list[list[float | None]] = [
        [None for _ in distances] for _ in depths
    ]

    for p, s, depth, dist in rows:
        i = depth_index[depth]
        j = dist_index[dist]
        p_grid[i][j] = p
        s_grid[i][j] = s

    return depths, distances, p_grid, s_grid


def count_missing(grid: list[list[float | None]]) -> int:
    return sum(1 for row in grid for v in row if v is None)


def sanitize_numbers(grid: list[list[float | None]]) -> list[list[float | None]]:
    out: list[list[float | None]] = []
    for row in grid:
        out_row: list[float | None] = []
        for v in row:
            if v is None:
                out_row.append(None)
            elif isinstance(v, float) and math.isnan(v):
                out_row.append(None)
            else:
                out_row.append(float(v))
        out.append(out_row)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert JMA2001 travel-time text to JSON (depth x distance grid)."
    )
    parser.add_argument("input", type=Path, help="Input text file path")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("source/jma2001_travel_time.json"),
        help="Output JSON file path",
    )
    parser.add_argument(
        "--fill-missing",
        action="store_true",
        help="Fill missing cells by linear interpolation/extrapolation",
    )

    args = parser.parse_args()

    text = args.input.read_text(encoding="utf-8", errors="ignore")
    rows = parse_lines(text.splitlines())
    depths, distances, p_grid, s_grid = to_matrix(rows)

    p_grid = sanitize_numbers(p_grid)
    s_grid = sanitize_numbers(s_grid)

    missing_before = count_missing(p_grid) + count_missing(s_grid)
    if args.fill_missing:
        p_grid = fill_missing_grid(p_grid)
        s_grid = fill_missing_grid(s_grid)

    missing_after = count_missing(p_grid) + count_missing(s_grid)

    payload = {
        "depths": depths,
        "distances": distances,
        "pTimes": p_grid,
        "sTimes": s_grid,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"parsed rows      : {len(rows)}")
    print(f"depth count      : {len(depths)}")
    print(f"distance count   : {len(distances)}")
    print(f"missing before   : {missing_before}")
    print(f"missing after    : {missing_after}")
    print(f"output           : {args.output}")


if __name__ == "__main__":
    main()
