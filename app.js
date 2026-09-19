// 统一统计请求，自动带 X-Site-Host，后续调用完全无感
async function statsFetch(path, options = {}) {
  const url = `${config.statsApiUrl}${path}`;
  const headers = {
    'X-Site-Host': window.location.hostname,
    ...(options.headers || {})
  };
  
  return fetch(url, { ...options, headers });
}

// ================= 状态管理 =================
const AppState = {
    allData: [],
    filteredData: [],
    config: null,
    fuse: null,
    currentPage: 1,
    currentCategory: null,
    sortMode: 'date',
    searchQuery: ''
};

// ================= 初始化入口 =================
window.initResourceSite = async function() {
    if (AppState.allData.length > 0) return;

    try {
        const configRes = await fetch('config.json');
        AppState.config = await configRes.json();
        
        document.getElementById('site-title').textContent = AppState.config.siteName;
        document.getElementById('btn-message-board').href = AppState.config.messageBoardUrl;
       
          // ✅ 绑定取码教程链接
        const tutorialBtn = document.getElementById('btn-tutorial');
        if (tutorialBtn && AppState.config.tutorialUrl) {
            tutorialBtn.href = AppState.config.tutorialUrl;
        }

        const announceBtn = document.getElementById('btn-announcement');
        if (announceBtn) {
            if (AppState.config.announcementUrl) {
                announceBtn.href = AppState.config.announcementUrl;
            } else {
                announceBtn.onclick = () => alert(AppState.config.announcement);
            }
        }

        await loadAllData();
        
        AppState.fuse = new Fuse(AppState.allData, {
            keys: ['title', 'pinyin'],
            threshold: 0.3,
            ignoreLocation: true
        });

        renderParentCategories();
        bindEvents();
        applyFiltersAndRender();
        StatsManager.init(AppState.config);

    } catch (error) {
        console.error("❌ 站点初始化失败:", error);
        const grid = document.getElementById('card-grid');
        if (grid) grid.innerHTML = '<p class="text-red-500 col-span-full text-center py-10">数据加载失败，请检查 config.json 和 data 目录。</p>';
    }
};

// ================= 数据加载（含每日缓存） =================
const CACHE_PREFIX = 'zaozi_data_';

async function loadAllData() {
    // ✅ 统一使用 utils.js 中的 getBeijingDate()
    const today = getBeijingDate();
    const cacheKey = CACHE_PREFIX + today;

    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            AppState.allData = JSON.parse(cached);
            console.log(`✅ [${today}] 命中本地缓存，跳过网络请求`);
            return;
        } catch(e) {
            localStorage.removeItem(cacheKey);
        }
    }

    console.log(`📡 [${today}] 首次加载，请求数据...`);
    const allItems = [];
    for (const file of AppState.config.dataFiles) {
        const res = await fetch(file);
        if (!res.ok) throw new Error(`Failed to load ${file}`);
        const items = await res.json();
        allItems.push(...items);
    }
    AppState.allData = allItems;

    try {
        localStorage.setItem(cacheKey, JSON.stringify(allItems));
        Object.keys(localStorage)
            .filter(k => k.startsWith(CACHE_PREFIX) && k !== cacheKey)
            .forEach(k => localStorage.removeItem(k));
        console.log(`💾 [${today}] 数据已缓存，历史缓存已清理`);
    } catch(e) {
        console.warn('⚠️ 缓存写入失败（数据可能超过 5MB 限制）:', e);
    }
}

// ================= 核心逻辑：筛选、排序与分页 =================
function applyFiltersAndRender() {
    let data = [...AppState.allData];

    if (AppState.searchQuery) {
        const searchResults = AppState.fuse.search(AppState.searchQuery);
        data = searchResults.map(r => r.item);
    } else if (AppState.currentCategory) {
        const tree = AppState.config.categoryTree;
        let targetCategories = [];
        
        if (tree[AppState.currentCategory]) {
            targetCategories = [AppState.currentCategory, ...tree[AppState.currentCategory].children];
        } else {
            targetCategories = [AppState.currentCategory];
        }

        data = data.filter(item => 
            item.categories && item.categories.some(cat => targetCategories.includes(cat))
        );
    }

    if (AppState.sortMode === 'date') {
        data.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } else {
        data.sort((a, b) => (a.pinyin || '').localeCompare(b.pinyin || ''));
    }

    AppState.filteredData = data;
    AppState.currentPage = 1;
    
    updateStatusUI();
    renderPage();
}

// ================= 标签颜色映射（少女粉主题 - 高饱和） =================
const TAG_COLORS = ['tag-rose', 'tag-pink', 'tag-amber', 'tag-sky', 'tag-lavender', 'tag-mint'];
function getTagColorClass(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

// ================= 渲染逻辑 =================
function renderPage() {
    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';

    const pageSize = AppState.config.pageSize || 40;
    const startIdx = (AppState.currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageData = AppState.filteredData.slice(startIdx, endIdx);

    if (pageData.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-20 text-pink-400 text-lg font-medium">🔍 没有找到匹配的资源</div>';
        renderPagination(0);
        return;
    }

    let lastGroupLabel = '';

    pageData.forEach((item, index) => {
        let currentLabel = '';
        if (AppState.sortMode === 'date') {
            currentLabel = item.date || '未知日期';
            if (currentLabel !== lastGroupLabel) {
                grid.insertAdjacentHTML('beforeend', `<div class="group-label">📅 ${currentLabel} 更新</div>`);
                lastGroupLabel = currentLabel;
            }
        } else {
            let letter = (item.pinyin || '#').charAt(0).toUpperCase();
            if (!/[A-Z]/.test(letter)) letter = '#';
            if (letter !== lastGroupLabel) {
                grid.insertAdjacentHTML('beforeend', `<div class="group-label">🔤 ${letter}</div>`);
                lastGroupLabel = letter;
            }
        }

        const card = document.createElement('div');
        card.className = 'resource-card flex flex-col justify-between';
        card.style.setProperty('--i', index);
        const tags = (item.categories || []).slice(0, 2).map(c => 
            `<span class="card-tag ${getTagColorClass(c)}">${c}</span>`
        ).join('');
        card.innerHTML = `
            <h3 class="line-clamp-2 mb-3" title="${item.title}">${item.title}</h3>
            <div class="flex flex-wrap gap-1.5 mt-auto">${tags}</div>
        `;
        card.onclick = () => showModal(item);
        grid.appendChild(card);
    });

    renderPagination(Math.ceil(AppState.filteredData.length / pageSize));
}

function renderPagination(totalPages) {
    const container = document.getElementById('pagination');
    container.innerHTML = '';
    if (totalPages <= 1) return;

    container.insertAdjacentHTML('beforeend', `<button class="page-btn" ${AppState.currentPage === 1 ? 'disabled' : ''} data-page="prev">上一页</button>`);

    const pages = new Set([1, totalPages, AppState.currentPage, AppState.currentPage - 1, AppState.currentPage + 1]);
    const sortedPages = [...pages].filter(p => p > 0 && p <= totalPages).sort((a, b) => a - b);
    
    let lastPage = 0;
    sortedPages.forEach(p => {
        if (p - lastPage > 1) container.insertAdjacentHTML('beforeend', `<span class="px-2 text-pink-400 text-sm font-semibold">...</span>`);
        const isActive = p === AppState.currentPage;
        container.insertAdjacentHTML('beforeend', `<button class="page-btn ${isActive ? 'page-active' : ''}" data-page="${p}">${p}</button>`);
        lastPage = p;
    });

    container.insertAdjacentHTML('beforeend', `<button class="page-btn" ${AppState.currentPage === totalPages ? 'disabled' : ''} data-page="next">下一页</button>`);
}

// ✅ 渲染父分类行
function renderParentCategories() {
    const bar = document.getElementById('parent-category-bar');
    const resetBtn = document.getElementById('btn-reset-category');
    bar.innerHTML = '';
    bar.appendChild(resetBtn);

    const tree = AppState.config.categoryTree;
    for (const parent of Object.keys(tree)) {
        const btn = document.createElement('button');
        btn.className = 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-pink-700 border border-pink-300 hover:border-pink-500 hover:text-pink-800 hover:bg-pink-100 transition whitespace-nowrap parent-cat-btn';
        btn.dataset.cat = parent;
        btn.textContent = parent;
        bar.appendChild(btn);
    }
}

// ✅ 渲染子分类行
function renderChildCategories(parentName) {
    const bar = document.getElementById('child-category-bar');
    bar.innerHTML = '';

    const tree = AppState.config.categoryTree;
    const children = tree[parentName]?.children || [];

    if (children.length === 0) {
        bar.classList.add('hidden');
        return;
    }

    children.forEach(child => {
        const btn = document.createElement('button');
        btn.className = 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-pink-600 border border-pink-300 hover:border-rose-500 hover:text-rose-700 hover:bg-rose-100 transition whitespace-nowrap child-cat-btn';
        btn.dataset.cat = child;
        btn.textContent = child;
        bar.appendChild(btn);
    });

    bar.classList.remove('hidden');
}

// ================= 统计模块（多子域名适配版） =================
const StatsManager = {
    apiUrl: '',
    siteHost: '',

    init(config) {
        this.apiUrl = config.statsApiUrl;
        // ✅ 获取当前页面的子域名，用于隔离统计
        this.siteHost = window.location.hostname;

        if (!this.apiUrl) {
            console.warn("⚠️ 未配置 statsApiUrl，统计功能已禁用");
            return;
        }
        console.log(`📊 统计子域名: ${this.siteHost}`);
        this.fetchStats();
        this.recordView();
    },

    async fetchStats() {
        try {
            const res = await fetch(`${this.apiUrl}/api/stats`, {
                headers: { 'X-Site-Host': this.siteHost }
            });
            const data = await res.json();
            
            const todayEl = document.getElementById('stat-today-views');
            if (todayEl) todayEl.textContent = data.todayViews.toLocaleString();
            
            const topList = document.getElementById('stat-top-resources');
            if (topList) {
                topList.innerHTML = '';
                if (data.topResources && data.topResources.length > 0) {
                    data.topResources.forEach((item, index) => {
                        topList.insertAdjacentHTML('beforeend', `
                            <li class="flex justify-between items-center">
                                <span class="truncate mr-2 text-orange-700 font-medium" title="${item.title}">${index + 1}. ${item.title}</span>
                                <span class="text-orange-600 font-mono text-xs font-bold bg-orange-100 px-2 py-0.5 rounded">${item.count}</span>
                            </li>
                        `);
                    });
                } else {
                    topList.innerHTML = '<li class="text-orange-400 font-medium">暂无数据</li>';
                }
            }
        } catch (err) {
            console.error("获取统计数据失败:", err);
            const todayEl = document.getElementById('stat-today-views');
            if (todayEl) todayEl.textContent = '--';
        }
    },

    recordView() {
        const today = getBeijingDate();
        // ✅ 缓存 key 也按子域名隔离，避免不同子域名共用同一个 PV 去重标记
        const cacheKey = `last_stats_view_${this.siteHost}_${today}`;
        const lastViewDate = localStorage.getItem(cacheKey);
        
        if (lastViewDate !== today) {
            fetch(`${this.apiUrl}/api/stats/view`, {
                method: 'POST',
                headers: { 'X-Site-Host': this.siteHost }
            })
                .then(() => localStorage.setItem(cacheKey, today))
                .catch(err => console.error("上报 PV 失败:", err));
        }
    },

    recordClick(title) {
        if (!this.apiUrl) return;
        fetch(`${this.apiUrl}/api/stats/click`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Site-Host': this.siteHost
            },
            body: JSON.stringify({ title })
        }).catch(err => console.error("上报点击失败:", err));
        
        setTimeout(() => this.fetchStats(), 1000);
    }
};
// ================= UI 交互与事件 =================
function showModal(item) {
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = item.title;
    
    const meta = document.getElementById('modal-meta');
    meta.innerHTML = `
        <span class="bg-pink-100 text-pink-700 border border-pink-300 px-2.5 py-1 rounded-lg font-semibold">📅 ${item.date}</span>
        ${(item.categories || []).map(c => `<span class="bg-rose-100 text-rose-700 border border-rose-300 px-2.5 py-1 rounded-lg font-semibold">🏷️ ${c}</span>`).join('')}
    `;

    // ✅ 清理死代码：build.py 的 clean_links 已过滤掉非 http 链接且不保留 note 字段
    // 因此此处只需渲染有效的 http 链接，无需处理 note 分支和重复的 http 判断
    const linksContainer = document.getElementById('modal-links');
    linksContainer.innerHTML = '';
    
    if (!item.links || item.links.length === 0) {
        linksContainer.innerHTML = '<p class="text-pink-400 text-sm text-center py-4 font-medium">暂无有效链接</p>';
    } else {
        item.links.forEach(link => {
            linksContainer.insertAdjacentHTML('beforeend', `
                <a href="${link.url}" target="_blank" class="block w-full bg-pink-50 hover:bg-pink-100 border border-pink-300 hover:border-pink-500 rounded-xl p-3.5 transition text-center shadow-sm hover:shadow-md">
                    <span class="font-bold text-pink-600 text-sm">🔗 ${link.platform}</span>
                </a>
            `);
        });
    }

    StatsManager.recordClick(item.title);
    modal.classList.remove('hidden');
}

function updateStatusUI() {
    const statusEl = document.getElementById('current-status');
    const countEl = document.getElementById('total-count');
    
    if (statusEl) statusEl.textContent = AppState.searchQuery ? `搜索: "${AppState.searchQuery}"` : (AppState.currentCategory || '全部');
    if (countEl) countEl.textContent = AppState.filteredData.length;
}

// ✅ 更新分类激活样式
function updateCategoryActiveUI(activeCat) {
    // 重置所有分类按钮为默认态
    document.querySelectorAll('.parent-cat-btn').forEach(el => {
        el.className = 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-pink-700 border border-pink-300 hover:border-pink-500 hover:text-pink-800 hover:bg-pink-100 transition whitespace-nowrap parent-cat-btn';
    });
    document.querySelectorAll('.child-cat-btn').forEach(el => {
        el.className = 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-pink-600 border border-pink-300 hover:border-rose-500 hover:text-rose-700 hover:bg-rose-100 transition whitespace-nowrap child-cat-btn';
    });

    if (!activeCat) {
        const resetBtn = document.getElementById('btn-reset-category');
        resetBtn.classList.add('category-active');
        return;
    }

    const matched = document.querySelector(`[data-cat="${activeCat}"]`);
    if (matched) {
        matched.classList.add('category-active');
    }
}

function bindEvents() {
    // 1. 搜索框防抖
    let searchTimer;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            AppState.searchQuery = e.target.value.trim();
            applyFiltersAndRender();
        }, 300);
    });

    // 2. 排序切换
    document.getElementById('sort-date').onclick = () => {
        AppState.sortMode = 'date';
        document.getElementById('sort-date').className = 'sort-btn px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-sm whitespace-nowrap transition';
        document.getElementById('sort-pinyin').className = 'sort-btn sort-btn-inactive px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition';
        applyFiltersAndRender();
    };
    document.getElementById('sort-pinyin').onclick = () => {
        AppState.sortMode = 'pinyin';
        document.getElementById('sort-pinyin').className = 'sort-btn px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-sm whitespace-nowrap transition';
        document.getElementById('sort-date').className = 'sort-btn sort-btn-inactive px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition';
        applyFiltersAndRender();
    };

    // ✅ 3. 父分类点击
    document.getElementById('parent-category-bar').addEventListener('click', (e) => {
        const btn = e.target.closest('.parent-cat-btn');
        if (!btn) return;

        const cat = btn.dataset.cat;
        AppState.currentCategory = cat;
        AppState.searchQuery = '';
        document.getElementById('search-input').value = '';

        updateCategoryActiveUI(cat);
        renderChildCategories(cat);
        applyFiltersAndRender();
    });

    // ✅ 4. 子分类点击
    document.getElementById('child-category-bar').addEventListener('click', (e) => {
        const btn = e.target.closest('.child-cat-btn');
        if (!btn) return;

        const cat = btn.dataset.cat;
        AppState.currentCategory = cat;
        AppState.searchQuery = '';
        document.getElementById('search-input').value = '';

        updateCategoryActiveUI(cat);
        applyFiltersAndRender();
    });

    // 5. 重置分类
    document.getElementById('btn-reset-category').onclick = () => {
        AppState.currentCategory = null;
        AppState.searchQuery = '';
        document.getElementById('search-input').value = '';
        updateCategoryActiveUI(null);
        document.getElementById('child-category-bar').classList.add('hidden');
        document.getElementById('child-category-bar').innerHTML = '';
        applyFiltersAndRender();
    };

    // 6. 分页点击
    document.getElementById('pagination').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-page]');
        if (!btn || btn.disabled) return;
        
        const val = btn.dataset.page;
        const totalPages = Math.ceil(AppState.filteredData.length / AppState.config.pageSize);
        
        if (val === 'prev') AppState.currentPage--;
        else if (val === 'next') AppState.currentPage++;
        else AppState.currentPage = parseInt(val);
        
        renderPage();
        document.getElementById('main-content').scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 7. 弹窗关闭
    document.getElementById('modal-close').onclick = () => document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').onclick = (e) => {
        if (e.target.id === 'modal') document.getElementById('modal').classList.add('hidden');
    };
}

// 在 app.js 中补充这个函数
function getBeijingDate() {
  const now = new Date(Date.now() + 8 * 3600000);
  return now.toISOString().split('T')[0];
}