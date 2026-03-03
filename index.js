//=====
// 設定
const CONFIG = {
    isTest: new URLSearchParams(window.location.search).has("test"),

    get apiurl() {
        return this.isTest
        ? "./source/testNotoEq.json"
        : "https://eqf-worker.spdev-3141.workers.dev/api/p2pquake?codes=551&limit=15"
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

document.querySelector('.side-panel').appendChild(toggleBtn);

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
map.createPane("shingen").style.zIndex = 400;
map.createPane("tsunami_map").style.zIndex = 110;
map.createPane("eew_shingen").style.zIndex = 101;
map.createPane("pwave").style.zIndex = 80;
map.createPane("swave").style.zIndex = 81;

let shindoLayer = L.layerGroup().addTo(map);
let shindoFilledLayer = L.layerGroup().addTo(map);
let JMAPointsJson = null;
let shindoCanvasLayer = null;
let hypoMarker = null;
let eewHypoMarker = null;
let stationMap = {};
let japan_data = null;
let filled_list = {};
let eewBlinkInterval = null;
let eewBlinkState = false;

const shindoCanvasPane = map.createPane("shindo_canvas");
shindoCanvasPane.style.zIndex = 200;
shindoCanvasPane.style.overflow = 'visible';

var pwave = L.circle([0, 0], {
    radius: 0, pane: "pwave",
    color: '#d9f6ff',
    fillColor: '#00000000',
    fillOpacity: 0.5,
    weight: 1,
    opacity: 1,
}).addTo(map);

var swave = L.circle([0, 0], {
    radius: 0, pane: "swave",
    color: '#dc143c',
    fillColor: '#dc143c',
    fillOpacity: 0.1,
    weight: 1.5,
    opacity: 1,
}).addTo(map);

const PolygonLayer_Style = {
    "color": "#dde0e5",
    "weight": 1.5,
    "opacity": 0.25,
    "fillColor": "#32353a",
    "fillOpacity": 1
};

const shindoFillColorMap = {
    10: "#007a9c",   // 1
    20: "#008369",   // 2
    30: "#d1a11b",   // 3
    40: "#c27b2b",   // 4
    45: "#c22b2b",   // 5弱
    46: "#db4921",   // 5弱以上
    50: "#a11717",   // 5強
    55: "#8f0d34",   // 6弱
    60: "#80142f",   // 6強
    70: "#4a0083",   // 7
};

$.getJSON("source/saibun.geojson", function (data) {
    japan_data = data;
    L.geoJson(data, {
        pane: "pane_map3",
        style: PolygonLayer_Style
    }).addTo(map);
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
            img.src = `./source/point_icons/_${name}.png`;
            img.onload = () => {
                iconCache[name] = img;
                resolve();
            };
        });
    }));
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

preloadIcons().then(() => {
    shindoCanvasLayer = new ShindoCanvasLayer();
    shindoCanvasLayer.addTo(map);

    $.getJSON("source/JMAstations.json", function (data) {
        JMAPointsJson = data;
        data.forEach(p => { stationMap[p.name] = p; });
        updateData();
        setInterval(updateData, CONFIG.updateInterval);
    });
});

const sidePanel = document.querySelector('.side-panel');
let isDown = false;
let startY;
let scrollTop;

sidePanel.addEventListener('mousedown', (e) => {
    isDown = true;
    startY = e.pageY - sidePanel.offsetTop;
    scrollTop = sidePanel.scrollTop;
    sidePanel.style.cursor = 'grabbing';
    sidePanel.style.userSelect = 'none';
});

document.addEventListener('mouseup', () => {
    isDown = false;
    sidePanel.style.cursor = 'grab';
    sidePanel.style.userSelect = '';
});

document.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const y = e.pageY - sidePanel.offsetTop;
    const walk = y - startY;
    sidePanel.scrollTop = scrollTop - walk;
});

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
    $.getJSON(CONFIG.apiurl, (data) => {
        const detailScaleData = data.filter(eq => eq.issue.type === "DetailScale");
        const latest = detailScaleData[0];

        const { time, hypocenter, maxScale, domesticTsunami } = latest.earthquake;
        const { name: hyponame, magnitude, depth, latitude, longitude } = hypocenter;

        const hypoLatLng = new L.LatLng(latitude, longitude);
        const hypoIconImage = L.icon({
            iconUrl: 'source/shingen.png',
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -40]
        });
        updateMarker(hypoLatLng, hypoIconImage);

        const map_maxscale = scaleMap[String(maxScale)];

        drawShindoPoints(latest.points);

        updateEarthquakeParam(time, map_maxscale, hyponame, magnitude, depth, domesticTsunami);

        trySpeakEarthquake({
            time,
            scale:    map_maxscale,
            name:     hyponame,
            magnitude,
            depth,
            tsunami:  domesticTsunami,
            rawScale: maxScale,
        });

        const eqMap = new Map();
        detailScaleData.forEach(eq => {
            const key = `${eq.earthquake.time}_${eq.earthquake.hypocenter.name}`;
            const existing = eqMap.get(key);
            if (!existing || eq.created_at > existing.created_at) {
                eqMap.set(key, eq);
            }
        });

        const deduped = Array.from(eqMap.values())
            .sort((a, b) => b.earthquake.time.localeCompare(a.earthquake.time));

        const latestKey = `${latest.earthquake.time}_${latest.earthquake.hypocenter.name}`;
        const historyData = deduped.filter(eq => {
            const key = `${eq.earthquake.time}_${eq.earthquake.hypocenter.name}`;
            return key !== latestKey;
        });

        updateEqHistory(historyData);
    });
}

function drawShindoPoints(points) {
    if (!JMAPointsJson || !japan_data || !shindoCanvasLayer) return;

    const canvasPoints = [];
    filled_list = {};
    shindoFilledLayer.clearLayers()

    points.forEach(element => {
        const station = stationMap[element.addr];
        if (!station) return;

        const scale = element.scale;
        const iconName = iconMap[scale] || "int_";

        canvasPoints.push({
            latlng: L.latLng(Number(station.lat), Number(station.lon)),
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
    const latest_maxscale = document.querySelector(".latest-card_maxscale");

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

    document.getElementsByClassName("latest-card_location")[0].textContent = name;

    const date = new Date(time);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const formatted_time = `${month}/${day} ${hours}:${minutes}`;
    document.getElementsByClassName("latest-card_date")[0].textContent = `${formatted_time}ごろ発生`;

    const magnitude_class = document.getElementsByClassName("latest-card_magnitude")[0];
    if (Number(magnitude) === -1) {
        magnitude_class.textContent = "調査中";
        magnitude_class.classList.add("investigate-text");
    } else {
        magnitude_class.textContent = magnitude.toFixed(1);
        magnitude_class.classList.remove("investigate-text");
    }

    const depth_class = document.getElementsByClassName("latest-card_depth")[0];
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

    const tsunami_class = document.getElementsByClassName("latest-card_tsunami")[0];
    Object.values(tsunamiClassMap).forEach(cls => tsunami_class.classList.remove(cls));
    tsunami_class.textContent = tsunamiCommentMap[tsunami] || "情報なし";
    if (tsunamiClassMap[tsunami]) tsunami_class.classList.add(tsunamiClassMap[tsunami]);
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
            <div class="eq-history_content">
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
    });
}

function enableDragScroll(element, options = {}) {
    let isDown = false;
    let startX, startY, scrollLeft, scrollTop;
    const speed = options.speed || 1;

    element.style.cursor = 'grab';

    element.addEventListener('mousedown', (e) => {
        isDown = true;
        element.classList.add('active');
        element.style.cursor = 'grabbing';
        startX = e.pageX - element.offsetLeft;
        startY = e.pageY - element.offsetTop;
        scrollLeft = element.scrollLeft;
        scrollTop = element.scrollTop;
    });

    element.addEventListener('mouseup', () => {
        isDown = false;
        element.classList.remove('active');
        element.style.cursor = 'grab';
    });

    element.addEventListener('mouseleave', () => {
        isDown = false;
        element.classList.remove('active');
        element.style.cursor = 'grab';
    });

    element.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - element.offsetLeft;
        const y = e.pageY - element.offsetTop;
        element.scrollLeft = scrollLeft - (x - startX) * speed;
        element.scrollTop  = scrollTop  - (y - startY) * speed;
    });
}

const scrollable = document.querySelector('.side-panel');
enableDragScroll(scrollable, { speed: 1 });

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

function buildSpeechText(time, scale, name, magnitude, depth, tsunami) {
    const d = new Date(time);
    const month   = d.getMonth() + 1;
    const day     = d.getDate();
    const hours   = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");

    const magText = Number(magnitude) === -1
        ? "不明"
        : `${magnitude.toFixed(1)}`;

    const depthNum  = Number(depth);
    const depthText = depthNum === -1 ? "不明"
                    : depthNum === 0  ? "ごく浅い"
                    : `${depthNum}キロメートル`;

    const tsunamiVoiceMap = {
        "None":        "この地震による津波の心配はありません。",
        "Unknown":     "現在、津波に関する情報を調査中です。",
        "Checking":    "現在、津波に関する情報を調査中です。",
        "NonEffective":"若干の海面変動があるかもしれませんが、被害の心配はありません。",
        "Watch":       "この地震によって、津波注意報が発表されています。",
        "Warning":     "この地震によって、津波予報等を発表中です。",
    };
    const tsunamiText = tsunamiVoiceMap[tsunami] ?? "津波情報は不明です。";

    return [
        `地震情報。`,
        `${month}月${day}日 ${hours}時${minutes}分ごろ、`,
        `${name}で地震がありました。`,
        `最大震度は${scale}、`,
        `震源の深さは${depthText}。`,
        `地震の規模を示すマグニチュードは、${magText} 、と推定されています。`,
        `また、${tsunamiText}`,
    ].join("");
}

function trySpeakEarthquake({ time, scale, name, magnitude, depth, tsunami, rawScale }) {
    if (speechCooldown) return;
    const key = `${time}_${name}`;
    if (key === lastSpokenKey) return;
    if (Number(rawScale) < SpeechConfig.minScale) return;

    lastSpokenKey = key;
    const text = buildSpeechText(time, scale, name, magnitude, depth, tsunami);
    speak(text);
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

function getFormattedTime(date) {
    const year   = date.getFullYear();
    const month  = String(date.getMonth() + 1).padStart(2, "0");
    const day    = String(date.getDate()).padStart(2, "0");
    const hour   = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");

    return {
        dateStr: `${year}${month}${day}`,
        timeStr: `${year}${month}${day}${hour}${minute}${second}`
    };
}

let interpolationData = {
    active: false,
    hypoCenter: null,
    originTime: null,
    depth: 0,
    lastPRadius: 0,
    lastSRadius: 0,
    lastCheckTime: null
};

const WAVE_VELOCITY = { P: 6.0, S: 3.5 };

function calculateRadius(velocity, elapsedSeconds, depthKm) {
    const distance = velocity * elapsedSeconds;
    const rSquared = distance * distance - depthKm * depthKm;
    return rSquared > 0 ? Math.sqrt(rSquared) : 0;
}

function updatePSWave() {
    const now = CONFIG.getSimulatedTime();
    const { dateStr, timeStr } = getFormattedTime(now);

    $.getJSON(`https://eqf-worker.spdev-3141.workers.dev/api/kyoshin/${dateStr}/${timeStr}.json?t=${now.getTime()}`)
        .done(function(yahoo_data) {
            if (!yahoo_data.psWave || !yahoo_data.hypoInfo?.items?.[0]) {
                interpolationData.active = false;
                pwave.setRadius(0);
                swave.setRadius(0);
                if (eewHypoMarker) eewHypoMarker.remove();
                eewHypoMarker = null;

                stopEewBlink();

                if (shindoCanvasLayer) shindoCanvasLayer._canvas.style.display = '';
                map.getPane('pane_map_filled').style.display = '';
                map.getPane('shingen').style.display = '';
                return;
            }

            if (shindoCanvasLayer) shindoCanvasLayer._canvas.style.display = 'none';
            map.getPane('pane_map_filled').style.display = 'none';
            map.getPane('shingen').style.display = 'none';

            const psItem = yahoo_data.psWave.items[0];
            const hypoItem = yahoo_data.hypoInfo.items[0];

            const lat = parseFloat(psItem.latitude.replace("N", ""));
            const lng = parseFloat(psItem.longitude.replace("E", ""));
            const center = new L.LatLng(lat, lng);

            const originTime = new Date(hypoItem.originTime);
            const depthMatch = hypoItem.depth.match(/^(\d+)/);
            const depthVal = depthMatch ? parseFloat(depthMatch[1]) : 0;
            interpolationData.depth = depthVal; 

            const elapsedSinceOrigin = (now - originTime) / 1000;
            const pRadiusYahoo = parseFloat(psItem.pRadius);
            const sRadiusYahoo = parseFloat(psItem.sRadius);

            if (elapsedSinceOrigin > 0) {
                const adjustedPVelocity = Math.sqrt(pRadiusYahoo * pRadiusYahoo + depthVal * depthVal) / elapsedSinceOrigin;
                const adjustedSVelocity = Math.sqrt(sRadiusYahoo * sRadiusYahoo + depthVal * depthVal) / elapsedSinceOrigin;

                WAVE_VELOCITY.P = adjustedPVelocity;
                WAVE_VELOCITY.S = adjustedSVelocity;
                
                console.log(`速度補正: P=${adjustedPVelocity.toFixed(2)} km/s, S=${adjustedSVelocity.toFixed(2)} km/s, 深さ=${depthVal}km`);
            }

            interpolationData.active = true;
            interpolationData.hypoCenter = center;
            interpolationData.originTime = originTime;
            interpolationData.depth = depthVal;
            interpolationData.lastPRadius = pRadiusYahoo;
            interpolationData.lastSRadius = sRadiusYahoo;
            interpolationData.lastCheckTime = now;

            const eewIcon = L.icon({
                iconUrl: 'source/eew-shingen.png',
                iconSize: [40, 40],
                iconAnchor: [20, 20],
            });
            
            if (!eewHypoMarker) {
                eewHypoMarker = L.marker(center, { icon: eewIcon, pane: "eew_shingen" }).addTo(map);
                startEewBlink();
            } else {
                eewHypoMarker.setLatLng(center);
            }

            drawWaveCircles(now);
        })
        .fail(function() {
            interpolationData.active = false;
        });
}

function interpolateAndDraw() {
    if (interpolationData.active && interpolationData.originTime) {
        const now = CONFIG.getSimulatedTime();
        drawWaveCircles(now);
    }
    requestAnimationFrame(interpolateAndDraw);
}

function drawWaveCircles(now) {
    if (!interpolationData.hypoCenter || !interpolationData.originTime) return;
    
    const elapsedSeconds = (now - interpolationData.originTime) / 1000;
    if (elapsedSeconds < 0) return;
    
    const depth = interpolationData.depth;

    let pRadius = calculateRadius(WAVE_VELOCITY.P, elapsedSeconds, depth);
    let sRadius = calculateRadius(WAVE_VELOCITY.S, elapsedSeconds, depth);

    /*
    if (interpolationData.lastCheckTime) {
        const timeSinceYahoo = (now - interpolationData.lastCheckTime);
        const fadeDuration = 2000;

        const alpha = Math.min(1, timeSinceYahoo / fadeDuration);

        const blendedPRadius = pRadius * (1 - alpha) + interpolationData.lastPRadius * alpha;
        const blendedSRadius = sRadius * (1 - alpha) + interpolationData.lastSRadius * alpha;
        
        pRadius = blendedPRadius;
        sRadius = blendedSRadius;
    }
    */

    pwave.setLatLng(interpolationData.hypoCenter);
    pwave.setRadius(pRadius * 1000);
    
    swave.setLatLng(interpolationData.hypoCenter);
    swave.setRadius(sRadius * 1000);
}

function checkDiscrepancy(calculatedRadius, yahooRadius) {
    const diff = Math.abs(calculatedRadius - yahooRadius);
    const ratio = diff / yahooRadius;
    
    if (ratio > 0.2) {
        return 0.8;
    }
    return 0.2;
}

function startEewBlink() {
    if (eewBlinkInterval) return;
    
    eewBlinkState = true;
    eewBlinkInterval = setInterval(() => {
        eewBlinkState = !eewBlinkState;
        if (eewHypoMarker) {
            eewHypoMarker.setOpacity(eewBlinkState ? 1.0 : 0.1);
        }
    }, 500);
}

function stopEewBlink() {
    if (eewBlinkInterval) {
        clearInterval(eewBlinkInterval);
        eewBlinkInterval = null;
    }
    if (eewHypoMarker) {
        eewHypoMarker.setOpacity(1.0);
    }
}

setInterval(updatePSWave, 1000);
updatePSWave();

requestAnimationFrame(interpolateAndDraw);