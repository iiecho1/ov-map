const CLOUD_DB_NAME = 'ov-map-cloud';
const CLOUD_DB_VERSION = 1;
const CLOUD_STORE = 'kml-files';
const AUTH_KEY = 'ov-map-admin-auth';
const DEFAULT_PASSWORD_HASH = 'admin123';
const CHUNK_SIZE = 512 * 1024;
const MAX_CONCURRENT = 3;

function getApiUrl() {
    return (localStorage.getItem('ov-map-cloud-api') || '').replace(/\/+$/, '');
}

async function compressGzip(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const length = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

function xhrUpload(url, body, headers, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
        xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json: () => JSON.parse(xhr.responseText) });
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send(body);
    });
}

async function compressedPost(url, bodyObj, onProgress) {
    const json = JSON.stringify(bodyObj);
    const compressed = await compressGzip(json);
    return xhrUpload(url, compressed, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, onProgress);
}

async function compressedPut(url, bodyObj) {
    const json = JSON.stringify(bodyObj);
    const compressed = await compressGzip(json);
    return fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        body: compressed
    });
}

async function chunkedUpload(fileData, onProgress) {
    const apiUrl = getApiUrl();
    if (!apiUrl) throw new Error('未配置 API 地址');

    const json = JSON.stringify(fileData);
    const compressed = await compressGzip(json);
    const totalSize = compressed.length;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    const initResp = await fetch(apiUrl + '/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: fileData.name, totalChunks, fileSize: totalSize })
    });
    if (!initResp.ok) throw new Error('初始化分片上传失败');
    const { uploadId } = await initResp.json();

    let uploaded = 0;
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);
        const chunk = compressed.slice(start, end);

        const resp = await xhrUpload(apiUrl + '/api/upload/chunk', chunk, {
            'Content-Type': 'application/octet-stream',
            'X-Upload-Id': uploadId,
            'X-Chunk-Index': String(i)
        }, (loaded) => {
            if (onProgress) onProgress(uploaded + loaded, totalSize);
        });
        if (!resp.ok) throw new Error('分片上传失败');
        uploaded += chunk.length;
    }

    const completeResp = await fetch(apiUrl + '/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, name: fileData.name, ext: fileData.ext || 'kml' })
    });
    if (!completeResp.ok) {
        const err = await completeResp.json().catch(() => ({}));
        throw new Error(err.error || '合并分片失败');
    }
    return completeResp.json();
}

const CloudStorage = {
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(CLOUD_DB_NAME, CLOUD_DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(CLOUD_STORE)) {
                    db.createObjectStore(CLOUD_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = e => { this.db = e.target.result; resolve(); };
            req.onerror = () => reject(new Error('无法打开本地存储数据库'));
        });
    },

    async getAll() {
        if (!this.db) return [];
        return new Promise(resolve => {
            const req = this.db.transaction(CLOUD_STORE, 'readonly').objectStore(CLOUD_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    },

    async get(id) {
        if (!this.db) return null;
        return new Promise(resolve => {
            const req = this.db.transaction(CLOUD_STORE, 'readonly').objectStore(CLOUD_STORE).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
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
    },

    async update(id, data) {
        const file = await this.get(id);
        if (!file) throw new Error('文件不存在');
        Object.assign(file, data, { updatedAt: Date.now() });
        return this.save(file);
    },

    async remove(id) {
        if (!this.db) throw new Error('存储未初始化');
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(CLOUD_STORE, 'readwrite');
            tx.objectStore(CLOUD_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new Error('删除失败'));
        });
    },

    async toggle(id) {
        const file = await this.get(id);
        if (!file) return;
        file.enabled = !file.enabled;
        file.updatedAt = Date.now();
        await this.save(file);
        return file;
    }
};

const RemoteStorage = {
    async getAll() {
        const url = getApiUrl();
        if (!url) return [];
        const resp = await fetch(url + '/api/files');
        return resp.json();
    },

    async get(id) {
        const url = getApiUrl();
        if (!url) return null;
        const resp = await fetch(url + '/api/files/' + id);
        if (!resp.ok) return null;
        return resp.json();
    },

    async save(fileData, onProgress) {
        const url = getApiUrl();
        if (!url) throw new Error('未配置 API 地址');
        if (fileData.text && fileData.text.length > CHUNK_SIZE) {
            return await chunkedUpload(fileData, onProgress);
        }
        const resp = await compressedPost(url + '/api/files', fileData, onProgress);
        if (!resp.ok) {
            if (resp.status === 413) throw new Error('文件过大，Cloudflare CDN 限制上传大小');
            throw new Error('上传失败 (HTTP ' + resp.status + ')');
        }
        return resp.json();
    },

    async update(id, data) {
        const url = getApiUrl();
        if (!url) throw new Error('未配置 API 地址');
        const resp = await compressedPut(url + '/api/files/' + id, data);
        if (!resp.ok) throw new Error('更新失败 (HTTP ' + resp.status + ')');
        return resp.json();
    },

    async remove(id) {
        const url = getApiUrl();
        if (!url) throw new Error('未配置 API 地址');
        const resp = await fetch(url + '/api/files/' + id, { method: 'DELETE' });
        if (!resp.ok) throw new Error('删除失败');
        return resp.json();
    },

    async toggle(id) {
        const url = getApiUrl();
        if (!url) throw new Error('未配置 API 地址');
        const resp = await fetch(url + '/api/files/' + id + '/toggle', { method: 'PATCH' });
        if (!resp.ok) throw new Error('操作失败');
        return resp.json();
    },

    async health() {
        const url = getApiUrl();
        if (!url) throw new Error('未配置 API 地址');
        const resp = await fetch(url + '/api/health', { signal: AbortSignal.timeout(3000) });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if (!data || data.status !== 'ok') throw new Error('服务状态异常');
        return data;
    }
};

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type : '');
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}

const Admin = {
    _type: 'kml',
    _source: 'remote',

    async init() {
        await CloudStorage.init();
        if (sessionStorage.getItem(AUTH_KEY) === 'true') {
            this.showAdminPage();
        }
        this.initUploadArea();
        this.initCloudUploadArea();
    },

    login(e) {
        e.preventDefault();
        const input = document.getElementById('password');
        const stored = localStorage.getItem('ov-map-admin-pw') || DEFAULT_PASSWORD_HASH;
        if (input.value === stored) {
            sessionStorage.setItem(AUTH_KEY, 'true');
            this.showAdminPage();
        } else {
            document.getElementById('loginError').style.display = 'block';
            input.value = '';
            input.focus();
        }
        return false;
    },

    logout() {
        sessionStorage.removeItem(AUTH_KEY);
        document.getElementById('adminPage').style.display = 'none';
        document.getElementById('loginPage').style.display = 'flex';
    },

    showAdminPage() {
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('adminPage').style.display = 'flex';

        const savedApi = localStorage.getItem('ov-map-cloud-api') || '';
        document.getElementById('remoteApiInput').value = savedApi;

        this.switchType('kml');
        if (savedApi) this.connectRemoteApi();
    },

    switchType(type) {
        this._type = type;
        document.querySelectorAll('#typeTabs .source-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.type === type);
        });
        const uploadArea = document.getElementById('uploadArea');
        uploadArea.style.display = type === 'kml' && this._source === 'local' ? '' : 'none';
        this.refreshList();
    },

    switchSource(source) {
        this._source = source;
        document.querySelectorAll('#sourceTabs .source-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.source === source);
        });
        const uploadArea = document.getElementById('uploadArea');
        uploadArea.style.display = this._type === 'kml' && source === 'local' ? '' : 'none';
        this.refreshList();
    },

    async connectRemoteApi() {
        const input = document.getElementById('remoteApiInput');
        const statusEl = document.getElementById('remoteApiStatus');
        const apiUrl = (input.value || '').trim().replace(/\/+$/, '');

        if (!apiUrl) {
            statusEl.textContent = '';
            statusEl.className = 'api-inline-status';
            localStorage.removeItem('ov-map-cloud-api');
            this._renderList([]);
            return;
        }

        statusEl.textContent = '连接中...';
        statusEl.className = 'api-inline-status';

        try {
            const resp = await fetch(apiUrl + '/api/health', { signal: AbortSignal.timeout(3000) });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            if (!data || data.status !== 'ok') throw new Error('服务状态异常');

            localStorage.setItem('ov-map-cloud-api', apiUrl);
            statusEl.textContent = '已连接 (' + (data.count || 0) + ' 个文件' + (data.configCount ? ', ' + data.configCount + ' 个配置' : '') + ')';
            statusEl.className = 'api-inline-status ok';
            this.refreshList();
        } catch (e) {
            statusEl.textContent = '连接失败: ' + e.message;
            statusEl.className = 'api-inline-status err';
        }
    },

    async refreshList() {
        const countEl = document.getElementById('fileCount');
        try {
            let items;
            if (this._type === 'kml') {
                if (this._source === 'remote') {
                    const url = getApiUrl();
                    if (!url) { this._renderList([]); countEl.textContent = ''; return; }
                    items = await RemoteStorage.getAll();
                } else {
                    items = await CloudStorage.getAll();
                }
            } else {
                if (this._source === 'remote') {
                    const url = getApiUrl();
                    if (!url) { this._renderList([]); countEl.textContent = ''; return; }
                    const resp = await fetch(url + '/api/configs');
                    items = await resp.json();
                } else {
                    items = this._getLocalConfigs();
                }
            }
            this._renderList(items);
            if (this._type === 'kml') {
                const enabledCount = items.filter(f => f.enabled !== false).length;
                countEl.textContent = items.length ? '共 ' + items.length + ' 个，' + enabledCount + ' 个启用' : '';
            } else {
                countEl.textContent = items.length ? '共 ' + items.length + ' 个配置' : '';
            }
        } catch (e) {
            document.getElementById('fileListContainer').innerHTML = '<p class="empty-hint">获取失败: ' + e.message + '</p>';
            countEl.textContent = '';
        }
    },

    _getLocalConfigs() {
        try {
            const raw = localStorage.getItem('layerToolConfigs');
            if (!raw) return [];
            const obj = JSON.parse(raw);
            return Object.entries(obj).map(([name, config]) => ({
                id: 'local_' + name,
                name,
                size: new Blob([JSON.stringify(config)]).size,
                text: JSON.stringify(config, null, 2),
                config,
                createdAt: null,
                updatedAt: null
            }));
        } catch { return []; }
    },

    _renderList(items) {
        const container = document.getElementById('fileListContainer');
        if (!items.length) {
            const hint = this._source === 'remote'
                ? '暂无云端' + (this._type === 'kml' ? '文件' : '配置') + '<br><small>请先连接后端 API</small>'
                : '暂无本地' + (this._type === 'kml' ? '文件' : '配置') + '<br><small>可通过图层工具页面操作</small>';
            container.innerHTML = '<p class="empty-hint">' + hint + '</p>';
            return;
        }

        items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        if (this._type === 'kml') {
            container.innerHTML = items.map(f => {
                const size = f.size ? this.formatSize(f.size) : '未知';
                const created = f.createdAt ? new Date(f.createdAt).toLocaleString('zh-CN') : '未知';
                const updated = f.updatedAt ? new Date(f.updatedAt).toLocaleString('zh-CN') : '';
                const enabled = f.enabled !== false;
                return `<div class="file-item ${enabled ? '' : 'file-disabled'}" data-id="${f.id}">
                    <div class="file-icon">${enabled ? '&#128196;' : '&#128196;'}</div>
                    <div class="file-info">
                        <div class="file-name-row">
                            <span class="file-name" id="fname-${f.id}">${this.escH(f.name)}</span>
                            <span class="file-status ${enabled ? 'enabled' : 'disabled'}">${enabled ? '启用' : '禁用'}</span>
                        </div>
                        <div class="file-meta">
                            <span>${size}</span>
                            <span>上传: ${created}</span>
                            ${updated && updated !== created ? `<span>更新: ${updated}</span>` : ''}
                        </div>
                    </div>
                    <div class="file-actions">
                        <button class="btn btn-xs" onclick="Admin.startRename('${f.id}')" title="重命名">&#9998; 重命名</button>
                        <button class="btn btn-xs ${enabled ? 'btn-warn' : 'btn-primary'}" onclick="Admin.toggleFile('${f.id}')">${enabled ? '禁用' : '启用'}</button>
                        <button class="btn btn-xs" onclick="Admin.showFileDetail('${f.id}')" title="查看详情">&#128269; 详情</button>
                        <button class="btn btn-xs btn-primary" onclick="Admin.downloadFile('${f.id}')">&#8681; 下载</button>
                        <button class="btn btn-xs btn-danger" onclick="Admin.deleteFile('${f.id}', '${this.escA(f.name)}')">&#10005; 删除</button>
                    </div>
                </div>`;
            }).join('');
        } else {
            container.innerHTML = items.map(f => {
                const size = f.size ? this.formatSize(f.size) : '未知';
                const created = f.createdAt ? new Date(f.createdAt).toLocaleString('zh-CN') : '未知';
                const updated = f.updatedAt ? new Date(f.updatedAt).toLocaleString('zh-CN') : '';
                const isRemote = this._source === 'remote';
                return `<div class="file-item" data-id="${f.id}">
                    <div class="file-icon">&#128196;</div>
                    <div class="file-info">
                        <div class="file-name-row">
                            <span class="file-name" id="fname-${f.id}">${this.escH(f.name)}</span>
                            <span class="file-status enabled">配置</span>
                        </div>
                        <div class="file-meta">
                            <span>${size}</span>
                            ${f.createdAt ? `<span>创建: ${created}</span>` : ''}
                            ${updated && updated !== created ? `<span>更新: ${updated}</span>` : ''}
                        </div>
                    </div>
                    <div class="file-actions">
                        ${isRemote ? `<button class="btn btn-xs" onclick="Admin.startRename('${f.id}')" title="重命名">&#9998; 重命名</button>` : ''}
                        <button class="btn btn-xs" onclick="Admin.showFileDetail('${f.id}')" title="详情">&#128269; 详情</button>
                        <button class="btn btn-xs btn-primary" onclick="Admin.downloadFile('${f.id}')">&#8681; 下载</button>
                        <button class="btn btn-xs btn-danger" onclick="Admin.deleteFile('${f.id}', '${this.escA(f.name)}')">&#10005; 删除</button>
                    </div>
                </div>`;
            }).join('');
        }
    },

    changePassword() {
        const input = document.getElementById('newPassword');
        const pw = input.value.trim();
        if (!pw) { showToast('请输入新密码', 'error'); return; }
        if (pw.length < 4) { showToast('密码至少4位', 'error'); return; }
        localStorage.setItem('ov-map-admin-pw', pw);
        input.value = '';
        showToast('密码已修改', 'success');
    },

    initUploadArea() {
        const area = document.getElementById('uploadArea');
        const input = document.getElementById('kmlFileInput');
        if (!area || !input) return;

        area.addEventListener('click', e => {
            if (e.target.tagName !== 'BUTTON') input.click();
        });
        area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
        area.addEventListener('dragleave', () => { area.classList.remove('dragover'); });
        area.addEventListener('drop', e => {
            e.preventDefault();
            area.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.kml'));
            if (files.length) this.uploadFiles(files);
            else showToast('请上传 .kml 文件', 'error');
        });
        input.addEventListener('change', e => {
            const files = Array.from(e.target.files);
            if (files.length) this.uploadFiles(files);
            input.value = '';
        });
    },

    async uploadFiles(files) {
        const progress = document.getElementById('uploadProgress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        progress.style.display = 'flex';

        let success = 0, completed = 0;
        const totalFiles = files.length;
        const fileBytes = Array.from(files).map(f => f.size);
        const fileProgress = new Array(totalFiles).fill(0);
        const totalBytes = fileBytes.reduce((s, b) => s + b, 0);

        const updateOverallProgress = () => {
            const uploadedBytes = fileProgress.reduce((s, p) => s + p, 0);
            const pct = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : Math.round((completed / totalFiles) * 100);
            progressFill.style.width = pct + '%';
            progressText.textContent = `${completed}/${totalFiles} 完成 (${pct}%)`;
        };

        const storage = this._source === 'remote' ? RemoteStorage : CloudStorage;
        const uploadOne = async (file, index) => {
            try {
                const text = await file.text();
                const id = 'cloud_' + Date.now() + '_' + index;
                const onProgress = (loaded, total) => { fileProgress[index] = loaded; updateOverallProgress(); };
                await storage.save({ id, name: file.name, text, ext: 'kml', size: file.size, enabled: true, createdAt: Date.now(), updatedAt: Date.now() },
                    storage === RemoteStorage ? onProgress : undefined);
                success++;
            } catch (err) {
                console.error('上传失败:', file.name, err);
                showToast(`上传失败: ${file.name}`, 'error');
            } finally {
                completed++;
                fileProgress[index] = fileBytes[index];
                updateOverallProgress();
            }
        };

        const queue = Array.from(files).map((f, i) => () => uploadOne(f, i));
        const workers = [];
        for (let w = 0; w < Math.min(MAX_CONCURRENT, queue.length); w++) {
            workers.push((async () => { while (queue.length) { const task = queue.shift(); if (task) await task(); } })());
        }
        await Promise.all(workers);

        progressFill.style.width = '100%';
        progressText.textContent = '完成';
        setTimeout(() => { progress.style.display = 'none'; }, 1000);

        if (success > 0) {
            showToast(`成功上传 ${success} 个文件`, 'success');
            this.refreshList();
        }
    },

    initCloudUploadArea() {
        const area = document.getElementById('cloudUploadArea');
        const input = document.getElementById('cloudKmlInput');
        if (!area || !input) return;

        area.addEventListener('click', e => {
            if (e.target.tagName !== 'BUTTON') input.click();
        });
        area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
        area.addEventListener('dragleave', () => { area.classList.remove('dragover'); });
        area.addEventListener('drop', e => {
            e.preventDefault();
            area.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.kml'));
            if (files.length) this.uploadCloudFiles(files);
            else showToast('请上传 .kml 文件', 'error');
        });
        input.addEventListener('change', e => {
            const files = Array.from(e.target.files);
            if (files.length) this.uploadCloudFiles(files);
            input.value = '';
        });
    },

    async uploadCloudFiles(files) {
        const apiUrl = getApiUrl();
        if (!apiUrl) { showToast('请先在下方"文件管理"中填写后端地址并连接', 'error'); return; }

        const progress = document.getElementById('cloudUploadProgress');
        const progressFill = document.getElementById('cloudProgressFill');
        const progressText = document.getElementById('cloudProgressText');
        progress.style.display = 'flex';

        let success = 0, completed = 0;
        const totalFiles = files.length;
        const fileBytes = Array.from(files).map(f => f.size);
        const fileProgress = new Array(totalFiles).fill(0);
        const totalBytes = fileBytes.reduce((s, b) => s + b, 0);

        const updateOverallProgress = () => {
            const uploadedBytes = fileProgress.reduce((s, p) => s + p, 0);
            const pct = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : Math.round((completed / totalFiles) * 100);
            progressFill.style.width = pct + '%';
            progressText.textContent = `${completed}/${totalFiles} 完成 (${pct}%)`;
        };

        const uploadOne = async (file, index) => {
            try {
                const text = await file.text();
                const id = 'cloud_' + Date.now() + '_' + index;
                const onProgress = (loaded, total) => { fileProgress[index] = loaded; updateOverallProgress(); };
                await RemoteStorage.save({ id, name: file.name, text, ext: 'kml', size: file.size, enabled: true, createdAt: Date.now(), updatedAt: Date.now() }, onProgress);
                success++;
            } catch (err) {
                console.error('云端上传失败:', file.name, err);
                showToast(`云端上传失败: ${file.name}`, 'error');
            } finally {
                completed++;
                fileProgress[index] = fileBytes[index];
                updateOverallProgress();
            }
        };

        const queue = Array.from(files).map((f, i) => () => uploadOne(f, i));
        const workers = [];
        for (let w = 0; w < Math.min(MAX_CONCURRENT, queue.length); w++) {
            workers.push((async () => { while (queue.length) { const task = queue.shift(); if (task) await task(); } })());
        }
        await Promise.all(workers);

        progressFill.style.width = '100%';
        progressText.textContent = '完成';
        setTimeout(() => { progress.style.display = 'none'; }, 1000);

        if (success > 0) {
            showToast(`成功上传 ${success} 个文件到云端`, 'success');
            if (this._type === 'kml' && this._source === 'remote') {
                this.refreshList();
            }
        }
    },

    startRename(id) {
        const nameEl = document.getElementById('fname-' + id);
        if (!nameEl) return;
        const oldName = nameEl.textContent;
        const input = document.createElement('input');
        input.type = 'text'; input.value = oldName; input.className = 'rename-input';
        nameEl.textContent = ''; nameEl.appendChild(input);
        input.focus(); input.select();

        const finish = async (save) => {
            const newName = input.value.trim();
            if (save && newName && newName !== oldName) {
                try {
                    if (this._type === 'kml') {
                        await (this._source === 'remote' ? RemoteStorage : CloudStorage).update(id, { name: newName });
                    } else {
                        if (this._source === 'remote') {
                            const url = getApiUrl();
                            const resp = await fetch(url + '/api/configs/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) });
                            if (!resp.ok) throw new Error('重命名失败');
                        } else {
                            showToast('本地配置不支持重命名', 'error'); this.refreshList(); return;
                        }
                    }
                    showToast('已重命名', 'success');
                } catch (err) { showToast('重命名失败', 'error'); }
            }
            this.refreshList();
        };

        input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
        input.addEventListener('blur', () => finish(true));
    },

    async showFileDetail(id) {
        let file, isConfig = this._type === 'config';
        if (isConfig) {
            if (this._source === 'remote') {
                const url = getApiUrl(); if (!url) return;
                const resp = await fetch(url + '/api/configs/' + id);
                if (!resp.ok) { showToast('配置不存在', 'error'); return; }
                file = await resp.json();
            } else {
                const configs = this._getLocalConfigs();
                file = configs.find(c => c.id === id);
                if (!file) { showToast('配置不存在', 'error'); return; }
            }
        } else {
            file = await (this._source === 'remote' ? RemoteStorage : CloudStorage).get(id);
            if (!file) { showToast('文件不存在', 'error'); return; }
        }

        const size = file.size ? this.formatSize(file.size) : '未知';
        const created = file.createdAt ? new Date(file.createdAt).toLocaleString('zh-CN') : '未知';
        const updated = file.updatedAt ? new Date(file.updatedAt).toLocaleString('zh-CN') : '未知';
        const text = file.text || (file.config ? JSON.stringify(file.config, null, 2) : '');
        const preview = text.substring(0, isConfig ? 800 : 500);

        document.getElementById('modalTitle').textContent = isConfig ? '配置详情' : '文件详情';
        document.getElementById('modalBody').innerHTML = `
            <div class="detail-grid">
                <div class="detail-label">${isConfig ? '配置名' : '文件名'}</div>
                <div class="detail-value">${this.escH(file.name)}</div>
                <div class="detail-label">ID</div>
                <div class="detail-value detail-mono">${this.escH(file.id)}</div>
                <div class="detail-label">大小</div>
                <div class="detail-value">${size}</div>
                ${!isConfig ? `<div class="detail-label">格式</div><div class="detail-value">${this.escH(file.ext || 'kml')}</div>` : ''}
                ${!isConfig ? `<div class="detail-label">状态</div><div class="detail-value"><span class="file-status ${file.enabled !== false ? 'enabled' : 'disabled'}">${file.enabled !== false ? '已启用' : '已禁用'}</span></div>` : ''}
                <div class="detail-label">来源</div>
                <div class="detail-value">${this._source === 'remote' ? '云端' : '本地'}</div>
                <div class="detail-label">创建时间</div>
                <div class="detail-value">${created}</div>
                <div class="detail-label">更新时间</div>
                <div class="detail-value">${updated}</div>
            </div>
            ${preview ? `<div class="detail-preview"><div class="detail-preview-title">内容预览</div><pre>${this.escH(preview)}</pre></div>` : ''}
        `;
        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-primary" onclick="Admin.downloadFile('${id}')">${isConfig ? '下载配置' : '下载文件'}</button>
            <button class="btn" onclick="Admin.closeModal()" style="background:#4a6278;color:#ecf0f1">关闭</button>
        `;
        document.getElementById('fileModal').style.display = 'flex';
    },

    async downloadFile(id) {
        let text, name;
        if (this._type === 'config') {
            if (this._source === 'remote') {
                const url = getApiUrl(); if (!url) return;
                const resp = await fetch(url + '/api/configs/' + id);
                if (!resp.ok) { showToast('配置不存在', 'error'); return; }
                const cfg = await resp.json(); text = cfg.text; name = cfg.name;
            } else {
                const cfg = this._getLocalConfigs().find(c => c.id === id);
                if (!cfg) { showToast('配置不存在', 'error'); return; }
                text = cfg.text; name = cfg.name;
            }
            if (!text) { showToast('配置内容为空', 'error'); return; }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
            a.download = (name || 'config') + '.json'; a.click(); URL.revokeObjectURL(a.href);
        } else {
            const file = await (this._source === 'remote' ? RemoteStorage : CloudStorage).get(id);
            if (!file || !file.text) { showToast('文件内容为空', 'error'); return; }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([file.text], { type: 'application/vnd.google-earth.kml+xml' }));
            a.download = file.name || 'file.kml'; a.click(); URL.revokeObjectURL(a.href);
        }
    },

    closeModal() {
        document.getElementById('fileModal').style.display = 'none';
    },

    async toggleFile(id) {
        try {
            await (this._source === 'remote' ? RemoteStorage : CloudStorage).toggle(id);
            showToast('状态已更新', 'success');
            this.refreshList();
        } catch (err) { showToast('操作失败', 'error'); }
    },

    async deleteFile(id, name) {
        if (!confirm(`确定删除 "${name}" ？`)) return;
        try {
            if (this._type === 'config') {
                if (this._source === 'remote') {
                    const url = getApiUrl(); if (!url) throw new Error('未配置 API 地址');
                    const resp = await fetch(url + '/api/configs/' + id, { method: 'DELETE' });
                    if (!resp.ok) throw new Error('删除失败');
                } else {
                    const realName = name.replace(/\\'/g, "'");
                    const raw = localStorage.getItem('layerToolConfigs');
                    if (raw) { const obj = JSON.parse(raw); delete obj[realName]; localStorage.setItem('layerToolConfigs', JSON.stringify(obj)); }
                }
            } else {
                await (this._source === 'remote' ? RemoteStorage : CloudStorage).remove(id);
            }
            showToast('已删除', 'success');
            this.refreshList();
        } catch (err) { showToast('删除失败', 'error'); }
    },

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    escH(s) {
        return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
    },

    escA(s) {
        return s ? String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
    }
};

document.addEventListener('DOMContentLoaded', () => Admin.init());
