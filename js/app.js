const DB_NAME = 'ov-map-db';
const DB_VERSION = 1;
const STORE_LAYERS = 'layers';
const STORE_STATE = 'state';

const Storage = {
    db: null,
    async init() {
        return new Promise(resolve => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_LAYERS)) db.createObjectStore(STORE_LAYERS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE, { keyPath: 'key' });
            };
            req.onsuccess = e => { this.db = e.target.result; resolve(); };
            req.onerror = () => resolve();
        });
    },
    saveLayer(id, data) {
        if (!this.db) return;
        this.db.transaction(STORE_LAYERS, 'readwrite').objectStore(STORE_LAYERS).put({ id, ...data });
    },
    removeLayer(id) {
        if (!this.db) return;
        this.db.transaction(STORE_LAYERS, 'readwrite').objectStore(STORE_LAYERS).delete(id);
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
        if (!this.db) return;
        const tx = this.db.transaction([STORE_LAYERS, STORE_STATE], 'readwrite');
        tx.objectStore(STORE_LAYERS).clear();
        tx.objectStore(STORE_STATE).clear();
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
    wgs84ToGcj02(lat, lng) { return this._transform(lat, lng); }
};

L.GCJ02TileLayer = L.TileLayer.extend({
    initialize(url, opts) {
        L.TileLayer.prototype.initialize.call(this, url, opts);
    },
    getTileUrl(coords) {
        const tileSize = 256;
        const z = coords.z;
        const x = coords.x;
        const y = coords.y;
        const n = Math.pow(2, z);
        const lng = x / n * 360.0 - 180.0;
        const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
        const lat = latRad * 180.0 / Math.PI;
        const gcj = L.GCJ02.wgs84ToGcj02(lat, lng);
        const gcjX = (gcj.lng + 180.0) / 360.0 * n;
        const gcjY = (1 - Math.log(Math.tan(gcj.lat * Math.PI / 180) + 1 / Math.cos(gcj.lat * Math.PI / 180)) / Math.PI) / 2 * n;
        const s = this._getSubdomain({ x: Math.floor(gcjX), y: Math.floor(gcjY), z });
        return L.Util.template(this._url, { s, x: Math.floor(gcjX), y: Math.floor(gcjY), z });
    }
});

L.BingSatelliteLayer = L.TileLayer.extend({
    options: { attribution: '&copy; Bing', maxZoom: 19 },
    initialize() {
        L.TileLayer.prototype.initialize.call(this, '', this.options);
    },
    _toQuadKey(x, y, z) {
        let key = '';
        for (let i = z; i > 0; i--) {
            let digit = 0;
            const mask = 1 << (i - 1);
            if (x & mask) digit += 1;
            if (y & mask) digit += 2;
            key += digit;
        }
        return key;
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
    colorIndex: 0, _saveTimer: null, _labelTimer: null, _importing: false, _layerOrder: [],

    async init() {
        await Storage.init();
        this.loadApiKey();
        this.initMap();
        this.initBaseLayers();
        this.initDrawControl();
        this.initLocateControl();
        this.initLabelOverlay();
        this.initEventListeners();
        await this.restoreState();
        await this.restoreLayers();
    },

    initMap() {
        this.canvasRenderer = L.canvas({ padding: 0.1 });
        this.map = L.map('map', {
            center: [35.8617, 104.1954], zoom: 5, zoomControl: true,
            preferCanvas: true
        });
        this.drawnItems = new L.FeatureGroup();
        this.map.addLayer(this.drawnItems);
    },

    initLabelOverlay() {
        const self = this;
        const Overlay = L.Layer.extend({
            onAdd(map) {
                this._map = map;
                const pane = map.getPane('overlayPane');
                this._canvas = L.DomUtil.create('canvas', 'label-canvas');
                this._canvas.style.cssText = 'position:absolute;pointer-events:none;';
                pane.appendChild(this._canvas);
                map.on('moveend zoomend resize', this._throttledUpdate, this);
                this._update();
            },
            onRemove(map) {
                L.DomUtil.remove(this._canvas);
                map.off('moveend zoomend resize', this._throttledUpdate, this);
            },
            _throttledUpdate() {
                clearTimeout(self._labelTimer);
                self._labelTimer = setTimeout(() => this._update(), 100);
            },
            _update() {
                const map = this._map;
                if (!map) return;
                const size = map.getSize();
                const dpr = window.devicePixelRatio || 1;
                this._canvas.width = size.x * dpr;
                this._canvas.height = size.y * dpr;
                this._canvas.style.width = size.x + 'px';
                this._canvas.style.height = size.y + 'px';
                const topLeft = map.containerPointToLayerPoint([0, 0]);
                L.DomUtil.setPosition(this._canvas, topLeft);
                const ctx = this._canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.clearRect(0, 0, size.x, size.y);

                if (map.getZoom() < 14) return;

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = '11px Microsoft YaHei,sans-serif';

                const pad = 100;
                for (const data of Object.values(App.importedLayers)) {
                    if (!data._labelCache || !map.hasLayer(data.layer)) continue;
                    for (const item of data._labelCache) {
                        let pt;
                        if (item.type === 'point') {
                            pt = map.latLngToContainerPoint(item.latlng);
                        } else if (item._c) {
                            pt = map.latLngToContainerPoint(item._c);
                        } else if (item.bounds) {
                            item._c = item.bounds.getCenter();
                            pt = map.latLngToContainerPoint(item._c);
                        } else continue;
                        if (pt.x < -pad || pt.y < -pad || pt.x > size.x + pad || pt.y > size.y + pad) continue;
                        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                        ctx.lineWidth = 3;
                        ctx.strokeText(item.text, pt.x, pt.y);
                        ctx.fillStyle = '#2c3e50';
                        ctx.fillText(item.text, pt.x, pt.y);
                    }
                }
            }
        });
        this.labelOverlay = new Overlay();
        this.labelOverlay.addTo(this.map);
    },

    updateLabelOverlay() {
        if (this.labelOverlay && this.labelOverlay._update) this.labelOverlay._update();
    },

    initBaseLayers() {
        this.baseLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 });
        this.baseLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19 });
        this.baseLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenTopoMap', maxZoom: 17 });
        this.baseLayers.gaode = new L.GCJ02TileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: ['1','2','3','4'], attribution: '&copy; 高德', maxZoom: 18 });
        this.baseLayers.gaodeSatellite = new L.GCJ02TileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', { subdomains: ['1','2','3','4'], attribution: '&copy; 高德卫星', maxZoom: 18 });
        this.baseLayers.bingSatellite = new L.BingSatelliteLayer();
        this.baseLayers.osm.addTo(this.map);
        this.currentBaseLayer = 'osm';
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
    },

    initLocateControl() {
        const Ctrl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd() {
                const btn = L.DomUtil.create('div', 'locate-btn');
                btn.innerHTML = '&#9737;';
                btn.title = '定位到当前位置';
                L.DomEvent.disableClickPropagation(btn);
                L.DomEvent.on(btn, 'click', () => App.locate());
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
            if (this.locateMarker) this.map.removeLayer(this.locateMarker);
            if (this.locateCircle) this.map.removeLayer(this.locateCircle);
            if (accuracy > 0) {
                this.locateCircle = L.circle([lat, lng], { radius: accuracy, color: '#3498db', fillColor: '#3498db', fillOpacity: 0.15, weight: 1 }).addTo(this.map);
            }
            this.locateMarker = L.marker([lat, lng]).addTo(this.map)
                .bindPopup(`${source}<br>经度: ${lng.toFixed(6)}<br>纬度: ${lat.toFixed(6)}${accuracy > 0 ? '<br>精度: ' + accuracy.toFixed(0) + ' 米' : ''}`)
                .openPopup();
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
            script.src = `http://ip-api.com/json/?callback=${cb}&lang=zh-CN`;
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

    searchMode: 'place', searchTimer: null,

    setSearchMode(mode) {
        this.searchMode = mode;
        document.querySelectorAll('.search-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        const input = document.getElementById('searchInput');
        const placeholders = { place: '搜索地点...', layer: '搜索图层属性...', coord: '经度, 纬度 如: 118.63, 37.42' };
        input.placeholder = placeholders[mode] || '搜索...';
        input.value = '';
        document.getElementById('searchResults').classList.remove('has-items');
        document.getElementById('searchResults').innerHTML = '';
    },

    doSearch() {
        const q = document.getElementById('searchInput').value.trim();
        if (!q) return;
        if (this.searchMode === 'place') this.searchPlace(q);
        else if (this.searchMode === 'coord') this.searchCoord(q);
        else this.searchLayer(q);
    },

    searchCoord(query) {
        const container = document.getElementById('searchResults');

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
        if (this.coordMarker) this.map.removeLayer(this.coordMarker);
        this.coordMarker = L.marker([lat, lng]).addTo(this.map)
            .bindPopup(`坐标定位<br>经度: ${lng.toFixed(6)}<br>纬度: ${lat.toFixed(6)}`)
            .openPopup();
        container.innerHTML = `<div class="search-result-item"><div class="result-name">经度: ${lng.toFixed(6)}, 纬度: ${lat.toFixed(6)}</div><div class="result-sub">已跳转到该位置</div></div>`;
        container.classList.add('has-items');
    },

    _gaodeKey: '',

    toggleApiKeyBox() {
        const box = document.getElementById('apiKeyBox');
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
        if (box.style.display === 'block') {
            document.getElementById('apiKeyInput').value = this._gaodeKey || '';
        }
    },

    saveApiKey() {
        this._gaodeKey = document.getElementById('apiKeyInput').value.trim();
        localStorage.setItem('gaode_key', this._gaodeKey);
        document.getElementById('apiKeyBox').style.display = 'none';
        alert(this._gaodeKey ? 'API Key 已保存' : 'API Key 已清除');
    },

    loadApiKey() {
        this._gaodeKey = localStorage.getItem('gaode_key') || '';
    },

    async searchPlace(query) {
        const container = document.getElementById('searchResults');
        if (!this._gaodeKey) {
            container.innerHTML = '<div class="search-hint">请先配置高德 API Key<br><br>免费申请地址:<br>console.amap.com/dev/key/app<br><br>创建应用 → 添加Key → 选"Web服务"<br><br>点击搜索框右侧 ⚙ 配置</div>';
            container.classList.add('has-items');
            return;
        }
        container.innerHTML = '<div class="search-hint">搜索中...</div>';
        container.classList.add('has-items');
        try {
            const c = this.map.getCenter();
            const cityResp = await fetch(`https://restapi.amap.com/v3/geocode/regeo?key=${this._gaodeKey}&location=${c.lng},${c.lat}&extensions=base`).then(r => r.json()).catch(() => null);
            const cityCode = cityResp?.regeocode?.addressComponent?.citycode || '';
            const cityName = cityResp?.regeocode?.addressComponent?.city || '';
            let url = `https://restapi.amap.com/v3/place/text?key=${this._gaodeKey}&keywords=${encodeURIComponent(query)}&offset=10&extensions=all`;
            if (cityCode) url += `&city=${cityCode}&citylimit=true`;
            const results = await fetch(url).then(r => r.json());
            if (!results.pois || !results.pois.length) { container.innerHTML = '<div class="search-hint">未找到结果</div>'; return; }
            container.innerHTML = (cityName ? `<div class="search-hint">搜索范围: ${cityName}</div>` : '') +
                results.pois.slice(0, 8).map(p => {
                const loc = p.location.split(',');
                const lng = parseFloat(loc[0]), lat = parseFloat(loc[1]);
                const addr = p.address ? (Array.isArray(p.address) ? p.address.join(' ') : p.address) : '';
                return `<div class="search-result-item" onclick="App.goToPlace(${lat},${lng},\`${this.escA(p.name)}\`)"><div class="result-name">${this.escH(p.name)}</div><div class="result-sub">${this.escH(addr || p.cityname || '')}</div></div>`;
            }).join('');
        } catch { container.innerHTML = '<div class="search-hint">搜索失败，请检查 API Key</div>'; }
    },

    goToPlace(lat, lon, name) {
        this.map.setView([lat, lon], 16);
        if (this.searchMarker) this.map.removeLayer(this.searchMarker);
        this.searchMarker = L.marker([lat, lon]).addTo(this.map).bindPopup(name).openPopup();
        document.getElementById('searchResults').classList.remove('has-items');
    },

    searchLayer(query) {
        const container = document.getElementById('searchResults');
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
        const limit = matches.slice(0, 20);
        container.innerHTML = `<div class="search-hint">找到 ${matches.length} 个${matches.length > 20 ? '（前20）' : ''}</div>` + limit.map((m, i) => `<div class="search-result-item layer-match" onclick="App.goToLayer(${i})"><div class="result-name">${this.escH(m.display)}</div><div class="result-sub">${this.escH(m.sub)}</div></div>`).join('');
        container.classList.add('has-items');
        this._lastSearch = limit;
    },

    goToLayer(i) {
        const m = this._lastSearch?.[i];
        if (!m) return;
        if (m.latlng) this.map.setView(m.latlng, 17);
        if (m.layer.openPopup) m.layer.openPopup();
        document.getElementById('searchResults').classList.remove('has-items');
    },

    getCenter(sub, f) {
        if (f.geometry?.type === 'Point') { const c = f.geometry.coordinates; return [c[1], c[0]]; }
        return sub.getBounds?.().isValid?.() ? sub.getBounds().getCenter() : null;
    },

    escH(s) { return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : ''; },
    escA(s) { return s ? String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$') : ''; },

    _ctxLatLng: null,

    hideContextMenu() {
        document.getElementById('contextMenu').classList.remove('show');
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
        if (this.coordMarker) this.map.removeLayer(this.coordMarker);
        this.coordMarker = L.marker([ll.lat, ll.lng]).addTo(this.map)
            .bindPopup(`经度: ${ll.lng.toFixed(6)}<br>纬度: ${ll.lat.toFixed(6)}`)
            .openPopup();
    },

    addMarkerFromCtx() {
        if (!this._ctxLatLng) return;
        const ll = this._ctxLatLng;
        this.hideContextMenu();
        const name = prompt('标记名称（可留空）:', '') || '';
        const m = L.marker([ll.lat, ll.lng]).addTo(this.map);
        const popup = `${name ? '<b>' + this.escH(name) + '</b><br>' : ''}经度: ${ll.lng.toFixed(6)}<br>纬度: ${ll.lat.toFixed(6)}`;
        m.bindPopup(popup).openPopup();
    },

    initEventListeners() {
        document.querySelectorAll('input[name="baseLayer"]').forEach(r => r.addEventListener('change', e => this.switchBaseLayer(e.target.value)));
        document.getElementById('importKml').addEventListener('click', () => this.triggerFileInput('.kml'));
        document.getElementById('importGeoJson').addEventListener('click', () => this.triggerFileInput('.geojson,.json'));
        document.getElementById('importGpx').addEventListener('click', () => this.triggerFileInput('.gpx'));
        document.getElementById('fileInput').addEventListener('change', e => this.handleFileImport(e));

        const si = document.getElementById('searchInput');
        si.addEventListener('keydown', e => { if (e.key === 'Enter') this.doSearch(); });
        si.addEventListener('input', () => {
            clearTimeout(this.searchTimer);
            if (!si.value.trim()) { document.getElementById('searchResults').classList.remove('has-items'); document.getElementById('searchResults').innerHTML = ''; return; }
            this.searchTimer = setTimeout(() => this.doSearch(), 400);
        });
        document.addEventListener('click', e => { if (!e.target.closest('.search-box')) document.getElementById('searchResults').classList.remove('has-items'); });
        document.addEventListener('click', () => this.hideContextMenu());
        document.addEventListener('contextmenu', e => { if (e.target.closest('#map')) e.preventDefault(); });

        this.map.on('contextmenu', e => {
            this._ctxLatLng = e.latlng;
            const menu = document.getElementById('contextMenu');
            document.getElementById('ctxCoord').innerHTML =
                `经度: ${e.latlng.lng.toFixed(6)}<br>纬度: ${e.latlng.lat.toFixed(6)}`;
            menu.style.left = e.originalEvent.clientX + 'px';
            menu.style.top = e.originalEvent.clientY + 'px';
            menu.classList.add('show');
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = (e.originalEvent.clientX - rect.width) + 'px';
            if (rect.bottom > window.innerHeight) menu.style.top = (e.originalEvent.clientY - rect.height) + 'px';
        });

        this.map.on('mousemove', e => { document.getElementById('cursorPos').textContent = `经度: ${e.latlng.lng.toFixed(6)}, 纬度: ${e.latlng.lat.toFixed(6)}`; });
        this.map.on('zoomend', () => { document.getElementById('zoomLevel').textContent = `缩放级别: ${this.map.getZoom()}`; this.debouncedSave(); });
        this.map.on('moveend', () => this.debouncedSave());
        this.map.on(L.Draw.Event.CREATED, e => { this.drawnItems.addLayer(e.layer); this.showMeasure(e.layerType, e.layer); });
        this.map.on(L.Draw.Event.EDITED, e => { e.layers.eachLayer(l => this.showMeasure(l.feature?.geometry?.type || 'polygon', l)); });
    },

    debouncedSave() { clearTimeout(this._saveTimer); this._saveTimer = setTimeout(() => { const c = this.map.getCenter(); Storage.saveState({ center: [c.lat, c.lng], zoom: this.map.getZoom(), baseLayer: this.currentBaseLayer, layerOrder: this._layerOrder || [] }); }, 300); },

    async restoreState() {
        const s = await Storage.getState();
        if (!s) return;
        if (s.baseLayer && this.baseLayers[s.baseLayer]) { this.switchBaseLayer(s.baseLayer); const r = document.querySelector(`input[name="baseLayer"][value="${s.baseLayer}"]`); if (r) r.checked = true; }
        if (s.center && s.zoom) this.map.setView(s.center, s.zoom);
        if (s.layerOrder) this._layerOrder = s.layerOrder;
    },

    async restoreLayers() {
        const saved = await Storage.getAllLayers();
        for (const item of saved) { try { this.renderLayer(item.text, item.ext, item.name, item.id, item.colorIndex); } catch (e) { console.error('restore failed:', item.name, e); } }
        this.updateImportedLayersList();
        this.updateLabelOverlay();
    },

    switchBaseLayer(n) { if (this.currentBaseLayer) this.map.removeLayer(this.baseLayers[this.currentBaseLayer]); this.baseLayers[n].addTo(this.map); this.currentBaseLayer = n; },
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
        kmlDoc.querySelectorAll('Style').forEach(el => { const id = el.getAttribute('id'); if (id) sm['#' + id] = this.parseStyle(el); });
        kmlDoc.querySelectorAll('StyleMap').forEach(el => {
            const id = el.getAttribute('id'); if (!id) return;
            const p = el.querySelector('Pair');
            if (p) { const u = p.querySelector('styleUrl'); if (u) { const ref = u.textContent.trim(); if (sm[ref]) sm['#' + id] = sm[ref]; } }
        });
        const pms = kmlDoc.querySelectorAll('Placemark');
        for (let i = 0; i < pms.length && i < geoJson.features.length; i++) {
            const pm = pms[i], f = geoJson.features[i];
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

    getPopup(f) {
        const kd = f.properties?._kmlDescription;
        if (kd) return kd;
        if (!f.properties) return '';
        const skip = new Set(['styleUrl', 'styleHash', '_kmlStyle', '_styleUrl', '_kmlDescription']);
        const entries = Object.entries(f.properties).filter(([k, v]) => v && !skip.has(k));
        if (!entries.length) return '';
        let h = '';
        if (f.properties.name) h += `<div class="popup-title">${f.properties.name}</div>`;
        h += '<table class="popup-table">';
        for (const [k, v] of entries) { if (k !== 'name') h += `<tr><td class="popup-key">${k}</td><td class="popup-val">${v}</td></tr>`; }
        return h + '</table>';
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
        const CHUNK = 200;

        for (let i = 0; i < total; i += CHUNK) {
            const end = Math.min(i + CHUNK, total);
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
                        renderer: self.canvasRenderer,
                        style: () => self.getStyle(f, fallback)
                    });
                    layer.feature = f;
                    if ((gt === 'Polygon' || gt === 'MultiPolygon') && f.properties?.name) {
                        labelCache.push({ text: f.properties.name, bounds: layer.getBounds(), type: 'polygon' });
                    }
                }

                if (layer) {
                    group.addLayer(layer);
                }
            }

            if (i + CHUNK < total) await new Promise(r => setTimeout(r, 0));
        }

        group.eachLayer(l => {
            if (!l.feature) return;
            const html = self.getPopup(l.feature);
            if (html) l.bindPopup(html, { maxWidth: 450, maxHeight: 350 });
        });

        group.addTo(this.map);
        this.importedLayers[layerId] = { layer: group, name: fileName, color: fallback, _labelCache: labelCache, ext, text, colorIndex: ci };
        return group;
    },

    renderLayer(text, ext, fileName, layerId, ci) {
        const fallback = this.layerColors[ci % this.layerColors.length];
        let geoJson = null;
        if (ext === 'kml') {
            const doc = new DOMParser().parseFromString(text, 'text/xml');
            geoJson = toGeoJSON.kml(doc);
            this.enrichKml(geoJson, doc);
        } else if (ext === 'geojson' || ext === 'json') {
            geoJson = JSON.parse(text);
        } else if (ext === 'gpx') {
            geoJson = toGeoJSON.gpx(new DOMParser().parseFromString(text, 'text/xml'));
        }
        if (!geoJson) return null;

        const self = this;
        const labelCache = [];
        const layer = L.geoJSON(geoJson, {
            renderer: self.canvasRenderer,
            style: f => self.getStyle(f, fallback),
            pointToLayer: (f, ll) => {
                const ks = f.properties?._kmlStyle;
                if (ks?._hideMarker) { labelCache.push({ text: f.properties?.name || '', latlng: ll, type: 'point' }); return null; }
                const m = L.circleMarker(ll, { renderer: self.canvasRenderer, radius: 6, fillColor: ks?.markerColor || fallback, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8 });
                if (f.properties?.name) labelCache.push({ text: f.properties.name, latlng: ll, type: 'point' });
                return m;
            },
            onEachFeature: (f, l) => {
                const html = self.getPopup(f);
                if (html) l.bindPopup(html, { maxWidth: 450, maxHeight: 350 });
                if ((f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') && f.properties?.name)
                    labelCache.push({ text: f.properties.name, bounds: l.getBounds(), type: 'polygon' });
            }
        });
        layer.addTo(this.map);
        this.importedLayers[layerId] = { layer, name: fileName, color: fallback, _labelCache: labelCache, ext, text, colorIndex: ci };
        return layer;
    },

    showLoading(msg) {
        let o = document.getElementById('loadingOverlay');
        if (!o) { o = document.createElement('div'); o.id = 'loadingOverlay'; o.innerHTML = '<div class="loading-spinner"></div><div class="loading-text"></div>'; document.body.appendChild(o); }
        o.querySelector('.loading-text').textContent = msg || '加载中...';
        o.style.display = 'flex';
    },
    hideLoading() { const o = document.getElementById('loadingOverlay'); if (o) o.style.display = 'none'; },

    async handleFileImport(event) {
        const file = event.target.files[0];
        if (!file || this._importing) return;
        this._importing = true;
        const fileName = file.name, ext = file.name.split('.').pop().toLowerCase(), ci = this.colorIndex++;
        try {
            this.showLoading('读取文件...');
            const text = await file.text();
            const layerId = Date.now();
            let layer;
            const total = (text.match(/<Placemark>/g) || []).length;
            if (total > 500) {
                layer = await this.renderLayerAsync(text, ext, fileName, layerId, ci, msg => this.showLoading(msg));
            } else {
                this.showLoading('渲染中...');
                await new Promise(r => setTimeout(r, 16));
                layer = this.renderLayer(text, ext, fileName, layerId, ci);
            }
            if (!layer) { this.hideLoading(); this._importing = false; return; }
            if (layer.getBounds().isValid()) this.map.fitBounds(layer.getBounds());
            this.showLoading('保存...');
            await Storage.saveLayer(layerId, { name: fileName, ext, text, colorIndex: ci });
            this.updateImportedLayersList();
            this.debouncedSave();
            this.updateLabelOverlay();
        } catch (err) { alert('导入失败: ' + err.message); console.error(err); }
        this.hideLoading();
        this._importing = false;
        event.target.value = '';
    },

    updateImportedLayersList() {
        const c = document.getElementById('importedLayers');
        const ids = Object.keys(this.importedLayers);
        if (!ids.length) { c.innerHTML = '<p class="empty-hint">暂无导入图层</p>'; return; }
        if (!this._layerOrder || !this._layerOrder.length) this._layerOrder = ids;
        this._layerOrder = this._layerOrder.filter(id => this.importedLayers[id]);
        for (const id of ids) { if (!this._layerOrder.includes(id)) this._layerOrder.push(id); }

        c.innerHTML = this._layerOrder.map((id, i) => {
            const d = this.importedLayers[id];
            if (!d) return '';
            return `<div class="layer-item" draggable="true" data-id="${id}">
                <input type="checkbox" checked onchange="App.toggleLayer('${id}',this.checked)">
                <span class="layer-color-indicator" style="background:${d.color}"></span>
                <div class="layer-item-info">
                    <span class="layer-item-name" ondblclick="App.startRename('${id}',this)">${this.escH(d.name)}</span>
                    <div class="layer-actions">
                        <button title="上移" onclick="App.moveLayer('${id}',-1)" ${i === 0 ? 'disabled' : ''}>&#9650;</button>
                        <button title="下移" onclick="App.moveLayer('${id}',1)" ${i === this._layerOrder.length - 1 ? 'disabled' : ''}>&#9660;</button>
                        <button title="删除" onclick="App.removeLayer('${id}')" style="color:#e74c3c">&#10005;</button>
                    </div>
                </div>
            </div>`;
        }).join('');
        this._bindLayerDrag();
    },

    _bindLayerDrag() {
        const container = document.getElementById('importedLayers');
        let dragId = null;
        container.querySelectorAll('.layer-item[draggable]').forEach(el => {
            el.addEventListener('dragstart', e => {
                dragId = el.dataset.id;
                el.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            });
            el.addEventListener('dragend', () => { el.style.opacity = '1'; dragId = null; });
            el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.style.borderTop = '2px solid #3498db'; });
            el.addEventListener('dragleave', () => { el.style.borderTop = ''; });
            el.addEventListener('drop', e => {
                e.preventDefault();
                el.style.borderTop = '';
                if (!dragId || dragId === el.dataset.id) return;
                const fromId = dragId;
                const toId = el.dataset.id;
                const order = this._layerOrder;
                const fromIdx = order.indexOf(fromId);
                const toIdx = order.indexOf(toId);
                if (fromIdx < 0 || toIdx < 0) return;
                order.splice(fromIdx, 1);
                order.splice(toIdx, 0, fromId);
                this.updateImportedLayersList();
                this.debouncedSave();
            });
        });
    },

    moveLayer(id, dir) {
        const order = this._layerOrder;
        const idx = order.indexOf(String(id));
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
        const finish = () => {
            const newName = input.value.trim() || d.name;
            d.name = newName;
            el.textContent = newName;
            Storage.saveLayer(id, { name: d.name, ext: d.ext, text: d.text, colorIndex: d.colorIndex });
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = d.name; input.blur(); } });
    },

    toggleLayer(id, vis) {
        const d = this.importedLayers[id];
        if (d) { if (vis) this.map.addLayer(d.layer); else this.map.removeLayer(d.layer); this.updateLabelOverlay(); }
    },

    async removeLayer(id) {
        const d = this.importedLayers[id];
        if (d) {
            this.map.removeLayer(d.layer);
            delete this.importedLayers[id];
            this._layerOrder = (this._layerOrder || []).filter(x => x !== id);
            await Storage.removeLayer(id);
            this.updateImportedLayersList();
            this.updateLabelOverlay();
        }
    },

    showMeasure(type, layer) {
        const c = document.getElementById('measureResults');
        let html = '';
        if (type === 'polyline') { const ll = layer.getLatLngs(); let d = 0; for (let i = 1; i < ll.length; i++) d += ll[i-1].distanceTo(ll[i]); html = `<div class="measure-result"><div class="label">线段</div><div class="value">长度: ${this.fmtD(d)}</div></div>`; }
        else if (type === 'polygon' || type === 'rectangle') { const ll = layer.getLatLngs()[0]; html = `<div class="measure-result"><div class="label">${type === 'rectangle' ? '矩形' : '多边形'}</div><div class="value">面积: ${this.fmtA(this.calcA(ll))}</div><div class="value">周长: ${this.fmtD(this.calcP(ll))}</div></div>`; }
        else if (type === 'circle') { const r = layer.getRadius(); html = `<div class="measure-result"><div class="label">圆形</div><div class="value">半径: ${this.fmtD(r)}</div><div class="value">面积: ${this.fmtA(Math.PI*r*r)}</div></div>`; }
        c.innerHTML = html + c.innerHTML;
    },

    calcA(ll) { let a = 0; for (let i = 0, n = ll.length; i < n; i++) { const j = (i+1)%n; a += ll[i].lat*ll[j].lng - ll[j].lat*ll[i].lng; } return Math.abs(a)/2*111319.9*111319.9; },
    calcP(ll) { let p = 0; for (let i = 0; i < ll.length; i++) p += ll[i].distanceTo(ll[(i+1)%ll.length]); return p; },
    fmtD(m) { return m >= 1000 ? (m/1000).toFixed(2)+' 公里' : m.toFixed(2)+' 米'; },
    fmtA(s) { if (s >= 1e6) return (s/1e6).toFixed(2)+' 平方公里'; if (s >= 1e4) return (s/1e4).toFixed(2)+' 公顷'; return s.toFixed(2)+' 平方米'; },

    clearMeasurements() { this.drawnItems.clearLayers(); document.getElementById('measureResults').innerHTML = '<p class="empty-hint">使用绘图工具进行测量</p>'; },
    async clearAllData() { if (!confirm('确定清除所有数据？')) return; await Storage.clearAll(); alert('已清除，请刷新页面'); }
};

document.addEventListener('DOMContentLoaded', () => App.init());
