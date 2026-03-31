//=====
// 設定
const CONFIG = {
    isTest: new URLSearchParams(window.location.search).has("test"),

    get apiurl() {
        return this.isTest
        ? "./data/json/testNotoEq.json"
        : "https://eqf-worker.spdev-3141.workers.dev/api/p2pquake?codes=551&limit=40"
    },

    get updateInterval() {
        return this.isTest ? 10000 : 2000;
    },

    testBaseTime: new Date("2024-01-01T16:10:14"),
    _testStartedAt: Date.now(),

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
    toggleBtn.href = window.location.pathname + '?test';
    toggleBtn.textContent = 'テストモード';
}

const sidePanelElement = document.querySelector('.side-panel');
if (sidePanelElement) {
    sidePanelElement.appendChild(toggleBtn);
}

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
map.createPane("wavefront").style.zIndex = 350;
map.createPane("shingen").style.zIndex = 400;
map.createPane("tsunami_map").style.zIndex = 110;

let shindoLayer = L.layerGroup().addTo(map);
let shindoFilledLayer = L.layerGroup().addTo(map);
let JMAPointsJson = null;
let shindoCanvasLayer = null;
let hypoMarker = null;
let stationMap = {};
let japan_data = null;
let filled_list = {};
let selectedEarthquakeKey = null;
let lastRenderedEarthquakeKey = null;
let PROXY = 'https://eqf-kyoshin.spdev-3141.workers.dev/?url=';
let kyoshinMode = 'shindo'; // 'shindo' or 'pga'
let jma2001TravelTable = null;
let waveCurrentEq = null;
let wavePFrontLayer = null;
let waveSFrontLayer = null;
let waveTimerId = null;
let testModeEewEq = null;
let testModeEewRaw = null;
let liveEewEq = null;
let liveEewRaw = null;
let eewWs = null;
let eewReconnectTimer = null;
let latestUpdateRequestId = 0;
let latestAppliedUpdateRequestId = 0;
let lastPlayedEewFirstReportKey = null;
const WAVE_SVG_NS = 'http://www.w3.org/2000/svg';
const WAVE_S_GRADIENT_ID = 'wavefront-s-radial-gradient';

const WAVE_FRONT_CONFIG = {
    enabled: true,
    updateIntervalMs: 20,
    pColor: '#ffffff',
    sColor: '#ec211a',
    pOpacity: 0.85,
    sOpacity: 0.9,
    sFillOpacity: 0.35,
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
    finalHideAfterMs: 5 * 60 * 1000,
};

const shindoCanvasPane = map.createPane("shindo_canvas");
shindoCanvasPane.style.zIndex = 200;
shindoCanvasPane.style.overflow = 'visible';

const PolygonLayer_Style = {
    "color": "rgb(223, 223, 223)",
    "weight": 1.8,
    "opacity": 0.25,
    "fillColor": "#333333",
    "fillOpacity": 1
};

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

const iconNames = ["int1","int2","int3","int4","int50","int_","int55","int60","int65","int7"];

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
    },

    onAdd: function (map) {
        this._map = map;

        this._canvas = L.DomUtil.create('canvas', 'shindo-canvas-layer');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';

        map.getPane('shindo_canvas').appendChild(this._canvas);

        map.on('move zoom viewreset zoomend moveend', this._redraw, this);
        map.on('resize', this._resize, this);

        this._resize();
        return this;
    },

    onRemove: function (map) {
        this._canvas.remove();
        map.off('move zoom viewreset zoomend moveend', this._redraw, this);
        map.off('resize', this._resize, this);
    },

    setPoints: function (points) {
        this._points = points;
        this._redraw();
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
        this._redraw();
    },

    _redraw: function () {
        if (!this._map) return;

        this._updateCanvasPosition();

        const ctx = this._canvas.getContext('2d');
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

const iconMap = {
    10: "int1",
    20: "int2",
    30: "int3",
    40: "int4",
    45: "int50",
    46: "int_",
    50: "int55",
    55: "int60",
    60: "int65",
    70: "int7"
};

Promise.all([preloadIcons(), japanDataReady, loadStationData(), loadJma2001TravelTimeTable(), loadTestModeEewData()])
    .then(async ([, , , travelTable, eewData]) => {
        jma2001TravelTable = travelTable;
        testModeEewEq = eewData?.eq || null;
        testModeEewRaw = eewData?.raw || null;

        if (!CONFIG.isTest) {
            await loadInitialLiveEewSnapshot();
        }

        shindoCanvasLayer = new ShindoCanvasLayer();
        shindoCanvasLayer.addTo(map);

        initWaveFrontLayers();
        initLiveEewStream();

        updateData();
        setInterval(updateData, CONFIG.updateInterval);

        if (CONFIG.isTest) {
            initSamplePointShindo();
        }

    })
    .catch((error) => {
        console.error("Initial map data load failed:", error);
    });

const latestCard = document.querySelector('.latest-card');
if (latestCard) {
    latestCard.addEventListener('click', () => {
        selectedEarthquakeKey = null;
    });
}

function createShindoIcon(scale) {
    const scaleText = scaleMap[String(scale)] || "?";
    const fillColor = getShindoFillColor(scale);

    const match = scaleText.match(/^(\d)([^\d]*)$/);
    const number = match ? match[1] : scaleText;
    const modifier = match ? match[2] : "";

    const textColor = (number === "3" || number === "4") ? "#000" : "#fff";

    const html = `
        <div style="
            width: 22px; height: 22px;
            background: ${fillColor};
            border: 2px solid #fff;
            border-radius: 4px;
            display: flex; align-items: center; justify-content: center;
            font-weight: bold; font-size: 12px;
            color: ${textColor};
            box-shadow: 0 1px 3px rgba(0,0,0,0.5);
            line-height: 1;
        ">
            ${number}<span style="font-size:8px">${modifier}</span>
        </div>
    `;

    return L.divIcon({
        html: html,
        className: "",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -15]
    });
}

function updateData() {
    const requestId = ++latestUpdateRequestId;

    $.getJSON(CONFIG.apiurl)
        .done((data) => {
            if (requestId < latestAppliedUpdateRequestId) return;
            latestAppliedUpdateRequestId = requestId;

            try {
                const detailScaleData = Array.isArray(data)
                    ? data.filter(eq => eq?.issue?.type === "DetailScale")
                    : [];
                const latest = detailScaleData[0];

                if (!latest && !testModeEewEq) return;

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

                let displayEq = latest || testModeEewEq || liveEewEq;
                if (CONFIG.isTest && testModeEewEq) {
                    selectedEarthquakeKey = null;
                    displayEq = testModeEewEq;
                } else if (!CONFIG.isTest && liveEewEq) {
                    selectedEarthquakeKey = null;
                    displayEq = liveEewEq;
                } else if (selectedEarthquakeKey) {
                    const selectedEq = deduped.find(eq => getEarthquakeKey(eq) === selectedEarthquakeKey);
                    if (selectedEq) {
                        displayEq = selectedEq;
                    } else {
                        selectedEarthquakeKey = null;
                    }
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

                updateEewCard(CONFIG.isTest ? testModeEewRaw : liveEewRaw);

                const latestKey = latest ? getEarthquakeKey(latest) : "";
                const historyData = latest
                    ? deduped.filter(eq => getEarthquakeKey(eq) !== latestKey)
                    : [];

                updateEqHistory(historyData);
            } catch (error) {
                console.error('[updateData] Failed to render earthquake data', error);
            }
        })
        .fail((_, textStatus, errorThrown) => {
            console.warn('[updateData] Failed to fetch earthquake data', textStatus, errorThrown);
        });
}

function loadTestModeEewData() {
    if (!CONFIG.isTest) return Promise.resolve(null);

    return fetch('./data/json/testeew.json')
        .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then((json) => {
            const eq = convertTestEewToDetailScale(json);
            const announcedTime = parseJmaDateTime(json?.AnnouncedTime);
            const simulatedNow = announcedTime || eq?.earthquake?.time;

            if (simulatedNow) {
                CONFIG.testBaseTime = new Date(simulatedNow);
                CONFIG._testStartedAt = Date.now();
            }
            return { raw: json, eq };
        })
        .catch((error) => {
            console.warn('[test] Failed to load data/json/testeew.json', error);
            return null;
        });
}

function initLiveEewStream() {
    if (CONFIG.isTest || eewWs) return;

    try {
        eewWs = new WebSocket(EEW_WS_CONFIG.url);
    } catch (error) {
        console.warn('[eew] WebSocket initialize failed', error);
        scheduleLiveEewReconnect();
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
        scheduleLiveEewReconnect();
    });

    eewWs.addEventListener('error', (error) => {
        console.warn('[eew] WebSocket error', error);
    });
}

function scheduleLiveEewReconnect() {
    if (CONFIG.isTest || eewReconnectTimer) return;

    eewReconnectTimer = setTimeout(() => {
        eewReconnectTimer = null;
        initLiveEewStream();
    }, EEW_WS_CONFIG.reconnectMs);
}

function handleLiveEewMessage(payload) {
    if (!payload) return;

    let data;
    try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
        return;
    }

    if (!data || data.type !== 'jma_eew') return;

    liveEewRaw = data;

    if (data.isCancel) {
        clearLiveEewDisplay();
        return;
    }

    const eq = convertTestEewToDetailScale(data);
    if (!eq) return;

    liveEewEq = eq;
    renderEarthquakeOnMap(eq, { autoMove: false });
    updateEewCard(liveEewRaw);
    playEewSoundForFirstReport(data);
}

function isFirstEewReport(eew) {
    return Number(eew?.Serial) === 1;
}

function getEewFirstReportPlayKey(eew) {
    return [
        eew?.EventID,
        eew?.OriginTime,
        eew?.AnnouncedTime,
        eew?.Hypocenter,
    ].filter(Boolean).join('|');
}

function playEewSoundForFirstReport(eew) {
    if (!isFirstEewReport(eew)) return;

    const key = getEewFirstReportPlayKey(eew);
    if (key && key === lastPlayedEewFirstReportKey) return;

    lastPlayedEewFirstReportKey = key || String(Date.now());
    playEewSound();
}

function parseJmaDateTime(value) {
    if (!value) return null;
    return value.replace(/\//g, '-').replace(' ', 'T');
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

async function loadInitialLiveEewSnapshot() {
    try {
        const response = await fetch(EEW_HTTP_CONFIG.snapshotUrl, { cache: 'no-store' });
        if (!response.ok) return;

        const data = await response.json();
        if (!data || data.type !== 'jma_eew' || data.isCancel) {
            clearLiveEewDisplay();
            return;
        }

        if (isFinalReportExpired(data)) {
            clearLiveEewDisplay();
            return;
        }

        liveEewRaw = data;
        const eq = convertTestEewToDetailScale(data);
        if (!eq) return;

        liveEewEq = eq;
        renderEarthquakeOnMap(eq, { autoMove: false });
        updateEewCard(liveEewRaw);

        // 最終報から5分以内のスナップショットはページ表示時に通知音を鳴らす。
        if (data.isFinal) {
            playEewSound();
        }
    } catch (error) {
        console.warn('[eew] Initial snapshot load failed', error);
    }
}

function convertIntensityToScaleCode(maxIntensity) {
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

function convertTestEewToDetailScale(eew) {
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
            maxScale: convertIntensityToScaleCode(eew.MaxIntensity),
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
        areaScales: convertWarnAreaToAreaScales(eew.WarnArea),
    };
}

function convertWarnAreaToAreaScales(warnArea) {
    if (!Array.isArray(warnArea)) return [];

    const areaScaleMap = {};

    warnArea.forEach((area) => {
        const areaName = String(area?.Chiiki || '').trim();
        if (!areaName) return;

        const areaCode = AreaNameToCode(areaName);
        if (!areaCode) return;

        const scale = convertIntensityToScaleCode(area?.Shindo1);
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

function moveCameraToEarthquake(eq) {
    const latlngs = getEarthquakeLatLngs(eq);
    if (latlngs.length === 0) return;

    if (latlngs.length === 1) {
        map.flyTo(latlngs[0], 8, { animate: true, duration: 0.5 });
        return;
    }

    const bounds = L.latLngBounds(latlngs);
    if (!bounds.isValid()) return;

    map.flyToBounds(bounds, {
        padding: [60, 60],
        maxZoom: 8,
        duration: 0.5,
    });
}

function renderEarthquakeOnMap(eq, options = {}) {
    if (!eq || !eq.earthquake) return;
    const { autoMove = false } = options;

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
    if (shouldRenderWaveFrontForEq(eq)) {
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
    return CONFIG.isTest ? testModeEewEq : liveEewEq;
}

function getActiveEewRaw() {
    return CONFIG.isTest ? testModeEewRaw : liveEewRaw;
}

function shouldRenderWaveFrontForEq(eq) {
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

    const originMs = getEarthquakeOriginMillis(waveCurrentEq);
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
        clearLiveEewDisplay();
        return;
    }

    let pDistanceKm = getDistanceForElapsedSec('p', depthKm, elapsedSec);
    let sDistanceKm = getDistanceForElapsedSec('s', depthKm, elapsedSec);
    const isPMaxReached = isPWaveMaxReached(pDistanceKm);

    if (isPMaxReached) {
        pDistanceKm = getDistanceAfterPWaveMax('p', depthKm, elapsedSec, pDistanceKm);
        sDistanceKm = getDistanceAfterPWaveMax('s', depthKm, elapsedSec, sDistanceKm);
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

function clearLiveEewDisplay() {
    liveEewEq = null;
    liveEewRaw = null;
    testModeEewEq = null;
    testModeEewRaw = null;
    waveCurrentEq = null;
    hideWaveFrontLayers();
    updateEewCard(null);
}

function getEarthquakeOriginMillis(eq) {
    const time = eq?.earthquake?.time;
    if (!time) return NaN;
    return Date.parse(time);
}

function parseDepthKm(depthRaw) {
    const depth = Number(depthRaw);
    if (Number.isFinite(depth) && depth >= 0) return depth;
    return WAVE_FRONT_CONFIG.defaultDepthKm;
}

function getDistanceForElapsedSec(waveType, depthKm, elapsedSec) {
    if (jma2001TravelTable) {
        const distanceFromTable = invertTravelTimeToDistance(jma2001TravelTable, waveType, depthKm, elapsedSec);
        if (Number.isFinite(distanceFromTable)) {
            return distanceFromTable;
        }
    }

    return getDistanceByFallbackVelocity(waveType, depthKm, elapsedSec);
}

function getDistanceAfterPWaveMax(waveType, depthKm, elapsedSec, currentDistanceKm) {
    const maxInfo = getWaveMaxDistanceInfo(waveType, depthKm);
    if (!maxInfo) {
        return Number.isFinite(currentDistanceKm)
            ? currentDistanceKm
            : getDistanceByFallbackVelocity(waveType, depthKm, elapsedSec);
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

function getDistanceByFallbackVelocity(waveType, depthKm, elapsedSec) {
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

function invertTravelTimeToDistance(table, waveType, depthKm, elapsedSec) {
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
    filled_list = {};
    shindoFilledLayer.clearLayers();

    if (Array.isArray(points)) {
        points.forEach(element => {
            const station = stationMap[element.addr];
            if (!station) return;

            const stationLat = Number(station.lat);
            const stationLon = Number(station.lon);
            if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) return;

            const scale = element.scale;
            const iconName = iconMap[scale] || "int_";

            canvasPoints.push({
                latlng: L.latLng(stationLat, stationLon),
                iconName: iconName,
                scale: scale
            });

            if (station.area?.name) {
                const areaCode = AreaNameToCode(station.area.name);
                if (areaCode != null && (!filled_list[areaCode] || filled_list[areaCode] < scale)) {
                    filled_list[areaCode] = scale;
                }
            }
        });
    }

    if (Array.isArray(areaScales)) {
        areaScales.forEach((item) => {
            const areaCode = item?.areaCode;
            const scale = Number(item?.scale);
            if (!areaCode || !Number.isFinite(scale) || scale < 0) return;

            if (!filled_list[areaCode] || filled_list[areaCode] < scale) {
                filled_list[areaCode] = scale;
            }
        });
    }

    canvasPoints.sort((a, b) => a.scale - b.scale);

    shindoCanvasLayer.setPoints(canvasPoints);

    for (const areaCode in filled_list) {
        FillPolygon(areaCode, getShindoFillColor(filled_list[areaCode]));
    }
}

function getShindoFillColor(scale) {
    return shindoFillColorMap[scale] || "#888888";
}

function FillPolygon(area_Code, fillColor) {
    if (!japan_data) return;

    const array_Num = AreaCode.indexOf(area_Code);
    if (array_Num === -1) return;

    const style = {
        "color": "#d1d1d1",
        "weight": 0.2,
        "opacity": 1,
        "fillColor": fillColor,
        "fillOpacity": 1,
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
}

function AreaNameToCode(Name) {
    const array_Num = AreaName.indexOf(Name);
    return AreaCode[array_Num];
}
function AreaCodeToName(code) {
    const array_Num = AreaCode.indexOf(code);
    return AreaName[array_Num];
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

    const eewScaleCode = convertIntensityToScaleCode(eew.MaxIntensity);
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
    card.querySelector('.eew-card_maxscale-txt').innerHTML = `${number}<span class="scale_modifier">${modifier}</span>`;

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

const alertAudio = new Audio(SoundConfig.src);
alertAudio.volume = SoundConfig.volume;

const eewAudio = new Audio(EewSoundConfig.src);
eewAudio.volume = EewSoundConfig.volume;

function playAlertSound() {
    if (!SoundConfig.enabled || !SoundConfig.earthquakeEnabled || !userInteracted) return;
    alertAudio.currentTime = 0;
    alertAudio.play().catch(e => console.warn('効果音の再生失敗:', e));
}

function playEewSound() {
    if (!EewSoundConfig.enabled) return;
    eewAudio.currentTime = 0;
    eewAudio.play().catch(e => console.warn('EEW音声の再生失敗:', e));
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
    const eqTestBtn = document.getElementById('sound-earthquake-test-btn');
    const eewTestBtn = document.getElementById('sound-eew-test-btn');
    const dot       = document.getElementById('sound-status-dot');
    const statusTxt = document.getElementById('sound-status-text');
    const testButtons = [eqTestBtn, eewTestBtn];

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
            });
    }

    toggle.checked = SoundConfig.enabled;
    eqToggle.checked = SoundConfig.earthquakeEnabled;
    eewToggle.checked = EewSoundConfig.enabled;
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

    volumeEl.addEventListener('mousedown', (e) => e.stopPropagation());

    volumeEl.addEventListener('input', () => {
        const v = parseFloat(volumeEl.value);
        SoundConfig.volume = v;
        alertAudio.volume = v;
        volumeLbl.textContent = `${Math.round(v * 100)}%`;
    });

    eqTestBtn.addEventListener('click', () => {
        runSoundTest({ src: SoundConfig.src, volume: SoundConfig.volume, activeButton: eqTestBtn });
    });

    eewTestBtn.addEventListener('click', () => {
        runSoundTest({ src: EewSoundConfig.src, volume: EewSoundConfig.volume, activeButton: eewTestBtn });
    });
})();

async function fetchGifPixels(gifUrl) {
    const res = await fetch(PROXY + encodeURIComponent(gifUrl));
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
    const t = new Date(latestTime * 1000);
    const pad = n => String(n).padStart(2, '0');
    const yyyymmdd = `${t.getFullYear()}${pad(t.getMonth()+1)}${pad(t.getDate())}`;
    const ts = yyyymmdd + pad(t.getHours()) + pad(t.getMinutes()) + pad(t.getSeconds());

    const shindoUrl = `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/${yyyymmdd}/${ts}.jma_s.gif`;
    const pgaUrl    = `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/acmap_s/${yyyymmdd}/${ts}.acmap_s.gif`;

    const [shindoData, pgaData] = await Promise.all([
        fetchGifPixels(shindoUrl),
        fetchGifPixels(pgaUrl),
    ]);

    const shindoResult = [], pgaResult = [], colorResult = [], pgaColorResult = [];

    for (const { x, y, suspended } of points) {
        if (suspended || y >= shindoData.height || x >= shindoData.width) {
            shindoResult.push(7.0);
            pgaResult.push(9999.9);
            colorResult.push(null);
            pgaColorResult.push(null);
            continue;
        }

        const sc = getPixel(shindoData, x, y);
        const pc = getPixel(pgaData, x, y);
        const sp = color2position(sc.r, sc.g, sc.b);
        const pp = color2position(pc.r, pc.g, pc.b);

        colorResult.push(`rgb(${sc.r},${sc.g},${sc.b})`);
        pgaColorResult.push(`rgb(${pc.r},${pc.g},${pc.b})`)

        if (sp == null || pp == null) {
            shindoResult.push(7.0); pgaResult.push(9999.9); continue;
        }

        let shindo = Math.round((10.0 * sp - 3.0) * 10) / 10;
        let pga    = Math.round((10 ** (5.0 * pp - 2.0)) * 10) / 10;

        if (shindo < -3 || shindo > 7) shindo = 7.0;
        if (pga < 0 || pga > 9999.9) pga = 99999.9;

        shindoResult.push(shindo);
        pgaResult.push(pga);
    }

    return { shindoResult, pgaResult, colorResult, pgaColorResult };
}

let latestTime = 0;
let lastSync = 0;
let kyoshinPoints = [];

async function fetchLatestTime() {
    const url = `http://www.kmoni.bosai.go.jp/webservice/server/pros/latest.json?_=${Date.now()}`;
    const res = await fetch(PROXY + encodeURIComponent(url));
    const json = await res.json();
    latestTime = Math.floor(new Date(json.latest_time.replace(/\//g, '-')).getTime() / 1000);
}

async function initKyoshin() {
    kyoshinPoints = await loadPoints();
    await fetchLatestTime();
    lastSync = latestTime;
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

    setInterval(async () => {
        if (latestTime - lastSync > 3600) {
            await fetchLatestTime();
            lastSync = latestTime;
        } else {
            latestTime += 1;
        }
    const { shindoResult, pgaResult, colorResult, pgaColorResult } = await updateImages(latestTime, kyoshinPoints);
    window._lastColorResult = colorResult;
    window._lastPgaColorResult = pgaColorResult;
    drawKyoshinPoints(kyoshinPoints, kyoshinMode === 'shindo' ? colorResult : pgaColorResult);
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
        const lat = parseFloat(cols[5]);
        const lon = parseFloat(cols[6]);
        const x = parseInt(cols[7]);
        const y = parseInt(cols[8]);
        if (isNaN(x) || isNaN(y) || isNaN(lat) || isNaN(lon)) continue;
        points.push({ x, y, suspended: isSuspended, lat, lon });
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
    if (!window.kyoshinLayer) {
        window.kyoshinLayer = L.layerGroup().addTo(map);
    }
    window.kyoshinLayer.clearLayers();

    points.forEach(({ lat, lon, suspended }, i) => {
        if (suspended) return;
        const color = colorResult[i];
        if (!color) return;

        const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
        if (!match) return;
        const [, r, g, b] = match.map(Number);
        if (r < 10 && g < 10 && b < 10) return;

        const fillOpacity = getKyoshinOpacity(r, g, b);

        L.circleMarker([lat, lon], {
            radius: getKyoshinRadius(),
            color: color,
            fillColor: color,
            fillOpacity,
            weight: 0,
        }).addTo(window.kyoshinLayer);
    });
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

function getKyoshinRadius() {
    const zoom = map.getZoom();
    if (zoom >= 11) return 18;
    if (zoom >= 10) return 15;
    if (zoom >= 8) return 7;
    if (zoom >= 7) return 5;
    if (zoom >= 6) return 3;
    if (zoom >= 4) return 2;
    if (zoom >= 2) return 1;
    return 3;
}

initKyoshin();


