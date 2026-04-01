#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BIN_MIN = -3.0;
const BIN_MAX = 7.0;
const BIN_STEP = 0.001;

class FenwickTree {
    constructor(size) {
        this.tree = new Array(size).fill(0);
    }

    add(index, delta) {
        let i = index;
        while (i < this.tree.length) {
            this.tree[i] += delta;
            i += i & -i;
        }
    }

    findByPrefix(target) {
        let index = 0;
        let bit = 1;
        while ((bit << 1) < this.tree.length) {
            bit <<= 1;
        }
        let remaining = target;
        while (bit) {
            const next = index + bit;
            if (next < this.tree.length && this.tree[next] < remaining) {
                index = next;
                remaining -= this.tree[next];
            }
            bit >>= 1;
        }
        return index + 1;
    }
}

function floorToFirstDecimalByJmaRule(value) {
    if (!Number.isFinite(value)) {
        return -3.0;
    }
    const roundedTo2 = Math.round(value * 100) / 100;
    return Math.floor(roundedTo2 * 10) / 10;
}

function normalizeCoeffs(alpha0, alpha1, alpha2, beta0, beta1, beta2) {
    return [alpha1 / alpha0, alpha2 / alpha0, beta0 / alpha0, beta1 / alpha0, beta2 / alpha0];
}

function createPairFilter(f0, f1, dt) {
    const w0 = 2 * Math.PI * f0;
    const w1 = 2 * Math.PI * f1;
    return normalizeCoeffs(
        8 / (dt * dt) + (4 * w0 + 2 * w1) / dt + w0 * w1,
        2 * w0 * w1 - 16 / (dt * dt),
        8 / (dt * dt) - (4 * w0 + 2 * w1) / dt + w0 * w1,
        4 / (dt * dt) + (2 * w1) / dt,
        -8 / (dt * dt),
        4 / (dt * dt) - (2 * w1) / dt
    );
}

function createCompensationPairFilter(f1, dt) {
    const w1 = 2 * Math.PI * f1;
    return normalizeCoeffs(
        16 / (dt * dt) + (17 * w1) / dt + w1 * w1,
        2 * w1 * w1 - 32 / (dt * dt),
        16 / (dt * dt) - (17 * w1) / dt + w1 * w1,
        4 / (dt * dt) + (8.5 * w1) / dt + w1 * w1,
        2 * w1 * w1 - 8 / (dt * dt),
        4 / (dt * dt) - (8.5 * w1) / dt + w1 * w1
    );
}

function createCorrectionFilter(f2, h2a, h2b, dt) {
    const w2 = 2 * Math.PI * f2;
    return normalizeCoeffs(
        12 / (dt * dt) + (12 * h2b * w2) / dt + w2 * w2,
        10 * w2 * w2 - 24 / (dt * dt),
        12 / (dt * dt) - (12 * h2b * w2) / dt + w2 * w2,
        12 / (dt * dt) + (12 * h2a * w2) / dt + w2 * w2,
        10 * w2 * w2 - 24 / (dt * dt),
        12 / (dt * dt) - (12 * h2a * w2) / dt + w2 * w2
    );
}

function createLowpassFilter(freq, damping, dt) {
    const w = 2 * Math.PI * freq;
    return normalizeCoeffs(
        12 / (dt * dt) + (12 * damping * w) / dt + w * w,
        10 * w * w - 24 / (dt * dt),
        12 / (dt * dt) - (12 * damping * w) / dt + w * w,
        w * w,
        10 * w * w,
        w * w
    );
}

function applyBiquad(samples, coeffs) {
    const [a1, a2, b0, b1, b2] = coeffs;
    const out = new Array(samples.length).fill(0);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i += 1) {
        const x0 = samples[i];
        const y0 = (-a1 * y1 - a2 * y2) + (b0 * x0 + b1 * x1 + b2 * x2);
        out[i] = y0;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
    }
    return out;
}

function applyFilterCascade(samples, filters) {
    let out = samples.slice();
    for (const filter of filters) {
        out = applyBiquad(out, filter);
    }
    return out;
}

function rawIntensityToBinIndex(value) {
    const clamped = Math.max(BIN_MIN, Math.min(BIN_MAX, value));
    return Math.round((clamped - BIN_MIN) / BIN_STEP);
}

function binIndexToRawIntensity(index) {
    const maxIndex = Math.round((BIN_MAX - BIN_MIN) / BIN_STEP);
    const clamped = Math.max(0, Math.min(maxIndex, index));
    return BIN_MIN + clamped * BIN_STEP;
}

function calcRealtimeIntensitySamples(ns, ew, ud, hz) {
    const dt = 1.0 / hz;
    const filters = [
        createPairFilter(0.45, 7.0, dt),
        createCompensationPairFilter(7.0, dt),
        createCorrectionFilter(0.5, 1.0, 0.75, dt),
        createLowpassFilter(12.0, 0.9, dt),
        createLowpassFilter(20.0, 0.6, dt),
        createLowpassFilter(30.0, 0.6, dt),
    ];
    const gain = 1.262;
    const fNs = applyFilterCascade(ns, filters);
    const fEw = applyFilterCascade(ew, filters);
    const fUd = applyFilterCascade(ud, filters);
    const composite = fNs.map((a, i) => gain * Math.sqrt(a * a + fEw[i] * fEw[i] + fUd[i] * fUd[i]));

    const binCount = Math.round((BIN_MAX - BIN_MIN) / BIN_STEP) + 1;
    const fenwick = new FenwickTree(binCount + 2);
    const windowSize = Math.max(1, Math.round(60 * hz));
    const required = Math.max(1, Math.floor(0.3 * hz));
    const sampleBins = new Array(composite.length).fill(0);
    const result = new Array(composite.length).fill(-3.0);

    for (let i = 0; i < composite.length; i += 1) {
        const amp = composite[i];
        const raw = amp > 0 ? (2 * Math.log10(amp) + 0.94) : BIN_MIN;
        const binIndex = rawIntensityToBinIndex(raw);
        sampleBins[i] = binIndex;
        fenwick.add(binIndex + 1, 1);
        if (i >= windowSize) {
            fenwick.add(sampleBins[i - windowSize] + 1, -1);
        }
        const active = Math.min(i + 1, windowSize);
        const rankFromSmallest = active >= required ? (active - required + 1) : 1;
        const thresholdBin = fenwick.findByPrefix(rankFromSmallest) - 1;
        result[i] = Math.max(BIN_MIN, Math.min(BIN_MAX, floorToFirstDecimalByJmaRule(binIndexToRawIntensity(thresholdBin))));
    }

    return result;
}

function parseCsvTimestampMs(raw) {
    const normalized = raw.replace(/\//g, '-').replace(' ', 'T');
    return new Date(normalized).getTime();
}

function parseStationCsv(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    let dataStart = -1;
    let componentMode = null;
    let stationCode = null;

    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].startsWith('#Time,RelativeTime(s),N-S(gal),E-W(gal),U-D(gal)')) {
            dataStart = i;
            componentMode = 'knet3';
            break;
        }
        if (lines[i].startsWith('#Time,RelativeTime(s),1(gal),2(gal),3(gal),4(gal),5(gal),6(gal)')) {
            dataStart = i;
            componentMode = 'kik6';
            break;
        }
    }
    if (dataStart < 0 || !componentMode) {
        return null;
    }

    let hz = 100.0;
    let originTimeMs = null;

    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].startsWith('#SamplingFrequency(Hz)') && i + 1 < lines.length) {
            const parsed = Number(lines[i + 1].replace('#', '').trim());
            if (Number.isFinite(parsed)) hz = parsed;
            break;
        }
    }

    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].startsWith('#OriginTime,Latitude,Longitude,Depth(km),Magnitude') && i + 1 < lines.length) {
            const originCols = lines[i + 1].replace('#', '').split(',').map((value) => value.trim());
            if (originCols[0]) {
                const parsed = parseCsvTimestampMs(originCols[0]);
                originTimeMs = Number.isFinite(parsed) ? parsed : null;
            }
            break;
        }
    }

    for (let i = 0; i < lines.length; i += 1) {
        if ((lines[i].startsWith('#Code,Latitude,Longitude,Height(m)') || lines[i].startsWith('#Code,Latitude,Longitude,Height1(m),Height2(m)')) && i + 1 < lines.length) {
            const stationCols = lines[i + 1].replace('#', '').split(',').map((value) => value.trim());
            stationCode = stationCols[0] || null;
            break;
        }
    }

    let offsets = [0.0, 0.0, 0.0];
    for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].startsWith('#Offset') || i + 2 >= lines.length) continue;
        const values = lines[i + 2].replace('#', '').split(',').map((value) => Number(value.trim()));
        if (values.length >= 3 && values.every((value) => Number.isFinite(value))) {
            offsets = values.slice(0, 3);
        }
        break;
    }

    const ns = [];
    const ew = [];
    const ud = [];
    const pga = [];
    let startTimeMs = null;

    for (const rawLine of lines.slice(dataStart + 1)) {
        const row = rawLine.trim();
        if (!row || row.startsWith('#')) continue;
        const cols = row.split(',');
        if ((componentMode === 'knet3' && cols.length < 5) || (componentMode === 'kik6' && cols.length < 8)) {
            continue;
        }

        const timestampMs = parseCsvTimestampMs(cols[0]);
        if (!Number.isFinite(timestampMs)) continue;

        let n, e, u;
        if (componentMode === 'kik6') {
            n = Number(cols[2]) - offsets[0];
            e = Number(cols[3]) - offsets[1];
            u = Number(cols[4]) - offsets[2];
        } else {
            n = Number(cols[2]) - offsets[0];
            e = Number(cols[3]) - offsets[1];
            u = Number(cols[4]) - offsets[2];
        }
        if (![n, e, u].every(Number.isFinite)) continue;

        if (startTimeMs === null) {
            startTimeMs = timestampMs;
        }
        ns.push(n);
        ew.push(e);
        ud.push(u);
        pga.push(Math.sqrt(n * n + e * e + u * u));
    }

    if (!pga.length || startTimeMs === null) {
        return null;
    }

    const intensity = calcRealtimeIntensitySamples(ns, ew, ud, hz);
    const intervalMs = 1000.0 / hz;
    const endTimeMs = startTimeMs + (pga.length - 1) * intervalMs;

    return {
        stationCode,
        pgaSamples: pga.map((value) => Number(value.toFixed(6))),
        intensitySamples: intensity,
        originTimeMs,
        startTimeMs,
        endTimeMs: Number(endTimeMs.toFixed(3)),
        sampleIntervalMs: Number(intervalMs.toFixed(6)),
        samplingFrequencyHz: hz,
    };
}

function ensureDir(targetPath) {
    fs.mkdirSync(targetPath, { recursive: true });
}

function writeJson(filePath, payload) {
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
}

function generateForKind(eventDir, kind, eventId) {
    const targetDir = path.join(eventDir, 'kyoshin', kind);
    const csvDir = path.join(targetDir, 'csv');
    const existingJsonFiles = fs.existsSync(targetDir)
        ? fs.readdirSync(targetDir).filter((name) => name.toLowerCase().endsWith('.json') && name !== 'index.json')
        : [];
    for (const fileName of existingJsonFiles) {
        fs.unlinkSync(path.join(targetDir, fileName));
    }
    if (!fs.existsSync(csvDir)) {
        writeJson(path.join(targetDir, 'index.json'), { codes: [] });
        return [];
    }

    const codes = [];
    const csvFiles = fs.readdirSync(csvDir).filter((name) => name.toLowerCase().endsWith('.csv'));

    for (const fileName of csvFiles) {
        const payload = parseStationCsv(path.join(csvDir, fileName));
        if (!payload) continue;
        const code = String(payload.stationCode || '').trim();
        if (!code) continue;

        writeJson(path.join(targetDir, `${code}.json`), payload);
        codes.push(code);
    }

    const uniqueCodes = [...new Set(codes)].sort();
    writeJson(path.join(targetDir, 'index.json'), { codes: uniqueCodes });
    return uniqueCodes;
}

function main() {
    const eventId = (process.argv[2] || '').trim();
    if (!/^\d{10,14}$/.test(eventId)) {
        console.error('Usage: node scripts/generate_replay_kyoshin_precomputed.js <eventId>');
        process.exit(1);
    }

    const eventDir = path.resolve(process.cwd(), 'data', 'replay', eventId);
    if (!fs.existsSync(eventDir)) {
        console.error(`Replay event directory not found: ${eventDir}`);
        process.exit(1);
    }

    ensureDir(path.join(eventDir, 'kyoshin', 'knet'));
    ensureDir(path.join(eventDir, 'kyoshin', 'kik'));

    const knetCodes = generateForKind(eventDir, 'knet', eventId);
    const kikCodes = generateForKind(eventDir, 'kik', eventId);

    console.log(`event=${eventId}`);
    console.log(`knet=${knetCodes.length}`);
    console.log(`kik=${kikCodes.length}`);
}

main();
