const CLOUD_DB_NAME = 'ov-map-cloud';
const CLOUD_DB_VERSION = 1;
const CLOUD_STORE = 'kml-files';
const AUTH_KEY = 'ov-map-admin-auth';
const DEFAULT_PASSWORD_HASH = 'admin123';

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
        this.refreshList();
        document.getElementById('cloudApiUrl').value = localStorage.getItem('ov-map-cloud-api') || '';
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

    saveCloudApi() {
        const url = document.getElementById('cloudApiUrl').value.trim();
        localStorage.setItem('ov-map-cloud-api', url);
        showToast(url ? '云端 API 已保存' : '已恢复本地存储模式', 'success');
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
        const files = await CloudStorage.getAll();

        if (!files.length) {
            container.innerHTML = '<p class="empty-hint">暂无云端 KML 文件</p>';
            return;
        }

        files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        container.innerHTML = files.map(f => {
            const size = f.size ? this.formatSize(f.size) : '未知';
            const date = f.createdAt ? new Date(f.createdAt).toLocaleString('zh-CN') : '未知';
            const statusClass = f.enabled !== false ? 'enabled' : 'disabled';
            const statusText = f.enabled !== false ? '已启用' : '已禁用';
            const toggleText = f.enabled !== false ? '禁用' : '启用';
            const toggleClass = f.enabled !== false ? 'btn-warn' : 'btn-primary';

            return `<div class="file-item" data-id="${f.id}">
                <div class="file-icon">&#128196;</div>
                <div class="file-info">
                    <div class="file-name">${this.escH(f.name)}</div>
                    <div class="file-meta">
                        <span>${size}</span>
                        <span>${date}</span>
                        <span class="file-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="btn btn-small ${toggleClass}" onclick="Admin.toggleFile('${f.id}')">${toggleText}</button>
                    <button class="btn btn-small btn-danger" onclick="Admin.deleteFile('${f.id}', '${this.escA(f.name)}')">删除</button>
                </div>
            </div>`;
        }).join('');
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
