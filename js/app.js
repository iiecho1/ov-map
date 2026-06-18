const DB_NAME = 'ov-map-db';
const DB_VERSION = 1;
const STORE_LAYERS = 'layers';
const STORE_STATE = 'state';
const CLOUD_DB_NAME = 'ov-map-cloud';
const CLOUD_DB_VERSION = 1;
const CLOUD_STORE = 'kml-files';

const CloudReader = {
    db: null,
    _initError: false,
    async init() {
        return new Promise(resolve => {
            const req = indexedDB.open(CLOUD_DB_NAME, CLOUD_DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(CLOUD_STORE)) db.createObjectStore(CLOUD_STORE, { keyPath: 'id' });
            };
            req.onsuccess = e => { this.db = e.target.result; resolve(); };
            req.onerror = () => { this._initError = true; console.warn('CloudReader: IndexedDB unavailable'); resolve(); };
        });
    },
    async getEnabledFiles() {
        if (!this.db) return [];
        return new Promise(resolve => {
            const req = this.db.transaction(CLOUD_STORE, 'readonly').objectStore(CLOUD_STORE).getAll();
            req.onsuccess = () => resolve((req.result || []).filter(f => f.enabled !== false));
            req.onerror = () => resolve([]);
        });
    },
    async getAllFiles() {
        if (!this.db) return [];
        return new Promise(resolve => {
            const req = this.db.transaction(CLOUD_STORE, 'readonly').objectStore(CLOUD_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    },
    async save(fileData) {
        if (!this.db) throw new Error('存储未初始化');
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(CLOUD_STORE, 'readwrite');
            tx.objectStore(CLOUD_STORE).put(fileData);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new Error('保存失败'));
        });
    }
};

const Storage = {
    db: null,
    _initError: false,
    async init() {
        return new Promise(resolve => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_LAYERS)) db.createObjectStore(STORE_LAYERS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE, { keyPath: 'key' });
            };
            req.onsuccess = e => { this.db = e.target.result; resolve(); };
            req.onerror = () => { this._initError = true; console.warn('Storage: IndexedDB unavailable'); resolve(); };
        });
    },
    saveLayer(id, data) {
        if (!this.db) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_LAYERS, 'readwrite');
            tx.onerror = () => { console.error('Storage: saveLayer failed', id); reject(tx.error); };
            tx.oncomplete = () => resolve();
            tx.objectStore(STORE_LAYERS).put({ id, ...data });
        });
    },
    removeLayer(id) {
        if (!this.db) return;
        const del = (key) => {
            const tx = this.db.transaction(STORE_LAYERS, 'readwrite');
            tx.onerror = () => console.error('Storage: removeLayer failed', key);
            tx.objectStore(STORE_LAYERS).delete(key);
        };
        del(id);
        const nid = Number(id);
        if (!isNaN(nid)) del(nid);
    },
    getLayer(id) {
        if (!this.db) return Promise.resolve(null);
        const doGet = (key) => new Promise(resolve => {
            const req = this.db.transaction(STORE_LAYERS, 'readonly').objectStore(STORE_LAYERS).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
        return doGet(id).then(result => {
            if (result) return result;
            const nid = Number(id);
            if (!isNaN(nid)) return doGet(nid);
            return null;
        });
    },
    getAllLayers() {
        if (!this.db) return Promise.resolve([]);
        return new Promise(resolve => {
            const req = this.db.transaction(STORE_LAYERS, 'readonly').objectStore(STORE_LAYERS).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    },
    saveState(state) {
        if (!this.db) return;
        this.db.transaction(STORE_STATE, 'readwrite').objectStore(STORE_STATE).put({ key: 'mapState', ...state });
    },
    getState() {
        if (!this.db) return Promise.resolve(null);
        return new Promise(resolve => {
            const req = this.db.transaction(STORE_STATE, 'readonly').objectStore(STORE_STATE).get('mapState');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    },
    clearAll() {
        if (!this.db) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([STORE_LAYERS, STORE_STATE], 'readwrite');
            tx.objectStore(STORE_LAYERS).clear();
            tx.objectStore(STORE_STATE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};

L.GCJ02 = {
    _PI: Math.PI,
    _a: 6378245.0,
    _ee: 0.00669342162296594323,
    _transform(lat, lng) {
        let dLat = this._transformLat(lng - 105.0, lat - 35.0);
        let dLng = this._transformLng(lng - 105.0, lat - 35.0);
        const radLat = lat / 180.0 * this._PI;
        let magic = Math.sin(radLat);
        magic = 1 - this._ee * magic * magic;
        const sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((this._a * (1 - this._ee)) / (magic * sqrtMagic) * this._PI);
        dLng = (dLng * 180.0) / (this._a / sqrtMagic * Math.cos(radLat) * this._PI);
        return { lat: lat + dLat, lng: lng + dLng };
    },
    _transformLat(x, y) {
        let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * this._PI) + 20.0 * Math.sin(2.0 * x * this._PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * this._PI) + 40.0 * Math.sin(y / 3.0 * this._PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * this._PI) + 320 * Math.sin(y * this._PI / 30.0)) * 2.0 / 3.0;
        return ret;
    },
    _transformLng(x, y) {
        let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * this._PI) + 20.0 * Math.sin(2.0 * x * this._PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * this._PI) + 40.0 * Math.sin(x / 3.0 * this._PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * this._PI) + 300.0 * Math.sin(x / 30.0 * this._PI)) * 2.0 / 3.0;
        return ret;
    },
    wgs84ToGcj02(lat, lng) { return this._transform(lat, lng); },
    gcj02ToWgs84(lat, lng) {
        const t = this._transform(lat, lng);
        return { lat: lat * 2 - t.lat, lng: lng * 2 - t.lng };
    }
};

L.Projection.GCJ02Mercator = L.extend({}, L.Projection.SphericalMercator, {
    project(latlng) {
        const gcj = L.GCJ02.wgs84ToGcj02(latlng.lat, latlng.lng);
        return L.Projection.SphericalMercator.project(new L.LatLng(gcj.lat, gcj.lng));
    },
    unproject(point) {
        const gcjLatLng = L.Projection.SphericalMercator.unproject(point);
        const wgs = L.GCJ02.gcj02ToWgs84(gcjLatLng.lat, gcjLatLng.lng);
        return new L.LatLng(wgs.lat, wgs.lng);
    }
});

L.CRS.GCJ02 = L.extend({}, L.CRS.EPSG3857, {
    code: 'EPSG:GCJ02',
    projection: L.Projection.GCJ02Mercator
});

L.BingSatelliteLayer = L.TileLayer.extend({
    options: { attribution: '&copy; Bing', maxZoom: 19 },
    initialize() {
        L.TileLayer.prototype.initialize.call(this, '', this.options);
    },
    _toQuadKey(x, y, z) {
        const arr = new Array(z);
        for (let i = z - 1; i >= 0; i--) {
            let digit = 0;
            const mask = 1 << i;
            if (x & mask) digit += 1;
            if (y & mask) digit += 2;
            arr[z - 1 - i] = digit;
        }
        return arr.join('');
    },
    getTileUrl(coords) {
        const q = this._toQuadKey(coords.x, coords.y, coords.z);
        const s = (coords.x + coords.y) % 8;
        return `https://ecn.t${s}.tiles.virtualearth.net/tiles/a${q}.jpeg?g=587&mkt=zh-cn`;
    }
});

const App = {
    map: null, canvasRenderer: null, labelOverlay: null,
    baseLayers: {}, currentBaseLayer: null,
    importedLayers: {}, drawnItems: null, drawControl: null,
    layerColors: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'],
    colorIndex: 0, _saveTimer: null, _importing: false, _layerOrder: [], _flatLabelCache: null,
    _cursorRaf: null, _cursorLatest: null, _layerListRaf: null, _allLayersHidden: false, _savedLayerVisibility: {},
    _dom: {},
    _popupLru: null,

    _cacheDom() {
        const ids = ['searchInput', 'searchResults', 'apiKeyBox', 'apiKeyInput', 'cursorPos', 'zoomLevel', 'contextMenu', 'ctxCoord', 'fileInput', 'importedLayers', 'measureResults', 'loadingOverlay'];
        for (const id of ids) this._dom[id] = document.getElementById(id);
        this._dom.sidebar = document.getElementById('sidebar');
        this._dom.sidebarOverlay = document.getElementById('sidebarOverlay');
        this._dom.sidebarBtn = document.querySelector('.sidebar-btn');
        this._dom.sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
    },

    async init() {
        try {
            this._cacheDom();
            this._popupLru = new Map();
            this.showLoading('初始化中...');
            await new Promise(r => requestAnimationFrame(r));
            await Promise.all([Storage.init(), CloudReader.init()]);
            this.loadApiKey();
            this.initMap();
            this.initBaseLayers();
            this.initDrawControl();
            this.initLocateControl();
            this.initSidebarToggleControl();
            this.initLabelOverlay();
            this.initEventListeners();
            await Promise.all([this.restoreState(), this.restoreLayers()]);
            if (Storage._initError || CloudReader._initError) {
                console.warn('Storage warning: Local persistence may be unavailable');
            }
        } catch (e) {
            console.error('Init failed:', e);
        }
        this.hideLoading();
    },

    initMap() {
        this.canvasRenderer = L.canvas({ padding: 0.1 });
        this.map = L.map('map', {
            center: [35.8617, 104.1954], zoom: 5, zoomControl: true,
            preferCanvas: true, renderer: this.canvasRenderer
        });
        this.drawnItems = new L.FeatureGroup([], { renderer: this.canvasRenderer });
        this.map.addLayer(this.drawnItems);
    },

    initLabelOverlay() {
        const self = this;
        const GRID_SIZE = 0.1;
        const Overlay = L.Layer.extend({
            onAdd(map) {
                this._map = map;
                const pane = map.getPane('overlayPane');
                this._canvas = L.DomUtil.create('canvas', 'label-canvas');
                this._canvas.style.cssText = 'position:absolute;pointer-events:none;';
                this._ctx = this._canvas.getContext('2d');
                this._ctx.textAlign = 'center';
                this._ctx.textBaseline = 'middle';
                this._ctx.font = '11px Microsoft YaHei,sans-serif';
                this._ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                this._ctx.lineWidth = 3;
                this._ctx.fillStyle = '#2c3e50';
                pane.appendChild(this._canvas);
                map.on('moveend zoomend resize', this._throttledUpdate, this);
                this._update();
            },
            onRemove(map) {
                L.DomUtil.remove(this._canvas);
                map.off('moveend zoomend resize', this._throttledUpdate, this);
            },
            _throttledUpdate() {
                if (this._rafPending) return;
                this._rafPending = true;
                requestAnimationFrame(() => { this._rafPending = false; this._update(); });
            },
            _update() {
                const map = this._map;
                if (!map) return;
                const size = map.getSize();
                const dpr = window.devicePixelRatio || 1;
                const cw = size.x * dpr, ch = size.y * dpr;
                const canvasChanged = this._canvas.width !== cw || this._canvas.height !== ch;
                if (canvasChanged) {
                    this._canvas.width = cw;
                    this._canvas.height = ch;
                    this._canvas.style.width = size.x + 'px';
                    this._canvas.style.height = size.y + 'px';
                    const ctx = this._ctx;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.font = '11px Microsoft YaHei,sans-serif';
                    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                    ctx.lineWidth = 3;
                    ctx.fillStyle = '#2c3e50';
                }
                const topLeft = map.containerPointToLayerPoint([0, 0]);
                L.DomUtil.setPosition(this._canvas, topLeft);
                const ctx = this._ctx;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, size.x, size.y);

                if (map.getZoom() < 14) return;

                const bounds = map.getBounds();
                const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
                const latPad = (ne.lat - sw.lat) * 0.2, lngPad = (ne.lng - sw.lng) * 0.2;
                const filterBounds = L.latLngBounds([sw.lat - latPad, sw.lng - lngPad], [ne.lat + latPad, ne.lng + lngPad]);
                const pad = 100;
                const items = App._getFlatLabelCache();
                const grid = App._getLabelSpatialIndex(items, GRID_SIZE, filterBounds);
                ctx.beginPath();
                for (let k = 0; k < grid.length; k++) {
                    const item = grid[k];
                    const pt = map.latLngToContainerPoint(item._c);
                    if (pt.x < -pad || pt.y < -pad || pt.x > size.x + pad || pt.y > size.y + pad) continue;
                    ctx.strokeText(item.text, pt.x, pt.y);
                    ctx.fillText(item.text, pt.x, pt.y);
                }
                ctx.stroke();
            }
        });
        this.labelOverlay = new Overlay();
        this.labelOverlay.addTo(this.map);
    },

    updateLabelOverlay() {
        this._flatLabelCache = null;
        if (this.labelOverlay && this.labelOverlay._update) this.labelOverlay._update();
    },

    _getFlatLabelCache() {
        if (this._flatLabelCache) return this._flatLabelCache;
        const flat = [];
        const layers = this.importedLayers;
        for (const id in layers) {
            const data = layers[id];
            if (!data._labelCache || !this.map.hasLayer(data.layer)) continue;
            const cache = data._labelCache;
            for (let i = 0; i < cache.length; i++) {
                const item = cache[i];
                if (!item.text) continue;
                if (!item._c) {
                    if (item.type === 'point') item._c = item.latlng;
                    else if (item.bounds) item._c = item.bounds.getCenter();
                    else continue;
                }
                flat.push(item);
            }
        }
        this._flatLabelCache = flat;
        return flat;
    },

    _getLabelSpatialIndex(items, gridSize, filterBounds) {
        if (!filterBounds) return items;
        const sw = filterBounds.getSouthWest(), ne = filterBounds.getNorthEast();
        const minLat = Math.floor(sw.lat / gridSize) * gridSize;
        const maxLat = Math.ceil(ne.lat / gridSize) * gridSize;
        const minLng = Math.floor(sw.lng / gridSize) * gridSize;
        const maxLng = Math.ceil(ne.lng / gridSize) * gridSize;
        const result = [];
        for (let k = 0; k < items.length; k++) {
            const item = items[k];
            if (!item._c) continue;
            const lat = item._c.lat, lng = item._c.lng;
            if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) continue;
            result.push(item);
        }
        return result;
    },

    initBaseLayers() {
        this.baseLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19 });
        this.baseLayers.gaode = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: ['1','2','3','4'], attribution: '&copy; 高德', maxZoom: 18 });
        this.baseLayers.gaodeSatellite = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', { subdomains: ['1','2','3','4'], attribution: '&copy; 高德卫星', maxZoom: 18 });
        this.baseLayers.bingSatellite = new L.BingSatelliteLayer();
        this.baseLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 });
        this.baseLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenTopoMap', maxZoom: 17 });
        this.baseLayers.satellite.addTo(this.map);
        this.currentBaseLayer = 'satellite';
    },

    initDrawControl() {
        this.drawControl = new L.Control.Draw({
            position: 'topright',
            draw: {
                polyline: { shapeOptions: { color: '#e74c3c', weight: 3 }, metric: true, feet: false },
                polygon: { allowIntersection: false, shapeOptions: { color: '#3498db', weight: 3, fillOpacity: 0.2 }, metric: true, feet: false },
                rectangle: { shapeOptions: { color: '#2ecc71', weight: 3, fillOpacity: 0.2 }, metric: true },
                circle: { shapeOptions: { color: '#f39c12', weight: 3, fillOpacity: 0.2 }, metric: true },
                marker: true, circlemarker: false
            },
            edit: { featureGroup: this.drawnItems, remove: true }
        });
        this.map.addControl(this.drawControl);
        const origTooltip = L.Draw.Polyline.prototype._getTooltipText;
        L.Draw.Polyline.prototype._getTooltipText = function () {
            const r = origTooltip.call(this);
            const ll = this._poly.getLatLngs();
            if (ll.length >= 1 && this._currentLatLng) {
                const p1 = ll[0], p2 = this._currentLatLng;
                const toRad = Math.PI / 180;
                const lat1 = p1.lat * toRad, lat2 = p2.lat * toRad;
                const dLng = (p2.lng - p1.lng) * toRad;
                const y = Math.sin(dLng) * Math.cos(lat2);
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
                const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
                const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
                const dir = dirs[Math.round(bearing / 45) % 8];
                r.subtext = (r.subtext ? r.subtext + '\n' : '') + `方位角: ${bearing.toFixed(1)}° (${dir})`;
            }
            return r;
        };
    },

    initLocateControl() {
        const Ctrl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd() {
                const btn = L.DomUtil.create('div', 'locate-btn');
                btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
                btn.title = '定位到当前位置';
                L.DomEvent.disableClickPropagation(btn);
                L.DomEvent.on(btn, 'click', () => App.locate());
                return btn;
            }
        });
        new Ctrl().addTo(this.map);
    },

    initSidebarToggleControl() {
        const Ctrl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd() {
                const btn = L.DomUtil.create('div', 'sidebar-btn');
                btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
                btn.title = '切换菜单';
                L.DomEvent.disableClickPropagation(btn);
                L.DomEvent.disableScrollPropagation(btn);
                L.DomEvent.on(btn, 'click', () => App.toggleSidebar());
                return btn;
            }
        });
        new Ctrl().addTo(this.map);
    },

    locate() {
        const btn = document.querySelector('.locate-btn');
        if (btn) btn.classList.add('locating');

        const placeMarker = (lat, lng, accuracy, source) => {
            this.map.setView([lat, lng], 16);
            if (this.locateMarker && this.map.hasLayer(this.locateMarker)) this.map.removeLayer(this.locateMarker);
            if (this.locateCircle && this.map.hasLayer(this.locateCircle)) this.map.removeLayer(this.locateCircle);
            if (accuracy > 0) {
                this.locateCircle = L.circle([lat, lng], { radius: accuracy, color: '#3498db', fillColor: '#3498db', fillOpacity: 0.15, weight: 1 }).addTo(this.map);
            }
            const popupHtml = `${source}<br>经度: ${lng.toFixed(6)}<br>纬度: ${lat.toFixed(6)}${accuracy > 0 ? '<br>精度: ' + accuracy.toFixed(0) + ' 米' : ''}<br><button class="marker-delete-btn" data-action="delete-marker">删除标记</button>`;
            this.locateMarker = this.createMarkerWithPopup([lat, lng], popupHtml, {
                onDelete: () => {
                    if (this.locateCircle && this.map.hasLayer(this.locateCircle)) { this.map.removeLayer(this.locateCircle); this.locateCircle = null; }
                    this.locateMarker = null;
                }
            });
            if (btn) btn.classList.remove('locating');
        };

        const ipLocate = () => {
            const script = document.createElement('script');
            const cb = '__ipCallback_' + Date.now();
            window[cb] = (data) => {
                delete window[cb];
                document.body.removeChild(script);
                if (data && data.lat && data.lon) {
                    placeMarker(data.lat, data.lon, 1000, `IP定位 (${data.city || data.country || ''})`);
                } else {
                    alert('IP定位失败');
                    if (btn) btn.classList.remove('locating');
                }
            };
            script.src = `https://ip-api.com/json/?callback=${cb}&lang=zh-CN`;
            script.onerror = () => {
                delete window[cb];
                document.body.removeChild(script);
                alert('定位服务不可用');
                if (btn) btn.classList.remove('locating');
            };
            document.body.appendChild(script);
        };

        if (!navigator.geolocation || !window.isSecureContext) {
            ipLocate();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            pos => placeMarker(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, 'GPS定位'),
            () => ipLocate(),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
        );
    },

    searchMode: 'place', searchScope: 'all', searchTimer: null,

    setSearchMode(mode) {
        this.searchMode = mode;
        document.querySelectorAll('.search-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        const scopeWrap = document.getElementById('searchScopeWrap');
        if (scopeWrap) scopeWrap.style.display = mode === 'layer' ? 'flex' : 'none';
        const input = this._dom.searchInput;
        const placeholders = { place: '搜索地点...', layer: '搜索图层属性...', coord: '经度, 纬度 如: 118.63, 37.42' };
        input.placeholder = placeholders[mode] || '搜索...';
        input.value = '';
        this._dom.searchResults.classList.remove('has-items');
        this._dom.searchResults.innerHTML = '';
    },

    setSearchScope(scope) {
        this.searchScope = scope;
        document.querySelectorAll('.search-scope-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
        const input = this._dom.searchInput;
        if (input.value.trim()) this.doSearch();
    },

    doSearch() {
        const q = this._dom.searchInput.value.trim();
        if (!q) return;
        if (this.searchMode === 'place') this.searchPlace(q);
        else if (this.searchMode === 'coord') this.searchCoord(q);
        else this.searchLayer(q);
    },

    searchCoord(query) {
        const container = this._dom.searchResults;

        let nums = [];
        const dmsPattern = /(-?\d+(?:\.\d+)?)\s*[°度]\s*(\d+(?:\.\d+)?)?\s*['′分]?\s*(\d+(?:\.\d+)?)?\s*["″秒]?\s*[NSEW东北西南]?/gi;
        let dmsMatch;
        const dmsMatches = [];
        while ((dmsMatch = dmsPattern.exec(query)) !== null) {
            const deg = parseFloat(dmsMatch[1]);
            const min = dmsMatch[2] ? parseFloat(dmsMatch[2]) : 0;
            const sec = dmsMatch[3] ? parseFloat(dmsMatch[3]) : 0;
            dmsMatches.push(deg + min / 60 + sec / 3600);
        }

        if (dmsMatches.length >= 2) {
            nums = dmsMatches;
        } else {
            const cleaned = query.replace(/[^0-9.\-]+/g, ' ').trim();
            nums = cleaned.split(/\s+/).map(Number).filter(n => !isNaN(n) && isFinite(n));
        }

        if (nums.length < 2) {
            container.innerHTML = '<div class="search-hint">输入坐标跳转（先经度后纬度）<br><br>支持格式:<br>118.6377, 37.4237<br>东经118°38′ 北纬37°25′<br>E118 38.2 N37 25.4<br><br>自动忽略汉字等无关字符</div>';
            container.classList.add('has-items');
            return;
        }

        let lng, lat;
        if (Math.abs(nums[0]) <= 180 && Math.abs(nums[1]) <= 90) {
            lng = nums[0]; lat = nums[1];
        } else if (Math.abs(nums[0]) <= 90 && Math.abs(nums[1]) <= 180) {
            lng = nums[1]; lat = nums[0];
        } else {
            container.innerHTML = '<div class="search-hint">数值超出范围<br>经度: -180~180, 纬度: -90~90</div>';
            container.classList.add('has-items');
            return;
        }

        this.map.setView([lat, lng], 16);
        if (this.coordMarker && this.map.hasLayer(this.coordMarker)) this.map.removeLayer(this.coordMarker);
        const popupHtml = `坐标定位<br>经度: ${lng.toFixed(6)}<br>纬度: ${lat.toFixed(6)}<br><button class="marker-delete-btn" data-action="delete-marker">删除标记</button>`;
        this.coordMarker = this.createMarkerWithPopup([lat, lng], popupHtml);
        container.innerHTML = `<div class="search-result-item"><div class="result-name">经度: ${lng.toFixed(6)}, 纬度: ${lat.toFixed(6)}</div><div class="result-sub">已跳转到该位置</div></div>`;
        container.classList.add('has-items');
        this.closeSidebarOnMobile();
    },

    _gaodeKey: '', _searchAbort: null,

    toggleApiKeyBox() {
        const box = this._dom.apiKeyBox;
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
        if (box.style.display === 'block') {
            this._dom.apiKeyInput.value = this._gaodeKey || '';
        }
    },

    saveApiKey() {
        this._gaodeKey = this._dom.apiKeyInput.value.trim();
        localStorage.setItem('gaode_key', this._gaodeKey);
        this._dom.apiKeyBox.style.display = 'none';
        alert(this._gaodeKey ? 'API Key 已保存' : 'API Key 已清除');
    },

    loadApiKey() {
        this._gaodeKey = localStorage.getItem('gaode_key') || '';
    },

    async searchPlace(query) {
        const container = this._dom.searchResults;
        if (!this._gaodeKey) {
            container.innerHTML = '<div class="search-hint">请先配置高德 API Key<br><br>免费申请地址:<br>console.amap.com/dev/key/app<br><br>创建应用 → 添加Key → 选"Web服务"<br><br>点击搜索框右侧 ⚙ 配置</div>';
            container.classList.add('has-items');
            return;
        }
        if (this._searchAbort) this._searchAbort.abort();
        this._searchAbort = new AbortController();
        const signal = this._searchAbort.signal;
        container.innerHTML = '<div class="search-hint">搜索中...</div>';
        container.classList.add('has-items');
        try {
            const c = this.map.getCenter();
            const centerKey = `${Math.round(c.lat * 100)}_${Math.round(c.lng * 100)}`;
            let cityCode = '', cityName = '';
            if (this._geocodeCache && this._geocodeCache.key === centerKey) {
                cityCode = this._geocodeCache.cityCode;
                cityName = this._geocodeCache.cityName;
            } else {
                const cityResp = await fetch(`https://restapi.amap.com/v3/geocode/regeo?key=${this._gaodeKey}&location=${c.lng},${c.lat}&extensions=base`, { signal }).then(r => r.json()).catch(() => null);
                if (signal.aborted) return;
                cityCode = cityResp?.regeocode?.addressComponent?.citycode || '';
                cityName = cityResp?.regeocode?.addressComponent?.city || '';
                this._geocodeCache = { key: centerKey, cityCode, cityName };
            }
            let url = `https://restapi.amap.com/v3/place/text?key=${this._gaodeKey}&keywords=${encodeURIComponent(query)}&offset=10&extensions=all`;
            if (cityCode) url += `&city=${cityCode}&citylimit=true`;
            const results = await fetch(url, { signal }).then(r => r.json());
            if (signal.aborted) return;
            if (!results.pois || !results.pois.length) { container.innerHTML = '<div class="search-hint">未找到结果</div>'; return; }
            container.innerHTML = (cityName ? `<div class="search-hint">搜索范围: ${cityName}</div>` : '') +
                results.pois.slice(0, 8).map(p => {
                const loc = p.location.split(',');
                const gcjLng = parseFloat(loc[0]), gcjLat = parseFloat(loc[1]);
                const wgs = L.GCJ02.gcj02ToWgs84(gcjLat, gcjLng);
                const addr = p.address ? (Array.isArray(p.address) ? p.address.join(' ') : p.address) : '';
                return `<div class="search-result-item" onclick="App.goToPlace(${wgs.lat},${wgs.lng},\`${this.escA(p.name)}\`)"><div class="result-name">${this.escH(p.name)}</div><div class="result-sub">${this.escH(addr || p.cityname || '')}</div></div>`;
            }).join('');
        } catch (e) { if (e.name !== 'AbortError') container.innerHTML = '<div class="search-hint">搜索失败，请检查 API Key</div>'; }
    },

    goToPlace(lat, lon, name) {
        this.map.setView([lat, lon], 16);
        if (this.searchMarker && this.map.hasLayer(this.searchMarker)) this.map.removeLayer(this.searchMarker);
        const popupHtml = name + '<br><button class="marker-delete-btn" data-action="delete-marker">删除标记</button>';
        this.searchMarker = this.createMarkerWithPopup([lat, lon], popupHtml);
        this._dom.searchResults.classList.remove('has-items');
        this.closeSidebarOnMobile();
    },

    searchLayer(query) {
        const container = this._dom.searchResults;
        const q = query.toLowerCase();
        const matches = [];
        for (const [, { layer, name: ln }] of Object.entries(this.importedLayers)) {
            layer.eachLayer(sub => {
                const f = sub.feature;
                if (!f?.properties) return;
                const name = (f.properties.name || '').toLowerCase();
                if (name.includes(q)) { matches.push({ display: f.properties.name || ln, sub: `来自: ${ln}`, layer: sub, latlng: this.getCenter(sub, f) }); return; }
                for (const [k, v] of Object.entries(f.properties)) {
                    if (k.startsWith('_') || k === 'styleUrl' || k === 'styleHash') continue;
                    if (String(v).toLowerCase().includes(q)) { matches.push({ display: f.properties.name || ln, sub: `${k}: ${v}`, layer: sub, latlng: this.getCenter(sub, f) }); return; }
                }
            });
        }
        if (!matches.length) { container.innerHTML = '<div class="search-hint">未找到匹配</div>'; container.classList.add('has-items'); return; }
        const limit = matches.slice(0, 50);
        container.innerHTML = `<div class="search-hint">找到 ${matches.length} 个${matches.length > 50 ? '（前50）' : ''}</div>` + limit.map((m, i) => `<div class="search-result-item layer-match" onclick="App.goToLayer(${i})"><div class="result-name">${this.escH(m.display)}</div><div class="result-sub">${this.escH(m.sub)}</div></div>`).join('');
        container.classList.add('has-items');
        this._lastSearch = limit;
    },

    goToLayer(i) {
        const m = this._lastSearch?.[i];
        if (!m) return;
        if (m.latlng) this.map.setView(m.latlng, 17);
        if (m.layer._popupFeature && !m.layer._popupBound) {
            m.layer._popupBound = true;
            const html = App.getPopup(m.layer._popupFeature, m.layer._layerName);
            if (html) m.layer.bindPopup(html, { className: 'layer-popup', maxHeight: Math.min(window.innerHeight - 120, 400) });
        }
        if (m.layer.openPopup) m.layer.openPopup();
        this.closeSidebarOnMobile();
    },

    getCenter(sub, f) {
        if (f.geometry?.type === 'Point') { const c = f.geometry.coordinates; return [c[1], c[0]]; }
        return sub.getBounds?.().isValid?.() ? sub.getBounds().getCenter() : null;
    },

    createMarkerWithPopup(latlng, popupHtml, options = {}) {
        const marker = L.marker(latlng).addTo(this.map);
        marker.bindPopup(popupHtml);
        marker.on('popupopen', () => {
            const btn = marker.getPopup().getElement()?.querySelector('[data-action="delete-marker"]');
            if (btn) btn.addEventListener('click', () => {
                if (this.map.hasLayer(marker)) this.map.removeLayer(marker);
                if (options.onDelete) options.onDelete();
            });
        });
        marker.openPopup();
        return marker;
    },

    _buildSearchIndex(layerId) {
        const data = this.importedLayers[layerId];
        if (!data) return;
        const index = [];
        const nameInverted = new Map();
        const descInverted = new Map();
        const skip = new Set(['_kmlStyle', '_styleUrl', 'styleUrl', 'styleHash']);
        const htmlRe = /<[^>]+>/g;
        data.layer.eachLayer(sub => {
            const f = sub.feature;
            if (!f?.properties) return;
            const name = f.properties.name || '';
            let nameText = name.toLowerCase();
            let descText = '';
            const kd = f.properties._kmlDescription;
            if (kd) {
                descText = kd.replace(htmlRe, ' ').toLowerCase();
            }
            const idx = index.length;
            index.push({ display: name || data.name, sub, latlng: this.getCenter(sub, f), nameText, descText });
            if (name) {
                const token = name.toLowerCase();
                if (!nameInverted.has(token)) nameInverted.set(token, []);
                nameInverted.get(token).push(idx);
            }
            if (descText) {
                for (const [k, v] of Object.entries(f.properties)) {
                    if (skip.has(k) || k.startsWith('_') || k === 'name') continue;
                    if (v && String(v).length <= 50) {
                        const token = String(v).toLowerCase();
                        if (!descInverted.has(token)) descInverted.set(token, []);
                        descInverted.get(token).push(idx);
                    }
                }
            }
        });
        data._searchIndex = index;
        data._nameInverted = nameInverted;
        data._descInverted = descInverted;
    },

    escH(s) { return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : ''; },
    escA(s) { return s ? String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\(/g, '\\(').replace(/\)/g, '\\)') : ''; },

    _ctxLatLng: null,

    hideContextMenu() {
        this._dom.contextMenu.classList.remove('show');
        if (this._ctxMarker) {
            this.map.removeLayer(this._ctxMarker);
            this._ctxMarker = null;
        }
    },

    _showContextMenu(latlng, cx, cy) {
        this._ctxLatLng = latlng;

        if (this._ctxMarker) this.map.removeLayer(this._ctxMarker);
        this._ctxMarker = L.marker([latlng.lat, latlng.lng], {
            icon: L.divIcon({
                className: 'ctx-indicator',
                html: '<div style="width:16px;height:16px;border:3px solid #e74c3c;border-radius:50%;background:rgba(231,76,60,0.3);animation:ctx-pulse 1.2s ease-out infinite"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        }).addTo(this.map);

        const menu = this._dom.contextMenu;
        this._dom.ctxCoord.innerHTML =
            `经度: ${latlng.lng.toFixed(6)}<br>纬度: ${latlng.lat.toFixed(6)}`;
        menu.style.left = cx + 'px';
        menu.style.top = cy + 'px';
        menu.classList.add('show');
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = Math.max(0, cx - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = Math.max(0, cy - rect.height) + 'px';
        if (rect.left < 0) menu.style.left = '0px';
        if (rect.top < 0) menu.style.top = '0px';
    },

    copyCoord() {
        if (!this._ctxLatLng) return;
        const text = `${this._ctxLatLng.lng.toFixed(6)}, ${this._ctxLatLng.lat.toFixed(6)}`;
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.querySelector('.context-actions button');
            const orig = btn.textContent;
            btn.textContent = '已复制!';
            setTimeout(() => { btn.textContent = orig; }, 1000);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
        this.hideContextMenu();
    },

    searchFromCtx() {
        if (!this._ctxLatLng) return;
        const ll = this._ctxLatLng;
        this.hideContextMenu();
        this.map.setView([ll.lat, ll.lng], 16);
        if (this.coordMarker && this.map.hasLayer(this.coordMarker)) this.map.removeLayer(this.coordMarker);
        const popupHtml = `经度: ${ll.lng.toFixed(6)}<br>纬度: ${ll.lat.toFixed(6)}<br><button class="marker-delete-btn" data-action="delete-marker">删除标记</button>`;
        this.coordMarker = this.createMarkerWithPopup([ll.lat, ll.lng], popupHtml);
    },

    addMarkerFromCtx() {
        if (!this._ctxLatLng) return;
        const ll = this._ctxLatLng;
        this.hideContextMenu();
        const name = prompt('标记名称（可留空）:', '') || '';
        const popupHtml = `${name ? '<b>' + this.escH(name) + '</b><br>' : ''}经度: ${ll.lng.toFixed(6)}<br>纬度: ${ll.lat.toFixed(6)}<br><button class="marker-delete-btn" data-action="delete-marker">删除标记</button>`;
        this.createMarkerWithPopup([ll.lat, ll.lng], popupHtml);
    },

    initEventListeners() {
        document.querySelectorAll('input[name="baseLayer"]').forEach(r => r.addEventListener('change', e => this.switchBaseLayer(e.target.value)));
        document.getElementById('importKml').addEventListener('click', () => this.triggerFileInput('.kml'));
        document.getElementById('importGeoJson').addEventListener('click', () => this.triggerFileInput('.geojson,.json'));
        document.getElementById('importGpx').addEventListener('click', () => this.triggerFileInput('.gpx'));
        document.getElementById('fileInput').addEventListener('change', e => this.handleFileImport(e));

        const si = this._dom.searchInput;
        si.addEventListener('keydown', e => { if (e.key === 'Enter') this.doSearch(); });
        si.addEventListener('input', () => {
            clearTimeout(this.searchTimer);
            if (!si.value.trim()) { this._dom.searchResults.classList.remove('has-items'); this._dom.searchResults.innerHTML = ''; return; }
            if (this.searchMode !== 'layer') {
                this.searchTimer = setTimeout(() => this.doSearch(), 400);
            }
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.search-box')) this._dom.searchResults.classList.remove('has-items');
            this.hideContextMenu();
        });

        (this._dom.sidebar || document.getElementById('sidebar')).addEventListener('click', e => {
            if (e.target.closest('.layer-actions') || e.target.closest('.layer-item-name') || e.target.type === 'checkbox') return;
            if (e.target.closest('.layer-item') || e.target.closest('.search-result-item') || e.target.closest('.btn')) {
                this.closeSidebarOnMobile();
            }
        });

        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (!this._isMobile()) {
                    if (this._dom.sidebar) this._dom.sidebar.classList.remove('open');
                    if (this._dom.sidebarOverlay) this._dom.sidebarOverlay.classList.remove('show');
                    if (this._dom.sidebarBtn) this._dom.sidebarBtn.classList.remove('active');
                }
                this.map.invalidateSize();
            }, 300);
        });
        document.addEventListener('contextmenu', e => { if (e.target.closest('#map')) e.preventDefault(); });

        // 移动端长按：仅长按显示经纬度卡片，单击不显示
        this._longPressTimer = null;
        this._longPressFired = false;
        this._ctxTouchPos = null;
        this._pendingContextLatLng = null;
        this._popupOpen = false;

        this.map.on('popupopen', e => {
            this._popupOpen = true;
            const wrapper = e.popup.getElement();
            if (wrapper && !wrapper._stopPropBound) {
                wrapper._stopPropBound = true;
                wrapper.addEventListener('contextmenu', ev => { ev.stopPropagation(); }, true);
                wrapper.addEventListener('touchstart', ev => { ev.stopPropagation(); }, true);
                wrapper.addEventListener('touchmove', ev => { ev.stopPropagation(); }, true);
                wrapper.addEventListener('touchend', ev => { ev.stopPropagation(); }, true);
            }
        });
        this.map.on('popupclose', () => { this._popupOpen = false; });

        this.map.on('contextmenu', e => {
            if (this._popupOpen) return;
            if (this._rightDownPos) {
                const dx = e.originalEvent.clientX - this._rightDownPos.x;
                const dy = e.originalEvent.clientY - this._rightDownPos.y;
                this._rightDownPos = null;
                if (dx * dx + dy * dy > 25) return;
            }
            if (this._longPressTimer) {
                this._pendingContextLatLng = e.latlng;
                return;
            }
            this._showContextMenu(e.latlng, e.originalEvent.clientX, e.originalEvent.clientY);
        });

        this.map.on('touchstart', e => {
            if (e.originalEvent.touches.length !== 1) return;
            if (this._popupOpen) return;
            const touch = e.originalEvent.touches[0];
            this._ctxTouchPos = { x: touch.clientX, y: touch.clientY };
            this._longPressFired = false;
            this._pendingContextLatLng = null;
            clearTimeout(this._longPressTimer);
            this._longPressTimer = setTimeout(() => {
                this._longPressFired = true;
                this._longPressTimer = null;
                const latlng = this._pendingContextLatLng;
                if (latlng && this._ctxTouchPos) {
                    this._showContextMenu(latlng, this._ctxTouchPos.x, this._ctxTouchPos.y);
                }
            }, 600);
        }, { passive: true });
        this.map.on('touchmove', () => {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }, { passive: true });
        this.map.on('touchend', () => {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
            // 短按：确保经纬度卡片关闭
            if (!this._longPressFired) {
                this.hideContextMenu();
            }
        });

        this._rightDownPos = null;
        this.map.on('mousedown', e => {
            if (e.originalEvent.button === 2) this._rightDownPos = { x: e.originalEvent.clientX, y: e.originalEvent.clientY };
        });

        this._cursorLatest = null;
        this.map.on('mousemove', e => {
            this._cursorLatest = e;
            if (this._cursorRaf) return;
            this._cursorRaf = requestAnimationFrame(() => {
                this._cursorRaf = null;
                const ev = this._cursorLatest;
                if (ev) this._dom.cursorPos.textContent = `经度: ${ev.latlng.lng.toFixed(6)}, 纬度: ${ev.latlng.lat.toFixed(6)}`;
            });
        });
        this.map.on('zoomend', () => { this._dom.zoomLevel.textContent = `缩放级别: ${this.map.getZoom()}`; this.debouncedSave(); });
        this.map.on('moveend', () => this.debouncedSave());
        this.map.on(L.Draw.Event.CREATED, e => { this.drawnItems.addLayer(e.layer); this.showMeasure(e.layerType, e.layer); e.layer.openPopup(); });
        this.map.on(L.Draw.Event.EDITED, e => { e.layers.eachLayer(l => this.showMeasure(l.feature?.geometry?.type || 'polygon', l)); });
        this.map.on(L.Draw.Event.DRAWSTOP, () => {
            this.map.dragging.enable();
            this.map.tap && this.map.tap.enable();
            if (this.map._container) this.map._container.style.pointerEvents = '';
        });
    },

    debouncedSave() { clearTimeout(this._saveTimer); this._saveTimer = setTimeout(() => { const c = this.map.getCenter(); const newState = { center: [c.lat, c.lng], zoom: this.map.getZoom(), baseLayer: this.currentBaseLayer, layerOrder: this._layerOrder || [] }; const sig = newState.center[0]+','+newState.center[1]+','+newState.zoom+','+newState.baseLayer+','+newState.layerOrder.join(','); if (sig === this._lastSaveSig) return; this._lastSaveSig = sig; Storage.saveState(newState); }, 300); },

    async restoreState() {
        const s = await Storage.getState();
        if (!s) return;
        if (s.baseLayer && this.baseLayers[s.baseLayer]) { this.switchBaseLayer(s.baseLayer); const r = document.querySelector(`input[name="baseLayer"][value="${s.baseLayer}"]`); if (r) r.checked = true; }
        if (s.center && s.zoom) this.map.setView(s.center, s.zoom);
        if (s.layerOrder) this._layerOrder = s.layerOrder.map(x => String(x));
    },

    async _runConcurrent(tasks, limit = 8) {
        let idx = 0;
        const run = async () => {
            while (idx < tasks.length) {
                const i = idx++;
                await tasks[i]();
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => run()));
    },

    async restoreLayers() {
        const saved = await Storage.getAllLayers();
        if (!saved.length) return;
        const total = saved.length;
        let done = 0;
        this.showLoading(`并行加载 ${total} 个图层 (0/${total})...`);
        const tasks = saved.map(item => async () => {
            try {
                await this.renderLayerAsync(item.text, item.ext, item.name, item.id, item.colorIndex);
                if (item.visible === false) {
                    const d = this.importedLayers[item.id];
                    if (d) { this.map.removeLayer(d.layer); d.visible = false; }
                }
            } catch (e) { console.error('restore failed:', item.name, e); }
            done++;
            this.showLoading(`并行加载图层 (${done}/${total})...`);
        });
        await this._runConcurrent(tasks, 4);
        this.hideLoading();
        this.updateImportedLayersList();
        this.updateLabelOverlay();
    },

    async loadCloudLayers() {
        const files = await CloudReader.getEnabledFiles();
        if (!files.length) return;
        const existingNames = new Set(Object.values(this.importedLayers).map(d => d.name));
        const newFiles = files.filter(f => !existingNames.has(f.name));
        if (!newFiles.length) return;
        const total = newFiles.length;
        let done = 0;
        this.showLoading(`并行加载 ${total} 个云端图层 (0/${total})...`);
        const tasks = newFiles.map((f, i) => async () => {
            try {
                const layerId = 'cloud_' + Date.now() + '_' + i;
                const ci = this.colorIndex++;
                const layer = await this.renderLayerAsync(f.text, f.ext || 'kml', f.name, layerId, ci);
                if (layer) {
                    if (layer.getBounds().isValid()) this.map.fitBounds(layer.getBounds());
                    this.importedLayers[layerId]._cloud = true;
                    this._layerOrder = this._layerOrder || [];
                    this._layerOrder.push(layerId);
                }
            } catch (e) { console.error('cloud layer load failed:', f.name, e); }
            done++;
            this.showLoading(`并行加载云端图层 (${done}/${total})...`);
        });
        await this._runConcurrent(tasks, 8);
        this.hideLoading();
        this.updateImportedLayersList();
        this.updateLabelOverlay();
        this.debouncedSave();
    },

    switchBaseLayer(n) {
        if (!this.baseLayers[n]) return;
        if (this.currentBaseLayer) {
            if (this.map.hasLayer(this.baseLayers[this.currentBaseLayer])) {
                this.map.removeLayer(this.baseLayers[this.currentBaseLayer]);
            }
        }
        const isGCJ02 = (n === 'gaode' || n === 'gaodeSatellite');
        const currentIsGCJ02 = this.map.options.crs === L.CRS.GCJ02;
        if (isGCJ02 !== currentIsGCJ02) {
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            this.map.options.crs = isGCJ02 ? L.CRS.GCJ02 : L.CRS.EPSG3857;
            this.map.setView(center, zoom, { reset: true });
        }
        this.baseLayers[n].addTo(this.map);
        this.currentBaseLayer = n;
    },
    triggerFileInput(a) { document.getElementById('fileInput').accept = a; document.getElementById('fileInput').click(); },

    kmlColorToRgba(c) {
        if (!c) return null;
        const hex = c.trim().replace('#', '');
        if (hex.length === 8) { const a = parseInt(hex.substring(0, 2), 16) / 255; const r = parseInt(hex.substring(6, 8), 16); const g = parseInt(hex.substring(4, 6), 16); const b = parseInt(hex.substring(2, 4), 16); return { hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), a }; }
        if (hex.length === 6) { const r = parseInt(hex.substring(4, 6), 16); const g = parseInt(hex.substring(2, 4), 16); const b = parseInt(hex.substring(0, 2), 16); return { hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), a: 0.5 }; }
        return null;
    },

    parseStyle(el) {
        const r = {};
        const ps = el.querySelector('PolyStyle');
        if (ps) {
            const c = ps.querySelector('color');
            if (c) { const v = this.kmlColorToRgba(c.textContent); if (v) { r.fillColor = v.hex; r.fillOpacity = v.a; } }
            if (ps.querySelector('fill')?.textContent.trim() === '0') r.fillOpacity = 0;
            if (ps.querySelector('outline')?.textContent.trim() === '0') r.stroke = false;
        }
        const ls = el.querySelector('LineStyle');
        if (ls) {
            const c = ls.querySelector('color');
            if (c) { const v = this.kmlColorToRgba(c.textContent); if (v) { r.color = v.hex; r.opacity = v.a; } }
            const w = ls.querySelector('width');
            if (w) r.weight = parseInt(w.textContent.trim()) || 2;
        }
        const is = el.querySelector('IconStyle');
        if (is) {
            const c = is.querySelector('color');
            if (c) { const v = this.kmlColorToRgba(c.textContent); if (v) r.markerColor = v.hex; }
            r.hasIcon = true;
        }
        if (el.querySelector('LabelStyle')) r.hasLabel = true;
        if (r.hasLabel && !r.hasIcon && !r.fillColor && !r.color) r._hideMarker = true;
        return r;
    },

    enrichKml(geoJson, kmlDoc) {
        const sm = {};
        const styles = kmlDoc.getElementsByTagName('Style');
        for (let i = 0; i < styles.length; i++) {
            const el = styles[i];
            const id = el.getAttribute('id');
            if (id) sm['#' + id] = this.parseStyle(el);
        }
        const styleMaps = kmlDoc.getElementsByTagName('StyleMap');
        for (let i = 0; i < styleMaps.length; i++) {
            const el = styleMaps[i];
            const id = el.getAttribute('id');
            if (!id) continue;
            const p = el.querySelector('Pair');
            if (p) { const u = p.querySelector('styleUrl'); if (u) { const ref = u.textContent.trim(); if (sm[ref]) sm['#' + id] = sm[ref]; } }
        }

        const apply = (pm, f) => {
            const ist = pm.querySelector('Style');
            if (ist) f.properties._kmlStyle = this.parseStyle(ist);
            const su = pm.querySelector('styleUrl');
            if (su) { const ref = su.textContent.trim(); f.properties._styleUrl = ref; if (!f.properties._kmlStyle && sm[ref]) f.properties._kmlStyle = sm[ref]; }
            const de = pm.querySelector('description');
            if (de) f.properties._kmlDescription = de.textContent.trim();
            const gt = f.geometry?.type;
            if ((gt === 'Point' || gt === 'MultiPoint') && !f.properties._kmlStyle?._hideMarker) {
                const hasLabelProp = 'label-opacity' in f.properties || 'label-color' in f.properties || 'label-scale' in f.properties;
                const hasIconProp = 'icon-opacity' in f.properties || 'icon-color' in f.properties || 'icon-scale' in f.properties || 'icon-offset' in f.properties;
                if (hasLabelProp && !hasIconProp) {
                    if (!f.properties._kmlStyle) f.properties._kmlStyle = {};
                    f.properties._kmlStyle._hideMarker = true;
                }
            }
        };

        const pms = kmlDoc.getElementsByTagName('Placemark');
        if (pms.length === geoJson.features.length) {
            for (let i = 0; i < pms.length; i++) apply(pms[i], geoJson.features[i]);
        } else {
            const fByName = new Map();
            for (const f of geoJson.features) {
                const n = f.properties?.name;
                if (n) fByName.set(n, f);
            }
            for (let i = 0; i < pms.length; i++) {
                const pm = pms[i];
                const nm = pm.querySelector('name');
                if (nm) { const f = fByName.get(nm.textContent.trim()); if (f) apply(pm, f); }
            }
        }
    },

    getStyle(f, fallback) {
        const ks = f.properties?._kmlStyle;
        const gt = f.geometry?.type;
        if (ks) {
            if (gt === 'Polygon' || gt === 'MultiPolygon') return { color: ks.color || fallback, weight: ks.weight || 2, opacity: ks.opacity ?? 1, fillColor: ks.fillColor || fallback, fillOpacity: ks.fillOpacity ?? 0.3, stroke: ks.stroke !== false };
            if (gt === 'LineString' || gt === 'MultiLineString') return { color: ks.color || fallback, weight: ks.weight || 3, opacity: ks.opacity ?? 1 };
        }
        if (gt === 'Polygon' || gt === 'MultiPolygon') return { color: fallback, weight: 2, fillColor: fallback, fillOpacity: 0.3 };
        return { color: fallback, weight: 3 };
    },

    _skipProps: new Set(['styleUrl', 'styleHash', '_kmlStyle', '_styleUrl', '_kmlDescription']),

    getPopup(f, layerName) {
        const id = f._popupId ?? (f._popupId = (this._popupIdCounter = (this._popupIdCounter || 0) + 1));
        const cached = this._popupLru.get(id);
        if (cached !== undefined) { this._popupLru.delete(id); this._popupLru.set(id, cached); return cached; }
        const featureName = f.properties?.name || '';
        const kd = f.properties?._kmlDescription;
        if (kd) {
            let h = '';
            if (layerName) h += `<div class="popup-layer-tag">${this.escH(layerName)}</div>`;
            if (featureName) h += `<div class="popup-title">${this.escH(featureName)}</div>`;
            const result = h + kd;
            this._popupLru.set(id, result); if (this._popupLru.size > 500) this._popupLru.delete(this._popupLru.keys().next().value); return result;
        }
        if (!f.properties) { this._popupLru.set(id, ''); return ''; }
        const entries = Object.entries(f.properties).filter(([k, v]) => v && !this._skipProps.has(k));
        if (!entries.length) { this._popupLru.set(id, ''); return ''; }
        let h = '';
        if (layerName) h += `<div class="popup-layer-tag">${this.escH(layerName)}</div>`;
        if (featureName) h += `<div class="popup-title">${this.escH(featureName)}</div>`;
        h += '<table class="popup-table">';
        for (const [k, v] of entries) { if (k !== 'name') h += `<tr><td class="popup-key">${this.escH(k)}</td><td class="popup-val">${this.escH(String(v))}</td></tr>`; }
        const html = h + '</table>';
        this._popupLru.set(id, html);
        if (this._popupLru.size > 500) this._popupLru.delete(this._popupLru.keys().next().value);
        return html;
    },

    async renderLayerAsync(text, ext, fileName, layerId, ci, onProgress) {
        const fallback = this.layerColors[ci % this.layerColors.length];
        let geoJson = null;

        if (ext === 'kml') {
            if (onProgress) onProgress('解析 KML...');
            const doc = new DOMParser().parseFromString(text, 'text/xml');
            geoJson = toGeoJSON.kml(doc);
            if (onProgress) onProgress('提取样式...');
            await new Promise(r => setTimeout(r, 0));
            this.enrichKml(geoJson, doc);
        } else if (ext === 'geojson' || ext === 'json') {
            geoJson = JSON.parse(text);
        } else if (ext === 'gpx') {
            geoJson = toGeoJSON.gpx(new DOMParser().parseFromString(text, 'text/xml'));
        }
        if (!geoJson) return null;

        const features = geoJson.features;
        const total = features.length;
        const labelCache = [];
        const self = this;
        const group = L.featureGroup();

        let i = 0;
        let chunkSize = 500;
        let lastTime = performance.now();

        while (i < total) {
            const end = Math.min(i + chunkSize, total);
            if (onProgress) onProgress(`渲染 ${end}/${total}...`);

            for (let j = i; j < end; j++) {
                const f = features[j];
                const gt = f.geometry?.type;
                let layer = null;

                if (gt === 'Point' || gt === 'MultiPoint') {
                    const ks = f.properties?._kmlStyle;
                    if (ks?._hideMarker) {
                        const ll = L.GeoJSON.coordsToLatLng(f.geometry.coordinates);
                        labelCache.push({ text: f.properties?.name || '', latlng: ll, type: 'point' });
                        continue;
                    }
                    const ll = L.GeoJSON.coordsToLatLng(f.geometry.coordinates);
                    const m = L.circleMarker(ll, {
                        renderer: self.canvasRenderer, radius: 6,
                        fillColor: ks?.markerColor || fallback, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8
                    });
                    m.feature = f;
                    if (f.properties?.name) labelCache.push({ text: f.properties.name, latlng: ll, type: 'point' });
                    layer = m;
                } else {
                    layer = L.GeoJSON.geometryToLayer(f, {
                        renderer: self.canvasRenderer
                    });
                    layer.feature = f;
                    if (layer.setStyle) layer.setStyle(self.getStyle(f, fallback));
                    if ((gt === 'Polygon' || gt === 'MultiPolygon') && f.properties?.name) {
                        labelCache.push({ text: f.properties.name, bounds: layer.getBounds(), type: 'polygon' });
                    }
                }

                if (layer) {
                    layer._popupFeature = f;
                    layer._layerName = fileName;
                    group.addLayer(layer);
                }
            }

            i = end;
            if (i < total) {
                const elapsed = performance.now() - lastTime;
                chunkSize = elapsed < 8 ? Math.min(2000, chunkSize * 2) : elapsed > 30 ? Math.max(200, Math.floor(chunkSize / 2)) : chunkSize;
                lastTime = performance.now();
                await new Promise(r => requestAnimationFrame(r));
            }
        }

        group.addTo(this.map);
        const groupFileName = fileName;
        group.on('click', function(e) {
            const layer = e.layer;
            if (layer._popupBound) return;
            layer._popupBound = true;
            const html = App.getPopup(layer._popupFeature, layer._layerName || groupFileName);
            if (html) {
                layer.bindPopup(html, { className: 'layer-popup', maxHeight: Math.min(window.innerHeight - 120, 400) });
                layer.openPopup();
            }
        });
        this.importedLayers[layerId] = { layer: group, name: fileName, color: fallback, _labelCache: labelCache, ext, colorIndex: ci };
        return group;
    },

    showLoading(msg) {
        let o = this._dom.loadingOverlay;
        if (!o) { o = document.createElement('div'); o.id = 'loadingOverlay'; o.innerHTML = '<div class="loading-spinner"></div><div class="loading-text"></div>'; document.body.appendChild(o); this._dom.loadingOverlay = o; }
        o.querySelector('.loading-text').textContent = msg || '加载中...';
        o.style.display = 'flex';
    },
    hideLoading() { const o = this._dom.loadingOverlay; if (o) o.style.display = 'none'; },

    async handleFileImport(event) {
        const file = event.target.files[0];
        if (!file || this._importing) return;
        this._importing = true;
        const fileName = file.name, ext = file.name.split('.').pop().toLowerCase(), ci = this.colorIndex++;
        try {
            this.showLoading('读取文件...');
            const text = await file.text();
            const layerId = Date.now();
            const layer = await this.renderLayerAsync(text, ext, fileName, layerId, ci, msg => this.showLoading(msg));
            if (!layer) return;
            if (layer.getBounds().isValid()) this.map.fitBounds(layer.getBounds());
            this.showLoading('保存...');
            await Storage.saveLayer(layerId, { name: fileName, ext, text, colorIndex: ci });
            this.updateImportedLayersList();
            this.debouncedSave();
            this.updateLabelOverlay();
        } catch (err) { alert('导入失败: ' + err.message); console.error(err); }
        finally { this._importing = false; }
        this.hideLoading();
        event.target.value = '';
    },

    updateImportedLayersList() {
        if (this._layerListRaf) return;
        this._layerListRaf = requestAnimationFrame(() => {
            this._layerListRaf = null;
            this._doUpdateImportedLayersList();
        });
    },
    _doUpdateImportedLayersList() {
        const c = this._dom.importedLayers;
        const ids = Object.keys(this.importedLayers);
        if (!ids.length) { c.innerHTML = '<p class="empty-hint">暂无导入图层</p>'; return; }
        if (!this._layerOrder || !this._layerOrder.length) this._layerOrder = ids;
        this._layerOrder = this._layerOrder.filter(id => this.importedLayers[id]);
        const orderSet = new Set(this._layerOrder);
        for (const id of ids) { if (!orderSet.has(id)) this._layerOrder.push(id); }

        const fragment = document.createDocumentFragment();
        const orderLen = this._layerOrder.length;
        for (let i = 0; i < orderLen; i++) {
            const id = this._layerOrder[i];
            const d = this.importedLayers[id];
            if (!d) continue;
            const div = document.createElement('div');
            div.className = 'layer-item';
            div.draggable = true;
            div.dataset.id = id;
            const cloudIcon = d._cloud ? '&#9729; ' : '';
            const checkedAttr = d.visible !== false ? 'checked' : '';
            const moveUpDisabled = i === 0 ? 'disabled' : '';
            const moveDownDisabled = i === orderLen - 1 ? 'disabled' : '';
            div.innerHTML = `<input type="checkbox" ${checkedAttr} onchange="App.toggleLayer('${id}',this.checked)">
                <span class="layer-color-indicator" style="background:${d.color}"></span>
                <div class="layer-item-info">
                    <span class="layer-item-name" ondblclick="App.startRename('${id}',this)">${cloudIcon}${this.escH(d.name)}</span>
                    <div class="layer-actions">
                        <button title="上移" onclick="App.moveLayer('${id}',-1)" ${moveUpDisabled}>&#9650;</button>
                        <button title="下移" onclick="App.moveLayer('${id}',1)" ${moveDownDisabled}>&#9660;</button>
                        <button title="删除" onclick="App.removeLayer('${id}')" style="color:#e74c3c">&#10005;</button>
                    </div>
                </div>`;
            fragment.appendChild(div);
        }
        c.innerHTML = '';
        c.appendChild(fragment);
        this._bindLayerDrag();
    },

    _bindLayerDrag() {
        if (this._layerDragBound) return;
        this._layerDragBound = true;
        const container = this._dom.importedLayers;
        let dragId = null;
        container.addEventListener('dragstart', e => {
            const el = e.target.closest('.layer-item[draggable]');
            if (!el) return;
            dragId = el.dataset.id;
            el.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
        });
        container.addEventListener('dragend', e => {
            const el = e.target.closest('.layer-item[draggable]');
            if (el) el.style.opacity = '1';
            dragId = null;
        });
        container.addEventListener('dragover', e => {
            const el = e.target.closest('.layer-item[draggable]');
            if (!el) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.style.borderTop = '2px solid #3498db';
        });
        container.addEventListener('dragleave', e => {
            const el = e.target.closest('.layer-item[draggable]');
            if (el) el.style.borderTop = '';
        });
        container.addEventListener('drop', e => {
            e.preventDefault();
            const el = e.target.closest('.layer-item[draggable]');
            if (!el) return;
            el.style.borderTop = '';
            if (!dragId || dragId === el.dataset.id) return;
            const order = this._layerOrder;
            const dragStr = String(dragId);
            const dropStr = String(el.dataset.id);
            const fromIdx = order.findIndex(x => String(x) === dragStr);
            const toIdx = order.findIndex(x => String(x) === dropStr);
            if (fromIdx < 0 || toIdx < 0) return;
            order.splice(fromIdx, 1);
            order.splice(toIdx, 0, dragId);
            this.updateImportedLayersList();
            this.debouncedSave();
        });

        this._bindLayerTouchDrag(container);
    },

    _bindLayerTouchDrag(container) {
        let touchDragId = null;
        let touchDragEl = null;
        let clone = null;
        let startX = 0, startY = 0;
        let started = false;
        let currentDropEl = null;
        const DRAG_THRESHOLD = 8;

        const clearIndicator = () => {
            if (currentDropEl) { currentDropEl.style.borderTop = ''; currentDropEl = null; }
        };

        const getDropTarget = (x, y) => {
            if (clone) clone.style.pointerEvents = 'none';
            const el = document.elementFromPoint(x, y);
            if (clone) clone.style.pointerEvents = '';
            return el ? el.closest('.layer-item[draggable]') : null;
        };

        container.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) return;
            const el = e.target.closest('.layer-item[draggable]');
            if (!el) return;
            const actionsBtn = e.target.closest('.layer-actions button');
            if (actionsBtn) return;
            const t = e.touches[0];
            startX = t.clientX;
            startY = t.clientY;
            touchDragId = el.dataset.id;
            touchDragEl = el;
            started = false;
        }, { passive: true });

        container.addEventListener('touchmove', e => {
            if (!touchDragId) return;
            const t = e.touches[0];
            if (!started) {
                if (Math.abs(t.clientX - startX) < DRAG_THRESHOLD && Math.abs(t.clientY - startY) < DRAG_THRESHOLD) return;
                started = true;
                touchDragEl.style.opacity = '0.4';
                clone = touchDragEl.cloneNode(true);
                clone.style.cssText = 'position:fixed;left:0;top:0;z-index:10000;pointer-events:none;opacity:0.85;width:' + touchDragEl.offsetWidth + 'px;background:#2c3e50;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
                document.body.appendChild(clone);
            }
            e.preventDefault();
            clone.style.transform = 'translate(' + t.clientX + 'px,' + (t.clientY - touchDragEl.offsetHeight / 2) + 'px)';
            clearIndicator();
            const target = getDropTarget(t.clientX, t.clientY);
            if (target && target.dataset.id !== touchDragId) {
                target.style.borderTop = '2px solid #3498db';
                currentDropEl = target;
            }
        }, { passive: false });

        const finish = () => {
            if (!touchDragId) return;
            const dropEl = currentDropEl;
            clearIndicator();
            if (clone) { document.body.removeChild(clone); clone = null; }
            if (touchDragEl) touchDragEl.style.opacity = '1';
            if (started && dropEl) {
                const dropId = dropEl.dataset.id;
                if (dropId && dropId !== touchDragId) {
                    const order = this._layerOrder;
                    const dragStr = String(touchDragId);
                    const fromIdx = order.findIndex(x => String(x) === dragStr);
                    const toIdx = order.findIndex(x => String(x) === String(dropId));
                    if (fromIdx >= 0 && toIdx >= 0) {
                        order.splice(fromIdx, 1);
                        order.splice(toIdx, 0, touchDragId);
                        this.updateImportedLayersList();
                        this.debouncedSave();
                    }
                }
            }
            touchDragId = null;
            touchDragEl = null;
            started = false;
        };

        container.addEventListener('touchend', finish, { passive: true });
        container.addEventListener('touchcancel', finish, { passive: true });
    },

    moveLayer(id, dir) {
        const order = this._layerOrder;
        const idStr = String(id);
        const idx = order.findIndex(x => String(x) === idStr);
        if (idx < 0) return;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= order.length) return;
        [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
        this.updateImportedLayersList();
        this.debouncedSave();
    },

    startRename(id, el) {
        const d = this.importedLayers[id];
        if (!d) return;
        const input = document.createElement('input');
        input.value = d.name;
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();
        const finish = async () => {
            const newName = input.value.trim() || d.name;
            d.name = newName;
            d._searchIndex = null;
            d._nameInverted = null;
            d._descInverted = null;
            el.textContent = newName;
            const saved = await Storage.getLayer(id);
            if (saved) await Storage.saveLayer(id, { ...saved, name: d.name });
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = d.name; input.blur(); } });
    },

    async toggleLayer(id, vis) {
        const d = this.importedLayers[id];
        if (d) {
            d.visible = vis;
            if (vis && !this.map.hasLayer(d.layer)) this.map.addLayer(d.layer);
            else if (!vis && this.map.hasLayer(d.layer)) this.map.removeLayer(d.layer);
            this.updateLabelOverlay();
            try {
                const saved = await Storage.getLayer(id);
                if (saved) await Storage.saveLayer(id, { ...saved, visible: vis });
            } catch (e) { console.error('toggleLayer save failed:', id, e); }
        }
    },

    toggleAllLayers() {
        const btn = document.getElementById('toggleAllLayersBtn');
        if (!this._allLayersHidden) {
            this._savedLayerVisibility = {};
            for (const [id, d] of Object.entries(this.importedLayers)) {
                this._savedLayerVisibility[id] = d.visible !== false;
                if (this.map.hasLayer(d.layer)) this.map.removeLayer(d.layer);
                d.visible = false;
            }
            this._allLayersHidden = true;
            if (btn) {
                btn.innerHTML = '&#128064; 恢复显示';
                btn.title = '恢复显示隐藏前的图层';
            }
        } else {
            for (const [id, d] of Object.entries(this.importedLayers)) {
                if (this._savedLayerVisibility[id] && !this.map.hasLayer(d.layer)) {
                    this.map.addLayer(d.layer);
                    d.visible = true;
                } else if (!this._savedLayerVisibility[id] && this.map.hasLayer(d.layer)) {
                    this.map.removeLayer(d.layer);
                    d.visible = false;
                }
            }
            this._allLayersHidden = false;
            this._savedLayerVisibility = {};
            if (btn) {
                btn.innerHTML = '&#128065; 隐藏全部';
                btn.title = '隐藏/显示全部图层';
            }
        }
        this._flatLabelCache = null;
        this.updateImportedLayersList();
        this.updateLabelOverlay();
    },

    async removeLayer(id) {
        const d = this.importedLayers[id];
        if (d) {
            if (this.map.hasLayer(d.layer)) this.map.removeLayer(d.layer);
            delete this.importedLayers[id];
            this._layerOrder = (this._layerOrder || []).filter(x => String(x) !== String(id));
            this._flatLabelCache = null;
            if (d._searchIndex) d._searchIndex = null;
            if (d._nameInverted) d._nameInverted = null;
            if (d._descInverted) d._descInverted = null;
            await Storage.removeLayer(id);
            this.updateImportedLayersList();
            this.updateLabelOverlay();
        }
    },

    showMeasure(type, layer) {
        const c = this._dom.measureResults;
        let label = '', body = '', popupHtml = '';
        if (type === 'polyline') {
            const ll = layer.getLatLngs();
            let d = 0;
            for (let i = 1; i < ll.length; i++) d += ll[i-1].distanceTo(ll[i]);
            label = '线段';
            let angleHtml = '';
            let popupAngle = '';
            if (ll.length >= 2) {
                const bearing = this.calcBearing(ll[0], ll[ll.length - 1]);
                const dir = this.bearingDir(bearing);
                angleHtml = `<div class="value">方位角: ${bearing.toFixed(1)}° (${dir})</div>`;
                popupAngle = `<br>方位角: <strong>${bearing.toFixed(1)}°</strong> (${dir})`;
            }
            body = `<div class="value">长度: ${this.fmtD(d)}</div>${angleHtml}`;
            popupHtml = `<div class="popup-title">📏 ${label}</div><div class="popup-body">长度: <strong>${this.fmtD(d)}</strong>${popupAngle}</div>`;
        } else if (type === 'polygon' || type === 'rectangle') {
            const ll = layer.getLatLngs()[0];
            label = type === 'rectangle' ? '矩形' : '多边形';
            const area = this.fmtA(this.calcA(ll));
            const perimeter = this.fmtD(this.calcP(ll));
            body = `<div class="value">面积: ${area}</div><div class="value">周长: ${perimeter}</div>`;
            popupHtml = `<div class="popup-title">📐 ${label}</div><div class="popup-body">面积: <strong>${area}</strong><br>周长: <strong>${perimeter}</strong></div>`;
        } else if (type === 'circle') {
            const r = layer.getRadius();
            label = '圆形';
            const area = this.fmtA(Math.PI * r * r);
            body = `<div class="value">半径: ${this.fmtD(r)}</div><div class="value">面积: ${area}</div>`;
            popupHtml = `<div class="popup-title">⭕ ${label}</div><div class="popup-body">半径: <strong>${this.fmtD(r)}</strong><br>面积: <strong>${area}</strong></div>`;
        } else if (type === 'marker') {
            const ll = layer.getLatLng();
            label = '标记';
            body = '';
            popupHtml = `<div class="popup-title">📍 ${label}</div><div class="popup-body">经度: <strong>${ll.lng.toFixed(6)}</strong><br>纬度: <strong>${ll.lat.toFixed(6)}</strong></div>`;
        }
        if (body) c.innerHTML = `<div class="measure-result"><div class="label">${label}</div>${body}</div>` + c.innerHTML;
        if (popupHtml) layer.bindPopup(popupHtml, { className: 'measure-popup' });
    },

    calcBearing(p1, p2) {
        const toRad = Math.PI / 180;
        const lat1 = p1.lat * toRad, lat2 = p2.lat * toRad;
        const dLng = (p2.lng - p1.lng) * toRad;
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    },
    bearingDir(b) {
        const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
        return dirs[Math.round(b / 45) % 8];
    },
    calcA(ll) { let a = 0; for (let i = 0, n = ll.length; i < n; i++) { const j = (i+1)%n; a += ll[i].lat*ll[j].lng - ll[j].lat*ll[i].lng; } return Math.abs(a)/2*111319.9*111319.9; },
    calcP(ll) { let p = 0; for (let i = 0; i < ll.length; i++) p += ll[i].distanceTo(ll[(i+1)%ll.length]); return p; },
    fmtD(m) { return m >= 1000 ? (m/1000).toFixed(2)+' 公里' : m.toFixed(2)+' 米'; },
    fmtA(s) { if (s >= 1e6) return (s/1e6).toFixed(2)+' 平方公里'; if (s >= 1e4) return (s/1e4).toFixed(2)+' 公顷'; return s.toFixed(2)+' 平方米'; },

    clearMeasurements() { this.drawnItems.clearLayers(); this._dom.measureResults.innerHTML = '<p class="empty-hint">使用绘图工具进行测量</p>'; },
    async clearAllData() { if (!confirm('确定清除所有数据？')) return; await Storage.clearAll(); alert('已清除，请刷新页面'); },

    _remoteFiles: [],
    _cloudTab: 'cloud',

    async openCloudSync() {
        const modal = document.getElementById('cloudSyncModal');
        modal.style.display = 'flex';

        const apiInput = document.getElementById('cloudApiInput');
        apiInput.value = localStorage.getItem('ov-map-cloud-api') || '';

        this.switchCloudTab('cloud');
        this._loadLocalCloudFiles();

        if (apiInput.value.trim()) {
            this.connectCloudApi();
        }
    },

    closeCloudSync() {
        document.getElementById('cloudSyncModal').style.display = 'none';
    },

    switchCloudTab(tab) {
        this._cloudTab = tab;
        document.querySelectorAll('.cloud-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });
        document.getElementById('cloudTabCloud').classList.toggle('active', tab === 'cloud');
        document.getElementById('cloudTabLocal').classList.toggle('active', tab === 'local');
    },

    async connectCloudApi() {
        const apiInput = document.getElementById('cloudApiInput');
        const statusEl = document.getElementById('cloudApiStatus');
        const listEl = document.getElementById('cloudRemoteFileList');
        const apiUrl = (apiInput.value || '').trim().replace(/\/+$/, '');

        if (!apiUrl) {
            statusEl.innerHTML = '';
            listEl.innerHTML = '<div class="cloud-sync-hint">请输入后端 API 地址</div>';
            return;
        }

        statusEl.innerHTML = '<span style="color:#95a5a6">连接中...</span>';
        statusEl.className = 'cloud-api-status';
        listEl.innerHTML = '';

        try {
            const resp = await fetch(apiUrl + '/api/health', { signal: AbortSignal.timeout(3000) });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            if (!data || data.status !== 'ok') throw new Error('服务状态异常');
        } catch (e) {
            statusEl.innerHTML = '连接失败: ' + e.message;
            statusEl.className = 'cloud-api-status err';
            listEl.innerHTML = '';
            return;
        }

        localStorage.setItem('ov-map-cloud-api', apiUrl);
        statusEl.innerHTML = '已连接: ' + apiUrl;
        statusEl.className = 'cloud-api-status ok';

        try {
            const resp = await fetch(apiUrl + '/api/files');
            const files = await resp.json();
            this._remoteFiles = files || [];
            this._renderFileList(listEl, this._remoteFiles, true);
        } catch (e) {
            listEl.innerHTML = '<div class="cloud-sync-hint">获取文件列表失败</div>';
            this._remoteFiles = [];
        }
    },

    async _loadLocalCloudFiles() {
        const listEl = document.getElementById('cloudLocalFileList');
        listEl.innerHTML = '<div class="cloud-sync-hint">加载中...</div>';
        const files = await CloudReader.getAllFiles();
        if (!files.length) {
            listEl.innerHTML = '<div class="cloud-sync-hint">暂无浏览器数据<br><small>可通过图层工具页面同步到浏览器</small></div>';
            return;
        }
        files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        this._renderFileList(listEl, files, false);
    },

    _renderFileList(container, files, isRemote) {
        const existingNames = new Set(Object.values(this.importedLayers).map(d => d.name));
        container.innerHTML = '<div class="cloud-file-list">' + files.map(f => {
            const size = f.size ? (f.size < 1024 ? f.size + ' B' : f.size < 1048576 ? (f.size / 1024).toFixed(1) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB') : '';
            const date = f.createdAt ? new Date(f.createdAt).toLocaleDateString('zh-CN') : '';
            const imported = existingNames.has(f.name);
            return `<label class="cloud-file-item${imported ? ' imported' : ''}" data-id="${f.id}">
                <input type="checkbox" value="${f.id}" data-remote="${isRemote}" ${imported ? 'disabled' : ''}>
                <div class="cloud-file-info">
                    <div class="cloud-file-name">${this.escH(f.name)}${imported ? ' <small style="color:#2ecc71">(已导入)</small>' : ''}</div>
                    <div class="cloud-file-meta">${[size, date].filter(Boolean).join(' · ')}</div>
                </div>
            </label>`;
        }).join('') + '</div>';
    },

    async syncSelectedCloudFiles() {
        const activeTab = this._cloudTab;
        const containerId = activeTab === 'cloud' ? 'cloudRemoteFileList' : 'cloudLocalFileList';
        const checks = document.querySelectorAll('#' + containerId + ' input[type="checkbox"]:checked:not(:disabled)');
        if (!checks.length) { alert('请选择要同步的图层'); return; }

        this.showLoading('正在获取图层...');
        this.closeCloudSync();

        const ids = Array.from(checks).map(cb => cb.value);
        let files;
        if (activeTab === 'cloud') {
            files = this._remoteFiles.filter(f => ids.includes(f.id));
            const apiUrl = (localStorage.getItem('ov-map-cloud-api') || '').replace(/\/+$/, '');
            if (apiUrl) {
                const fullFiles = [];
                for (const f of files) {
                    try {
                        const resp = await fetch(apiUrl + '/api/files/' + f.id);
                        if (resp.ok) fullFiles.push(await resp.json());
                    } catch (e) { console.error('获取文件失败:', f.id, e); }
                }
                files = fullFiles;
            }
        } else {
            const allLocal = await CloudReader.getAllFiles();
            files = allLocal.filter(f => ids.includes(f.id));
        }

        if (!files.length) { this.hideLoading(); alert('未找到选中的文件'); return; }

        const total = files.length;
        let done = 0;
        this.showLoading(`正在同步 (0/${total})...`);

        await new Promise(r => setTimeout(r, 50));

        for (const f of files) {
            try {
                const layerId = 'cloud_' + Date.now() + '_' + done;
                const ci = this.colorIndex++;
                const layer = await this.renderLayerAsync(f.text, f.ext || 'kml', f.name, layerId, ci);
                if (layer && layer.getBounds().isValid()) this.map.fitBounds(layer.getBounds());
                this._layerOrder = this._layerOrder || [];
                this._layerOrder.push(layerId);
                await Storage.saveLayer(layerId, { name: f.name, ext: f.ext || 'kml', text: f.text, colorIndex: ci });
            } catch (e) { console.error('同步失败:', f.name, e); }
            done++;
            this.showLoading(`正在同步 (${done}/${total})...`);
        }

        this.hideLoading();
        this.updateImportedLayersList();
        this.updateLabelOverlay();
        this.debouncedSave();
    },

    toggleSidebar() {
        const sidebar = this._dom.sidebar || document.getElementById('sidebar');
        const overlay = this._dom.sidebarOverlay || document.getElementById('sidebarOverlay');
        const btn = this._dom.sidebarBtn || document.querySelector('.sidebar-btn');
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
        if (btn) btn.classList.toggle('active');
        setTimeout(() => this.map.invalidateSize(), 300);
    },

    toggleSidebarCollapse() {
        const sidebar = this._dom.sidebar || document.getElementById('sidebar');
        const collapseBtn = this._dom.sidebarCollapseBtn || document.getElementById('sidebarCollapseBtn');
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        collapseBtn.innerHTML = isCollapsed ? '&#10095;' : '&#10094;';
        collapseBtn.title = isCollapsed ? '展开菜单' : '折叠菜单';
        setTimeout(() => this.map.invalidateSize(), 350);
    },

    closeSidebarOnMobile() {
        if (this._isMobile()) {
            const sidebar = this._dom.sidebar || document.getElementById('sidebar');
            const overlay = this._dom.sidebarOverlay || document.getElementById('sidebarOverlay');
            const btn = this._dom.sidebarBtn || document.querySelector('.sidebar-btn');
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            if (btn) btn.classList.remove('active');
        }
    },

    _isMobile() {
        return window.innerWidth <= 768;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
