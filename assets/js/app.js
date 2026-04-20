//=====
// 設定
const urlParams = new URLSearchParams(window.location.search);
const DEFAULT_TEST_EVENT_ID = '202512082315';
const TEST_EVENT_ID_PATTERN = /^\d{10,14}$/;
const TEST_REPLAY_LEAD_MS = 5000;
const REPLAY_RECENT_STORAGE_KEY = 'eqfast.replayRecentEventIds';

function getTestEventId() {
    const requested = (urlParams.get('event') || '').trim();
    return TEST_EVENT_ID_PATTERN.test(requested) ? requested : DEFAULT_TEST_EVENT_ID;
}

function buildPageUrl(paramsUpdater) {
    const nextParams = new URLSearchParams(window.location.search);
    paramsUpdater(nextParams);
    const query = nextParams.toString();
    return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

function getReplayBasePath(eventId = getTestEventId()) {
    return `./data/replay/${eventId}`;
}

const testJsonPathCache = new Map();

async function resolveJsonCandidatePath(cacheKey, paths) {
    if (testJsonPathCache.has(cacheKey)) {
        return testJsonPathCache.get(cacheKey);
    }

    const pending = (async () => {
        for (const path of paths) {
            try {
                const response = await fetch(path);
                if (!response.ok) continue;
                return path;
            } catch {
                // Try next candidate path.
            }
        }

        throw new Error(`No JSON found for candidates: ${paths.join(', ')}`);
    })();

    testJsonPathCache.set(cacheKey, pending);
    try {
        return await pending;
    } catch (error) {
        testJsonPathCache.delete(cacheKey);
        throw error;
    }
}

async function fetchJsonFromCandidates(cacheKey, paths) {
    const path = await resolveJsonCandidatePath(cacheKey, paths);

    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return {
            path,
            json: await response.json(),
        };
    } catch (error) {
        testJsonPathCache.delete(cacheKey);
        throw error;
    }
}

async function fetchTestDataJson(baseName) {
    const cacheKey = `${baseName}:${getTestEventId()}`;
    return fetchJsonFromCandidates(cacheKey, [`${getReplayBasePath()}/${baseName}.json`]);
}

const API_CONFIG = {
    p2pquakeUrl: "https://eqf-worker.spdev-3141.workers.dev/api/p2pquake?codes=551&limit=20",
    kmoniProxyBaseUrl: "https://eqf-kyoshin.spdev-3141.workers.dev/",
    kmoniHost: "www.kmoni.bosai.go.jp",
};

function buildWorkerProxyUrl(targetUrl) {
    return `${API_CONFIG.kmoniProxyBaseUrl}?url=${encodeURIComponent(targetUrl)}`;
}

function buildKmoniUrl(path) {
    return `http://${API_CONFIG.kmoniHost}${path}`;
}

async function fetchViaWorkerProxy(targetUrl, init) {
    const response = await fetch(buildWorkerProxyUrl(targetUrl), init);
    if (!response.ok) {
        throw new Error(`Worker proxy request failed: ${response.status}`);
    }
    return response;
}

const CONFIG = {
    isTest: urlParams.has("test"),
    testEventId: getTestEventId(),

    get apiurl() {
        return this.isTest
        ? `${getReplayBasePath(this.testEventId)}/earthquakes.json`
        : API_CONFIG.p2pquakeUrl
    },

    get updateInterval() {
        return this.isTest ? 10000 : 2000;
    },

    testBaseTime: new Date("2024-01-01T16:10:14"),
    _testStartedAt: Date.now(),
    testReplayStartMs: null,

    getSimulatedTime() {
        if (!this.isTest) {
            return new Date(Date.now() - 2000);
        }
        const elapsed = Date.now() - this._testStartedAt;
        return new Date(this.testBaseTime.getTime() + elapsed);
    },
};
//=====

const toggleBtn = document.createElement('a');
toggleBtn.className = 'feedback-button';
toggleBtn.target = '_self';

if (CONFIG.isTest) {
    toggleBtn.href = window.location.pathname;
    toggleBtn.textContent = 'テストモードを終了';
} else {
    toggleBtn.href = buildPageUrl((params) => {
        params.set('test', '');
    });
    toggleBtn.textContent = 'テストモード';
}

const sidePanelElement = document.querySelector('.side-panel');

function appendAboveFeedbackButtons(parentElement, element) {
    const firstFeedbackButton = parentElement.querySelector('.feedback-button');
    if (firstFeedbackButton) {
        parentElement.insertBefore(element, firstFeedbackButton);
        return;
    }
    parentElement.appendChild(element);
}

function loadRecentReplayEventIds() {
    try {
        const raw = window.localStorage.getItem(REPLAY_RECENT_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((id) => String(id || '').trim())
            .filter((id) => TEST_EVENT_ID_PATTERN.test(id));
    } catch {
        return [];
    }
}

function saveRecentReplayEventId(eventId) {
    if (!TEST_EVENT_ID_PATTERN.test(eventId)) return;
    const current = loadRecentReplayEventIds().filter((id) => id !== eventId);
    const next = [eventId, ...current].slice(0, 12);
    try {
        window.localStorage.setItem(REPLAY_RECENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Ignore storage failures.
    }
}

function navigateToReplayEvent(eventId) {
    saveRecentReplayEventId(eventId);
    window.location.href = buildPageUrl((params) => {
        params.set('test', '');
        params.set('event', eventId);
    });
}

function buildReplayEventCandidates() {
    const source = [CONFIG.testEventId, DEFAULT_TEST_EVENT_ID, ...loadRecentReplayEventIds()]
        .map((id) => String(id || '').trim())
        .filter((id) => TEST_EVENT_ID_PATTERN.test(id));
    return Array.from(new Set(source));
}

function appendReplaySelector(parentElement) {
    const wrap = document.createElement('div');
    wrap.className = 'replay-selector';

    const title = document.createElement('p');
    title.className = 'replay-selector-title';
    title.textContent = '地震リプレイ';

    const hint = document.createElement('p');
    hint.className = 'replay-selector-hint';
    hint.textContent = '候補を選ぶか、イベントIDを入力して再生できます。';

    const select = document.createElement('select');
    select.className = 'replay-selector-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '候補から選択';
    select.appendChild(placeholder);

    buildReplayEventCandidates().forEach((eventId) => {
        const option = document.createElement('option');
        option.value = eventId;
        option.textContent = eventId;
        if (eventId === CONFIG.testEventId) {
            option.textContent = `${eventId} (現在)`;
        }
        select.appendChild(option);
    });

    const input = document.createElement('input');
    input.className = 'replay-selector-input';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 14;
    input.placeholder = 'イベントID (10〜14桁)';
    input.value = CONFIG.testEventId;

    const error = document.createElement('p');
    error.className = 'replay-selector-error';
    error.hidden = true;

    const button = document.createElement('button');
    button.className = 'replay-selector-button';
    button.type = 'button';
    button.textContent = 'このイベントを再生';

    const submit = () => {
        const nextEventId = String(input.value || '').trim();
        if (!TEST_EVENT_ID_PATTERN.test(nextEventId)) {
            error.hidden = false;
            error.textContent = 'イベントIDは10桁から14桁の数字で入力してください。';
            return;
        }

        error.hidden = true;
        navigateToReplayEvent(nextEventId);
    };

    select.addEventListener('change', () => {
        if (!select.value) return;
        input.value = select.value;
        error.hidden = true;
    });

    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
    });

    button.addEventListener('click', submit);

    wrap.appendChild(title);
    wrap.appendChild(hint);
    wrap.appendChild(select);
    wrap.appendChild(input);
    wrap.appendChild(error);
    wrap.appendChild(button);
    parentElement.appendChild(wrap);
}

if (sidePanelElement) {
    appendAboveFeedbackButtons(sidePanelElement, toggleBtn);

    if (CONFIG.isTest) {
        const firstFeedbackButton = sidePanelElement.querySelector('.feedback-button');
        if (firstFeedbackButton) {
            const wrap = document.createElement('div');
            appendReplaySelector(wrap);
            sidePanelElement.insertBefore(wrap.firstChild, firstFeedbackButton);
        } else {
            appendReplaySelector(sidePanelElement);
        }
    }
}

function formatLastUpdateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '--/-- --:--:--';
    }

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function setLastDataUpdateTime(date) {
    const label = document.getElementById('last-update-time');
    if (!label) return;

    const parsed = date instanceof Date ? date : new Date(date);
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return;

    if (Number.isFinite(setLastDataUpdateTime.lastDisplayedMs)
        && parsed.getTime() < setLastDataUpdateTime.lastDisplayedMs) {
        return;
    }

    setLastDataUpdateTime.lastDisplayedMs = parsed.getTime();
    label.textContent = formatLastUpdateTime(parsed);
}

setLastDataUpdateTime.lastDisplayedMs = Number.NEGATIVE_INFINITY;

var map = L.map('map', {
    scrollWheelZoom: false,
    smoothWheelZoom: true,
    smoothSensitivity: 1.5,
}).setView([36.575, 137.984], 6);

L.control.scale({ maxWidth: 150, position: 'bottomright', imperial: false }).addTo(map);
map.zoomControl.setPosition('bottomleft');

const resetViewControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
        const btn = L.DomUtil.create('a', 'leaflet-control-zoom-reset');
        btn.innerHTML = '';
        btn.title = '初期位置に戻る';
        btn.href = '#';

        L.DomEvent.on(btn, 'click', (e) => {
            L.DomEvent.preventDefault(e);
            if (currentDisplayedEarthquake) {
                moveCameraToEarthquake(currentDisplayedEarthquake);
                return;
            }
            map.setView([36.575, 137.984], 6);
        });

        return btn;
    }
});

map.attributionControl.addAttribution(
    "<a href='https://www.jma.go.jp/jma/index.html' target='_blank'>気象庁</a>"
);
map.attributionControl.addAttribution(
    "<a href='https://github.com/mutsuyuki/Leaflet.SmoothWheelZoom' target='_blank'>SmoothWheelZoom</a>"
);

map.addControl(new resetViewControl());

map.createPane("pane_map1").style.zIndex = 1;
map.createPane("pane_map2").style.zIndex = 2;
map.createPane("pane_map3").style.zIndex = 3;
map.createPane("pane_map_filled").style.zIndex = 5;
map.createPane("shindo10").style.zIndex = 10;
map.createPane("shindo20").style.zIndex = 20;
map.createPane("shindo30").style.zIndex = 30;
map.createPane("shindo40").style.zIndex = 40;
map.createPane("shindo45").style.zIndex = 45;
map.createPane("shindo46").style.zIndex = 46;
map.createPane("shindo50").style.zIndex = 50;
map.createPane("shindo55").style.zIndex = 55;
map.createPane("shindo60").style.zIndex = 60;
map.createPane("shindo70").style.zIndex = 70;
map.createPane("shindo_canvas").style.zIndex = 200;
map.createPane("kyoshin_canvas").style.zIndex = 210;
map.createPane("wavefront").style.zIndex = 350;
map.createPane("shingen").style.zIndex = 400;
map.createPane("tsunami_map").style.zIndex = 110;

let shindoLayer = L.layerGroup().addTo(map);
let shindoFilledLayer = L.layerGroup().addTo(map);
let JMAPointsJson = null;
let shindoCanvasLayer = null;
let kyoshinCanvasLayer = null;
let hypoMarker = null;
let stationMap = {};
let japan_data = null;
let filled_list = {};
const areaCodeToIndexMap = new Map();
const areaNameToCodeMap = new Map();
const areaBoundsCache = new Map();
const shindoFillState = {
    layerByAreaCode: new Map(),
    activeAreaCodes: new Set(),
    colorByAreaCode: Object.create(null),
};
let shindoFillPrewarmStarted = false;
let shindoFillPrewarmCompleted = false;
let currentDisplayedEarthquake = null;
let selectedEarthquakeKey = null;
let lastRenderedEarthquakeKey = null;
let latestDetailScaleEarthquakes = [];
let latestDetailScaleEarthquake = null;
let kyoshinMode = 'shindo'; // 'shindo' or 'pga'
const KYOSHIN_VIEW_CONFIG = {
    showCandidates: false,
};
let jma2001TravelTable = null;
let waveCurrentEq = null;
let wavePFrontLayer = null;
let waveSFrontLayer = null;
let waveTimerId = null;
let testModeEewEq = null;
let testModeEewRaw = null;
let testModeEewTimeline = [];
let testModeEewTimelineIndex = -1;
let liveEewEq = null;
let liveEewRaw = null;
let eewWs = null;
let eewReconnectTimer = null;
let testEewAnnounceTimerId = null;
let latestUpdateRequestId = 0;
let latestAppliedUpdateRequestId = 0;
let lastPlayedEewFirstReportKey = null;
let preferLatestEqDuringEew = false;
let lastSeenActiveEewUpdateKey = '';
let lastSeenLatestDetailScaleKey = '';
const eewWarnAreaSignatureByEvent = new Map();
const USAGE_NOTICE_DISMISSED_KEY = 'eqfast.hideUsageNotice';
const kyoshinAutoViewState = {
    lastDetectedSignature: '',
    lastMovedAt: 0,
    lastTargetCenter: null,
    lastTargetSpanKm: null,
};
const KYOSHIN_AUTO_VIEW_CONFIG = {
    minIntervalMs: 2200,
    minCenterMoveKm: 18,
    minZoomDelta: 0.65,
    minSpanChangeRatio: 0.28,
};
const WAVE_SVG_NS = 'http://www.w3.org/2000/svg';
const WAVE_S_GRADIENT_ID = 'wavefront-s-radial-gradient';

const WAVE_FRONT_CONFIG = {
    enabled: true,
    updateIntervalMs: 10,
    pColor: '#ffffff',
    sColor: '#ec211a',
    pOpacity: 0.85,
    sOpacity: 0.9,
    sFillOpacity: 0.25,
    fallbackPVelocityKmS: 6.0,
    fallbackSVelocityKmS: 3.5,
    postMaxPVelocityKmS: 7.0,
    postMaxSVelocityKmS: 4.0,
    defaultDepthKm: 10,
    tablePath: 'data/json/jma2001_travel_time.json',
};

const EEW_WS_CONFIG = {
    url: 'wss://ws-api.wolfx.jp/jma_eew',
    reconnectMs: 5000,
};

const EEW_HTTP_CONFIG = {
    snapshotUrl: 'https://api.wolfx.jp/jma_eew.json',
    // Worker allowlist is currently K-MONI only, so EEW snapshot stays direct.
    snapshotProxyPrefix: null,
    finalHideAfterMs: 5 * 60 * 1000,
};

const TEST_EEW_ANNOUNCE_POLL_MS = 250;

const EEW_SOURCE = {
    LIVE: 'live',
    TEST: 'test',
};

const shindoCanvasPane = map.createPane("shindo_canvas");
shindoCanvasPane.style.zIndex = 200;
shindoCanvasPane.style.overflow = 'visible';

const kyoshinCanvasPane = map.createPane("kyoshin_canvas");
kyoshinCanvasPane.style.zIndex = 210;
kyoshinCanvasPane.style.overflow = 'visible';

const PolygonLayer_Style = {
    "color": "rgb(190, 190, 190)",
    "weight": 1.8,
    "opacity": 0.25,
    "fillColor": "#333333",
    "fillOpacity": 1
};

const WorldPolygonLayer_Style = {
    "color": "rgb(95, 106, 122)",
    "weight": 1,
    "opacity": 0.28,
    "fill": true,
    "fillColor": "#3d3d3d",
    "fillOpacity": 0.38,
};

function getWorldPolygonStyle() {
    return {
        ...WorldPolygonLayer_Style,
    };
}

function mercatorMetersToLatLng(pair) {
    const x = Number(pair?.[0]);
    const y = Number(pair?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return pair;

    const lng = (x / 20037508.34) * 180;
    const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI) - 90;
    return [lng, lat];
}

function convertWorldMapCoordinatesToWgs84(coords) {
    if (!Array.isArray(coords)) return coords;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        return mercatorMetersToLatLng(coords);
    }
    return coords.map(convertWorldMapCoordinatesToWgs84);
}

function isJapanWorldFeature(feature) {
    const props = feature?.properties || {};
    const codeKeys = ['ISO_A3', 'ADM0_A3', 'BRK_A3', 'SOV_A3', 'GU_A3', 'SU_A3'];
    for (const key of codeKeys) {
        if (String(props[key] || '').toUpperCase() === 'JPN') return true;
    }

    const nameKeys = ['NAME', 'NAME_LONG', 'NAME_EN', 'ADMIN', 'SOVEREIGNT', 'GEOUNIT', 'SUBUNIT'];
    for (const key of nameKeys) {
        if (String(props[key] || '').toLowerCase() === 'japan') return true;
    }

    return false;
}

function convertWorldMapGeoJsonToWgs84(source) {
    if (!source || !Array.isArray(source.features)) return source;

    return {
        ...source,
        features: source.features.map((feature) => {
            if (!feature?.geometry) return feature;
            return {
                ...feature,
                geometry: {
                    ...feature.geometry,
                    coordinates: convertWorldMapCoordinatesToWgs84(feature.geometry.coordinates),
                },
            };
        }),
    };
}

const worldMapDataReady = new Promise((resolve) => {
    $.getJSON('data/geo/worldmap.json')
        .done((rawData) => {
            const worldData = convertWorldMapGeoJsonToWgs84(rawData);
            L.geoJson(worldData, {
                pane: 'pane_map1',
                style: () => getWorldPolygonStyle(),
                interactive: false,
                filter: (feature) => !isJapanWorldFeature(feature),
            }).addTo(map);
            resolve(worldData);
        })
        .fail((_, textStatus, errorThrown) => {
            console.error('Failed to load data/geo/worldmap.json:', textStatus, errorThrown);
            resolve(null);
        });
});

const shindoFillColorMap = {
    10: "#007a9c",   // 1
    20: "#008369",   // 2
    30: "#b98a08",   // 3
    40: "#c27b2b",   // 4
    45: "#b11515",   // 5弱
    46: "#db4921",   // 5弱以上
    50: "#920b0b",   // 5強
    55: "#920b4a",   // 6弱
    60: "#80142f",   // 6強
    70: "#4a0083",   // 7
};

const japanDataReady = new Promise((resolve, reject) => {
    $.getJSON("data/geo/saibun.geojson")
        .done((data) => {
            japan_data = data;
            L.geoJson(data, {
                pane: "pane_map3",
                style: PolygonLayer_Style
            }).addTo(map);
            scheduleShindoFillPrewarm();
            resolve(data);
        })
        .fail((_, textStatus, errorThrown) => {
            console.error("Failed to load data/geo/saibun.geojson:", textStatus, errorThrown);
            reject(errorThrown || new Error(textStatus));
        });
});

const scaleMap = {
    "70": "7",
    "60": "6強",
    "55": "6弱",
    "50": "5強",
    "45": "5弱",
    "40": "4",
    "30": "3",
    "20": "2",
    "10": "1",
    "-1": "不明"
};

const scaleClassMap = {
    "7": "seven-bg",
    "6強": "six-plus-bg",
    "6弱": "six-minus-bg",
    "5強": "five-plus-bg",
    "5弱": "five-minus-bg",
    "4": "four-bg",
    "3": "three-bg",
    "2": "two-bg",
    "1": "one-bg",
    "不明": "null-bg"
};

const iconCache = {};

const iconNames = ["int1","int2","int3","int4","int50","int55","int60","int65","int7","intnull"];

function preloadIcons() {
    return Promise.all(iconNames.map(name => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = `./assets/images/point_icons/_${name}.png`;
            img.onload = () => {
                iconCache[name] = img;
                resolve();
            };
        });
    }));
}

function loadStationData() {
    return new Promise((resolve, reject) => {
        $.getJSON("data/json/JMAstations.json")
            .done((data) => {
                JMAPointsJson = data;
                stationMap = {};
                data.forEach((p) => { stationMap[p.name] = p; });
                resolve(data);
            })
            .fail((_, textStatus, errorThrown) => {
                console.error("Failed to load data/json/JMAstations.json:", textStatus, errorThrown);
                reject(errorThrown || new Error(textStatus));
            });
    });
}

const ShindoCanvasLayer = L.Layer.extend({

    initialize: function () {
        this._points = [];
        this._rafId = null;
    },

    onAdd: function (map) {
        this._map = map;

        this._canvas = L.DomUtil.create('canvas', 'shindo-canvas-layer');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';
        this._ctx = this._canvas.getContext('2d');

        map.getPane('shindo_canvas').appendChild(this._canvas);

        map.on('move zoom viewreset zoomend moveend', this._scheduleRedraw, this);
        map.on('resize', this._resize, this);

        this._resize();
        return this;
    },

    onRemove: function (map) {
        if (this._rafId != null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._canvas.remove();
        map.off('move zoom viewreset zoomend moveend', this._scheduleRedraw, this);
        map.off('resize', this._resize, this);
    },

    setPoints: function (points) {
        this._points = points;
        this._scheduleRedraw();
    },

    _scheduleRedraw: function () {
        if (this._rafId != null) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._redraw();
        });
    },

    _updateCanvasPosition: function () {
        const mapPane = this._map.getPane('mapPane');
        const offset = L.DomUtil.getPosition(mapPane);
        L.DomUtil.setPosition(this._canvas, L.point(-offset.x, -offset.y));
    },

    _resize: function () {
        const size = this._map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        this._updateCanvasPosition();
        this._scheduleRedraw();
    },

    _redraw: function () {
        if (!this._map) return;

        this._updateCanvasPosition();

        const ctx = this._ctx;
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

        const iconSize = 20;
        const half = iconSize / 2;

        this._points.forEach(({ latlng, iconName }) => {
            const img = iconCache[iconName];
            if (!img) return;

            const pt = this._map.latLngToContainerPoint(latlng);
            ctx.drawImage(img, pt.x - half, pt.y - half, iconSize, iconSize);
        });
    }
});

const KyoshinCanvasLayer = L.Layer.extend({

    initialize: function () {
        this._items = [];
        this._rafId = null;
    },

    onAdd: function (map) {
        this._map = map;

        this._canvas = L.DomUtil.create('canvas', 'kyoshin-canvas-layer');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';
        this._ctx = this._canvas.getContext('2d');

        map.getPane('kyoshin_canvas').appendChild(this._canvas);

        map.on('move zoom viewreset zoomend moveend', this._scheduleRedraw, this);
        map.on('resize', this._resize, this);

        this._resize();
        return this;
    },

    onRemove: function (map) {
        if (this._rafId != null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._canvas.remove();
        map.off('move zoom viewreset zoomend moveend', this._scheduleRedraw, this);
        map.off('resize', this._resize, this);
    },

    setRenderItems: function (items) {
        this._items = Array.isArray(items) ? items : [];
        this._scheduleRedraw();
    },

    _scheduleRedraw: function () {
        if (this._rafId != null) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._redraw();
        });
    },

    _updateCanvasPosition: function () {
        const mapPane = this._map.getPane('mapPane');
        const offset = L.DomUtil.getPosition(mapPane);
        L.DomUtil.setPosition(this._canvas, L.point(-offset.x, -offset.y));
    },

    _resize: function () {
        const size = this._map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        this._updateCanvasPosition();
        this._scheduleRedraw();
    },

    _redraw: function () {
        if (!this._map) return;

        this._updateCanvasPosition();

        const ctx = this._ctx;
        const width = this._canvas.width;
        const height = this._canvas.height;
        ctx.clearRect(0, 0, width, height);

        this._items.forEach((item) => {
            const pt = this._map.latLngToContainerPoint([item.lat, item.lon]);
            const radius = Number(item.radius) || 0;
            const margin = Math.max(radius + 6, (Number(item.iconSize) || 0) / 2 + 4);

            if (pt.x < -margin || pt.y < -margin || pt.x > width + margin || pt.y > height + margin) {
                return;
            }

            if (item.useIcon) {
                const img = iconCache[item.iconName];
                const iconSize = Number(item.iconSize) || 18;
                const half = iconSize / 2;

                if (item.showDetectedVisuals) {
                    ctx.save();
                    ctx.globalAlpha = 0.95;
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, half + 2, 0, Math.PI * 2);
                    ctx.strokeStyle = '#f3e44c';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();
                }

                if (!img) return;
                ctx.save();
                ctx.globalAlpha = Math.max(0.2, Math.min(1, Number(item.fillOpacity) || 1));
                ctx.drawImage(img, pt.x - half, pt.y - half, iconSize, iconSize);
                ctx.restore();
                return;
            }

            ctx.save();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = item.color;
            ctx.globalAlpha = Math.max(0, Math.min(1, Number(item.fillOpacity) || 0));
            ctx.fill();

            const strokeWeight = Number(item.strokeWeight) || 0;
            if (strokeWeight > 0) {
                ctx.globalAlpha = 1;
                ctx.strokeStyle = item.strokeColor || item.color;
                ctx.lineWidth = strokeWeight;
                ctx.stroke();
            }
            ctx.restore();
        });
    },
});

const iconMap = {
    10: "int1",
    20: "int2",
    30: "int3",
    40: "int4",
    45: "int50",
    46: "int50",
    50: "int55",
    55: "int60",
    60: "int65",
    70: "int7"
};

Promise.all([preloadIcons(), worldMapDataReady, japanDataReady, loadStationData(), loadJma2001TravelTimeTable(), loadTestModeEewData()])
    .then(async ([, , , , travelTable, eewData]) => {
        jma2001TravelTable = travelTable;
        if (!CONFIG.isTest) {
            testModeEewEq = eewData?.eq || null;
            testModeEewRaw = eewData?.raw || null;
        }
        startTestEewWatcher();

        if (!CONFIG.isTest) {
            await loadInitialLiveEewSnapshot();
        }

        shindoCanvasLayer = new ShindoCanvasLayer();
        shindoCanvasLayer.addTo(map);
        kyoshinCanvasLayer = new KyoshinCanvasLayer();
        kyoshinCanvasLayer.addTo(map);

        initWaveFrontLayers();
        initLiveEewStream();

        updateData();
        setInterval(updateData, CONFIG.updateInterval);

    })
    .catch((error) => {
        console.error("Initial map data load failed:", error);
    });

const latestCard = document.querySelector('.latest-card');
if (latestCard) {
    latestCard.addEventListener('click', () => {
        selectedEarthquakeKey = null;
        preferLatestEqDuringEew = false;
        refreshDisplayedEarthquake({ autoMove: true });
    });
}

const eewCardElement = document.getElementById('eew-card');
if (eewCardElement) {
    eewCardElement.addEventListener('click', () => {
        const activeEewEq = getActiveEewEq();
        if (!activeEewEq) return;

        selectedEarthquakeKey = null;
        preferLatestEqDuringEew = false;
        refreshDisplayedEarthquake({ autoMove: true, forceEewFocus: true });
    });
}

function getSelectedEarthquakeFromLatestData() {
    if (!selectedEarthquakeKey) return null;
    return latestDetailScaleEarthquakes.find((eq) => getEarthquakeKey(eq) === selectedEarthquakeKey) || null;
}

function getDisplayEarthquakeState(options = {}) {
    const { forceEewFocus = false } = options;
    const activeEewEq = getActiveEewEq();
    const selectedEq = getSelectedEarthquakeFromLatestData();
    const latestEq = latestDetailScaleEarthquake;

    if (selectedEq) {
        return {
            eq: selectedEq,
            reason: 'selected-history',
            useEewVisual: false,
        };
    }

    if (selectedEarthquakeKey && !selectedEq) {
        selectedEarthquakeKey = null;
    }

    if (forceEewFocus && activeEewEq) {
        return {
            eq: activeEewEq,
            reason: 'active-eew',
            useEewVisual: true,
        };
    }

    if (activeEewEq && preferLatestEqDuringEew && latestEq) {
        return {
            eq: latestEq,
            reason: 'latest-during-eew',
            useEewVisual: false,
        };
    }

    if (activeEewEq) {
        return {
            eq: activeEewEq,
            reason: 'active-eew',
            useEewVisual: true,
        };
    }

    if (latestEq) {
        return {
            eq: latestEq,
            reason: 'latest',
            useEewVisual: false,
        };
    }

    const fallbackEq = getCurrentEewEq();
    return {
        eq: fallbackEq,
        reason: fallbackEq ? 'fallback-eew' : 'none',
        useEewVisual: Boolean(fallbackEq),
    };
}

function refreshDisplayedEarthquake(options = {}) {
    const { autoMove = false, forceEewFocus = false } = options;
    const displayState = getDisplayEarthquakeState({ forceEewFocus });
    const displayEq = displayState.eq;
    if (!displayEq) return null;

    const displayKey = getEarthquakeKey(displayEq);
    const shouldAutoMove = autoMove || displayKey !== lastRenderedEarthquakeKey;
    renderEarthquakeOnMap(displayEq, {
        autoMove: shouldAutoMove,
        useEewVisual: displayState.useEewVisual,
    });
    lastRenderedEarthquakeKey = displayKey;
    return displayState;
}

function updateData() {
    const requestId = ++latestUpdateRequestId;

    const dataRequest = CONFIG.isTest
        ? fetchTestDataJson('earthquakes').then(({ json }) => json)
        : $.getJSON(CONFIG.apiurl);

    Promise.resolve(dataRequest)
        .then((data) => {
            if (requestId < latestAppliedUpdateRequestId) return;
            latestAppliedUpdateRequestId = requestId;

            try {
                const detailScaleData = Array.isArray(data)
                    ? data.filter(eq => eq?.issue?.type === "DetailScale")
                    : [];
                const latest = detailScaleData[0];
                latestDetailScaleEarthquake = latest || null;
                const activeEewEq = getActiveEewEq();
                const activeEewRaw = getActiveEewRaw();

                if (!latest && !activeEewEq) return;

                const latestDetailScaleKey = getDetailScaleUpdateKey(latest);
                if (latestDetailScaleKey) {
                    if (lastSeenLatestDetailScaleKey && latestDetailScaleKey !== lastSeenLatestDetailScaleKey && activeEewEq) {
                        // EEW発表中に新しい地震情報が来たら通常表示へ切り替える。
                        preferLatestEqDuringEew = true;
                    }
                    lastSeenLatestDetailScaleKey = latestDetailScaleKey;
                }

                const activeEewUpdateKey = getEewUpdateKey(activeEewRaw);
                if (!activeEewUpdateKey) {
                    preferLatestEqDuringEew = false;
                    lastSeenActiveEewUpdateKey = '';
                } else if (activeEewUpdateKey !== lastSeenActiveEewUpdateKey) {
                    // EEW続報が来たらEEW表示へ戻す。
                    preferLatestEqDuringEew = false;
                    lastSeenActiveEewUpdateKey = activeEewUpdateKey;
                }

                const eqMap = new Map();
                detailScaleData.forEach(eq => {
                    const key = getEarthquakeKey(eq);
                    const existing = eqMap.get(key);
                    if (!existing || eq.created_at > existing.created_at) {
                        eqMap.set(key, eq);
                    }
                });

                const deduped = Array.from(eqMap.values())
                    .sort((a, b) => b.earthquake.time.localeCompare(a.earthquake.time));

                let displayEq = latest || activeEewEq || liveEewEq;
                if (selectedEarthquakeKey) {
                    const selectedEq = deduped.find(eq => getEarthquakeKey(eq) === selectedEarthquakeKey);
                    if (selectedEq) {
                        displayEq = selectedEq;
                    } else {
                        selectedEarthquakeKey = null;
                        displayEq = activeEewEq || liveEewEq || latest;
                    }
                } else if (activeEewEq && preferLatestEqDuringEew && latest) {
                    displayEq = latest;
                } else if (activeEewEq) {
                    displayEq = activeEewEq;
                } else if (!CONFIG.isTest && liveEewEq) {
                    displayEq = liveEewEq;
                }

                const displayKey = getEarthquakeKey(displayEq);
                const shouldAutoMove = displayKey !== lastRenderedEarthquakeKey;

                renderEarthquakeOnMap(displayEq, { autoMove: shouldAutoMove });
                lastRenderedEarthquakeKey = displayKey;

                const latestCardEq = latest || (!CONFIG.isTest ? displayEq : null);
                if (latestCardEq?.earthquake) {
                    const { time, hypocenter, maxScale, domesticTsunami } = latestCardEq.earthquake;
                    const { name: hyponame, magnitude, depth } = hypocenter;

                    const map_maxscale = scaleMap[String(maxScale)];

                    updateEarthquakeParam(time, map_maxscale, hyponame, magnitude, depth, domesticTsunami);

                    trySpeakEarthquake({
                        time,
                        scale: map_maxscale,
                        name: hyponame,
                        magnitude,
                        depth,
                        tsunami: domesticTsunami,
                        rawScale: maxScale,
                    });
                }

                updateEewCard(getActiveEewRaw());

                const latestKey = latest ? getEarthquakeKey(latest) : "";
                const historyData = latest
                    ? deduped.filter(eq => getEarthquakeKey(eq) !== latestKey)
                    : [];

                updateEqHistory(historyData);
            } catch (error) {
                console.error('[updateData] Failed to render earthquake data', error);
            }
        })
        .catch((error) => {
            console.warn('[updateData] Failed to fetch earthquake data', error);
        });
}

function loadTestModeEewData() {
    if (!CONFIG.isTest) return Promise.resolve(null);

    return fetchTestDataJson('eew')
        .then(({ json }) => {
            const rawItems = Array.isArray(json) ? json : [json];
            const timeline = rawItems
                .map((item) => normalizeTestEew(item))
                .filter((item) => item && typeof item === 'object')
                .map((raw) => ({
                    raw,
                    eq: testEewToDetail(raw),
                    announcedMs: getEewAnnouncedMillis(raw),
                }))
                .sort((a, b) => {
                    const aMs = Number.isFinite(a.announcedMs) ? a.announcedMs : Number.POSITIVE_INFINITY;
                    const bMs = Number.isFinite(b.announcedMs) ? b.announcedMs : Number.POSITIVE_INFINITY;
                    if (aMs !== bMs) return aMs - bMs;

                    const aSerial = Number(a.raw?.Serial);
                    const bSerial = Number(b.raw?.Serial);
                    if (Number.isFinite(aSerial) && Number.isFinite(bSerial) && aSerial !== bSerial) {
                        return aSerial - bSerial;
                    }

                    return 0;
                });

            testModeEewTimeline = timeline;
            setEewState(EEW_SOURCE.TEST, { raw: null, eq: null, timeline, index: -1 });
            eewWarnAreaSignatureByEvent.clear();

            const firstTimelineItem = timeline[0] || null;
            const firstRaw = firstTimelineItem?.raw || null;
            const firstEq = firstTimelineItem?.eq || null;

            const originTime = parseJmaDateTime(firstRaw?.OriginTime);
            const originMs = Date.parse(originTime || '');
            const announcedMs = firstTimelineItem?.announcedMs;
            const eqTimeMs = Date.parse(firstEq?.earthquake?.time || '');

            let replayStartMs = NaN;
            if (Number.isFinite(originMs)) {
                replayStartMs = originMs - TEST_REPLAY_LEAD_MS;
            } else if (Number.isFinite(announcedMs)) {
                replayStartMs = announcedMs;
            } else if (Number.isFinite(eqTimeMs)) {
                replayStartMs = eqTimeMs;
            }

            if (Number.isFinite(replayStartMs)) {
                CONFIG.testBaseTime = new Date(replayStartMs);
                CONFIG._testStartedAt = Date.now();
                CONFIG.testReplayStartMs = CONFIG.testBaseTime.getTime();
            }

            syncTestEewTimeline({ playSound: false });
            return { raw: firstRaw, eq: firstEq };
        })
        .catch((error) => {
            console.warn('[test] Failed to load test EEW JSON', error);
            return null;
        });
}

function initLiveEewStream() {
    if (CONFIG.isTest || eewWs) return;

    try {
        eewWs = new WebSocket(EEW_WS_CONFIG.url);
    } catch (error) {
        console.warn('[eew] WebSocket initialize failed', error);
        scheduleEewReconnect();
        return;
    }

    eewWs.addEventListener('open', () => {
        console.log('[eew] connected');
        if (eewReconnectTimer) {
            clearTimeout(eewReconnectTimer);
            eewReconnectTimer = null;
        }
    });

    eewWs.addEventListener('message', (event) => {
        handleLiveEewMessage(event.data);
    });

    eewWs.addEventListener('close', () => {
        console.warn('[eew] disconnected');
        eewWs = null;
        scheduleEewReconnect();
    });

    eewWs.addEventListener('error', (error) => {
        console.warn('[eew] WebSocket error', error);
    });
}

function scheduleEewReconnect() {
    if (CONFIG.isTest || eewReconnectTimer) return;

    eewReconnectTimer = setTimeout(() => {
        eewReconnectTimer = null;
        initLiveEewStream();
    }, EEW_WS_CONFIG.reconnectMs);
}

function getEewState(source = CONFIG.isTest ? EEW_SOURCE.TEST : EEW_SOURCE.LIVE) {
    if (source === EEW_SOURCE.TEST) {
        return {
            raw: testModeEewRaw,
            eq: testModeEewEq,
            timeline: testModeEewTimeline,
            index: testModeEewTimelineIndex,
        };
    }

    return {
        raw: liveEewRaw,
        eq: liveEewEq,
        timeline: null,
        index: -1,
    };
}

function setEewState(source, { raw = null, eq = null, timeline = undefined, index = undefined } = {}) {
    if (source === EEW_SOURCE.TEST) {
        testModeEewRaw = raw;
        testModeEewEq = eq;
        if (timeline !== undefined) testModeEewTimeline = timeline;
        if (index !== undefined) testModeEewTimelineIndex = index;
        return;
    }

    liveEewRaw = raw;
    liveEewEq = eq;
}

function clearEewState(source, { clearWarnAreaSignature = false, hideCard = true } = {}) {
    if (source === EEW_SOURCE.TEST) {
        setEewState(EEW_SOURCE.TEST, { raw: null, eq: null, index: -1 });
    } else {
        setEewState(EEW_SOURCE.LIVE, { raw: null, eq: null });
    }

    if (clearWarnAreaSignature) {
        eewWarnAreaSignatureByEvent.clear();
    }

    if (hideCard) {
        updateEewCard(getCurrentEewRaw());
    }
}

function getCurrentEewSource() {
    return CONFIG.isTest ? EEW_SOURCE.TEST : EEW_SOURCE.LIVE;
}

function getCurrentEewRaw() {
    return getEewState(getCurrentEewSource()).raw;
}

function getCurrentEewEq() {
    return getEewState(getCurrentEewSource()).eq;
}

function applyEewUpdate(source, raw, options = {}) {
    const {
        autoMove = true,
        playSound = true,
        clearWarnAreaSignature = false,
        updateCard = true,
    } = options;

    const normalized = normalizeEewPayload(raw);
    if (!shouldDisplayEew(normalized)) {
        clearEewState(source, { clearWarnAreaSignature, hideCard: updateCard });
        if (source === getCurrentEewSource()) {
            waveCurrentEq = null;
            hideWaveFrontLayers();
        }
        return null;
    }

    const eq = testEewToDetail(normalized);
    if (!eq) {
        clearEewState(source, { clearWarnAreaSignature, hideCard: updateCard });
        return null;
    }

    setEewState(source, { raw: normalized, eq });

    if (source === getCurrentEewSource()) {
        renderEarthquakeOnMap(eq, { autoMove });
        if (updateCard) {
            updateEewCard(normalized);
        }
    }

    if (playSound) {
        playEewFirst(normalized);
        maybePlayEewWarnAreaUpdate(normalized);
    }

    return { raw: normalized, eq };
}

function handleLiveEewMessage(payload) {
    if (!payload) return;

    let data;
    try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
        return;
    }

    data = normalizeEewPayload(data);
    if (!data) return;
    applyEewUpdate(EEW_SOURCE.LIVE, data, {
        autoMove: true,
        playSound: true,
        clearWarnAreaSignature: true,
        updateCard: true,
    });
}

function isFirstEewReport(eew) {
    return Number(eew?.Serial) === 1;
}

function isEewWarning(eew) {
    if (!eew || typeof eew !== 'object') return false;
    if (eew.isWarn === true) return true;

    if (Array.isArray(eew.WarnArea)) {
        return eew.WarnArea.some((area) => String(area?.Type || '').includes('警報'));
    }

    return false;
}

function getEewPlayKey(eew) {
    return [
        eew?.EventID,
        eew?.OriginTime,
        eew?.AnnouncedTime,
        eew?.Hypocenter,
    ].filter(Boolean).join('|');
}

function getEewUpdateKey(eew) {
    if (!eew || typeof eew !== 'object') return '';
    return [
        String(eew.EventID || '').trim(),
        String(eew.Serial || '').trim(),
        String(eew.AnnouncedTime || '').trim(),
        String(eew.MaxIntensity || '').trim(),
        String(eew.isFinal || '').trim(),
    ].join('|');
}

function getDetailScaleUpdateKey(eq) {
    if (!eq || typeof eq !== 'object') return '';
    return [
        String(eq.created_at || '').trim(),
        String(eq.earthquake?.time || '').trim(),
        String(eq.earthquake?.hypocenter?.name || '').trim(),
    ].join('|');
}

function playEewFirst(eew) {
    if (!isFirstEewReport(eew)) return;

    const key = getEewPlayKey(eew);
    if (key && key === lastPlayedEewFirstReportKey) return;

    lastPlayedEewFirstReportKey = key || String(Date.now());
    playEewSound(eew);
}

function getEewWarnAreaSignature(eew) {
    if (!Array.isArray(eew?.WarnArea)) return '';

    const warningAreas = eew.WarnArea
        .filter((area) => String(area?.Type || '').includes('警報'))
        .map((area) => [
            String(area?.Chiiki || ''),
            String(area?.Shindo1 || ''),
            String(area?.Shindo2 || ''),
            String(area?.Type || ''),
        ].join('|'))
        .filter(Boolean)
        .sort();

    return warningAreas.join(';');
}

function maybePlayEewWarnAreaUpdate(eew) {
    if (!eew || typeof eew !== 'object') return;
    if (!isEewWarning(eew)) return;

    const eventKey = String(eew.EventID || eew.OriginTime || eew.AnnouncedTime || '').trim();
    if (!eventKey) return;

    const signature = getEewWarnAreaSignature(eew);
    if (!signature) return;

    const prevSignature = eewWarnAreaSignatureByEvent.get(eventKey);
    if (prevSignature == null) {
        eewWarnAreaSignatureByEvent.set(eventKey, signature);
        return;
    }
    if (prevSignature === signature) return;

    eewWarnAreaSignatureByEvent.set(eventKey, signature);
    playEewSound(eew);
}

function getTestEewTimelineIndexByTime(nowMs) {
    if (!Array.isArray(testModeEewTimeline) || testModeEewTimeline.length === 0) return -1;

    let activeIndex = -1;
    for (let i = 0; i < testModeEewTimeline.length; i++) {
        const item = testModeEewTimeline[i];
        const announcedMs = Number(item?.announcedMs);
        if (!Number.isFinite(announcedMs)) {
            if (activeIndex < 0) activeIndex = i;
            continue;
        }
        if (nowMs >= announcedMs) {
            activeIndex = i;
            continue;
        }
        break;
    }

    return activeIndex;
}

function syncTestEewTimeline(options = {}) {
    if (!CONFIG.isTest) return false;

    const currentState = getEewState(EEW_SOURCE.TEST);
    const timeline = Array.isArray(currentState.timeline) ? currentState.timeline : [];

    if (timeline.length === 0) {
        const wasActive = currentState.index !== -1 || currentState.raw != null || currentState.eq != null;
        setEewState(EEW_SOURCE.TEST, { raw: null, eq: null, index: -1 });
        if (wasActive) {
            updateEewCard(getCurrentEewRaw());
        }
        return wasActive;
    }

    const simulatedNowMs = CONFIG.getSimulatedTime().getTime();
    const nextIndex = getTestEewTimelineIndexByTime(simulatedNowMs);
    if (nextIndex === currentState.index) return false;

    setEewState(EEW_SOURCE.TEST, { index: nextIndex });
    if (nextIndex < 0) {
        clearEewState(EEW_SOURCE.TEST, { hideCard: true });
        return true;
    }

    const currentItem = timeline[nextIndex] || {};
    setEewState(EEW_SOURCE.TEST, {
        raw: currentItem.raw || null,
        eq: currentItem.eq || null,
        index: nextIndex,
    });

    if (CONFIG.isTest) {
        updateEewCard(getCurrentEewRaw());
    }

    if (options.playSound !== false && currentItem.raw) {
        playEewFirst(currentItem.raw);
        maybePlayEewWarnAreaUpdate(currentItem.raw);
    }

    return true;
}

function startTestEewWatcher() {
    if (!CONFIG.isTest) return;
    if (testEewAnnounceTimerId != null) return;

    if (syncTestEewTimeline({ playSound: false })) {
        updateData();
    }
    testEewAnnounceTimerId = setInterval(() => {
        if (syncTestEewTimeline({ playSound: true })) {
            updateData();
        }
    }, TEST_EEW_ANNOUNCE_POLL_MS);
}

function parseJmaDateTime(value) {
    if (!value) return null;
    return value.replace(/\//g, '-').replace(' ', 'T');
}

function normalizeTestEew(eew) {
    if (!eew || typeof eew !== 'object') return eew;

    const normalized = { ...eew };
    const announcedIso = parseJmaDateTime(normalized.AnnouncedTime);
    const originIso = parseJmaDateTime(normalized.OriginTime);
    const announcedMs = Date.parse(announcedIso || '');
    const originMs = Date.parse(originIso || '');

    if (Number.isFinite(announcedMs) && Number.isFinite(originMs) && originMs > announcedMs) {
        normalized.OriginTime = normalized.AnnouncedTime;
    }

    return normalized;
}

function getEewAnnouncedMillis(eew) {
    if (!eew) return NaN;

    const announced = parseJmaDateTime(eew.AnnouncedTime);
    if (announced) {
        const announcedMs = Date.parse(announced);
        if (Number.isFinite(announcedMs)) return announcedMs;
    }

    const origin = parseJmaDateTime(eew.OriginTime);
    if (origin) {
        const originMs = Date.parse(origin);
        if (Number.isFinite(originMs)) return originMs;
    }

    return NaN;
}

function isFinalReportExpired(eew, nowMs = Date.now()) {
    if (!eew?.isFinal) return false;

    const announcedMs = getEewAnnouncedMillis(eew);
    if (!Number.isFinite(announcedMs)) return false;
    return nowMs - announcedMs >= EEW_HTTP_CONFIG.finalHideAfterMs;
}

function normalizeEewPayload(raw) {
    if (!raw) return null;

    if (Array.isArray(raw)) {
        for (const item of raw) {
            const normalized = normalizeEewPayload(item);
            if (normalized) return normalized;
        }
        return null;
    }

    if (typeof raw !== 'object') return null;

    if (raw.type === 'jma_eew') return raw;

    const candidates = [raw.data, raw.result, raw.eew, raw.payload];
    for (const candidate of candidates) {
        const normalized = normalizeEewPayload(candidate);
        if (normalized) return normalized;
    }

    const hasCoreFields = Boolean(raw.EventID || raw.Serial || raw.OriginTime || raw.AnnouncedTime || raw.Hypocenter);
    if (!hasCoreFields) return null;

    return {
        type: 'jma_eew',
        ...raw,
    };
}

function shouldDisplayEew(eew, nowMs = Date.now()) {
    const normalized = normalizeEewPayload(eew);
    if (!normalized) return false;
    eew = normalized;
    if (eew.isCancel) return false;
    if (isFinalReportExpired(eew, nowMs)) return false;
    return true;
}

async function fetchInitialLiveEewSnapshot() {
    const directUrl = EEW_HTTP_CONFIG.snapshotUrl;
    const candidates = [directUrl];
    if (EEW_HTTP_CONFIG.snapshotProxyPrefix) {
        const proxyUrl = `${EEW_HTTP_CONFIG.snapshotProxyPrefix}${encodeURIComponent(directUrl)}`;
        candidates.push(proxyUrl);
    }

    for (const url of candidates) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) continue;

            const data = await response.json();
            return data;
        } catch {
            // Try next candidate.
        }
    }

    return null;
}

async function loadInitialLiveEewSnapshot() {
    try {
        const snapshot = await fetchInitialLiveEewSnapshot();
        const applied = applyEewUpdate(EEW_SOURCE.LIVE, snapshot, {
            autoMove: false,
            playSound: false,
            clearWarnAreaSignature: true,
            updateCard: true,
        });
        if (!applied) return;

        // 最終報から5分以内のスナップショットはページ表示時に通知音を鳴らす。
        if (applied.raw.isFinal) {
            playEewSound(applied.raw);
        }
    } catch (error) {
        console.warn('[eew] Initial snapshot load failed', error);
    }
}

function intensityToScale(maxIntensity) {
    const map = {
        '1': 10,
        '2': 20,
        '3': 30,
        '4': 40,
        '5-': 45,
        '5+': 50,
        '5弱以上': 46,
        '6-': 55,
        '6+': 60,
        '5弱': 45,
        '5強': 50,
        '6弱': 55,
        '6強': 60,
        '7': 70,
    };

    const key = String(maxIntensity || '').trim();
    return map[key] ?? -1;
}

function testEewToDetail(eew) {
    if (!eew) return null;

    const time = parseJmaDateTime(eew.OriginTime) || new Date().toISOString();
    const announced = parseJmaDateTime(eew.AnnouncedTime) || time;
    const magnitude = Number(eew.Magunitude ?? eew.Magnitude ?? eew.magunitude ?? eew.magnitude);
    const depth = Number(eew.Depth ?? eew.depth);
    const latitude = Number(eew.Latitude ?? eew.latitude ?? eew.lat);
    const longitude = Number(eew.Longitude ?? eew.longitude ?? eew.lon);

    return {
        issue: {
            type: 'DetailScale',
        },
        earthquake: {
            time,
            maxScale: intensityToScale(eew.MaxIntensity),
            domesticTsunami: 'Unknown',
            hypocenter: {
                name: eew.Hypocenter || '不明',
                magnitude,
                depth,
                latitude,
                longitude,
            },
        },
        created_at: announced,
        points: [],
        areaScales: warnAreaToScales(eew.WarnArea),
    };
}

function warnAreaToScales(warnArea) {
    if (!Array.isArray(warnArea)) return [];

    const areaScaleMap = {};

    warnArea.forEach((area) => {
        const areaName = String(area?.Chiiki || '').trim();
        if (!areaName) return;

        const areaCode = AreaNameToCode(areaName);
        if (!areaCode) return;

        const scale = intensityToScale(area?.Shindo1);
        if (!Number.isFinite(scale) || scale < 0) return;

        if (!areaScaleMap[areaCode] || areaScaleMap[areaCode] < scale) {
            areaScaleMap[areaCode] = scale;
        }
    });

    return Object.entries(areaScaleMap).map(([areaCode, scale]) => ({ areaCode, scale }));
}

function getEarthquakeKey(eq) {
    if (!eq || !eq.earthquake) return "";
    return `${eq.earthquake.time}_${eq.earthquake.hypocenter?.name || ""}`;
}

function getEarthquakeLatLngs(eq) {
    const latlngs = [];

    if (!eq || !eq.earthquake) return latlngs;

    const { latitude, longitude } = eq.earthquake.hypocenter || {};
    const hypoLat = Number(latitude);
    const hypoLon = Number(longitude);
    if (Number.isFinite(hypoLat) && Number.isFinite(hypoLon)) {
        latlngs.push(L.latLng(hypoLat, hypoLon));
    }

    if (!Array.isArray(eq.points)) return latlngs;

    eq.points.forEach((point) => {
        const station = stationMap[point.addr];
        if (!station) return;

        const stationLat = Number(station.lat);
        const stationLon = Number(station.lon);
        if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) return;

        latlngs.push(L.latLng(stationLat, stationLon));
    });

    return latlngs;
}

function getAreaBoundsByCode(areaCode) {
    if (!japan_data || !Array.isArray(japan_data.features)) return null;

    if (areaBoundsCache.has(areaCode)) {
        return areaBoundsCache.get(areaCode);
    }

    ensureAreaLookupMaps();
    const arrayNum = areaCodeToIndexMap.get(areaCode);
    if (!Number.isInteger(arrayNum) || arrayNum < 0) {
        areaBoundsCache.set(areaCode, null);
        return null;
    }

    const feature = japan_data.features[arrayNum];
    if (!feature) {
        areaBoundsCache.set(areaCode, null);
        return null;
    }

    const bounds = L.geoJSON(feature).getBounds();
    const validBounds = bounds.isValid() ? bounds : null;
    areaBoundsCache.set(areaCode, validBounds);
    return validBounds;
}

function getEarthquakeBounds(eq) {
    const bounds = L.latLngBounds([]);

    const pointLatLngs = getEarthquakeLatLngs(eq);
    pointLatLngs.forEach((latlng) => {
        bounds.extend(latlng);
    });

    if (Array.isArray(eq?.areaScales)) {
        eq.areaScales.forEach((item) => {
            const areaCode = item?.areaCode;
            if (!areaCode) return;

            const areaBounds = getAreaBoundsByCode(areaCode);
            if (!areaBounds) return;
            bounds.extend(areaBounds);
        });
    }

    return bounds.isValid() ? bounds : null;
}

function moveCameraToEarthquake(eq) {
    const bounds = getEarthquakeBounds(eq);
    if (!bounds) return;

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const isSinglePoint = northEast.lat === southWest.lat && northEast.lng === southWest.lng;

    if (isSinglePoint) {
        map.flyTo(bounds.getCenter(), 8, { animate: true, duration: 0.5 });
        return;
    }

    map.flyToBounds(bounds, {
        padding: [60, 60],
        maxZoom: 8,
        duration: 0.5,
    });
}

function renderEarthquakeOnMap(eq, options = {}) {
    if (!eq || !eq.earthquake) return;
    const { autoMove = false } = options;
    currentDisplayedEarthquake = eq;

    const { latitude, longitude } = eq.earthquake.hypocenter || {};
    const lat = Number(latitude);
    const lon = Number(longitude);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const hypoLatLng = new L.LatLng(lat, lon);
        const hypoIconImage = L.icon({
            iconUrl: 'assets/images/shingen.png',
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -40]
        });
        updateMarker(hypoLatLng, hypoIconImage);
    }

    drawShindoPoints(eq.points, eq.areaScales);
    if (shouldRenderWaveForEq(eq)) {
        setWaveFrontEarthquake(eq);
    } else {
        waveCurrentEq = null;
        hideWaveFrontLayers();
    }

    if (autoMove) {
        moveCameraToEarthquake(eq);
    }
}

function getActiveEewEq() {
    return getCurrentEewEq();
}

function getActiveEewRaw() {
    const activeRaw = getCurrentEewRaw();
    if (!shouldDisplayEew(activeRaw, CONFIG.isTest ? CONFIG.getSimulatedTime().getTime() : Date.now())) {
        return null;
    }
    return activeRaw;
}

function isEewIssuedNow() {
    const activeEewRaw = getActiveEewRaw();
    if (!activeEewRaw || activeEewRaw.isCancel) return false;

    const nowMs = CONFIG.isTest ? CONFIG.getSimulatedTime().getTime() : Date.now();
    if (isFinalReportExpired(activeEewRaw, nowMs)) return false;

    return true;
}

function isPastEqViewDuringEew() {
    if (!isEewIssuedNow()) return false;
    if (!selectedEarthquakeKey) return false;

    const activeEewEq = getActiveEewEq();
    const activeEewKey = getEarthquakeKey(activeEewEq);
    if (!activeEewKey) return false;

    return selectedEarthquakeKey !== activeEewKey;
}

function shouldRenderWaveForEq(eq) {
    const activeEewEq = getActiveEewEq();
    if (!activeEewEq || !eq) return false;
    return getEarthquakeKey(activeEewEq) === getEarthquakeKey(eq);
}

async function loadJma2001TravelTimeTable() {
    try {
        const response = await fetch(WAVE_FRONT_CONFIG.tablePath);
        if (!response.ok) {
            console.warn('[wavefront] JMA2001 table is not available. fallback mode is used.');
            return null;
        }

        const json = await response.json();
        if (!Array.isArray(json.depths) || !Array.isArray(json.distances)
            || !Array.isArray(json.pTimes) || !Array.isArray(json.sTimes)) {
            console.warn('[wavefront] Invalid JMA2001 table schema. fallback mode is used.');
            return null;
        }

        return json;
    } catch (error) {
        console.warn('[wavefront] Failed to load JMA2001 table. fallback mode is used.', error);
        return null;
    }
}

function initWaveFrontLayers() {
    if (wavePFrontLayer || waveSFrontLayer) return;

    wavePFrontLayer = L.circle([0, 0], {
        pane: 'wavefront',
        radius: 0,
        color: WAVE_FRONT_CONFIG.pColor,
        weight: 2,
        opacity: 0,
        fillOpacity: 0,
    }).addTo(map);

    waveSFrontLayer = L.circle([0, 0], {
        pane: 'wavefront',
        radius: 0,
        color: WAVE_FRONT_CONFIG.sColor,
        fillColor: `url(#${WAVE_S_GRADIENT_ID})`,
        weight: 2.5,
        opacity: 0,
        fillOpacity: 0,
    }).addTo(map);

    ensureSWaveGradientDef();
    waveSFrontLayer.bringToFront();
}

function ensureSWaveGradientDef() {
    if (!waveSFrontLayer) return;

    const pathElement = typeof waveSFrontLayer.getElement === 'function'
        ? waveSFrontLayer.getElement()
        : waveSFrontLayer._path;
    const svg = pathElement ? pathElement.ownerSVGElement : null;
    if (!svg) return;

    let defs = svg.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS(WAVE_SVG_NS, 'defs');
        svg.insertBefore(defs, svg.firstChild);
    }

    let gradient = defs.querySelector(`#${WAVE_S_GRADIENT_ID}`);
    if (!gradient) {
        gradient = document.createElementNS(WAVE_SVG_NS, 'radialGradient');
        gradient.setAttribute('id', WAVE_S_GRADIENT_ID);
        gradient.setAttribute('cx', '50%');
        gradient.setAttribute('cy', '50%');
        gradient.setAttribute('r', '50%');

        const stopCenter = document.createElementNS(WAVE_SVG_NS, 'stop');
        stopCenter.setAttribute('offset', '0%');
        stopCenter.setAttribute('stop-opacity', '0');

        const stopMiddle = document.createElementNS(WAVE_SVG_NS, 'stop');
        stopMiddle.setAttribute('offset', '45%');
        stopMiddle.setAttribute('stop-opacity', '0.25');

        const stopEdge = document.createElementNS(WAVE_SVG_NS, 'stop');
        stopEdge.setAttribute('offset', '100%');
        stopEdge.setAttribute('stop-opacity', '1');

        gradient.appendChild(stopCenter);
        gradient.appendChild(stopMiddle);
        gradient.appendChild(stopEdge);
        defs.appendChild(gradient);
    }

    const stops = gradient.querySelectorAll('stop');
    for (const stop of stops) {
        stop.setAttribute('stop-color', WAVE_FRONT_CONFIG.sColor);
    }
}

function setWaveFrontEarthquake(eq) {
    if (!WAVE_FRONT_CONFIG.enabled || !eq || !eq.earthquake) return;

    initWaveFrontLayers();
    waveCurrentEq = eq;
    updateWaveFronts(Date.now());

    if (waveTimerId != null) return;

    waveTimerId = setInterval(() => {
        updateWaveFronts(Date.now());
    }, WAVE_FRONT_CONFIG.updateIntervalMs);
}

function updateWaveFronts(nowMs) {
    if (!waveCurrentEq || !waveCurrentEq.earthquake || !wavePFrontLayer || !waveSFrontLayer) return;

    const { hypocenter } = waveCurrentEq.earthquake;
    const lat = Number(hypocenter?.latitude);
    const lon = Number(hypocenter?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        hideWaveFrontLayers();
        return;
    }

    const originMs = getEqOriginMs(waveCurrentEq);
    if (!Number.isFinite(originMs)) {
        hideWaveFrontLayers();
        return;
    }

    const nowForWaveMs = CONFIG.isTest ? CONFIG.getSimulatedTime().getTime() : nowMs;
    const elapsedSec = Math.max(0, (nowForWaveMs - originMs) / 1000);
    const depthKm = parseDepthKm(hypocenter?.depth);

    const activeEewRaw = getActiveEewRaw();
    const isFinalReport = !!(activeEewRaw && activeEewRaw.isFinal);
    if (isFinalReport && isFinalReportExpired(activeEewRaw, nowForWaveMs)) {
        clearCurrentEewDisplay();
        return;
    }

    let pDistanceKm = getDistForSec('p', depthKm, elapsedSec);
    let sDistanceKm = getDistForSec('s', depthKm, elapsedSec);
    const isPMaxReached = isPWaveMaxReached(pDistanceKm);

    if (isPMaxReached) {
        pDistanceKm = getDistAfterPMax('p', depthKm, elapsedSec, pDistanceKm);
        sDistanceKm = getDistAfterPMax('s', depthKm, elapsedSec, sDistanceKm);
    }

    const center = L.latLng(lat, lon);
    wavePFrontLayer.setLatLng(center);
    waveSFrontLayer.setLatLng(center);

    applyWaveFrontRadius(wavePFrontLayer, pDistanceKm, WAVE_FRONT_CONFIG.pOpacity, 0);
    applyWaveFrontRadius(waveSFrontLayer, sDistanceKm, WAVE_FRONT_CONFIG.sOpacity, WAVE_FRONT_CONFIG.sFillOpacity);
}

function applyWaveFrontRadius(layer, distanceKm, opacity, fillOpacity = 0) {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
        layer.setRadius(0);
        layer.setStyle({ opacity: 0, fillOpacity: 0 });
        return;
    }

    layer.setRadius(distanceKm * 1000);
    layer.setStyle({ opacity, fillOpacity });
}

function hideWaveFrontLayers() {
    if (!wavePFrontLayer || !waveSFrontLayer) return;
    wavePFrontLayer.setRadius(0);
    waveSFrontLayer.setRadius(0);
    wavePFrontLayer.setStyle({ opacity: 0, fillOpacity: 0 });
    waveSFrontLayer.setStyle({ opacity: 0, fillOpacity: 0 });
}

function isPWaveMaxReached(pDistanceKm) {
    if (!jma2001TravelTable || !Array.isArray(jma2001TravelTable.distances)) return false;
    const distances = jma2001TravelTable.distances;
    if (distances.length === 0) return false;

    const maxDistanceKm = Number(distances[distances.length - 1]);
    if (!Number.isFinite(maxDistanceKm)) return false;

    const marginKm = 1;
    return Number.isFinite(pDistanceKm) && pDistanceKm >= maxDistanceKm - marginKm;
}

function clearCurrentEewDisplay() {
    clearEewState(getCurrentEewSource(), {
        clearWarnAreaSignature: true,
        hideCard: true,
    });
    waveCurrentEq = null;
    hideWaveFrontLayers();
}

function getEqOriginMs(eq) {
    const time = eq?.earthquake?.time;
    if (!time) return NaN;
    return Date.parse(time);
}

function parseDepthKm(depthRaw) {
    const depth = Number(depthRaw);
    if (Number.isFinite(depth) && depth >= 0) return depth;
    return WAVE_FRONT_CONFIG.defaultDepthKm;
}

function getDistForSec(waveType, depthKm, elapsedSec) {
    if (jma2001TravelTable) {
        const distanceFromTable = invertTravelDist(jma2001TravelTable, waveType, depthKm, elapsedSec);
        if (Number.isFinite(distanceFromTable)) {
            return distanceFromTable;
        }
    }

    return getDistByFallback(waveType, depthKm, elapsedSec);
}

function getDistAfterPMax(waveType, depthKm, elapsedSec, currentDistanceKm) {
    const maxInfo = getWaveMaxDistanceInfo(waveType, depthKm);
    if (!maxInfo) {
        return Number.isFinite(currentDistanceKm)
            ? currentDistanceKm
            : getDistByFallback(waveType, depthKm, elapsedSec);
    }

    if (elapsedSec <= maxInfo.maxTravelSec) {
        return Number.isFinite(currentDistanceKm) ? currentDistanceKm : maxInfo.maxDistanceKm;
    }

    const velocity = waveType === 'p'
        ? WAVE_FRONT_CONFIG.postMaxPVelocityKmS
        : WAVE_FRONT_CONFIG.postMaxSVelocityKmS;
    const extraSec = elapsedSec - maxInfo.maxTravelSec;
    return maxInfo.maxDistanceKm + velocity * extraSec;
}

function getWaveMaxDistanceInfo(waveType, depthKm) {
    if (!jma2001TravelTable || !Array.isArray(jma2001TravelTable.distances)) return null;

    const distances = jma2001TravelTable.distances;
    if (distances.length === 0) return null;

    const maxDistanceKm = Number(distances[distances.length - 1]);
    if (!Number.isFinite(maxDistanceKm)) return null;

    const maxTravelSec = getTravelTimeAtDistance(jma2001TravelTable, waveType, depthKm, maxDistanceKm);
    if (!Number.isFinite(maxTravelSec)) return null;

    return { maxDistanceKm, maxTravelSec };
}

function getDistByFallback(waveType, depthKm, elapsedSec) {
    const velocity = waveType === 'p'
        ? WAVE_FRONT_CONFIG.fallbackPVelocityKmS
        : WAVE_FRONT_CONFIG.fallbackSVelocityKmS;

    const hypocentralDistance = velocity * elapsedSec;
    if (!Number.isFinite(hypocentralDistance) || hypocentralDistance <= depthKm) {
        return null;
    }

    const epicentralSquared = hypocentralDistance ** 2 - depthKm ** 2;
    if (epicentralSquared <= 0) return null;

    return Math.sqrt(epicentralSquared);
}

function invertTravelDist(table, waveType, depthKm, elapsedSec) {
    if (!table || !Number.isFinite(elapsedSec) || elapsedSec < 0) return null;

    const distances = table.distances;
    if (!Array.isArray(distances) || distances.length < 2) return null;

    const minDist = distances[0];
    const maxDist = distances[distances.length - 1];
    const tMin = getTravelTimeAtDistance(table, waveType, depthKm, minDist);
    const tMax = getTravelTimeAtDistance(table, waveType, depthKm, maxDist);
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null;
    if (elapsedSec < tMin) return null;
    if (elapsedSec >= tMax) return null;

    let left = minDist;
    let right = maxDist;

    for (let i = 0; i < 26; i += 1) {
        const mid = (left + right) / 2;
        const tMid = getTravelTimeAtDistance(table, waveType, depthKm, mid);
        if (!Number.isFinite(tMid)) return null;

        if (tMid < elapsedSec) {
            left = mid;
        } else {
            right = mid;
        }
    }

    return (left + right) / 2;
}

function getTravelTimeAtDistance(table, waveType, depthKm, distanceKm) {
    const timeMatrix = waveType === 'p' ? table.pTimes : table.sTimes;
    const depthBracket = findBracket(table.depths, depthKm);
    const distanceBracket = findBracket(table.distances, distanceKm);

    if (!depthBracket || !distanceBracket) return null;

    const { i0: d0, i1: d1, ratio: dr } = depthBracket;
    const { i0: x0, i1: x1, ratio: xr } = distanceBracket;

    const t00 = Number(timeMatrix?.[d0]?.[x0]);
    const t01 = Number(timeMatrix?.[d0]?.[x1]);
    const t10 = Number(timeMatrix?.[d1]?.[x0]);
    const t11 = Number(timeMatrix?.[d1]?.[x1]);

    if (![t00, t01, t10, t11].every(Number.isFinite)) return null;

    const top = t00 + (t01 - t00) * xr;
    const bottom = t10 + (t11 - t10) * xr;
    return top + (bottom - top) * dr;
}

function findBracket(sortedArray, value) {
    if (!Array.isArray(sortedArray) || sortedArray.length === 0 || !Number.isFinite(value)) return null;

    if (value <= sortedArray[0]) {
        return { i0: 0, i1: 0, ratio: 0 };
    }

    const lastIndex = sortedArray.length - 1;
    if (value >= sortedArray[lastIndex]) {
        return { i0: lastIndex, i1: lastIndex, ratio: 0 };
    }

    for (let i = 0; i < lastIndex; i += 1) {
        const left = Number(sortedArray[i]);
        const right = Number(sortedArray[i + 1]);
        if (!Number.isFinite(left) || !Number.isFinite(right)) continue;

        if (left <= value && value <= right) {
            const range = right - left;
            const ratio = range === 0 ? 0 : (value - left) / range;
            return { i0: i, i1: i + 1, ratio };
        }
    }

    return null;
}

function drawShindoPoints(points, areaScales = []) {
    if (!JMAPointsJson || !japan_data || !shindoCanvasLayer) return;

    const canvasPoints = [];
    const nextFilledList = {};

    if (Array.isArray(points)) {
        points.forEach(element => {
            const station = stationMap[element.addr];
            if (!station) return;

            const stationLat = Number(station.lat);
            const stationLon = Number(station.lon);
            if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) return;

            const scale = element.scale;
            const iconName = iconMap[scale] || "intnull";

            canvasPoints.push({
                latlng: L.latLng(stationLat, stationLon),
                iconName: iconName,
                scale: scale
            });

            if (station.area?.name) {
                const areaCode = AreaNameToCode(station.area.name);
                if (areaCode != null && (!nextFilledList[areaCode] || nextFilledList[areaCode] < scale)) {
                    nextFilledList[areaCode] = scale;
                }
            }
        });
    }

    if (Array.isArray(areaScales)) {
        areaScales.forEach((item) => {
            const areaCode = item?.areaCode;
            const scale = Number(item?.scale);
            if (!areaCode || !Number.isFinite(scale) || scale < 0) return;

            if (!nextFilledList[areaCode] || nextFilledList[areaCode] < scale) {
                nextFilledList[areaCode] = scale;
            }
        });
    }

    canvasPoints.sort((a, b) => a.scale - b.scale);

    shindoCanvasLayer.setPoints(canvasPoints);
    updateShindoFillLayers(nextFilledList);
    filled_list = nextFilledList;
}

function updateShindoFillLayers(nextFilledList) {
    const nextActiveAreaCodes = new Set(Object.keys(nextFilledList));

    shindoFillState.activeAreaCodes.forEach((areaCode) => {
        if (nextActiveAreaCodes.has(areaCode)) return;
        const layer = shindoFillState.layerByAreaCode.get(areaCode);
        if (!layer) return;
        layer.setStyle({
            color: '#d1d1d1',
            weight: 0,
            opacity: 0,
            fillOpacity: 0,
        });
        delete shindoFillState.colorByAreaCode[areaCode];
    });

    nextActiveAreaCodes.forEach((areaCode) => {
        const scale = nextFilledList[areaCode];
        const fillColor = getShindoFillColor(scale);
        const prevFillColor = shindoFillState.colorByAreaCode[areaCode];
        const layer = FillPolygon(areaCode, fillColor);
        if (!layer) return;

        const wasActive = shindoFillState.activeAreaCodes.has(areaCode);
        if (!wasActive || prevFillColor !== fillColor) {
            layer.setStyle({
                color: '#d1d1d1',
                weight: 0.2,
                opacity: 1,
                fillColor,
                fillOpacity: 1,
            });
            shindoFillState.colorByAreaCode[areaCode] = fillColor;
        }
    });

    shindoFillState.activeAreaCodes = nextActiveAreaCodes;
}

function getShindoFillColor(scale) {
    return shindoFillColorMap[scale] || "#888888";
}

function FillPolygon(area_Code, fillColor) {
    if (!japan_data) return;

    if (shindoFillState.layerByAreaCode.has(area_Code)) {
        return shindoFillState.layerByAreaCode.get(area_Code);
    }

    ensureAreaLookupMaps();
    const array_Num = areaCodeToIndexMap.get(area_Code);
    if (!Number.isInteger(array_Num) || array_Num < 0) return null;

    const style = {
        "color": "#d1d1d1",
        "weight": 0,
        "opacity": 0,
        "fillColor": fillColor,
        "fillOpacity": 0,
    };

    const data_japan = japan_data["features"][array_Num];
    const filledLayer = L.geoJSON(data_japan, {
        style: style,
        pane: "pane_map_filled",
        onEachFeature: function (feature, layer) {
            layer.myTag = "Filled";
        }
    });

    shindoFilledLayer.addLayer(filledLayer);
    shindoFillState.layerByAreaCode.set(area_Code, filledLayer);
    return filledLayer;
}

function scheduleShindoFillPrewarm() {
    if (shindoFillPrewarmStarted || shindoFillPrewarmCompleted) return;
    if (!japan_data || !Array.isArray(AreaCode) || AreaCode.length === 0) return;

    shindoFillPrewarmStarted = true;
    ensureAreaLookupMaps();

    const uniqueAreaCodes = Array.from(new Set(AreaCode.filter(Boolean)));
    const batchSize = 24;
    let cursor = 0;

    const runChunk = () => {
        const end = Math.min(cursor + batchSize, uniqueAreaCodes.length);
        for (let i = cursor; i < end; i += 1) {
            const areaCode = uniqueAreaCodes[i];
            FillPolygon(areaCode, '#888888');
        }
        cursor = end;

        if (cursor >= uniqueAreaCodes.length) {
            shindoFillPrewarmCompleted = true;
            return;
        }

        setTimeout(runChunk, 0);
    };

    setTimeout(runChunk, 0);
}

function ensureAreaLookupMaps() {
    if (areaCodeToIndexMap.size === 0 && Array.isArray(AreaCode)) {
        AreaCode.forEach((code, index) => {
            if (code == null) return;
            if (!areaCodeToIndexMap.has(code)) {
                areaCodeToIndexMap.set(code, index);
            }
        });
    }

    if (areaNameToCodeMap.size === 0 && Array.isArray(AreaName) && Array.isArray(AreaCode)) {
        const length = Math.min(AreaName.length, AreaCode.length);
        for (let i = 0; i < length; i += 1) {
            const name = AreaName[i];
            const code = AreaCode[i];
            if (!name || !code) continue;
            if (!areaNameToCodeMap.has(name)) {
                areaNameToCodeMap.set(name, code);
            }
        }
    }
}

function AreaNameToCode(Name) {
    ensureAreaLookupMaps();
    return areaNameToCodeMap.get(Name);
}

function updateMarker(hypoLatLng, hypoIconImage) {
    if (!hypoMarker) {
        hypoMarker = L.marker(hypoLatLng, { 
            icon: hypoIconImage, 
            pane: "shingen" 
        }).addTo(map);
    } else {
        hypoMarker.setLatLng(hypoLatLng);
    }
}

function updateEarthquakeParam(time, scale, name, magnitude, depth, tsunami) {
    const card = document.querySelector(".latest-card");
    const latest_maxscale = card.querySelector(".latest-card_maxscale");

    Object.values(scaleClassMap).forEach(cls => latest_maxscale.classList.remove(cls));

    const bgClass = scaleClassMap[scale];
    if (bgClass) latest_maxscale.classList.add(bgClass);

    const match = scale.match(/^(\d)([^\d]*)$/);
    const number = match ? match[1] : scale;
    const modifier = match ? match[2] : "";

    const txt = latest_maxscale.querySelector(".latest-card_maxscale-txt");
    const label = latest_maxscale.querySelector(".latest-card_maxscale-label");
    txt.innerHTML = `${number}<span class="scale_modifier">${modifier}</span>`;

    if (number === "3" || number === "4") {
        txt.style.color = "#000";
        label.style.color = "#000";
    } else {
        txt.style.color = "";
        label.style.color = "";
    }

    card.querySelector(".latest-card_location").textContent = name;

    const date = new Date(time);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const formatted_time = `${month}/${day} ${hours}:${minutes}`;
    card.querySelector(".latest-card_date").textContent = `${formatted_time}ごろ発生`;

    const magnitude_class = card.querySelector(".latest-card_magnitude");
    if (Number(magnitude) === -1) {
        magnitude_class.textContent = "調査中";
        magnitude_class.classList.add("investigate-text");
    } else {
        magnitude_class.textContent = magnitude.toFixed(1);
        magnitude_class.classList.remove("investigate-text");
    }

    const depth_class = card.querySelector(".latest-card_depth");
    const num_depth = Number(depth);
    if (num_depth === -1) {
        depth_class.textContent = "調査中";
        depth_class.classList.add("investigate-text");
    } else if (num_depth === 0) {
        depth_class.textContent = "ごく浅い";
        depth_class.classList.add("investigate-text");
    } else {
        depth_class.textContent = `${num_depth}km`;
        depth_class.classList.remove("investigate-text");
    }

    const tsunamiCommentMap = {
        "None": "津波の心配なし",
        "Unknown": "津波調査中",
        "Checking": "津波調査中",
        "NonEffective": "若干の海面変動",
        "Watch": "津波注意報発表中",
        "Warning": "津波予報等発表中",
    };
    const tsunamiClassMap = {
        "None": "tsunami-none",
        "Unknown": "tsunami-un",
        "Checking": "tsunami-check",
        "NonEffective": "tsunami-effect",
        "Watch": "tsunami-watch",
        "Warning": "tsunami-warn",
    };

    const tsunami_class = card.querySelector(".latest-card_tsunami");
    Object.values(tsunamiClassMap).forEach(cls => tsunami_class.classList.remove(cls));
    tsunami_class.textContent = tsunamiCommentMap[tsunami] || "情報なし";
    if (tsunamiClassMap[tsunami]) tsunami_class.classList.add(tsunamiClassMap[tsunami]);
}

function updateEewCard(eew) {
    const card = document.getElementById('eew-card');
    if (!card) return;

    if (!eew || eew.isCancel) {
        card.hidden = true;
        return;
    }

    card.hidden = false;

    const issueTypeFromTitle = String(eew.Title || '').match(/（([^）]+)）/)?.[1];
    const issueType = issueTypeFromTitle || (eew.isWarn ? '警報' : '予報');
    const issueSuffix = eew.isFinal ? '最終' : `第${String(eew.Serial || '?')}報`;

    const origin = parseJmaDateTime(eew.OriginTime);
    const date = origin ? new Date(origin) : new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    const eewScaleCode = intensityToScale(eew.MaxIntensity);
    const eewScaleText = scaleMap[String(eewScaleCode)] || String(eew.MaxIntensity || '不明');
    const eewBgClass = scaleClassMap[eewScaleText] || '';
    const match = eewScaleText.match(/^(\d)([^\d]*)$/);
    const number = match ? match[1] : eewScaleText;
    const modifier = match ? match[2] : '';

    const maxScale = card.querySelector('.eew-card_maxscale');
    Object.values(scaleClassMap).forEach(cls => maxScale.classList.remove(cls));
    if (eewBgClass) maxScale.classList.add(eewBgClass);

    card.querySelector('.eew-card_status').textContent = `緊急地震速報 (${issueType}) - ${issueSuffix}`;
    card.querySelector('.eew-card_date').textContent = `${month}/${day} ${hours}:${minutes}ごろ発生`;
    card.querySelector('.eew-card_location').textContent = eew.Hypocenter || '不明';
    card.querySelector('.eew-card_comment').textContent = 'で地震';
    const eewScaleTxt = card.querySelector('.eew-card_maxscale-txt');
    const eewScaleLabel = card.querySelector('.eew-card_maxscale-label');
    eewScaleTxt.innerHTML = `${number}<span class="scale_modifier">${modifier}</span>`;

    if (number === "3" || number === "4") {
        eewScaleTxt.style.color = "#000";
        eewScaleLabel.style.color = "#000";
    } else {
        eewScaleTxt.style.color = "";
        eewScaleLabel.style.color = "";
    }

    const mag = Number(eew.Magunitude);
    const depth = Number(eew.Depth);
    card.querySelector('.eew-card_magnitude').textContent = Number.isFinite(mag) ? mag.toFixed(1) : '調査中';
    card.querySelector('.eew-card_depth').textContent = Number.isFinite(depth)
        ? (depth === 0 ? 'ごく浅い' : `${depth}km`)
        : '調査中';
}

function updateEqHistory(eqData) {
    const container = document.getElementById("eq-history-list");
    container.innerHTML = "";

    eqData.forEach((eq) => {

        const { time, maxScale, hypocenter } = eq.earthquake;
        const { name, magnitude, depth } = hypocenter;

        const scaleText = scaleMap[String(maxScale)] || "不明";
        const bgClass = scaleClassMap[scaleText] || "";

        const match = scaleText.match(/^(\d)([^\d]*)$/);
        const scaleNumber = match ? match[1] : scaleText;
        const scaleModifier = match ? match[2] : "";

        const date = new Date(time);
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const formatted_time = `${month}/${day} ${hours}:${minutes}ごろ`;

        const num_depth = Number(depth);
        const depthText = num_depth === -1 ? "調査中"
                        : num_depth === 0  ? "ごく浅い"
                        : `${num_depth}km`;

        const magText = Number(magnitude) === -1 ? "調査中" : `M ${magnitude.toFixed(1)}`;

        const darkTextClass = (scaleNumber === "3" || scaleNumber === "4") ? "dark-text" : "";

        const html = `
            <div class="eq-history_content" tabindex="0" role="button" aria-label="過去の地震を地図に表示">
                <div class="eq-history_maxscale ${bgClass} ${darkTextClass}">
                    <p>${scaleNumber}<span class="scale_modifier">${scaleModifier}</span></p>
                </div>
                    <div class="eq-history_elements">
                        <p class="eq-history_date">${formatted_time}</p>
                        <div class="eq-history_param">
                            <p class="eq-history_param_magnitude">${magText}</p>
                            <p class="eq-history_param_depth">深さ ${depthText}</p>
                        </div>
                        <p class="eq-history_location">${name}</p>
                    </div>
                </div>
            `;
        container.insertAdjacentHTML("beforeend", html);

        const card = container.lastElementChild;
        if (!card) return;

        const selectHistoryEarthquake = () => {
            selectedEarthquakeKey = getEarthquakeKey(eq);
            renderEarthquakeOnMap(eq, { autoMove: true });
            lastRenderedEarthquakeKey = selectedEarthquakeKey;
        };

        card.addEventListener("click", selectHistoryEarthquake);

        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectHistoryEarthquake();
            }
        });
    });
}

function enableDragScroll(element, options = {}) {
    let isDown = false;
    let dragMoved = false;
    let suppressClick = false;
    let startX, startY, scrollLeft, scrollTop;
    const speed = options.speed || 1;
    const dragThreshold = options.dragThreshold || 6;

    element.style.cursor = 'grab';

    element.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDown = true;
        dragMoved = false;
        element.classList.add('active');
        element.style.cursor = 'grabbing';
        element.style.userSelect = 'none';
        startX = e.pageX - element.offsetLeft;
        startY = e.pageY - element.offsetTop;
        scrollLeft = element.scrollLeft;
        scrollTop = element.scrollTop;
    });

    element.addEventListener('mouseup', () => {
        if (!isDown) return;
        isDown = false;
        if (dragMoved) {
            suppressClick = true;
            setTimeout(() => {
                suppressClick = false;
            }, 0);
        }
        element.classList.remove('active');
        element.style.cursor = 'grab';
        element.style.userSelect = '';
    });

    element.addEventListener('mouseleave', () => {
        isDown = false;
        element.classList.remove('active');
        element.style.cursor = 'grab';
        element.style.userSelect = '';
    });

    element.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - element.offsetLeft;
        const y = e.pageY - element.offsetTop;
        if (!dragMoved) {
            const movedX = Math.abs(x - startX);
            const movedY = Math.abs(y - startY);
            if (movedX >= dragThreshold || movedY >= dragThreshold) {
                dragMoved = true;
            }
        }
        element.scrollLeft = scrollLeft - (x - startX) * speed;
        element.scrollTop  = scrollTop  - (y - startY) * speed;
    });

    element.addEventListener('click', (e) => {
        if (!suppressClick) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
}

const scrollable = document.querySelector('.side-panel');
if (scrollable) {
    enableDragScroll(scrollable, { speed: 1 });
}

const SpeechConfig = {
    enabled: true,
    minScale: 0,
    lang: 'ja-JP',
    rate: 1.0,
    pitch: 1.0,
};

let lastSpokenKey = null;
let speechCooldown = false;
let userInteracted = false;

function speak(text) {
    if (!SpeechConfig.enabled || !userInteracted) return;
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = SpeechConfig.lang;
    utter.rate  = SpeechConfig.rate;
    utter.pitch = SpeechConfig.pitch;

    if (CONFIG.isTest) {
        utter.onend = () => {
            setTimeout(() => {
                lastSpokenKey = null;
                speechCooldown = false;
            }, 5000);
        };
        speechCooldown = true;
    }

    window.speechSynthesis.speak(utter);
}

function buildSpeechText(scale) {
    return [
        `最大震度${scale}の地震が発生しました。`,
    ].join("");
}

function trySpeakEarthquake({ time, scale, name, rawScale }) {
    if (speechCooldown) return;
    const key = `${time}_${name}`;
    if (key === lastSpokenKey) return;
    if (Number(rawScale) < SpeechConfig.minScale) return;

    lastSpokenKey = key;
    playAlertSound();
    const text = buildSpeechText(scale);
    speak(text);
}

const SoundConfig = {
    enabled: true,
    earthquakeEnabled: true,
    src: './assets/audio/eq.mp3',
    volume: 0.8,
};

const EewSoundConfig = {
    enabled: true,
    src: './assets/audio/eew.mp3',
    volume: 0.9,
};

const EewWarnSoundConfig = {
    enabled: true,
    src: './assets/audio/eew_warn.mp3',
    volume: 0.95,
};

const ShakeSoundConfig = {
    enabled: true,
    src: './assets/audio/shake.mp3',
    volume: 0.8,
};

const alertAudio = new Audio(SoundConfig.src);
alertAudio.volume = SoundConfig.volume;

const eewAudio = new Audio(EewSoundConfig.src);
eewAudio.volume = EewSoundConfig.volume;

const eewWarnAudio = new Audio(EewWarnSoundConfig.src);
eewWarnAudio.volume = EewWarnSoundConfig.volume;

const shakeAudio = new Audio(ShakeSoundConfig.src);
shakeAudio.volume = ShakeSoundConfig.volume;

function unlockAudioPlayback() {
    const targets = [alertAudio, eewAudio, eewWarnAudio, shakeAudio];
    targets.forEach((audio) => {
        const originalMuted = audio.muted;
        const originalVolume = audio.volume;
        audio.muted = true;
        audio.volume = 0;
        audio.currentTime = 0;

        const playResult = audio.play();
        if (playResult && typeof playResult.then === 'function') {
            playResult
                .then(() => {
                    audio.pause();
                    audio.currentTime = 0;
                })
                .catch(() => {
                    // Permission may still be blocked depending on browser policy.
                })
                .finally(() => {
                    audio.muted = originalMuted;
                    audio.volume = originalVolume;
                });
            return;
        }

        audio.muted = originalMuted;
        audio.volume = originalVolume;
    });
}

function promptInitialAudioPermission() {
    const modal = document.getElementById('audio-permission-modal');
    const backdrop = document.getElementById('audio-permission-backdrop');
    const allowBtn = document.getElementById('audio-permission-allow-btn');
    const cancelBtn = document.getElementById('audio-permission-cancel-btn');
    if (!modal || !allowBtn || !cancelBtn || !backdrop) return;

    const closeModal = () => {
        modal.hidden = true;
    };

    if (!modal.dataset.bound) {
        allowBtn.addEventListener('click', () => {
            userInteracted = true;
            unlockAudioPlayback();
            closeModal();
        });

        cancelBtn.addEventListener('click', () => {
            closeModal();
        });

        backdrop.addEventListener('click', () => {
            closeModal();
        });

        modal.dataset.bound = '1';
    }

    modal.hidden = false;
}

function promptUsageNotice(onClose) {
    const modal = document.getElementById('usage-notice-modal');
    const backdrop = document.getElementById('usage-notice-backdrop');
    const okBtn = document.getElementById('usage-notice-ok-btn');
    if (!modal || !backdrop || !okBtn) {
        if (typeof onClose === 'function') onClose();
        return;
    }

    const closeModal = () => {
        modal.hidden = true;
        if (typeof onClose === 'function') onClose();
    };

    if (!modal.dataset.bound) {
        okBtn.addEventListener('click', closeModal);
        modal.dataset.bound = '1';
    }

    modal.hidden = false;
}

function initializeCreditsDialog() {
    const creditsButton = document.getElementById('credits-button');
    const modal = document.getElementById('credits-modal');
    const backdrop = document.getElementById('credits-backdrop');
    const closeButton = document.getElementById('credits-close-btn');

    if (!creditsButton || !modal || !backdrop || !closeButton) return;

    const closeModal = () => {
        modal.hidden = true;
    };

    if (!modal.dataset.bound) {
        creditsButton.addEventListener('click', (event) => {
            event.preventDefault();
            modal.hidden = false;
        });

        closeButton.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.hidden) {
                closeModal();
            }
        });

        modal.dataset.bound = '1';
    }
}

function initializeContactDialog() {
    const contactButton = document.getElementById('contact-button');
    const modal = document.getElementById('contact-modal');
    const backdrop = document.getElementById('contact-backdrop');
    const closeButton = document.getElementById('contact-close-btn');
    const githubIssueButton = document.getElementById('contact-github-issue-btn');
    const googleFormButton = document.getElementById('contact-google-form-btn');

    if (!contactButton || !modal || !backdrop || !closeButton || !githubIssueButton || !googleFormButton) return;

    const closeModal = () => {
        modal.hidden = true;
    };

    const openContactUrl = (url) => {
        window.open(url, '_blank', 'noopener');
        closeModal();
    };

    if (!modal.dataset.bound) {
        contactButton.addEventListener('click', (event) => {
            event.preventDefault();
            modal.hidden = false;
        });

        githubIssueButton.addEventListener('click', () => {
            openContactUrl('https://github.com/SQLab-dev/EQFast-dev/issues');
        });

        googleFormButton.addEventListener('click', () => {
            openContactUrl('https://forms.gle/V1J5r4MjhNfB1Tz26');
        });

        closeButton.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.hidden) {
                closeModal();
            }
        });

        modal.dataset.bound = '1';
    }
}

setTimeout(() => {
    promptUsageNotice(() => {
        promptInitialAudioPermission();
    });
}, 300);

initializeCreditsDialog();
initializeContactDialog();

function playAlertSound() {
    if (!SoundConfig.enabled || !SoundConfig.earthquakeEnabled || !userInteracted) return;
    alertAudio.currentTime = 0;
    alertAudio.play().catch(e => console.warn('効果音の再生失敗:', e));
}

function playEewSound(eew) {
    if (!EewSoundConfig.enabled) return;

    const shouldUseWarnSound = isEewWarning(eew) && EewWarnSoundConfig.enabled;
    const targetAudio = shouldUseWarnSound ? eewWarnAudio : eewAudio;

    targetAudio.currentTime = 0;
    targetAudio.play().catch(e => console.warn('EEW音声の再生失敗:', e));
}

function playShakeSound() {
    if (!SoundConfig.enabled || !ShakeSoundConfig.enabled || !userInteracted) return;
    shakeAudio.currentTime = 0;
    shakeAudio.play().catch(e => console.warn('揺れ検知音声の再生失敗:', e));
}

(function () {
    const toggle      = document.getElementById('voice-enabled-toggle');
    const detail      = document.getElementById('voice-detail');
    const minScaleSel = document.getElementById('voice-min-scale');
    const testBtn     = document.getElementById('voice-test-btn');
    const dot         = document.getElementById('voice-status-dot');
    const statusTxt   = document.getElementById('voice-status-text');

    function waitAndSync() {
        if (typeof SpeechConfig !== 'undefined') {
            toggle.checked    = SpeechConfig.enabled;
            minScaleSel.value = String(SpeechConfig.minScale);
            detail.classList.toggle('visible', SpeechConfig.enabled);
        } else {
            setTimeout(waitAndSync, 100);
        }
    }
    waitAndSync();

    toggle.addEventListener('change', () => {
        SpeechConfig.enabled = toggle.checked;
        detail.classList.toggle('visible', toggle.checked);
        if (toggle.checked) userInteracted = true;
    });

    minScaleSel.addEventListener('change', () => {
        SpeechConfig.minScale = Number(minScaleSel.value);
    });

    testBtn.addEventListener('click', () => {
        userInteracted = true;
        testBtn.disabled = true;
        testBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px"><path d="M8 5v14l11-7z"/></svg> 再生中…`;
        dot.className = 'voice-status-dot busy';
        statusTxt.textContent = '再生中…';

        const utter = new SpeechSynthesisUtterance('読み上げは有効です。');
        utter.lang  = SpeechConfig.lang;
        utter.rate  = SpeechConfig.rate;
        utter.pitch = SpeechConfig.pitch;
        utter.onend = () => {
            dot.className = 'voice-status-dot ok';
            statusTxt.textContent = '正常';
            testBtn.disabled = false;
            testBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px"><path d="M8 5v14l11-7z"/></svg> テスト再生`;
        };
        utter.onerror = () => {
            dot.className = 'voice-status-dot err';
            statusTxt.textContent = 'エラー';
            testBtn.disabled = false;
            testBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px"><path d="M8 5v14l11-7z"/></svg> テスト再生`;
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
    });
})();

(function () {
    const toggle    = document.getElementById('sound-enabled-toggle');
    const detail    = document.getElementById('sound-detail');
    const volumeEl  = document.getElementById('sound-volume');
    const volumeLbl = document.getElementById('sound-volume-label');
    const eqToggle  = document.getElementById('sound-earthquake-toggle');
    const eewToggle = document.getElementById('sound-eew-toggle');
    const shakeToggle = document.getElementById('sound-shake-toggle');
    const eqTestBtn = document.getElementById('sound-earthquake-test-btn');
    const eewTestBtn = document.getElementById('sound-eew-test-btn');
    const shakeTestBtn = document.getElementById('sound-shake-test-btn');
    const dot       = document.getElementById('sound-status-dot');
    const statusTxt = document.getElementById('sound-status-text');
    const testButtons = [eqTestBtn, eewTestBtn, shakeTestBtn];

    function setTestButtonsDisabled(disabled) {
        testButtons.forEach((button) => {
            if (button) button.disabled = disabled;
        });
    }

    function setButtonLabel(button, label) {
        if (!button) return;
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> ${label}`;
    }

    function runSoundTest({ src, volume, activeButton }) {
        userInteracted = true;
        setTestButtonsDisabled(true);
        setButtonLabel(activeButton, '再生中...');
        dot.className = 'voice-status-dot busy';
        statusTxt.textContent = '再生中…';

        const audio = new Audio(src);
        audio.volume = volume;

        return audio.play()
            .then(() => new Promise((resolve) => {
                audio.onended = resolve;
            }))
            .then(() => {
                dot.className = 'voice-status-dot ok';
                statusTxt.textContent = '正常';
            })
            .catch(() => {
                dot.className = 'voice-status-dot err';
                statusTxt.textContent = 'エラー（ファイル未設置？）';
            })
            .finally(() => {
                setTestButtonsDisabled(false);
                setButtonLabel(eqTestBtn, '再生');
                setButtonLabel(eewTestBtn, '再生');
                setButtonLabel(shakeTestBtn, '再生');
            });
    }

    toggle.checked = SoundConfig.enabled;
    eqToggle.checked = SoundConfig.earthquakeEnabled;
    eewToggle.checked = EewSoundConfig.enabled;
    shakeToggle.checked = ShakeSoundConfig.enabled;
    detail.classList.toggle('visible', SoundConfig.enabled);

    toggle.addEventListener('change', () => {
        SoundConfig.enabled = toggle.checked;
        detail.classList.toggle('visible', toggle.checked);
        if (toggle.checked) userInteracted = true;
    });

    eqToggle.addEventListener('change', () => {
        SoundConfig.earthquakeEnabled = eqToggle.checked;
        if (eqToggle.checked) userInteracted = true;
    });

    eewToggle.addEventListener('change', () => {
        EewSoundConfig.enabled = eewToggle.checked;
        if (eewToggle.checked) userInteracted = true;
    });

    shakeToggle.addEventListener('change', () => {
        ShakeSoundConfig.enabled = shakeToggle.checked;
        if (shakeToggle.checked) userInteracted = true;
    });

    volumeEl.addEventListener('mousedown', (e) => e.stopPropagation());

    volumeEl.addEventListener('input', () => {
        const v = parseFloat(volumeEl.value);
        SoundConfig.volume = v;
        alertAudio.volume = v;
        ShakeSoundConfig.volume = v;
        shakeAudio.volume = v;
        volumeLbl.textContent = `${Math.round(v * 100)}%`;
    });

    eqTestBtn.addEventListener('click', () => {
        runSoundTest({ src: SoundConfig.src, volume: SoundConfig.volume, activeButton: eqTestBtn });
    });

    eewTestBtn.addEventListener('click', () => {
        runSoundTest({ src: EewSoundConfig.src, volume: EewSoundConfig.volume, activeButton: eewTestBtn });
    });

    shakeTestBtn.addEventListener('click', () => {
        runSoundTest({ src: ShakeSoundConfig.src, volume: ShakeSoundConfig.volume, activeButton: shakeTestBtn });
    });
})();

async function fetchGifPixels(gifUrl) {
    const res = await fetchViaWorkerProxy(gifUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function getPixel(imageData, x, y) {
    const i = (y * imageData.width + x) * 4;
    return {
        r: imageData.data[i],
        g: imageData.data[i + 1],
        b: imageData.data[i + 2],
    };
}

async function updateImages(latestTime, points) {
    if (CONFIG.isTest) {
        return updateImagesFromTestData(points);
    }

    const t = new Date(latestTime * 1000);
    const pad = n => String(n).padStart(2, '0');
    const yyyymmdd = `${t.getFullYear()}${pad(t.getMonth()+1)}${pad(t.getDate())}`;
    const ts = yyyymmdd + pad(t.getHours()) + pad(t.getMinutes()) + pad(t.getSeconds());

    // K-MONI endpoint is currently HTTP-only.
    const shindoUrl = buildKmoniUrl(`/data/map_img/RealTimeImg/jma_s/${yyyymmdd}/${ts}.jma_s.gif`);
    const pgaUrl = buildKmoniUrl(`/data/map_img/RealTimeImg/acmap_s/${yyyymmdd}/${ts}.acmap_s.gif`);

    const [shindoData, pgaData] = await Promise.all([
        fetchGifPixels(shindoUrl),
        fetchGifPixels(pgaUrl),
    ]);

    const shindoResult = [], pgaResult = [], colorResult = [], pgaColorResult = [];

    for (const { x, y, suspended } of points) {
        if (suspended || y >= shindoData.height || x >= shindoData.width) {
            shindoResult.push(null);
            pgaResult.push(null);
            colorResult.push(null);
            pgaColorResult.push(null);
            continue;
        }

        const sc = getPixel(shindoData, x, y);
        const pc = getPixel(pgaData, x, y);
        const sp = color2position(sc.r, sc.g, sc.b);
        const pp = color2position(pc.r, pc.g, pc.b);

        if (sp == null || pp == null) {
            shindoResult.push(null);
            pgaResult.push(null);
            colorResult.push(null);
            pgaColorResult.push(null);
            continue;
        }

        colorResult.push(`rgb(${sc.r},${sc.g},${sc.b})`);
        pgaColorResult.push(`rgb(${pc.r},${pc.g},${pc.b})`);

        let shindo = Math.round((10.0 * sp - 3.0) * 10) / 10;
        let pga    = Math.round((10 ** (5.0 * pp - 2.0)) * 10) / 10;

        if (shindo < -3 || shindo > 7) shindo = 7.0;
        if (pga < 0 || pga > 9999.9) pga = 99999.9;

        shindoResult.push(shindo);
        pgaResult.push(pga);
    }

    return { shindoResult, pgaResult, colorResult, pgaColorResult };
}

async function updateImagesFromTestData(points) {
    const simulatedNowMs = CONFIG.getSimulatedTime().getTime();
    const targetTimeMs = simulatedNowMs;

    points.forEach((point) => {
        const code = String(point.code || '').trim();
        if (!code || point.suspended) return;
        queueKyoshinSeries(code);
    });
    pumpKyoshinQueue();

    const shindoResult = [];
    const pgaResult = [];
    const colorResult = [];
    const pgaColorResult = [];

    for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const code = String(point.code || '').trim();
        if (!code || point.suspended) {
            shindoResult.push(null);
            pgaResult.push(null);
            colorResult.push(null);
            pgaColorResult.push(null);
            continue;
        }

        const series = kyoshinTestDataState.stationSeriesByCode.get(code);
        if (!series || !Array.isArray(series.pgaSamples) || series.pgaSamples.length === 0) {
            shindoResult.push(null);
            pgaResult.push(null);
            colorResult.push(null);
            pgaColorResult.push(null);
            continue;
        }

        const sampleIndex = getKyoshinSampleIndex(series, targetTimeMs);
        if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex >= series.pgaSamples.length) {
            shindoResult.push(null);
            pgaResult.push(null);
            colorResult.push(null);
            pgaColorResult.push(null);
            continue;
        }

        const pga = Number(series.pgaSamples[sampleIndex]);
        if (!Number.isFinite(pga) || pga < 0) {
            shindoResult.push(null);
            pgaResult.push(null);
            colorResult.push(null);
            pgaColorResult.push(null);
            continue;
        }

        const calculatedIntensity = Number(series.intensitySamples?.[sampleIndex]);
        const shindo = Number.isFinite(calculatedIntensity)
            ? calculatedIntensity
            : pgaToApproxShindo(pga);
        const color = colorFromShindo(shindo);
        shindoResult.push(shindo);
        pgaResult.push(pga);
        colorResult.push(color);
        pgaColorResult.push(color);
    }

    return { shindoResult, pgaResult, colorResult, pgaColorResult };
}

const KYOSHIN_TEST_DATA_CONFIG = {
    basePath: `${getReplayBasePath(CONFIG.testEventId)}/kyoshin`,
    maxConcurrentLoads: 6,
};

const kyoshinTestDataState = {
    stationSeriesByCode: new Map(),
    loadingCodes: new Set(),
    queue: [],
    activeLoads: 0,
    availableCodeSetsPromise: null,
    availableCodeSets: {
        knet: null,
        kik: null,
    },
};

function queueKyoshinSeries(code) {
    if (!code) return;
    if (kyoshinTestDataState.stationSeriesByCode.has(code)) return;
    if (kyoshinTestDataState.loadingCodes.has(code)) return;
    if (kyoshinTestDataState.queue.includes(code)) return;
    kyoshinTestDataState.queue.push(code);
}

function pumpKyoshinQueue() {
    while (
        kyoshinTestDataState.activeLoads < KYOSHIN_TEST_DATA_CONFIG.maxConcurrentLoads
        && kyoshinTestDataState.queue.length > 0
    ) {
        const code = kyoshinTestDataState.queue.shift();
        kyoshinTestDataState.loadingCodes.add(code);
        kyoshinTestDataState.activeLoads += 1;

        loadKyoshinTestSeriesByCode(code)
            .catch(() => null)
            .finally(() => {
                kyoshinTestDataState.loadingCodes.delete(code);
                kyoshinTestDataState.activeLoads = Math.max(0, kyoshinTestDataState.activeLoads - 1);
                pumpKyoshinQueue();
            });
    }
}

async function loadKyoshinTestSeriesByCode(code) {
    if (kyoshinTestDataState.stationSeriesByCode.has(code)) {
        return kyoshinTestDataState.stationSeriesByCode.get(code);
    }

    await ensureKyoshinAvailableCodeSetsLoaded();

    const basePath = KYOSHIN_TEST_DATA_CONFIG.basePath;
    const candidates = [];
    if (kyoshinTestDataState.availableCodeSets.knet?.has(code)) {
        candidates.push({ path: `${basePath}/knet/${code}.json`, type: 'precomputed' });
    }
    if (kyoshinTestDataState.availableCodeSets.kik?.has(code)) {
        candidates.push({ path: `${basePath}/kik/${code}.json`, type: 'precomputed' });
    }

    if (candidates.length === 0) {
        kyoshinTestDataState.stationSeriesByCode.set(code, null);
        return null;
    }

    for (const candidate of candidates) {
        try {
            const response = await fetch(candidate.path);
            if (!response.ok) continue;

            const json = await response.json();
            const series = normalizeKyoshinSeries(json);
            if (series && Array.isArray(series.pgaSamples) && series.pgaSamples.length > 0) {
                kyoshinTestDataState.stationSeriesByCode.set(code, series);
                return series;
            }
        } catch {
            // Try next candidate path.
        }
    }

    kyoshinTestDataState.stationSeriesByCode.set(code, null);
    return null;
}

async function ensureKyoshinAvailableCodeSetsLoaded() {
    if (kyoshinTestDataState.availableCodeSets.knet && kyoshinTestDataState.availableCodeSets.kik) {
        return kyoshinTestDataState.availableCodeSets;
    }
    if (kyoshinTestDataState.availableCodeSetsPromise) {
        return kyoshinTestDataState.availableCodeSetsPromise;
    }

    const basePath = KYOSHIN_TEST_DATA_CONFIG.basePath;
    kyoshinTestDataState.availableCodeSetsPromise = Promise.all([
        loadKyoshinAvailableCodeSet(`${basePath}/knet/index.json`),
        loadKyoshinAvailableCodeSet(`${basePath}/kik/index.json`),
    ]).then(([knet, kik]) => {
        kyoshinTestDataState.availableCodeSets = { knet, kik };
        return kyoshinTestDataState.availableCodeSets;
    }).catch(() => {
        kyoshinTestDataState.availableCodeSets = {
            knet: new Set(),
            kik: new Set(),
        };
        return kyoshinTestDataState.availableCodeSets;
    });

    return kyoshinTestDataState.availableCodeSetsPromise;
}

async function loadKyoshinAvailableCodeSet(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) return new Set();
        const payload = await response.json();
        const codes = Array.isArray(payload?.codes) ? payload.codes : [];
        return new Set(codes.map((code) => String(code || '').trim()).filter(Boolean));
    } catch {
        return new Set();
    }
}

function normalizeKyoshinSeries(source) {
    if (!source || typeof source !== 'object') return null;

    const pgaSamples = Array.isArray(source.pgaSamples) ? source.pgaSamples.map(Number) : null;
    const intensitySamples = Array.isArray(source.intensitySamples) ? source.intensitySamples.map(Number) : null;
    const originTimeMs = Number(source.originTimeMs);
    const startTimeMs = Number(source.startTimeMs);
    const sampleIntervalMs = Number(source.sampleIntervalMs);
    const samplingFrequencyHz = Number(source.samplingFrequencyHz);

    if (!Array.isArray(pgaSamples) || pgaSamples.length === 0) return null;
    if (!Array.isArray(intensitySamples) || intensitySamples.length !== pgaSamples.length) return null;
    if (!Number.isFinite(startTimeMs) || !Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) return null;

    const endTimeMs = Number.isFinite(source.endTimeMs)
        ? Number(source.endTimeMs)
        : startTimeMs + (pgaSamples.length - 1) * sampleIntervalMs;

    return {
        pgaSamples,
        intensitySamples,
        originTimeMs: Number.isFinite(originTimeMs) ? originTimeMs : null,
        startTimeMs,
        endTimeMs,
        sampleIntervalMs,
        samplingFrequencyHz: Number.isFinite(samplingFrequencyHz) ? samplingFrequencyHz : 1000 / sampleIntervalMs,
    };
}

function floorJma1d(value) {
    if (!Number.isFinite(value)) return -3;
    const roundedTo2Decimals = Math.round(value * 100) / 100;
    return Math.floor(roundedTo2Decimals * 10) / 10;
}

function pgaToApproxShindo(pga) {
    if (!Number.isFinite(pga) || pga <= 0) return -3;
    const rawShindo = 2 * Math.log10(pga) + 0.94;
    const processed = floorJma1d(rawShindo);
    return Math.max(-3, Math.min(7, processed));
}

function getKyoshinSampleIndex(series, targetTimeMs) {
    if (!series || !Number.isFinite(series.startTimeMs) || !Number.isFinite(series.sampleIntervalMs) || series.sampleIntervalMs <= 0) {
        return -1;
    }
    if (!Number.isFinite(targetTimeMs)) return -1;

    const relativeMs = targetTimeMs - series.startTimeMs;
    if (relativeMs < 0) return -1;
    return Math.floor(relativeMs / series.sampleIntervalMs);
}

function shindoToScaleCode(shindo) {
    if (!Number.isFinite(shindo)) return 10;
    if (shindo >= 6.5) return 70;
    if (shindo >= 6.0) return 60;
    if (shindo >= 5.5) return 55;
    if (shindo >= 5.0) return 50;
    if (shindo >= 4.5) return 45;
    if (shindo >= 3.5) return 40;
    if (shindo >= 2.5) return 30;
    if (shindo >= 1.5) return 20;
    return 10;
}

function colorFromShindo(shindo) {
    if (!Number.isFinite(shindo)) return null;
    if (shindo < 0.5) return null;
    const scaleCode = shindoToScaleCode(shindo);
    const hex = getShindoFillColor(scaleCode);
    return hexToRgbString(hex);
}

function hexToRgbString(hex) {
    const normalized = String(hex || '').replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return 'rgb(136,136,136)';
    }

    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgb(${r},${g},${b})`;
}

let latestTime = 0;
let lastSync = 0;
let kyoshinPoints = [];

const KYOSHIN_DETECT_CONFIG = {
    historySeconds: 8,
    minHistorySamples: 2,
    candidateDelta: 0.28,
    candidateCurrent: 0.15,
    candidateNeighborDelta: 0.18,
    minCandidateNeighbors: 2,
    triggerDelta: 0.58,
    triggerCurrent: 0.45,
    neighborRadiusKm: 38,
    minTriggeredNeighbors: 2,
    neighborDelta: 0.3,
    sustainDelta: 0.15,
    sustainCurrent: 0.12,
    strongBypassShindo: 3.8,
    isolatedStrongBypassShindo: 4.8,
    minConsecutiveTriggerFrames: 1,
    abnormalHighShindo: 3.0,
    abnormalFlatDelta: 1.0,
    abnormalIsolatedShindo: 4.5,
    maxNeighbors: 24,
    tentativeEventMinPoints: 2,
    confirmedEventMinPoints: 4,
    confirmedEventMinStrongPoints: 1,
    confirmedEventMinShindo: 0.8,
    eventFreshWindowMs: 3500,
    minEventPointsForDisplay: 2,
    minEventPointsForAutoFocus: 3,
    soundCooldownMs: 2500,
};

const kyoshinDetectState = {
    histories: [],
    candidateStreaks: [],
    pointEventIds: [],
    pointExpiresAtMs: [],
    areaFeatures: [],
    neighborMap: [],
    events: new Map(),
    nextEventId: 1,
    lastSoundAtMs: 0,
    lastFocusedEventId: null,
    lastFocusedAtMs: 0,
    cameraBeforeFocus: null,
};

function initKyoshinDetection(points) {
    kyoshinDetectState.areaFeatures = buildKyoshinAreas();
    assignKyoshinAreas(points);
    kyoshinDetectState.histories = points.map(() => []);
    kyoshinDetectState.candidateStreaks = points.map(() => 0);
    kyoshinDetectState.pointEventIds = points.map(() => null);
    kyoshinDetectState.pointExpiresAtMs = points.map(() => 0);
    kyoshinDetectState.events = new Map();
    kyoshinDetectState.nextEventId = 1;
    kyoshinDetectState.lastSoundAtMs = 0;
    kyoshinDetectState.lastFocusedEventId = null;
    kyoshinDetectState.lastFocusedAtMs = 0;
    kyoshinDetectState.cameraBeforeFocus = null;
    kyoshinDetectState.neighborMap = buildKyoshinNeighbors(points);
    updateKyoshinStatus(null);
}

function getKyoshinPointName(point) {
    if (!point) return '';

    const station = stationMap[point.name];
    const prefectureName = String(station?.pref?.name || '').trim();
    const fallbackPrefectureName = String(point.region || '').trim();
    const displayPrefectureName = prefectureName || fallbackPrefectureName;
    const pointName = String(point.name || '').trim();
    if (displayPrefectureName && pointName) return `${displayPrefectureName} ${pointName}`;
    if (pointName) return pointName;

    const areaName = String(station?.area?.name || '').trim();
    if (areaName) return areaName;

    return fallbackPrefectureName;
}

function buildKyoshinAreas() {
    if (!japan_data || !Array.isArray(japan_data.features)) return [];

    return japan_data.features
        .map((feature) => {
            const geometry = feature?.geometry;
            const areaName = String(feature?.properties?.name || '').trim();
            if (!geometry || !areaName) return null;

            const bounds = getGeometryBounds(geometry);
            if (!bounds) return null;

            return {
                areaName,
                geometry,
                minLon: bounds.minLon,
                maxLon: bounds.maxLon,
                minLat: bounds.minLat,
                maxLat: bounds.maxLat,
            };
        })
        .filter(Boolean);
}

function assignKyoshinAreas(points) {
    if (!Array.isArray(points) || points.length === 0) return;

    points.forEach((point) => {
        point.areaName = resolveKyoshinArea(point);
    });
}

function resolveKyoshinArea(point) {
    if (!point) return '';

    const station = stationMap[point.name];
    const stationAreaName = String(station?.area?.name || '').trim();
    if (stationAreaName) return stationAreaName;

    const lat = Number(point.lat);
    const lon = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return String(point.region || '').trim();
    }

    const matchedFeature = kyoshinDetectState.areaFeatures.find((feature) => {
        if (!feature) return false;
        if (lon < feature.minLon || lon > feature.maxLon || lat < feature.minLat || lat > feature.maxLat) {
            return false;
        }
        return isPointInGeometry(lon, lat, feature.geometry);
    });

    if (matchedFeature?.areaName) return matchedFeature.areaName;
    return String(point.region || '').trim();
}

function getGeometryBounds(geometry) {
    const coords = geometry?.coordinates;
    if (!Array.isArray(coords)) return null;

    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    const visit = (value) => {
        if (!Array.isArray(value) || value.length === 0) return;
        if (typeof value[0] === 'number' && typeof value[1] === 'number') {
            const lon = Number(value[0]);
            const lat = Number(value[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            return;
        }
        value.forEach(visit);
    };

    visit(coords);
    if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
        return null;
    }

    return { minLon, maxLon, minLat, maxLat };
}

function isPointInGeometry(lon, lat, geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return false;

    if (geometry.type === 'Polygon') {
        return isPointInPolygonRings(lon, lat, geometry.coordinates);
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some((polygon) => isPointInPolygonRings(lon, lat, polygon));
    }
    return false;
}

function isPointInPolygonRings(lon, lat, rings) {
    if (!Array.isArray(rings) || rings.length === 0) return false;
    if (!isPointInRing(lon, lat, rings[0])) return false;

    for (let i = 1; i < rings.length; i += 1) {
        if (isPointInRing(lon, lat, rings[i])) return false;
    }
    return true;
}

function isPointInRing(lon, lat, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;

    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const xi = Number(ring[i]?.[0]);
        const yi = Number(ring[i]?.[1]);
        const xj = Number(ring[j]?.[0]);
        const yj = Number(ring[j]?.[1]);
        if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;

        const intersects = ((yi > lat) !== (yj > lat))
            && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function buildKyoshinNeighbors(points) {
    const cellDeg = Math.max(0.1, KYOSHIN_DETECT_CONFIG.neighborRadiusKm / 111);
    const grid = new Map();

    points.forEach((point, index) => {
        const gx = Math.floor(point.lon / cellDeg);
        const gy = Math.floor(point.lat / cellDeg);
        const key = `${gx}:${gy}`;
        if (!grid.has(key)) {
            grid.set(key, []);
        }
        grid.get(key).push(index);
    });

    const neighbors = points.map(() => []);

    points.forEach((point, index) => {
        const gx = Math.floor(point.lon / cellDeg);
        const gy = Math.floor(point.lat / cellDeg);
        const candidates = [];

        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                const key = `${gx + dx}:${gy + dy}`;
                const cellPoints = grid.get(key);
                if (!cellPoints) continue;
                candidates.push(...cellPoints);
            }
        }

        const around = [];
        candidates.forEach((candidateIndex) => {
            if (candidateIndex === index) return;
            const candidate = points[candidateIndex];
            const distanceKm = haversineDistanceKm(point.lat, point.lon, candidate.lat, candidate.lon);
            if (distanceKm > KYOSHIN_DETECT_CONFIG.neighborRadiusKm) return;
            around.push({ index: candidateIndex, distanceKm });
        });

        around.sort((a, b) => a.distanceKm - b.distanceKm);
        neighbors[index] = around
            .slice(0, KYOSHIN_DETECT_CONFIG.maxNeighbors)
            .map((item) => item.index);
    });

    return neighbors;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateKyoshinHistory(shindoResult, colorResult) {
    const pointMetrics = shindoResult.map((_, index) => ({
        valid: false,
        current: null,
        delta: 0,
        sampleCount: 0,
    }));

    for (let i = 0; i < shindoResult.length; i += 1) {
        const color = colorResult[i];
        const shindo = Number(shindoResult[i]);
        const isValid = Boolean(color) && Number.isFinite(shindo) && shindo >= -3 && shindo <= 7;

        if (!isValid) continue;

        const history = kyoshinDetectState.histories[i];
        history.push(shindo);
        if (history.length > KYOSHIN_DETECT_CONFIG.historySeconds) {
            history.shift();
        }

        const minVal = Math.min(...history);
        const maxVal = Math.max(...history);
        pointMetrics[i] = {
            valid: true,
            current: shindo,
            delta: maxVal - minVal,
            sampleCount: history.length,
        };
    }

    return pointMetrics;
}

function classifyKyoshin(maxShindo) {
    if (!Number.isFinite(maxShindo)) return { rank: 0, label: '不明' };
    if (maxShindo >= 4.5) return { rank: 5, label: '強い揺れ' };
    if (maxShindo >= 2.5) return { rank: 4, label: 'やや強い揺れ' };
    if (maxShindo >= 0.5) return { rank: 3, label: '弱い揺れ' };
    if (maxShindo >= -1.0) return { rank: 2, label: '弱い揺れ' };
    if (maxShindo >= -1.5) return { rank: 1, label: '微弱な揺れ' };
    return { rank: 0, label: '微弱' };
}

function getKyoshinEventTtl(maxShindo) {
    if (!Number.isFinite(maxShindo)) return 25000;
    if (maxShindo >= 4.5) return 90000;
    if (maxShindo >= 2.5) return 70000;
    if (maxShindo >= 0.5) return 50000;
    return 30000;
}

function getKyoshinPointTtl(currentShindo) {
    if (!Number.isFinite(currentShindo)) return 15000;
    if (currentShindo >= 4.5) return 90000;
    if (currentShindo >= 2.5) return 70000;
    if (currentShindo >= 0.5) return 50000;
    if (currentShindo >= -1.0) return 30000;
    return 20000;
}

function getOrCreateEvent(nowMs) {
    const id = kyoshinDetectState.nextEventId;
    kyoshinDetectState.nextEventId += 1;
    const event = {
        id,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        expiresAtMs: nowMs + 30000,
        isConfirmed: false,
        confirmedAtMs: null,
        pointIds: new Set(),
        maxShindo: -3,
        strengthRank: 0,
        strengthLabel: '微弱',
        announcedRank: 0,
        activePointCount: 0,
        strongPointCount: 0,
        centerLat: null,
        centerLon: null,
    };
    kyoshinDetectState.events.set(id, event);
    return event;
}

function mergeKyoshinEvents(targetId, sourceId) {
    if (targetId === sourceId) return;

    const target = kyoshinDetectState.events.get(targetId);
    const source = kyoshinDetectState.events.get(sourceId);
    if (!target || !source) return;

    source.pointIds.forEach((pointId) => {
        target.pointIds.add(pointId);
        kyoshinDetectState.pointEventIds[pointId] = targetId;
    });

    target.maxShindo = Math.max(target.maxShindo, source.maxShindo);
    if (source.strengthRank > target.strengthRank) {
        target.strengthRank = source.strengthRank;
        target.strengthLabel = source.strengthLabel;
    }
    target.announcedRank = Math.max(target.announcedRank, source.announcedRank);
    target.isConfirmed = target.isConfirmed || source.isConfirmed;
    target.confirmedAtMs = Number.isFinite(target.confirmedAtMs) && Number.isFinite(source.confirmedAtMs)
        ? Math.min(target.confirmedAtMs, source.confirmedAtMs)
        : (target.confirmedAtMs ?? source.confirmedAtMs);
    target.createdAtMs = Math.min(target.createdAtMs, source.createdAtMs);
    target.updatedAtMs = Math.max(target.updatedAtMs, source.updatedAtMs);
    target.expiresAtMs = Math.max(target.expiresAtMs, source.expiresAtMs);

    kyoshinDetectState.events.delete(sourceId);
}

function processKyoshin(nowMs, points, shindoResult, colorResult) {
    if (!Array.isArray(points) || points.length === 0) {
        updateKyoshinStatus(null);
        return;
    }

    const metrics = updateKyoshinHistory(shindoResult, colorResult);
    const triggeredPointIds = [];

    for (let i = 0; i < points.length; i += 1) {
        const metric = metrics[i];
        if (!metric.valid) {
            kyoshinDetectState.candidateStreaks[i] = 0;
            continue;
        }

        if (metric.sampleCount < KYOSHIN_DETECT_CONFIG.minHistorySamples) {
            kyoshinDetectState.candidateStreaks[i] = 0;
            continue;
        }

        const around = kyoshinDetectState.neighborMap[i] || [];
        let candidateNeighbors = 0;
        let triggeredNeighbors = 0;
        let activeNeighbors = 0;

        around.forEach((neighborId) => {
            const neighborMetric = metrics[neighborId];
            if (!neighborMetric?.valid) return;
            const isNeighborActive = Number(kyoshinDetectState.pointExpiresAtMs[neighborId]) > nowMs;
            if (isNeighborActive) {
                activeNeighbors += 1;
            }
            if (neighborMetric.delta >= KYOSHIN_DETECT_CONFIG.candidateNeighborDelta
                && neighborMetric.current >= KYOSHIN_DETECT_CONFIG.candidateCurrent) {
                candidateNeighbors += 1;
            }
            if (neighborMetric.delta < KYOSHIN_DETECT_CONFIG.neighborDelta) return;
            if (neighborMetric.current < KYOSHIN_DETECT_CONFIG.triggerCurrent) return;
            triggeredNeighbors += 1;
        });

        const isPointActive = Number(kyoshinDetectState.pointExpiresAtMs[i]) > nowMs;
        const abnormalCurrentThreshold = around.length === 0
            ? KYOSHIN_DETECT_CONFIG.abnormalIsolatedShindo
            : KYOSHIN_DETECT_CONFIG.abnormalHighShindo;
        const isHighFlatAnomaly = !isPointActive
            && metric.current >= abnormalCurrentThreshold
            && metric.delta < KYOSHIN_DETECT_CONFIG.abnormalFlatDelta
            && triggeredNeighbors === 0
            && activeNeighbors === 0;
        if (isHighFlatAnomaly) continue;

        const candidateTrigger = metric.delta >= KYOSHIN_DETECT_CONFIG.candidateDelta
            && metric.current >= KYOSHIN_DETECT_CONFIG.candidateCurrent
            && candidateNeighbors >= KYOSHIN_DETECT_CONFIG.minCandidateNeighbors;
        const mainTrigger = metric.delta >= KYOSHIN_DETECT_CONFIG.triggerDelta
            && metric.current >= KYOSHIN_DETECT_CONFIG.triggerCurrent
            && triggeredNeighbors >= KYOSHIN_DETECT_CONFIG.minTriggeredNeighbors;
        const strongBypass = metric.current >= KYOSHIN_DETECT_CONFIG.strongBypassShindo
            && triggeredNeighbors >= 1;
        const isolatedStrongBypass = metric.current >= KYOSHIN_DETECT_CONFIG.isolatedStrongBypassShindo
            && around.length === 0;
        const keepAlive = isPointActive
            && metric.current >= KYOSHIN_DETECT_CONFIG.sustainCurrent
            && (metric.delta >= KYOSHIN_DETECT_CONFIG.sustainDelta || activeNeighbors > 0 || triggeredNeighbors > 0);

        const candidate = candidateTrigger || mainTrigger || strongBypass || isolatedStrongBypass || keepAlive;
        kyoshinDetectState.candidateStreaks[i] = candidate
            ? (kyoshinDetectState.candidateStreaks[i] + 1)
            : 0;

        const hasReachedTrigger = kyoshinDetectState.candidateStreaks[i] >= KYOSHIN_DETECT_CONFIG.minConsecutiveTriggerFrames;
        if (hasReachedTrigger || keepAlive) {
            kyoshinDetectState.pointExpiresAtMs[i] = Math.max(
                Number(kyoshinDetectState.pointExpiresAtMs[i]) || 0,
                nowMs + getKyoshinPointTtl(metric.current)
            );
            triggeredPointIds.push(i);
        }
    }

    triggeredPointIds.forEach((pointId) => {
        const ownEventId = kyoshinDetectState.pointEventIds[pointId];
        const relatedEventIds = new Set();
        if (ownEventId && kyoshinDetectState.events.has(ownEventId)) {
            relatedEventIds.add(ownEventId);
        }

        const around = kyoshinDetectState.neighborMap[pointId] || [];
        around.forEach((neighborId) => {
            const neighborEventId = kyoshinDetectState.pointEventIds[neighborId];
            if (!neighborEventId || !kyoshinDetectState.events.has(neighborEventId)) return;
            relatedEventIds.add(neighborEventId);
        });

        let targetEvent = null;
        relatedEventIds.forEach((eventId) => {
            const event = kyoshinDetectState.events.get(eventId);
            if (!event) return;
            if (!targetEvent || event.createdAtMs < targetEvent.createdAtMs) {
                targetEvent = event;
            }
        });

        if (!targetEvent) {
            targetEvent = getOrCreateEvent(nowMs);
        }

        relatedEventIds.forEach((eventId) => {
            if (eventId !== targetEvent.id) {
                mergeKyoshinEvents(targetEvent.id, eventId);
            }
        });

        targetEvent.pointIds.add(pointId);
        kyoshinDetectState.pointEventIds[pointId] = targetEvent.id;

        const shindo = Number(shindoResult[pointId]);
        if (Number.isFinite(shindo)) {
            targetEvent.maxShindo = Math.max(targetEvent.maxShindo, shindo);
            const strength = classifyKyoshin(targetEvent.maxShindo);
            targetEvent.strengthRank = strength.rank;
            targetEvent.strengthLabel = strength.label;
        }

        targetEvent.updatedAtMs = nowMs;
        targetEvent.expiresAtMs = nowMs + getKyoshinEventTtl(targetEvent.maxShindo);
    });

    kyoshinDetectState.events.forEach((event, eventId) => {
        if (!event) return;

        let latSum = 0;
        let lonSum = 0;
        let count = 0;
        let strongPointCount = 0;
        let currentMaxShindo = -3;
        const pointNameCounter = new Map();
        const expiredPointIds = [];
        event.pointIds.forEach((pointId) => {
            if (Number(kyoshinDetectState.pointExpiresAtMs[pointId]) <= nowMs) {
                expiredPointIds.push(pointId);
                if (kyoshinDetectState.pointEventIds[pointId] === eventId) {
                    kyoshinDetectState.pointEventIds[pointId] = null;
                }
                return;
            }
            const point = points[pointId];
            if (!point) return;
            const shindo = Number(shindoResult[pointId]);
            latSum += point.lat;
            lonSum += point.lon;
            count += 1;
            if (Number.isFinite(shindo)) {
                currentMaxShindo = Math.max(currentMaxShindo, shindo);
            }
            if (Number.isFinite(shindo) && shindo >= KYOSHIN_DETECT_CONFIG.confirmedEventMinShindo) {
                strongPointCount += 1;
            }

            const pointName = getKyoshinPointName(point);
            if (!pointName) return;
            pointNameCounter.set(pointName, (pointNameCounter.get(pointName) || 0) + 1);
        });

        expiredPointIds.forEach((pointId) => {
            event.pointIds.delete(pointId);
        });

        event.centerLat = count > 0 ? latSum / count : null;
        event.centerLon = count > 0 ? lonSum / count : null;
        event.activePointCount = count;
        event.strongPointCount = strongPointCount;
        event.maxShindo = count > 0 ? currentMaxShindo : -3;
        const liveStrength = classifyKyoshin(event.maxShindo);
        event.strengthRank = liveStrength.rank;
        event.strengthLabel = liveStrength.label;
        event.areaNames = Array.from(pointNameCounter.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
            .map(([name]) => name);
        const isFresh = nowMs - event.updatedAtMs <= KYOSHIN_DETECT_CONFIG.eventFreshWindowMs;
        const shouldConfirm = isFresh
            && event.activePointCount >= KYOSHIN_DETECT_CONFIG.confirmedEventMinPoints
            && event.strongPointCount >= KYOSHIN_DETECT_CONFIG.confirmedEventMinStrongPoints;
        if (shouldConfirm && !event.isConfirmed) {
            event.isConfirmed = true;
            event.confirmedAtMs = nowMs;
        }
    });

    const removedEventIds = [];
    kyoshinDetectState.events.forEach((event, eventId) => {
        if (event.pointIds.size === 0) {
            removedEventIds.push(eventId);
            return;
        }
        if (event.expiresAtMs > nowMs) return;
        removedEventIds.push(eventId);
    });

    removedEventIds.forEach((eventId) => {
        const event = kyoshinDetectState.events.get(eventId);
        if (!event) return;
        event.pointIds.forEach((pointId) => {
            if (kyoshinDetectState.pointEventIds[pointId] === eventId) {
                kyoshinDetectState.pointEventIds[pointId] = null;
            }
        });
        kyoshinDetectState.events.delete(eventId);
    });

    let primaryEvent = null;
    kyoshinDetectState.events.forEach((event) => {
        if (!primaryEvent) {
            primaryEvent = event;
            return;
        }

        if (event.isConfirmed !== primaryEvent.isConfirmed) {
            if (event.isConfirmed) primaryEvent = event;
            return;
        }

        if (event.strengthRank > primaryEvent.strengthRank) {
            primaryEvent = event;
            return;
        }

        if (event.strengthRank === primaryEvent.strengthRank && event.maxShindo > primaryEvent.maxShindo) {
            primaryEvent = event;
            return;
        }

        if (event.strengthRank === primaryEvent.strengthRank
            && event.maxShindo === primaryEvent.maxShindo
            && event.updatedAtMs > primaryEvent.updatedAtMs) {
            primaryEvent = event;
        }
    });

    maybePlayKyoshinSound(primaryEvent, nowMs);
    maybeFocusKyoshin(primaryEvent, nowMs);
    maybeRestoreKyoshinCam(primaryEvent);
    updateKyoshinStatus(primaryEvent);
}

function maybeFocusKyoshin(event, nowMs) {
    if (!event) return;
    if (!event.isConfirmed && !KYOSHIN_VIEW_CONFIG.showCandidates) return;
    if (event.pointIds.size < KYOSHIN_DETECT_CONFIG.tentativeEventMinPoints) return;

    const lat = Number(event.centerLat);
    const lon = Number(event.centerLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (kyoshinDetectState.lastFocusedEventId === event.id) return;

    if (!kyoshinDetectState.cameraBeforeFocus) {
        const center = map.getCenter();
        kyoshinDetectState.cameraBeforeFocus = {
            lat: center.lat,
            lon: center.lng,
            zoom: map.getZoom(),
        };
    }

    kyoshinDetectState.lastFocusedEventId = event.id;
    kyoshinDetectState.lastFocusedAtMs = nowMs;

    const targetZoom = Math.max(map.getZoom(), 7);
    map.flyTo([lat, lon], targetZoom, { animate: true, duration: 0.6 });
}

function maybeRestoreKyoshinCam(event) {
    if (event && event.pointIds.size >= KYOSHIN_DETECT_CONFIG.tentativeEventMinPoints) return;

    const previousCamera = kyoshinDetectState.cameraBeforeFocus;
    if (!previousCamera) return;

    map.flyTo([previousCamera.lat, previousCamera.lon], previousCamera.zoom, {
        animate: true,
        duration: 0.6,
    });

    kyoshinDetectState.cameraBeforeFocus = null;
    kyoshinDetectState.lastFocusedEventId = null;
    kyoshinDetectState.lastFocusedAtMs = 0;
}

function maybePlayKyoshinSound(event, nowMs) {
    if (!event) return;
    if (!event.isConfirmed) return;
    if (event.pointIds.size < KYOSHIN_DETECT_CONFIG.minEventPointsForDisplay) return;
    if (!userInteracted) return;
    if (event.strengthRank <= event.announcedRank) return;
    if (nowMs - kyoshinDetectState.lastSoundAtMs < KYOSHIN_DETECT_CONFIG.soundCooldownMs) return;

    event.announcedRank = event.strengthRank;
    kyoshinDetectState.lastSoundAtMs = nowMs;
    playShakeSound();
}

function isDisplayableKyoshinEvent(event) {
    if (!event) return false;
    if (event.pointIds.size < KYOSHIN_DETECT_CONFIG.tentativeEventMinPoints) return false;
    if (event.isConfirmed) return true;
    return KYOSHIN_VIEW_CONFIG.showCandidates;
}

function updateKyoshinStatus(event) {
    const card = document.getElementById('kyoshin-detect-card');
    const text = document.getElementById('kyoshin-detect-status-text');
    const level = document.getElementById('kyoshin-detect-level');
    const panel = document.getElementById('kyoshin-detect-panel');
    const areas = document.getElementById('kyoshin-detect-areas');

    if (!card || !text || !level || !panel || !areas) return;

    text.classList.remove('kyoshin-detect-idle', 'kyoshin-detect-active', 'kyoshin-detect-strong');

    if (!isDisplayableKyoshinEvent(event)) {
        card.hidden = true;
        text.classList.add('kyoshin-detect-idle');
        text.textContent = '揺れ未検知';
        level.textContent = '待機中';
        panel.hidden = true;
        areas.innerHTML = '';
        return;
    }

    card.hidden = false;
    const pointCount = event.pointIds.size;
    const strongClass = event.isConfirmed && event.strengthRank >= 4 ? 'kyoshin-detect-strong' : 'kyoshin-detect-active';
    text.classList.add(strongClass);
    text.textContent = event.isConfirmed ? `揺れ検知中 (${pointCount}点)` : `揺れを監視中 (${pointCount}点)`;
    level.textContent = event.isConfirmed
        ? `${event.strengthLabel}`
        : `候補 / ${event.strengthLabel}`;

    const areaNames = Array.isArray(event.areaNames) ? event.areaNames : [];
    areas.innerHTML = areaNames.slice(0, 100)
        .map((name) => `<p class="kyoshin-detect-area-item">${name}</p>`)
        .join('');
    panel.hidden = areaNames.length === 0;
}

function getActiveKyoshinPoints() {
    const activePointIds = new Set();

    kyoshinDetectState.events.forEach((event) => {
        if (!isDisplayableKyoshinEvent(event)) return;
        event.pointIds.forEach((pointId) => {
            activePointIds.add(pointId);
        });
    });

    return activePointIds;
}

async function fetchLatestTime() {
    const url = buildKmoniUrl(`/webservice/server/pros/latest.json?_=${Date.now()}`);
    const res = await fetchViaWorkerProxy(url);
    const json = await res.json();
    latestTime = Math.floor(new Date(json.latest_time.replace(/\//g, '-')).getTime() / 1000);
}

async function initKyoshin() {
    kyoshinPoints = await loadPoints();
    initKyoshinDetection(kyoshinPoints);
    if (!CONFIG.isTest) {
        await fetchLatestTime();
        lastSync = latestTime;
    }
    console.log('[強震モニタ] 初期化完了, points:', kyoshinPoints.length);

    map.on('zoomend', () => {
        if (window._lastColorResult) {
            drawKyoshinPoints(kyoshinPoints, kyoshinMode === 'shindo'
                ? window._lastColorResult
                : window._lastPgaColorResult);
        }
    });

    document.getElementById('kyoshin-shindo-btn').addEventListener('click', () => {
        kyoshinMode = 'shindo';
        document.getElementById('kyoshin-shindo-btn').classList.add('active');
        document.getElementById('kyoshin-pga-btn').classList.remove('active');
        if (window._lastColorResult) {
            drawKyoshinPoints(kyoshinPoints, window._lastColorResult);
        }
    });

    document.getElementById('kyoshin-pga-btn').addEventListener('click', () => {
        kyoshinMode = 'pga';
        document.getElementById('kyoshin-pga-btn').classList.add('active');
        document.getElementById('kyoshin-shindo-btn').classList.remove('active');
        if (window._lastPgaColorResult) {
            drawKyoshinPoints(kyoshinPoints, window._lastPgaColorResult);
        }
    });

    const kyoshinCandidateToggle = document.getElementById('kyoshin-show-candidates-toggle');
    if (kyoshinCandidateToggle) {
        kyoshinCandidateToggle.checked = KYOSHIN_VIEW_CONFIG.showCandidates;
        kyoshinCandidateToggle.addEventListener('change', () => {
            KYOSHIN_VIEW_CONFIG.showCandidates = kyoshinCandidateToggle.checked;
            if (window._lastColorResult || window._lastPgaColorResult) {
                drawKyoshinPoints(kyoshinPoints, kyoshinMode === 'shindo'
                    ? window._lastColorResult
                    : window._lastPgaColorResult);
            }
        });
    }

    setInterval(async () => {
        const nowMs = Date.now();
        if (!CONFIG.isTest && latestTime - lastSync > 3600) {
            await fetchLatestTime();
            lastSync = latestTime;
        } else if (!CONFIG.isTest) {
            latestTime += 1;
        }
    const { shindoResult, pgaResult, colorResult, pgaColorResult } = await updateImages(latestTime, kyoshinPoints);
    processKyoshin(nowMs, kyoshinPoints, shindoResult, colorResult);
    window._lastShindoResult = shindoResult;
    window._lastColorResult = colorResult;
    window._lastPgaColorResult = pgaColorResult;
    drawKyoshinPoints(kyoshinPoints, kyoshinMode === 'shindo' ? colorResult : pgaColorResult);
        setLastDataUpdateTime(CONFIG.isTest ? CONFIG.getSimulatedTime() : new Date(latestTime * 1000));
        console.log('[強震モニタ] 更新:', latestTime, shindoResult.slice(0, 5));
    }, 1000);
}

async function loadPoints() {
    const res = await fetch('./data/raw/point.csv');
    const text = await res.text();
    const lines = text.split('\n').slice(1);
    const points = [];
    for (const line of lines) {
        const cols = line.split(',');
        if (cols.length < 9) continue;
        const isSuspended = cols[2].trim().toLowerCase() === 'true';
        const code = String(cols[1] || '').trim();
        const name = String(cols[3] || '').trim();
        const region = String(cols[4] || '').trim();
        const lat = parseFloat(cols[5]);
        const lon = parseFloat(cols[6]);
        const x = parseInt(cols[7]);
        const y = parseInt(cols[8]);
        if (isNaN(x) || isNaN(y) || isNaN(lat) || isNaN(lon)) continue;
        points.push({ x, y, suspended: isSuspended, lat, lon, code, name, region });
    }
    return points;
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max, s = max === 0 ? 0 : (max - min) / max;
    let h = 0;
    if (max !== min) {
        if (max === r) h = (g - b) / (max - min) / 6;
        else if (max === g) h = ((b - r) / (max - min) + 2) / 6;
        else h = ((r - g) / (max - min) + 4) / 6;
        if (h < 0) h += 1;
    }
    return { h, s, v };
}

function color2position(r, g, b) {
    const { h, s, v } = rgbToHsv(r, g, b);
    if (!(v > 0.05 && s > 0.75)) return null;
    let p;
    if (h > 0.1476) {
        p = 280.31*(h**6) - 916.05*(h**5) + 1142.6*(h**4)
            - 709.95*(h**3) + 234.65*(h**2) - 40.27*h + 3.2217;
    } else if (0.001 < h && h <= 0.1476) {
        p = 151.4*(h**4) - 49.32*(h**3) + 6.753*(h**2) - 2.481*h + 0.9033;
    } else {
        p = -0.005171*(v**2) - 0.3282*v + 1.2236;
    }
    return Math.max(p, 0);
}

function drawKyoshinPoints(points, colorResult) {
    if (!Array.isArray(points) || !Array.isArray(colorResult)) return;
    const detectedPointIds = getActiveKyoshinPoints();
    const isEewIssued = isEewIssuedNow();
    const hasDetectedPoints = detectedPointIds.size > 0;
    maybeAutoFitDetectedPointsForEew(points, detectedPointIds, isEewIssued);
    const isCalmRealtime = !isEewIssued && !hasDetectedPoints;
    const suppressDetectedVisuals = isPastEqViewDuringEew();
    const isFocusingEew = isEewIssued && !suppressDetectedVisuals;
    const isFocusingKyoshin = Boolean(kyoshinDetectState.cameraBeforeFocus || kyoshinDetectState.lastFocusedEventId != null);
    const shouldUseEmphasisOpacity = isFocusingEew || isFocusingKyoshin;
    const renderItems = [];

    points.forEach(({ lat, lon, suspended }, i) => {
        if (suspended) return;
        const color = colorResult[i];
        if (!color) return;

        const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
        if (!match) return;
        const [, r, g, b] = match.map(Number);
        if (r < 10 && g < 10 && b < 10) return;

        const isDetected = detectedPointIds.has(i);
        const showDetectedVisuals = isDetected && !suppressDetectedVisuals;
        const radius = getKyoshinRadius(showDetectedVisuals);
        const baseOpacity = getKyoshinOpacity(r, g, b);
        const calmOpacity = Math.min(0.85, Math.max(0.05, baseOpacity * 0.7));
        const shouldMakeOpaque = shouldUseEmphasisOpacity && (isEewIssued || showDetectedVisuals);
        const fillOpacity = isCalmRealtime
            ? calmOpacity
            : (suppressDetectedVisuals
                ? baseOpacity
            : (shouldMakeOpaque ? 1 : baseOpacity));
        const strokeColor = isDetected ? '#f3e44c' : color;
        const strokeWeight = isDetected ? 2.4 : 0;
        const shindoFromCache = Number(window._lastShindoResult?.[i]);
        let renderShindo = shindoFromCache;
        if (!Number.isFinite(renderShindo)) {
            const pos = color2position(r, g, b);
            renderShindo = Number.isFinite(pos) ? (10.0 * pos - 3.0) : -999;
        }

        renderItems.push({
            i,
            lat,
            lon,
            color,
            r,
            g,
            b,
            radius,
            fillOpacity,
            strokeColor,
            strokeWeight,
            isDetected,
            showDetectedVisuals,
            renderShindo,
        });
    });

    renderItems
        .sort((a, b) => a.renderShindo - b.renderShindo || a.i - b.i)
        .forEach((item) => {
            const useIcon = CONFIG.isTest && kyoshinMode === 'shindo' && !suppressDetectedVisuals && !isCalmRealtime;
            item.useIcon = useIcon;
            if (useIcon) {
                item.iconName = getKyoshinPointIconName(item.renderShindo);
                item.iconSize = getKyoshinPointIconSize(item.isDetected);
            }
        });

    if (kyoshinCanvasLayer) {
        kyoshinCanvasLayer.setRenderItems(renderItems);
    }
}

function maybeAutoFitDetectedPointsForEew(points, detectedPointIds, isEewIssued) {
    if (!isEewIssued || !(detectedPointIds instanceof Set) || detectedPointIds.size === 0) {
        kyoshinAutoViewState.lastDetectedSignature = '';
        kyoshinAutoViewState.lastMovedAt = 0;
        kyoshinAutoViewState.lastTargetCenter = null;
        kyoshinAutoViewState.lastTargetSpanKm = null;
        return;
    }

    const sortedIds = Array.from(detectedPointIds).sort((a, b) => a - b);
    const signature = sortedIds.join(',');
    if (signature === kyoshinAutoViewState.lastDetectedSignature) return;

    const bounds = L.latLngBounds([]);
    sortedIds.forEach((pointId) => {
        const point = points?.[pointId];
        if (!point) return;
        const lat = Number(point.lat);
        const lon = Number(point.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        bounds.extend([lat, lon]);
    });
    if (!bounds.isValid()) return;

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const isSinglePoint = northEast.lat === southWest.lat && northEast.lng === southWest.lng;
    const targetCenter = bounds.getCenter();
    const currentCenter = map.getCenter();
    const centerMoveKm = map.distance(currentCenter, targetCenter) / 1000;
    const targetZoom = isSinglePoint
        ? Math.max(map.getZoom(), 8)
        : map.getBoundsZoom(bounds, false, [70, 70]);
    const zoomDelta = Math.abs(map.getZoom() - targetZoom);
    const spanKm = isSinglePoint ? 0 : (southWest.distanceTo(northEast) / 1000);
    const prevSpanKm = Number(kyoshinAutoViewState.lastTargetSpanKm);
    const spanChangeRatio = prevSpanKm > 0
        ? Math.abs(spanKm - prevSpanKm) / prevSpanKm
        : 1;
    const now = Date.now();
    const elapsedSinceMove = now - Number(kyoshinAutoViewState.lastMovedAt || 0);
    const isFirstAutoMove = !kyoshinAutoViewState.lastMovedAt;
    const hasMeaningfulChange = isFirstAutoMove
        || centerMoveKm >= KYOSHIN_AUTO_VIEW_CONFIG.minCenterMoveKm
        || zoomDelta >= KYOSHIN_AUTO_VIEW_CONFIG.minZoomDelta
        || spanChangeRatio >= KYOSHIN_AUTO_VIEW_CONFIG.minSpanChangeRatio;

    if (!hasMeaningfulChange) {
        kyoshinAutoViewState.lastDetectedSignature = signature;
        return;
    }
    if (!isFirstAutoMove && elapsedSinceMove < KYOSHIN_AUTO_VIEW_CONFIG.minIntervalMs) {
        return;
    }

    if (isSinglePoint) {
        map.flyTo(targetCenter, targetZoom, {
            animate: true,
            duration: 0.5,
        });
    } else {
        map.flyToBounds(bounds, {
            padding: [70, 70],
            maxZoom: 8,
            duration: 0.5,
        });
    }

    kyoshinAutoViewState.lastMovedAt = now;
    kyoshinAutoViewState.lastTargetCenter = targetCenter;
    kyoshinAutoViewState.lastTargetSpanKm = spanKm;
    kyoshinAutoViewState.lastDetectedSignature = signature;
}

function getKyoshinOpacity(r, g, b) {
    if (kyoshinMode !== 'shindo') return 0.2;

    const pos = color2position(r, g, b);
    if (pos == null) return 0.55;

    let shindo = 10.0 * pos - 3.0;
    if (!Number.isFinite(shindo)) return 0.55;

    shindo = Math.max(-3, Math.min(7, shindo));
    const normalized = (shindo + 3) / 10;

    return 0.00 + normalized * 1.5;
}

function getKyoshinRadius(isDetected = false) {
    const zoom = map.getZoom();
    let baseRadius = 3;
    if (zoom >= 11) baseRadius = 18;
    else if (zoom >= 10) baseRadius = 15;
    else if (zoom >= 8) baseRadius = 7;
    else if (zoom >= 7) baseRadius = 5;
    else if (zoom >= 6) baseRadius = 3;
    else if (zoom >= 4) baseRadius = 2;
    else if (zoom >= 2) baseRadius = 1;

    return isDetected ? Math.max(baseRadius + 1.5, baseRadius * 1.45) : baseRadius;
}

function getKyoshinPointIconName(shindo) {
    if (!Number.isFinite(shindo)) return 'intnull';
    if (shindo < 0.5) return 'intnull';
    if (shindo >= 6.5) return 'int7';
    if (shindo >= 6.0) return 'int65';
    if (shindo >= 5.5) return 'int60';
    if (shindo >= 5.0) return 'int55';
    if (shindo >= 4.5) return 'int50';
    if (shindo >= 3.5) return 'int4';
    if (shindo >= 2.5) return 'int3';
    if (shindo >= 1.5) return 'int2';
    if (shindo >= 0.5) return 'int1';
    return 'intnull';
}

function getKyoshinPointIconSize(isDetected = false) {
    const radius = getKyoshinRadius(isDetected);
    return Math.max(14, Math.round(radius * 2.9));
}

function getKyoshinPointIcon(shindo, isDetected = false) {
    const iconName = getKyoshinPointIconName(shindo);
    const size = getKyoshinPointIconSize(isDetected);
    const cacheKey = `${iconName}:${size}:${isDetected ? 'detected' : 'normal'}`;
    if (!iconCache[cacheKey]) {
        iconCache[cacheKey] = L.icon({
            iconUrl: `./assets/images/point_icons/_${iconName}.png`,
            iconSize: [size, size],
            iconAnchor: [Math.round(size / 2), Math.round(size / 2)],
            className: isDetected ? 'kyoshin-point-icon kyoshin-point-icon-detected' : 'kyoshin-point-icon',
        });
    }
    return iconCache[cacheKey];
}

initKyoshin();


