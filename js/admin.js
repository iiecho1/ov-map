const CLOUD_DB_NAME = 'ov-map-cloud';
const CLOUD_DB_VERSION = 1;
const CLOUD_STORE = 'kml-files';
const AUTH_KEY = 'ov-map-admin-auth';
const DEFAULT_PASSWORD_HASH = 'admin123';

function getApiUrl() {
    return (localStorage.getItem('ov-map-cloud-api') || '').replace(/\/+$/, '');
}

function apiFetch(path, opts = {}) {
    const url = getApiUrl();
    if (!url) return null;
    if (opts.body && typeof opts.body === 'object') {
        opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
        opts.body = JSON.stringify(opts.body);
    }
    return fetch(url + path, opts).then(r => r.json());
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
            req.onerror = () => reject(new Error('无法打开云端存储数据库'));
        });
    },

    async getAll() {
        if (getApiUrl()) {
            try { return await apiFetch('/api/files'); } catch { return []; }
        }
        if (!this.db) return [];
        return new Promise(resolve => {
            const req = this.db.transaction(CLOUD_STORE, 'readonly').objectStore(CLOUD_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    },

    async get(id) {
        if (getApiUrl()) {
            try { return await apiFetch('/api/files/' + id); } catch { return null; }
        }
        if (!this.db) return null;
        return new Promise(resolve => {
            const req = this.db.transaction(CLOUD_STORE, 'readonly').objectStore(CLOUD_STORE).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    },

    async save(fileData) {
        if (getApiUrl()) {
            return apiFetch('/api/files', { method: 'POST', body: fileData });
        }
        if (!this.db) throw new Error('存储未初始化');
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(CLOUD_STORE, 'readwrite');
            tx.objectStore(CLOUD_STORE).put(fileData);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new Error('保存失败'));
        });
    },

    async update(id, data) {
        if (getApiUrl()) {
            return apiFetch('/api/files/' + id, { method: 'PUT', body: data });
        }
        const file = await this.get(id);
        if (!file) throw new Error('文件不存在');
        Object.assign(file, data, { updatedAt: Date.now() });
        return this.save(file);
    },

    async remove(id) {
        if (getApiUrl()) {
            return apiFetch('/api/files/' + id, { method: 'DELETE' });
        }
        if (!this.db) throw new Error('存储未初始化');
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(CLOUD_STORE, 'readwrite');
            tx.objectStore(CLOUD_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new Error('删除失败'));
        });
    },

    async toggle(id) {
        if (getApiUrl()) {
            return apiFetch('/api/files/' + id + '/toggle', { method: 'PATCH' });
        }
        const file = await this.get(id);
        if (!file) return;
        file.enabled = !file.enabled;
        file.updatedAt = Date.now();
        await this.save(file);
        return file;
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
    async init() {
        await CloudStorage.init();
        if (sessionStorage.getItem(AUTH_KEY) === 'true') {
            this.showAdminPage();
        }
        this.initUploadArea();
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
        document.getElementById('cloudApiUrl').value = savedApi;
        if (savedApi) this.checkApiStatus(savedApi);
        this.refreshList();
    },

    async checkApiStatus(url) {
        const statusEl = document.getElementById('apiStatus');
        try {
            const resp = await fetch(url.replace(/\/+$/, '') + '/api/health', {
                method: 'GET',
                signal: AbortSignal.timeout(3000)
            });
            const data = await resp.json();
            if (resp.ok && data.status === 'ok') {
                statusEl.className = 'api-status success';
                statusEl.textContent = `已连接 (${data.count || 0} 个文件)`;
            } else {
                statusEl.className = 'api-status error';
                statusEl.textContent = '后端响应异常';
            }
        } catch {
            statusEl.className = 'api-status error';
            statusEl.textContent = '无法连接后端';
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

    async saveCloudApi() {
        const url = document.getElementById('cloudApiUrl').value.trim();
        const statusEl = document.getElementById('apiStatus');
        const btn = document.getElementById('btnSaveApi');

        if (!url) {
            localStorage.removeItem('ov-map-cloud-api');
            statusEl.className = 'api-status';
            statusEl.textContent = '';
            showToast('已清除云端 API，使用本地存储', 'success');
            this.refreshList();
            return;
        }

        btn.disabled = true;
        btn.textContent = '检测中...';
        statusEl.className = 'api-status checking';
        statusEl.textContent = '正在检测后端连接...';

        try {
            const resp = await fetch(url.replace(/\/+$/, '') + '/api/health', {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            const data = await resp.json();

            if (resp.ok && data.status === 'ok') {
                localStorage.setItem('ov-map-cloud-api', url);
                statusEl.className = 'api-status success';
                statusEl.textContent = `连接成功 (${data.count || 0} 个文件)`;
                showToast('云端 API 已保存', 'success');
                this.refreshList();
            } else {
                statusEl.className = 'api-status error';
                statusEl.textContent = '后端响应异常';
                showToast('后端响应异常，未保存', 'error');
            }
        } catch (err) {
            statusEl.className = 'api-status error';
            if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                statusEl.textContent = '连接超时（5秒），请检查地址';
            } else if (err.name === 'TypeError') {
                statusEl.textContent = '无法连接，请检查地址是否正确';
            } else {
                statusEl.textContent = '连接失败: ' + err.message;
            }
            showToast('无法连接后端，未保存', 'error');
        }

        btn.disabled = false;
        btn.textContent = '保存';
    },

    initUploadArea() {
        const area = document.getElementById('uploadArea');
        const input = document.getElementById('kmlFileInput');

        area.addEventListener('click', e => {
            if (e.target.tagName !== 'BUTTON') input.click();
        });

        area.addEventListener('dragover', e => {
            e.preventDefault();
            area.classList.add('dragover');
        });

        area.addEventListener('dragleave', () => {
            area.classList.remove('dragover');
        });

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

        let success = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const pct = Math.round(((i) / files.length) * 100);
            progressFill.style.width = pct + '%';
            progressText.textContent = `上传 ${i + 1}/${files.length}: ${file.name}`;

            try {
                const text = await file.text();
                const id = 'cloud_' + Date.now() + '_' + i;
                await CloudStorage.save({
                    id,
                    name: file.name,
                    text,
                    ext: 'kml',
                    size: file.size,
                    enabled: true,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
                success++;
            } catch (err) {
                console.error('上传失败:', file.name, err);
                showToast(`上传失败: ${file.name}`, 'error');
            }
        }

        progressFill.style.width = '100%';
        progressText.textContent = '完成';
        setTimeout(() => { progress.style.display = 'none'; }, 1000);

        if (success > 0) {
            showToast(`成功上传 ${success} 个文件`, 'success');
            this.refreshList();
        }
    },

    async refreshList() {
        const container = document.getElementById('kmlFileList');
        const countEl = document.getElementById('fileCount');
        const files = await CloudStorage.getAll();

        if (!files.length) {
            container.innerHTML = '<p class="empty-hint">暂无云端 KML 文件</p>';
            countEl.textContent = '';
            return;
        }

        files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const enabledCount = files.filter(f => f.enabled !== false).length;
        countEl.textContent = `共 ${files.length} 个，${enabledCount} 个启用`;

        container.innerHTML = files.map(f => {
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
                    <button class="btn btn-xs btn-danger" onclick="Admin.deleteFile('${f.id}', '${this.escA(f.name)}')">&#10005; 删除</button>
                </div>
            </div>`;
        }).join('');
    },

    startRename(id) {
        const nameEl = document.getElementById('fname-' + id);
        if (!nameEl) return;
        const oldName = nameEl.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldName;
        input.className = 'rename-input';
        nameEl.textContent = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();

        const finish = async (save) => {
            const newName = input.value.trim();
            if (save && newName && newName !== oldName) {
                try {
                    await CloudStorage.update(id, { name: newName });
                    showToast('已重命名', 'success');
                } catch (err) {
                    showToast('重命名失败', 'error');
                }
            }
            this.refreshList();
        };

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
    },

    async showFileDetail(id) {
        const file = await CloudStorage.get(id);
        if (!file) { showToast('文件不存在', 'error'); return; }

        const size = file.size ? this.formatSize(file.size) : '未知';
        const created = file.createdAt ? new Date(file.createdAt).toLocaleString('zh-CN') : '未知';
        const updated = file.updatedAt ? new Date(file.updatedAt).toLocaleString('zh-CN') : '未知';
        const enabled = file.enabled !== false;
        const preview = file.text ? file.text.substring(0, 500) : '';

        document.getElementById('modalTitle').textContent = '文件详情';
        document.getElementById('modalBody').innerHTML = `
            <div class="detail-grid">
                <div class="detail-label">文件名</div>
                <div class="detail-value">${this.escH(file.name)}</div>
                <div class="detail-label">文件 ID</div>
                <div class="detail-value detail-mono">${this.escH(file.id)}</div>
                <div class="detail-label">文件大小</div>
                <div class="detail-value">${size}</div>
                <div class="detail-label">格式</div>
                <div class="detail-value">${this.escH(file.ext || 'kml')}</div>
                <div class="detail-label">状态</div>
                <div class="detail-value"><span class="file-status ${enabled ? 'enabled' : 'disabled'}">${enabled ? '已启用' : '已禁用'}</span></div>
                <div class="detail-label">创建时间</div>
                <div class="detail-value">${created}</div>
                <div class="detail-label">更新时间</div>
                <div class="detail-value">${updated}</div>
            </div>
            ${preview ? `<div class="detail-preview"><div class="detail-preview-title">内容预览（前 500 字符）</div><pre>${this.escH(preview)}</pre></div>` : ''}
        `;
        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-primary" onclick="Admin.downloadFile('${id}')">下载文件</button>
            <button class="btn" onclick="Admin.closeModal()" style="background:#4a6278;color:#ecf0f1">关闭</button>
        `;
        document.getElementById('fileModal').style.display = 'flex';
    },

    async downloadFile(id) {
        const file = await CloudStorage.get(id);
        if (!file || !file.text) { showToast('文件内容为空', 'error'); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([file.text], { type: 'application/vnd.google-earth.kml+xml' }));
        a.download = file.name || 'file.kml';
        a.click();
        URL.revokeObjectURL(a.href);
    },

    closeModal() {
        document.getElementById('fileModal').style.display = 'none';
    },

    async toggleFile(id) {
        try {
            await CloudStorage.toggle(id);
            showToast('状态已更新', 'success');
            this.refreshList();
        } catch (err) {
            showToast('操作失败', 'error');
        }
    },

    async deleteFile(id, name) {
        if (!confirm(`确定删除 "${name}" ？`)) return;
        try {
            await CloudStorage.remove(id);
            showToast('已删除', 'success');
            this.refreshList();
        } catch (err) {
            showToast('删除失败', 'error');
        }
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
