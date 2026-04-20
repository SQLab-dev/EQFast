#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime
import json
import math
import re
from pathlib import Path


BIN_MIN = -3.0
BIN_MAX = 7.0
BIN_STEP = 0.001


class FenwickTree:
    def __init__(self, size: int) -> None:
        self.tree = [0] * size

    def add(self, index: int, delta: int) -> None:
        i = index
        while i < len(self.tree):
            self.tree[i] += delta
            i += i & -i

    def find_by_prefix(self, target: int) -> int:
        index = 0
        bit = 1
        while (bit << 1) < len(self.tree):
            bit <<= 1
        remaining = target
        while bit:
            nxt = index + bit
            if nxt < len(self.tree) and self.tree[nxt] < remaining:
                index = nxt
                remaining -= self.tree[nxt]
            bit >>= 1
        return index + 1


def floor_to_first_decimal_by_jma_rule(value: float) -> float:
    if not math.isfinite(value):
        return -3.0
    rounded_to_2 = round(value * 100) / 100
    return math.floor(rounded_to_2 * 10) / 10


def normalize_coeffs(alpha0: float, alpha1: float, alpha2: float, beta0: float, beta1: float, beta2: float) -> tuple[float, float, float, float, float]:
    return (alpha1 / alpha0, alpha2 / alpha0, beta0 / alpha0, beta1 / alpha0, beta2 / alpha0)


def create_pair_filter(f0: float, f1: float, dt: float) -> tuple[float, float, float, float, float]:
    w0 = 2 * math.pi * f0
    w1 = 2 * math.pi * f1
    return normalize_coeffs(
        8 / (dt * dt) + (4 * w0 + 2 * w1) / dt + w0 * w1,
        2 * w0 * w1 - 16 / (dt * dt),
        8 / (dt * dt) - (4 * w0 + 2 * w1) / dt + w0 * w1,
        4 / (dt * dt) + (2 * w1) / dt,
        -8 / (dt * dt),
        4 / (dt * dt) - (2 * w1) / dt,
    )


def create_compensation_pair_filter(f1: float, dt: float) -> tuple[float, float, float, float, float]:
    w1 = 2 * math.pi * f1
    return normalize_coeffs(
        16 / (dt * dt) + (17 * w1) / dt + w1 * w1,
        2 * w1 * w1 - 32 / (dt * dt),
        16 / (dt * dt) - (17 * w1) / dt + w1 * w1,
        4 / (dt * dt) + (8.5 * w1) / dt + w1 * w1,
        2 * w1 * w1 - 8 / (dt * dt),
        4 / (dt * dt) - (8.5 * w1) / dt + w1 * w1,
    )


def create_correction_filter(f2: float, h2a: float, h2b: float, dt: float) -> tuple[float, float, float, float, float]:
    w2 = 2 * math.pi * f2
    return normalize_coeffs(
        12 / (dt * dt) + (12 * h2b * w2) / dt + w2 * w2,
        10 * w2 * w2 - 24 / (dt * dt),
        12 / (dt * dt) - (12 * h2b * w2) / dt + w2 * w2,
        12 / (dt * dt) + (12 * h2a * w2) / dt + w2 * w2,
        10 * w2 * w2 - 24 / (dt * dt),
        12 / (dt * dt) - (12 * h2a * w2) / dt + w2 * w2,
    )


def create_lowpass_filter(freq: float, damping: float, dt: float) -> tuple[float, float, float, float, float]:
    w = 2 * math.pi * freq
    return normalize_coeffs(
        12 / (dt * dt) + (12 * damping * w) / dt + w * w,
        10 * w * w - 24 / (dt * dt),
        12 / (dt * dt) - (12 * damping * w) / dt + w * w,
        w * w,
        10 * w * w,
        w * w,
    )


def apply_biquad(samples: list[float], coeffs: tuple[float, float, float, float, float]) -> list[float]:
    a1, a2, b0, b1, b2 = coeffs
    out = [0.0] * len(samples)
    x1 = x2 = y1 = y2 = 0.0
    for i, x0 in enumerate(samples):
        y0 = (-a1 * y1 - a2 * y2) + (b0 * x0 + b1 * x1 + b2 * x2)
        out[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def apply_filter_cascade(samples: list[float], filters: list[tuple[float, float, float, float, float]]) -> list[float]:
    out = samples[:]
    for filt in filters:
        out = apply_biquad(out, filt)
    return out


def raw_intensity_to_bin_index(value: float) -> int:
    clamped = max(BIN_MIN, min(BIN_MAX, value))
    return round((clamped - BIN_MIN) / BIN_STEP)


def bin_index_to_raw_intensity(index: int) -> float:
    max_index = round((BIN_MAX - BIN_MIN) / BIN_STEP)
    clamped = max(0, min(max_index, index))
    return BIN_MIN + clamped * BIN_STEP


def calc_realtime_intensity_samples(ns: list[float], ew: list[float], ud: list[float], hz: float) -> list[float]:
    dt = 1.0 / hz
    filters = [
        create_pair_filter(0.45, 7.0, dt),
        create_compensation_pair_filter(7.0, dt),
        create_correction_filter(0.5, 1.0, 0.75, dt),
        create_lowpass_filter(12.0, 0.9, dt),
        create_lowpass_filter(20.0, 0.6, dt),
        create_lowpass_filter(30.0, 0.6, dt),
    ]
    gain = 1.262
    f_ns = apply_filter_cascade(ns, filters)
    f_ew = apply_filter_cascade(ew, filters)
    f_ud = apply_filter_cascade(ud, filters)
    composite = [gain * math.sqrt(a * a + b * b + c * c) for a, b, c in zip(f_ns, f_ew, f_ud)]

    bin_count = round((BIN_MAX - BIN_MIN) / BIN_STEP) + 1
    fenwick = FenwickTree(bin_count + 2)
    window_size = max(1, round(60 * hz))
    required = max(1, math.floor(0.3 * hz))
    sample_bins = [0] * len(composite)
    result = [-3.0] * len(composite)

    for i, amp in enumerate(composite):
        raw = 2 * math.log10(amp) + 0.94 if amp > 0 else BIN_MIN
        bin_index = raw_intensity_to_bin_index(raw)
        sample_bins[i] = bin_index
        fenwick.add(bin_index + 1, 1)
        if i >= window_size:
            fenwick.add(sample_bins[i - window_size] + 1, -1)
        active = min(i + 1, window_size)
        rank_from_smallest = active - required + 1 if active >= required else 1
        threshold_bin = fenwick.find_by_prefix(rank_from_smallest) - 1
        result[i] = max(BIN_MIN, min(BIN_MAX, floor_to_first_decimal_by_jma_rule(bin_index_to_raw_intensity(threshold_bin))))
    return result


def parse_csv_timestamp_ms(raw: str) -> int:
    return int(datetime.datetime.fromisoformat(raw.replace("/", "-").replace(" ", "T")).timestamp() * 1000)


def parse_station_csv(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8", errors="ignore")
    lines = text.splitlines()
    data_start = -1
    component_mode = None
    for i, line in enumerate(lines):
        if line.startswith("#Time,RelativeTime(s),N-S(gal),E-W(gal),U-D(gal)"):
            data_start = i
            component_mode = "knet3"
            break
        if line.startswith("#Time,RelativeTime(s),1(gal),2(gal),3(gal),4(gal),5(gal),6(gal)"):
            data_start = i
            component_mode = "kik6"
            break
    if data_start < 0 or component_mode is None:
        return None

    hz = 100.0
    origin_time_ms: int | None = None
    for i, line in enumerate(lines):
        if line.startswith("#SamplingFrequency(Hz)") and i + 1 < len(lines):
            try:
                hz = float(lines[i + 1].replace("#", "").strip())
            except ValueError:
                pass
            break

    for i, line in enumerate(lines):
        if line.startswith("#OriginTime,Latitude,Longitude,Depth(km),Magnitude") and i + 1 < len(lines):
            origin_cols = [part.strip() for part in lines[i + 1].replace("#", "").split(",")]
            if origin_cols:
                try:
                    origin_time_ms = parse_csv_timestamp_ms(origin_cols[0])
                except Exception:
                    origin_time_ms = None
            break

    offsets = [0.0, 0.0, 0.0]
    for i, line in enumerate(lines):
        if not line.startswith("#Offset") or i + 2 >= len(lines):
            continue
        raw_values = [part.strip() for part in lines[i + 2].replace("#", "").split(",")]
        try:
            parsed = [float(value) for value in raw_values]
            if component_mode == "kik6" and len(parsed) >= 3:
                offsets = parsed[:3]
            elif component_mode == "knet3" and len(parsed) >= 3:
                offsets = parsed[:3]
        except ValueError:
            pass
        break

    ns: list[float] = []
    ew: list[float] = []
    ud: list[float] = []
    pga: list[float] = []
    start_time_ms: int | None = None

    for raw in lines[data_start + 1:]:
        row = raw.strip()
        if not row or row.startswith("#"):
            continue
        cols = row.split(",")
        if (component_mode == "knet3" and len(cols) < 5) or (component_mode == "kik6" and len(cols) < 8):
            continue
        try:
            timestamp_ms = parse_csv_timestamp_ms(cols[0])
            if component_mode == "kik6":
                n = float(cols[2]) - offsets[0]
                e = float(cols[3]) - offsets[1]
                u = float(cols[4]) - offsets[2]
            else:
                n = float(cols[2]) - offsets[0]
                e = float(cols[3]) - offsets[1]
                u = float(cols[4]) - offsets[2]
        except Exception:
            continue
        if start_time_ms is None:
            start_time_ms = timestamp_ms
        ns.append(n); ew.append(e); ud.append(u)
        pga.append(math.sqrt(n * n + e * e + u * u))

    if not pga or start_time_ms is None:
        return None

    intensity = calc_realtime_intensity_samples(ns, ew, ud, hz)
    interval_ms = 1000.0 / hz
    end_time_ms = start_time_ms + (len(pga) - 1) * interval_ms
    return {
        "pgaSamples": [round(v, 6) for v in pga],
        "intensitySamples": intensity,
        "originTimeMs": origin_time_ms,
        "startTimeMs": start_time_ms,
        "endTimeMs": round(end_time_ms, 3),
        "sampleIntervalMs": round(interval_ms, 6),
        "samplingFrequencyHz": hz,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate precomputed Kyoshin test series JSON from K-NET/KiK-net CSV files.")
    parser.add_argument("--input-root", type=Path, default=Path("data/kyoshin_data"))
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    replay_root = Path("data/replay")
    generated_codes: dict[tuple[str, str], set[str]] = {}

    for kind in ("knet", "kik"):
        csv_dir = args.input_root / kind / "csv"
        for csv_path in csv_dir.glob("*.csv"):
            match = re.match(r"^(?P<code>.+?)(?P<event_id>\d{10,14})$", csv_path.stem)
            if not match:
                print(f"skip (event id not found): {csv_path}")
                continue

            code = match.group("code")
            event_id = match.group("event_id")
            out_dir = replay_root / event_id / "kyoshin" / kind
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{code}.json"
            if out_path.exists() and not args.overwrite:
                generated_codes.setdefault((event_id, kind), set()).add(code)
                continue
            payload = parse_station_csv(csv_path)
            if payload is None:
                continue
            out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            generated_codes.setdefault((event_id, kind), set()).add(code)
            print(out_path)

    for (event_id, kind), codes in generated_codes.items():
        index_path = replay_root / event_id / "kyoshin" / kind / "index.json"
        index_path.write_text(
            json.dumps({"codes": sorted(codes)}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        print(index_path)


if __name__ == "__main__":
    main()
