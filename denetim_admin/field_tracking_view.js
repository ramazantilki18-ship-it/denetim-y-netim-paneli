/**
 * SAHA TAKİP VE PERFORMANS ANALİZİ GÖRÜNÜMÜ (field_tracking_view.js)
 * 
 * Bu dosya, admin panelindeki "Saha Performans" sayfasının 
 * dinamik render ve istatistik hesaplama mantığını içerir.
 */

// Global State
let rawFieldSessionsCache = [];
let fieldSessionsCache = [];
let fieldRosterCache = {};
let fieldTrackingActiveTab = 'matrix';
let detailMapInstance = null;
let detailMapMarkers = [];
let detailMapPolyline = null;
let fieldTrackingCharts = [];
let fieldTrackingIsDemoMode = false;
let fieldTrackingDemoModeReason = '';

/**
 * Ana giriş noktası - switchView('field-tracking-view') ile çağrılır
 */
async function renderFieldTracking() {
    const container = document.getElementById('field-tracking-view');
    if (!container) return;

    // Eğer sayfa ilk defa yükleniyorsa iskeleti oluştur
    if (container.innerHTML === '') {
        initFieldTrackingLayout(container);
    }

    // Filtre seçeneklerini (Hat ve Personel) doldur
    populateFieldFilters();

    // Verileri yükle ve render et (True = Yeniden Firestore'dan Çek)
    await loadFieldTrackingData(true);
}

/**
 * Sayfa iskeletini hazırlar (HTML)
 */
function initFieldTrackingLayout(container) {
    container.innerHTML = `
        <style>
            /* Premium Segmented Pill Tabs */
            .field-tracking-tabs {
                display: flex;
                width: 100%;
                background: rgba(15, 23, 42, 0.45);
                border: 1px solid var(--border-main);
                border-radius: 12px;
                padding: 5px;
                gap: 4px;
                margin-bottom: 6px;
                box-sizing: border-box;
                overflow-x: auto;
                scrollbar-width: none;
                -ms-overflow-style: none;
            }

            body.light-mode .field-tracking-tabs {
                background: rgba(241, 245, 249, 0.85);
                border-color: rgba(203, 213, 225, 0.7);
            }

            .field-tracking-tabs::-webkit-scrollbar {
                display: none;
            }

            .field-tab-btn {
                flex: 1 0 auto;
                background: transparent;
                color: var(--text-secondary);
                border: none;
                font-size: 0.78rem;
                font-weight: 700;
                padding: 8px 14px;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                white-space: nowrap;
                text-align: center;
                min-width: max-content;
            }

            .field-tab-btn i {
                flex-shrink: 0;
            }

            .field-tab-btn:hover {
                color: var(--text-primary);
                background: rgba(255, 255, 255, 0.05);
            }

            body.light-mode .field-tab-btn:hover {
                background: rgba(0, 0, 0, 0.04);
            }

            .field-tab-btn.active {
                background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
                color: white !important;
                box-shadow: 0 4px 14px rgba(249, 115, 22, 0.35);
            }

            /* Responsive stat card grids */
            .field-stat-grid {
                display: grid;
                grid-template-columns: repeat(5, minmax(0, 1fr));
                gap: 0.75rem;
                margin-bottom: 0.75rem;
            }

            @media (max-width: 1024px) {
                .field-stat-grid {
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                }
            }

            @media (max-width: 768px) {
                .field-stat-grid {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
            }

            @media (max-width: 480px) {
                .field-stat-grid {
                    grid-template-columns: 1fr;
                }
            }

            .field-stat-card {
                background: var(--bg-card);
                border: 1px solid var(--border-main);
                border-radius: 12px;
                padding: 12px;
                display: flex;
                flex-direction: column;
                min-height: 90px;
                box-sizing: border-box;
            }

            .field-stat-card .stat-label {
                font-size: 0.72rem;
                color: var(--text-dim);
                font-weight: 700;
                text-transform: uppercase;
                margin-bottom: 6px;
                line-height: 1.3;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }

            .field-stat-card .stat-label i {
                flex-shrink: 0;
                font-size: 1.05rem;
            }

            .field-stat-card .stat-value {
                font-size: 1.4rem;
                font-weight: 800;
                margin: 0;
                line-height: 1.2;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .field-stat-card .stat-desc {
                color: var(--text-dim);
                font-size: 0.7rem;
                margin-top: 4px;
                line-height: 1.3;
            }

            /* Chart grid */
            .field-chart-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
                gap: 0.75rem;
                margin-top: 0.5rem;
                margin-bottom: 0.75rem;
            }

            .field-chart-card {
                background: var(--bg-card);
                border: 1px solid var(--border-main);
                border-radius: 12px;
                padding: 14px;
                box-sizing: border-box;
            }

            .field-chart-card.full-width {
                grid-column: 1 / -1;
            }

            .field-chart-card h4 {
                font-size: 0.9rem;
                font-weight: 700;
                margin-bottom: 0.75rem;
                color: var(--text-primary);
            }

            @media (max-width: 1200px) {
                .field-tab-btn {
                    font-size: 0.72rem;
                    padding: 8px 6px;
                    gap: 4px;
                }
            }
        </style>

        <div class="field-tracking-container">
            <!-- Arka planda filtre kontrolü sağlayan gizli select elemanları -->
            <div style="display: none;">
                <select id="field-filter-line" multiple onchange="applyFieldFilters()">
                    <option value="all" selected>Tüm Hatlar</option>
                </select>
                <select id="field-filter-user" multiple onchange="applyFieldFilters()">
                    <option value="all" selected>Tüm Personeller</option>
                </select>
            </div>

            <!-- Üst Filtre Barı (Premium Custom Select & Akıllı Tarih Entegrasyonu) -->
            <div class="filter-card" style="margin-bottom: 0.75rem; max-width: 100%; width: 100%; padding: 0.45rem 0.75rem; border-radius: 12px; background: transparent !important; border: 1px solid rgba(249, 115, 22, 0.35); box-shadow: 0 8px 24px rgba(249, 115, 22, 0.15); display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 1rem; z-index: 10; position: relative; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; flex: 1;">
                    
                    <!-- Akıllı Tarih Seçici (Tüm Zamanlar) -->
                    <div class="custom-select-wrapper" id="custom-wrap-field-unified-date" style="position: relative; width: 220px;">
                        <div class="custom-select-trigger" onclick="toggleCustomSelect('custom-wrap-field-unified-date')">
                            <span class="custom-select-label" id="field-unified-date-label">Tüm Zamanlar</span>
                            <i class="fas fa-calendar-alt" style="font-size: 0.75rem; color: var(--text-secondary);"></i>
                        </div>
                        <div class="custom-select-options-card" id="custom-options-field-unified-date" style="width: 320px; padding: 0.8rem; overflow-y: visible; max-height: unset; z-index: 1000; right: auto; left: 0;">
                            <!-- Dinamik Akıllı Tarih Arayüzü -->
                        </div>
                    </div>

                    <!-- Hat Seçimi (Çoklu Seçim) -->
                    <div class="custom-select-wrapper" id="custom-wrap-field-line" style="width: 180px;">
                        <div class="custom-select-trigger" onclick="toggleCustomSelect('custom-wrap-field-line')">
                            <span class="custom-select-label" id="field-label-line">Tüm Hatlar</span>
                            <i class="fas fa-chevron-down" style="font-size: 0.6rem; color: var(--text-secondary);"></i>
                        </div>
                        <div class="custom-select-options-card">
                            <div class="custom-options-list" id="field-custom-options-line">
                                <!-- Dinamik Hatlar -->
                            </div>
                        </div>
                    </div>

                    <!-- Personel Seçimi (Çoklu Seçim) -->
                    <div class="custom-select-wrapper" id="custom-wrap-field-user" style="width: 220px;">
                        <div class="custom-select-trigger" onclick="toggleCustomSelect('custom-wrap-field-user')">
                            <span class="custom-select-label" id="field-label-user">Tüm Personeller</span>
                            <i class="fas fa-chevron-down" style="font-size: 0.6rem; color: var(--text-secondary);"></i>
                        </div>
                        <div class="custom-select-options-card">
                            <div class="custom-options-list" id="field-custom-options-user">
                                <!-- Dinamik Personeller -->
                            </div>
                        </div>
                    </div>

                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-outline" onclick="clearFieldFilters()" style="padding: 0.45rem 1rem; font-size: 0.85rem; border-radius: 8px;">
                        <i class="fas fa-filter-circle-xmark mr-1"></i> Temizle
                    </button>
                    <button class="btn-primary" onclick="exportFieldDataToExcel()" style="padding: 0.45rem 1rem; font-size: 0.85rem; border-radius: 8px;">
                        <i class="fas fa-file-excel mr-2"></i> Excel Raporu Al
                    </button>
                </div>
            </div>

            <!-- Sekme Seçici (Premium Segmented Control) -->
            <div class="field-tracking-tabs">
                <button class="field-tab-btn active" id="field-tab-matrix" onclick="switchFieldTab('matrix')">
                    <i class="fas fa-calendar-alt"></i> Vardiya Planı
                </button>
                <button class="field-tab-btn" id="field-tab-general" onclick="switchFieldTab('general')">
                    <i class="fas fa-chart-line"></i> Genel Analiz
                </button>
                <button class="field-tab-btn" id="field-tab-individual" onclick="switchFieldTab('individual')">
                    <i class="fas fa-user-clock"></i> Personel Analizi
                </button>
                <button class="field-tab-btn" id="field-tab-reports" onclick="switchFieldTab('reports')">
                    <i class="fas fa-file-invoice"></i> Raporlar
                </button>
            </div>

            <!-- Sekme İçerik Alanı -->
            <div id="field-tracking-tab-content" style="margin-top: 0px; margin-bottom: 0.75rem;">
                <!-- İçerik fonksiyonlar tarafından dinamik yüklenecek -->
            </div>
        </div>
    `;
}

/**
 * Filtrelerden seçili olan aktif yıl ve ayı bulur (Hata önleyici)
 */
function getFieldActiveYearAndMonth() {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1; // Varsayılan geçerli yıl ve ay

    if (typeof unifiedDateFilters !== 'undefined' && unifiedDateFilters.field) {
        const uYears = unifiedDateFilters.field.years || [];
        const uMonths = unifiedDateFilters.field.months || [];
        if (uYears.length > 0) year = parseInt(uYears[0]);
        if (uMonths.length > 0) month = parseInt(uMonths[0]);
    }
    return { year, month };
}

/**
 * Gizli filtre listelerini doldurur
 */
function populateFieldFilters() {
    // 1. Hatlar
    const lineSelect = document.getElementById('field-filter-line');
    if (lineSelect) {
        const currentSelected = getMultiSelectValues(lineSelect);
        lineSelect.innerHTML = '<option value="all" selected>Tüm Hatlar</option>';
        const lines = appData.lines || [];
        lines.forEach(line => {
            const id = typeof line === 'object' ? line.id : line;
            const name = typeof line === 'object' ? line.name : line;
            const opt = new Option(name, id);
            opt.selected = currentSelected.includes(id);
            lineSelect.add(opt);
        });
    }

    // 2. Personeller
    const userSelect = document.getElementById('field-filter-user');
    if (userSelect) {
        const currentSelected = getMultiSelectValues(userSelect);
        userSelect.innerHTML = '<option value="all" selected>Tüm Personeller</option>';
        const users = (appData.users || []).filter(u => {
            const title = (u.title || u.jobTitle || '').toLowerCase();
            return title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
        });
        users.forEach(user => {
            const name = user.name || user.username || user.id;
            const opt = new Option(name, user.id);
            opt.selected = currentSelected.includes(user.id);
            userSelect.add(opt);
        });
    }

    // Özel çoklu seçim arayüzünü güncelle
    syncFieldCustomSelects();
}

/**
 * Özel select kutularını senkronize eder
 */
function syncFieldCustomSelects() {
    syncSingleFieldCustomSelect('field-filter-line', 'field-custom-options-line', 'Tüm Hatlar', 'Hat Seçildi', true);
    syncSingleFieldCustomSelect('field-filter-user', 'field-custom-options-user', 'Tüm Personeller', 'Personel Seçildi', true);
    syncFieldCustomSelectsLabels();
}

/**
 * Tek bir özel select kutusunu senkronize eder (Dinamik Checkbox yapısı)
 */
function syncSingleFieldCustomSelect(selectId, optionsContainerId, defaultLabel, activeLabelSuffix, isMulti) {
    const select = document.getElementById(selectId);
    const optionsContainer = document.getElementById(optionsContainerId);
    if (!select || !optionsContainer) return;

    optionsContainer.innerHTML = '';
    const selectedValues = isMulti ? getMultiSelectValues(select) : [select.value];

    Array.from(select.options).forEach(opt => {
        if (!opt.value) return;

        const isSelected = isMulti
            ? (selectedValues.includes(opt.value) || (selectedValues.length === 0 && opt.value === 'all'))
            : (select.value === opt.value);

        const optDiv = document.createElement('div');
        optDiv.className = 'custom-option-item' + (isSelected ? ' selected' : '');

        const checkboxHtml = isMulti
            ? `<input type="checkbox" ${isSelected ? 'checked' : ''} style="pointer-events:none; margin:0; width:14px; height:14px; accent-color:#f97316;">`
            : '';

        optDiv.innerHTML = `${checkboxHtml} <span style="margin-left:6px; color:var(--text-primary);">${escapeHtml(opt.text)}</span>`;

        optDiv.addEventListener('click', function (e) {
            e.stopPropagation();
            if (isMulti) {
                if (opt.value === 'all') {
                    Array.from(select.options).forEach(o => o.selected = (o.value === 'all'));
                } else {
                    opt.selected = !opt.selected;
                    const allOpt = Array.from(select.options).find(o => o.value === 'all');
                    if (allOpt) allOpt.selected = false;

                    const selected = getMultiSelectValues(select);
                    if (selected.length === 0 && allOpt) {
                        allOpt.selected = true;
                    }
                }
                select.dispatchEvent(new Event('change'));
                if (typeof select.onchange === 'function') {
                    select.onchange();
                }
            } else {
                select.value = opt.value;
                select.dispatchEvent(new Event('change'));
                if (typeof select.onchange === 'function') {
                    select.onchange();
                }
                optionsContainer.parentElement.style.display = 'none'; // Kapat
            }
            
            syncFieldCustomSelectsLabels();
            applyFieldFilters();
        });

        optionsContainer.appendChild(optDiv);
    });
}

/**
 * Özel select etiketlerini seçilenlere göre günceller
 */
function syncFieldCustomSelectsLabels() {
    // Hat Etiketi
    const lineSelect = document.getElementById('field-filter-line');
    const lineLabel = document.getElementById('field-label-line');
    if (lineSelect && lineLabel) {
        const selected = getMultiSelectValues(lineSelect);
        if (selected.length === 0 || selected.includes('all')) {
            lineLabel.textContent = 'Tüm Hatlar';
        } else if (selected.length <= 2) {
            const texts = selected.map(val => {
                const found = Array.from(lineSelect.options).find(o => o.value === val);
                return found ? found.text : '';
            }).filter(Boolean);
            lineLabel.textContent = texts.join(', ');
        } else {
            lineLabel.textContent = `${selected.length} Hat Seçildi`;
        }
    }

    // Personel Etiketi
    const userSelect = document.getElementById('field-filter-user');
    const userLabel = document.getElementById('field-label-user');
    if (userSelect && userLabel) {
        const selected = getMultiSelectValues(userSelect);
        if (selected.length === 0 || selected.includes('all')) {
            userLabel.textContent = 'Tüm Personeller';
        } else if (selected.length <= 2) {
            const texts = selected.map(val => {
                const found = Array.from(userSelect.options).find(o => o.value === val);
                return found ? found.text : '';
            }).filter(Boolean);
            userLabel.textContent = texts.join(', ');
        } else {
            userLabel.textContent = `${selected.length} Personel Seçildi`;
        }
    }
}

/**
 * Filtreleri temizler
 */
function clearFieldFilters() {
    // 1. Hatlar
    const lineSelect = document.getElementById('field-filter-line');
    if (lineSelect) {
        Array.from(lineSelect.options).forEach(o => o.selected = (o.value === 'all'));
    }

    // 2. Personeller
    const userSelect = document.getElementById('field-filter-user');
    if (userSelect) {
        Array.from(userSelect.options).forEach(o => o.selected = (o.value === 'all'));
    }

    // 3. Akıllı Tarih Filtresi
    if (typeof unifiedDateFilters !== 'undefined' && unifiedDateFilters.field) {
        unifiedDateFilters.field.years = [];
        unifiedDateFilters.field.months = [];
        unifiedDateFilters.field.weeks = [];
        unifiedDateFilters.field.days = [];
        renderUnifiedDateOptions('field');
        updateUnifiedDateTriggerLabel('field');
    }

    syncFieldCustomSelects();
    applyFieldFilters();
}

/**
 * Sekme değiştirme mantığı
 */
function switchFieldTab(tabId) {
    destroyFieldCharts();
    fieldTrackingActiveTab = tabId;

    // Segmented tab butonlarının aktiflik durumunu güncelle
    document.querySelectorAll('.field-tracking-tabs .field-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    const activeBtn = document.getElementById(`field-tab-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    renderActiveTabContent();
}

/**
 * Grafik nesnelerini bellekten temizler
 */
function destroyFieldCharts() {
    if (fieldTrackingCharts && fieldTrackingCharts.length > 0) {
        fieldTrackingCharts.forEach(c => {
            try { c.destroy(); } catch (e) {}
        });
        fieldTrackingCharts = [];
    }
}

/**
 * Firebase Firestore'dan verileri yükler
 */
/**
 * Belirli bir promise'ı zaman aşımıyla çalıştırır (Hata toleransı için)
 */
function withTimeout(promise, ms = 4000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Sorgu zaman aşımına uğradı')), ms))
    ]);
}

/**
 * Firebase Firestore'dan verileri yükler
 */
let _isLoadingFieldData = false;

async function loadFieldTrackingData(force = false) {
    if (_isLoadingFieldData) return;
    const container = document.getElementById('field-tracking-tab-content');
    if (!container) return;

    _isLoadingFieldData = true;
    try {
        // Aktif tarih filtre yıl/ayını bulalım ki roster'ı o tarihe göre yükleyelim
        const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();

        // Roster verilerini yükle (Çalışılan günler ve izin durumları)
        try {
            fieldRosterCache = await loadMonthlyRoster(activeYear, activeMonth);
        } catch (rErr) {
            console.warn('Roster load warning, bypassing:', rErr);
            fieldRosterCache = {};
        }

        // Verileri in-memory cache'den al (Firestore anlık dinleyicisi arka planda besler)
        if (Array.isArray(appData.fieldSessions) && appData.fieldSessions.length > 0) {
            rawFieldSessionsCache = [...appData.fieldSessions];
            fieldTrackingIsDemoMode = false;
        } else {
            // Eğer veritabanı boşsa veya henüz yüklenmediyse mock veriler üretelim
            fieldTrackingIsDemoMode = true;
            fieldTrackingDemoModeReason = 'Veritabanı boş veya erişilemedi';
            
            rawFieldSessionsCache = [];
            generateFieldTrackingMockData();
        }

        // Tarih seçici listesini güncelle
        if (typeof renderUnifiedDateOptions === 'function') {
            renderUnifiedDateOptions('field');
        }

        // Filtreleri yerel önbelleğe uygulayıp ekranı çizelim
        applyFieldFilters();
    } finally {
        _isLoadingFieldData = false;
    }
}

/**
 * Filtreleri in-memory uygulayıp aktif sekmeyi günceller
 */
function applyFieldFilters() {
    let filtered = [...rawFieldSessionsCache];
    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();

    // 1. Akıllı Tarih Filtreleme
    if (typeof unifiedDateFilters !== 'undefined' && unifiedDateFilters.field) {
        const uYears = unifiedDateFilters.field.years || [];
        const uMonths = unifiedDateFilters.field.months || [];
        const uWeeks = unifiedDateFilters.field.weeks || [];
        const uDays = unifiedDateFilters.field.days || [];

        // YIL filtresi var ise yıl bazlı, yok ise aktif yıla göre filtrele
        if (uYears.length > 0) {
            filtered = filtered.filter(s => {
                let date = s.startTime || s.date;
                if (date && !(date instanceof Date)) date = new Date(date);
                return date && uYears.includes(date.getFullYear().toString());
            });
        } else {
            filtered = filtered.filter(s => {
                let date = s.startTime || s.date;
                if (date && !(date instanceof Date)) date = new Date(date);
                return date && date.getFullYear() === activeYear;
            });
        }

        // AY filtresi var ise ay bazlı, yok ise aktif aya göre filtrele
        if (uMonths.length > 0) {
            filtered = filtered.filter(s => {
                let date = s.startTime || s.date;
                if (date && !(date instanceof Date)) date = new Date(date);
                return date && uMonths.includes((date.getMonth() + 1).toString());
            });
        } else {
            filtered = filtered.filter(s => {
                let date = s.startTime || s.date;
                if (date && !(date instanceof Date)) date = new Date(date);
                return date && (date.getMonth() + 1) === activeMonth;
            });
        }

        // Hafta filtresi varsa uygula
        if (uWeeks.length > 0) {
            filtered = filtered.filter(s => {
                let date = s.startTime || s.date;
                if (date && !(date instanceof Date)) date = new Date(date);
                return date && uWeeks.includes(getISOWeekNumber(date).toString());
            });
        }

        // Gün filtresi varsa uygula
        if (uDays.length > 0) {
            filtered = filtered.filter(s => {
                let date = s.startTime || s.date;
                if (date && !(date instanceof Date)) date = new Date(date);
                return date && uDays.includes(getLocalDateString(date));
            });
        }
    } else {
        // Eğer unifiedDateFilters.field tanımsızsa da aktif yıl ve aya göre filtrele
        filtered = filtered.filter(s => {
            let date = s.startTime || s.date;
            if (date && !(date instanceof Date)) date = new Date(date);
            return date && date.getFullYear() === activeYear && (date.getMonth() + 1) === activeMonth;
        });
    }

    // 2. Hat Filtreleme (Çoklu Seçim)
    const lineSelect = document.getElementById('field-filter-line');
    if (lineSelect) {
        const selectedLines = getMultiSelectValues(lineSelect);
        if (selectedLines.length > 0) {
            filtered = filtered.filter(s => {
                if (selectedLines.includes(s.line)) return true;
                if (Array.isArray(s.visits)) {
                    return s.visits.some(v => {
                        const nfcKey = Object.keys(appData.stationLocations || {}).find(k => k.endsWith(`_${v.stationName}`));
                        if (nfcKey) {
                            const lineId = nfcKey.split('_')[0];
                            return selectedLines.includes(lineId);
                        }
                        return false;
                    });
                }
                return false;
            });
        }
    }

    // 3. Personel Filtreleme (Çoklu Seçim)
    const userSelect = document.getElementById('field-filter-user');
    if (userSelect) {
        const selectedUsers = getMultiSelectValues(userSelect);
        if (selectedUsers.length > 0) {
            filtered = filtered.filter(s => selectedUsers.includes(s.userId));
        }
    }

    // Diğer çizim fonksiyonlarının okuduğu ana global değişkeni güncelle
    fieldSessionsCache = filtered;

    // Aktif sekmeyi çiz
    renderActiveTabContent();
}

/**
 * Aktif sekme içeriğini ekrana çizer
 */
function renderActiveTabContent() {
    const container = document.getElementById('field-tracking-tab-content');
    if (!container) return;

    destroyFieldCharts();

    // İçerik sarmalayıcısını kontrol et veya oluştur
    let contentWrapper = document.getElementById('field-tracking-inner-content');
    if (!contentWrapper) {
        container.innerHTML = `
            <!-- Demo Modu Bilgi Bannerı -->
            <div id="field-demo-banner" style="display:none; margin-bottom:1rem; padding:0.75rem 1rem; background:rgba(245, 158, 11, 0.15); border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; color:#f59e0b; display:flex; align-items:center; gap:10px; font-size:0.85rem; font-weight:600;">
                <i class="fas fa-info-circle" style="font-size:1.1rem;"></i>
                <span>Saha takip veritabanına erişim izniniz bulunmuyor veya koleksiyon henüz oluşturulmamış. Şu anda demo/mock verileri görüntülüyorsunuz.</span>
            </div>
            <div id="field-tracking-inner-content"></div>
        `;
        contentWrapper = document.getElementById('field-tracking-inner-content');
    }

    // Banner görünürlüğünü güncelle
    const banner = document.getElementById('field-demo-banner');
    if (banner) {
        banner.style.display = (fieldTrackingIsDemoMode) ? 'flex' : 'none';
        if (fieldTrackingIsDemoMode && fieldTrackingDemoModeReason) {
            const spanEl = banner.querySelector('span');
            if (spanEl) {
                spanEl.innerHTML = `Saha takip veritabanından veri alınamadı (Detay: <strong>${escapeHtml(fieldTrackingDemoModeReason)}</strong>). Şu anda demo/mock verileri görüntülüyorsunuz.`;
            }
        }
    }

    if (fieldTrackingActiveTab === 'matrix') {
        renderFieldMatrix(contentWrapper);
    } else if (fieldTrackingActiveTab === 'general') {
        renderFieldGeneralStats(contentWrapper);
    } else if (fieldTrackingActiveTab === 'individual') {
        renderFieldIndividualPerf(contentWrapper);
    } else if (fieldTrackingActiveTab === 'reports') {
        renderFieldReports(contentWrapper);
    }
}

/**
 * Dakikayı formatlı saate çevirir (Örn: 90 -> 1s 30dk)
 */
function formatFieldDuration(minutes) {
    if (!minutes || isNaN(minutes) || minutes <= 0) return '—';
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hrs > 0) {
        return mins > 0 ? `${hrs}s ${mins}dk` : `${hrs}s`;
    }
    return `${mins}dk`;
}

/**
 * -----------------------------------------------------------------------------
 * SEKME 1: SAHA MATRİSİ GÖRÜNÜMÜ
 * -----------------------------------------------------------------------------
 */
function renderFieldMatrix(container) {
    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
    
    // Filtrelenmiş personel listesi (Sadece Hat Vardiya Amiri ve Saha Süpervizörü)
    let filteredUsers = (appData.users || []).filter(u => {
        const title = (u.title || u.jobTitle || '').toLowerCase();
        const isValidRole = title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
        if (!isValidRole) return false;

        // En azından bir saha seansı varsa listele
        const hasSession = fieldSessionsCache.some(s => s.userId === u.id);
        const hasTrackingPerm = getTitleMobilePermission(u.title || u.jobTitle, 'sahaTakip');
        return hasSession || hasTrackingPerm;
    });

    if (filteredUsers.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:4rem; color:var(--text-dim); background:var(--bg-card); border-radius:12px; border:1px solid var(--border-main);">
                <i class="fas fa-route fa-3x mb-3" style="color:var(--text-dim);"></i>
                <p style="font-size:1.1rem; font-weight:600;">Seçili Dönemde Saha Verisi Bulunmuyor</p>
                <p style="font-size:0.9rem;">Mobil uygulamada "Sahadayım" butonuna basarak seans başlatmış olan personel bulunmuyor.</p>
            </div>
        `;
        return;
    }

    // Gün başlıkları HTML
    let dayHeadersHtml = '';
    for (let d = 1; d <= daysInMonth; d++) {
        dayHeadersHtml += `<th style="text-align: center; padding: 8px 4px; font-size: 0.75rem; min-width: 42px;">${d}</th>`;
    }

    // Hatta göre gruplandırma yap
    const groupedUsers = {};
    filteredUsers.forEach(user => {
        const lines = Array.isArray(user.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
        let lineGroup = 'Tüm Hatlar (Global)';
        if (lines.length > 0) {
            if (lines.includes('ALL')) {
                lineGroup = 'Tüm Hatlar (Global)';
            } else {
                lineGroup = lines.join(', ');
            }
        }
        if (!groupedUsers[lineGroup]) {
            groupedUsers[lineGroup] = [];
        }
        groupedUsers[lineGroup].push(user);
    });

    // Grupları sırala (Önce M1, M2 vs., en son Tüm Hatlar)
    const sortedGroupKeys = Object.keys(groupedUsers).sort((a, b) => {
        const isAGlobal = a.includes('Tüm') || a.includes('Global') || a.includes('Diğer');
        const isBGlobal = b.includes('Tüm') || b.includes('Global') || b.includes('Diğer');
        if (isAGlobal && !isBGlobal) return 1;
        if (!isAGlobal && isBGlobal) return -1;
        return a.localeCompare(b, 'tr');
    });

    // Her grubu kendi içinde ada göre alfabetik sırala
    sortedGroupKeys.forEach(groupName => {
        groupedUsers[groupName].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
    });

    let rowsHtml = '';
    sortedGroupKeys.forEach(groupName => {
        let lineLogosHtml = '';
        if (groupName.includes('Tüm Hatlar') || groupName.includes('Global')) {
            lineLogosHtml = `<div class="line-logo" style="background:#475569; color:white; font-size:0.6rem; font-weight:800; border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.1); margin-right: 8px;" title="Tüm Hatlar"><i class="fas fa-globe" style="font-size:0.65rem;"></i></div>`;
        } else {
            const groupLines = groupName.split(',').map(l => l.trim()).filter(Boolean);
            lineLogosHtml = groupLines.map((line, idx) => {
                const color = (appData.lineColors && appData.lineColors[line]) || '#2563eb';
                return `
                    <div class="line-logo" style="background:${color}; color:white; font-size:0.62rem; font-weight:800; border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.1); margin-left:${idx > 0 ? '-6px' : '0px'}; margin-right:${idx === groupLines.length - 1 ? '8px' : '0px'}; border:1px solid var(--bg-card); z-index:${5 - idx};" title="${line}">${line}</div>
                `;
            }).join('');
        }

        // Grup Başlığı Satırı
        rowsHtml += `
            <tr class="matrix-group-header-row">
                <td colspan="${daysInMonth + 2}" style="background: rgba(37, 99, 235, 0.08) !important; color: var(--text-primary); font-weight: 800; font-size: 0.8rem; text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border-main); position: sticky; left: 0;">
                    <div style="display:inline-flex; align-items:center; vertical-align:middle;">
                        ${lineLogosHtml}
                        <span style="font-weight: 800; font-size: 0.8rem; color: var(--text-primary);">${escapeHtml(groupName)}</span>
                    </div>
                </td>
            </tr>
        `;

        groupedUsers[groupName].forEach(user => {
            const roster = fieldRosterCache[user.id] || {};
            const daysObj = roster.days || {};

            let userTotalMinutes = 0;
            let dayCellsHtml = '';

            for (let d = 1; d <= daysInMonth; d++) {
                const dayRoster = daysObj[d] || '';
                const shiftStr = (typeof dayRoster === 'object' ? (dayRoster.shift || '') : dayRoster).toString();
                const isOff = ['İ', 'Yİ', 'R', 'OFF'].includes(shiftStr.toUpperCase());
                
                const meetingDuration = (typeof dayRoster === 'object' && dayRoster.meetingDuration) ? dayRoster.meetingDuration : 0;
                const meetingStart = (typeof dayRoster === 'object' && dayRoster.meetingStart) ? dayRoster.meetingStart : '';
                const meetingEnd = (typeof dayRoster === 'object' && dayRoster.meetingEnd) ? dayRoster.meetingEnd : '';
                const meetingType = (typeof dayRoster === 'object' && dayRoster.meetingType) ? dayRoster.meetingType : '';
                const meetingDescription = (typeof dayRoster === 'object' && dayRoster.meetingDescription) ? dayRoster.meetingDescription : '';
                
                let meetingLabel = 'Toplantı/Eğitim';
                if (meetingType === 'meeting') meetingLabel = 'Toplantı';
                else if (meetingType === 'training') meetingLabel = 'Eğitim';
                else if (meetingType === 'other') meetingLabel = `Diğer (${meetingDescription})`;

                const session = fieldSessionsCache.find(s => {
                    let sDate = s.startTime || s.date;
                    if (sDate && !(sDate instanceof Date)) sDate = new Date(sDate);
                    return s.userId === user.id && sDate && sDate.getDate() === d && sDate.getFullYear() === activeYear && (sDate.getMonth() + 1) === activeMonth;
                });

                if (session) {
                    const duration = session.totalDuration || 0;
                    userTotalMinutes += duration;
                    
                    const meetingBadge = meetingDuration > 0 
                        ? `<div style="position:absolute; top:-2px; right:-2px; width:12px; height:12px; background:#8b5cf6; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:6px; color:white; z-index:3; border:1px solid var(--bg-card);" title="${escapeAttr(meetingLabel)}: ${meetingStart} - ${meetingEnd} (${formatFieldDuration(meetingDuration)})"><i class="fas fa-chalkboard-teacher" style="font-size:6px;"></i></div>` 
                        : '';

                    dayCellsHtml += `
                        <td class="matrix-cell-saha" style="position:relative; background-color: rgba(249, 115, 22, 0.08) !important; color: var(--text-primary) !important; font-weight:600;" onclick="openFieldSessionDetail('${escapeAttr(session.id)}')" title="${formatFieldDuration(duration)}${meetingDuration > 0 ? ' | ' + meetingLabel + ': ' + formatFieldDuration(meetingDuration) + ' (' + meetingStart + '-' + meetingEnd + ')' : ''}">
                            ${meetingBadge}
                            ${formatFieldDuration(duration)}
                        </td>
                    `;
                } else if (isOff) {
                    dayCellsHtml += `<td class="matrix-cell-saha field-duration-off" title="İzin Günü">OFF</td>`;
                } else {
                    dayCellsHtml += `<td class="matrix-cell-saha field-duration-none">—</td>`;
                }
            }

            const totalFormatted = formatFieldDuration(userTotalMinutes);

            rowsHtml += `
                <tr>
                    <td class="matrix-user-cell" style="font-weight: 700; border-right: 2px solid var(--border-main); padding: 8px 10px; overflow: hidden;">
                        <div style="display:flex; align-items:center; gap:0.45rem;">
                            <div style="display:flex; flex-direction:column; min-width:0; overflow:hidden;">
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.78rem;">${escapeHtml(user.name)}</span>
                                <small style="color:var(--text-dim); font-weight:normal; font-size:0.65rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeAttr(user.title || user.jobTitle || 'Saha')}">${escapeHtml(user.title || user.jobTitle || 'Saha')}</small>
                            </div>
                        </div>
                    </td>
                    ${dayCellsHtml}
                    <td style="font-weight: 800; text-align: center; color: var(--accent); background: rgba(37, 99, 235, 0.05);">${totalFormatted}</td>
                </tr>
            `;
        });
    });

    const monthNamesTr = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    const selectedMonthName = monthNamesTr[activeMonth - 1] || 'Saha';

    container.innerHTML = `
        <div class="card shadow-sm border-0" style="background:var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px; margin-top: 0px; margin-bottom: 0.75rem;">
            <div class="card-header border-0 d-flex justify-content-between align-items-center p-3 flex-wrap gap-3" style="background:none;">
                <h4 class="card-title mb-0" style="font-size:1.1rem; font-weight:700;">
                    <i class="fas fa-calendar-alt mr-2" style="color:var(--accent);"></i> 
                    ${selectedMonthName} ${activeYear} Saha Süre Takip Matrisi
                </h4>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive" style="max-height: 600px; overflow-y: auto;">
                    <table class="table table-bordered mb-0" style="border-collapse: collapse; min-width: 1500px;">
                        <thead>
                            <tr style="background:var(--bg-card-sub); border-bottom:2px solid var(--border-main);">
                                <th class="matrix-user-hdr" style="border-right: 2px solid var(--border-main); padding: 8px 10px; font-weight:700; text-align:left;">Personel</th>
                                ${dayHeadersHtml}
                                <th style="width: 100px; font-weight: 800; text-align: center;">Toplam</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * Ünvanın mobil iznini döndürür
 */
function getTitleMobilePermission(title, permissionKey) {
    if (!title) return false;
    const permissions = appData.mobilePermissions || {};
    const titleObj = permissions.titles?.[title.trim()];
    if (titleObj) {
        return titleObj[permissionKey] === true;
    }
    return false;
}

function renderFieldGeneralStats(container) {
    const sessions = fieldSessionsCache;
    
    let totalMinutes = 0;
    let totalTravelMinutes = 0;
    let visitedStationsSet = new Set();
    let userTotals = {}; // user_id -> minutes
    let dailyTotals = {}; // 1-31 -> minutes
    let dailyCounts = {}; // 1-31 -> count
    let stationDurations = {}; // stationName -> minutes

    sessions.forEach(s => {
        totalMinutes += s.totalDuration || 0;
        userTotals[s.userName] = (userTotals[s.userName] || 0) + (s.totalDuration || 0);
        const d = s.date.getDate();
        dailyTotals[d] = (dailyTotals[d] || 0) + (s.totalDuration || 0);
        dailyCounts[d] = (dailyCounts[d] || 0) + 1;

        if (Array.isArray(s.visits)) {
            s.visits.forEach(v => {
                visitedStationsSet.add(v.stationName);
                stationDurations[v.stationName] = (stationDurations[v.stationName] || 0) + (v.duration || 0);
            });
        }

        if (Array.isArray(s.travels)) {
            s.travels.forEach(t => {
                totalTravelMinutes += t.duration || 0;
            });
        }
    });

    const totalMissions = fieldSessionsCache.length;
    const uniqueDays = new Set(fieldSessionsCache.map(s => {
        let d = s.startTime || s.date;
        if (d && !(d instanceof Date)) d = new Date(d);
        return d ? getLocalDateString(d) : '';
    }).filter(Boolean)).size;
    const activeUsersCount = new Set(fieldSessionsCache.map(s => s.userId)).size;

    const avgMissionDuration = totalMissions > 0 ? Math.round(totalMinutes / totalMissions) : 0;
    const avgDailyMinutes = uniqueDays > 0 ? Math.round(totalMinutes / uniqueDays) : 0;

    let totalVisitsCount = 0;
    const allUniqueStations = new Set();
    fieldSessionsCache.forEach(s => {
        if (Array.isArray(s.visits)) {
            totalVisitsCount += s.visits.length;
            s.visits.forEach(v => {
                if (v.stationName) allUniqueStations.add(v.stationName);
            });
        }
    });

    let topStation = '—';
    let topStationMinutes = 0;
    Object.keys(stationDurations).forEach(st => {
        if (stationDurations[st] > topStationMinutes) {
            topStation = st;
            topStationMinutes = stationDurations[st];
        }
    });

    // Time Distribution Calculations
    const lineSelect = document.getElementById('field-filter-line');
    const userSelect = document.getElementById('field-filter-user');
    const selectedLines = lineSelect ? getMultiSelectValues(lineSelect) : [];
    const selectedUsers = userSelect ? getMultiSelectValues(userSelect) : [];
    
    let activeUsers = (appData.users || []).filter(u => {
        const title = (u.title || u.jobTitle || '').toLowerCase();
        return title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
    });
    
    if (selectedUsers.length > 0) {
        activeUsers = activeUsers.filter(u => selectedUsers.includes(u.id));
    }
    if (selectedLines.length > 0) {
        activeUsers = activeUsers.filter(u => {
            const hasSessionOnLine = sessions.some(s => s.userId === u.id);
            const hasLineAccess = Array.isArray(u.authorizedLines) && u.authorizedLines.some(l => selectedLines.includes(l));
            return hasSessionOnLine || hasLineAccess;
        });
    }

    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
    
    const weeklyData = {};
    const userData = {};
    const titleData = {};
    const lineData = {};
    
    for (let d = 1; d <= daysInMonth; d++) {
        const weekName = getMonthWeekName(d);
        if (!weeklyData[weekName]) {
            weeklyData[weekName] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
    }
    
    let totalSahaHours = 0;
    let totalMeetingHours = 0;
    let totalOfficeHours = 0;
    let totalWorkDays = 0;

    activeUsers.forEach(user => {
        const rosterUser = fieldRosterCache[user.id] || {};
        const days = rosterUser.days || {};
        
        const title = user.title || user.jobTitle || 'Saha Amiri';
        if (!titleData[title]) {
            titleData[title] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
        
        const primaryLine = (Array.isArray(user.authorizedLines) && user.authorizedLines.length > 0) 
            ? user.authorizedLines[0] 
            : 'Tümü';
            
        if (!lineData[primaryLine]) {
            lineData[primaryLine] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
        
        if (!userData[user.name]) {
            userData[user.name] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
        
        for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = String(day);
            const dayData = days[dayKey];
            
            const daySessions = sessions.filter(s => {
                const sDate = s.startTime ? (s.startTime instanceof Date ? s.startTime : new Date(s.startTime)) : (s.date instanceof Date ? s.date : new Date(s.date));
                return s.userId === user.id && sDate && sDate.getDate() === day;
            });
            
            let sahaMinutes = 0;
            daySessions.forEach(s => {
                sahaMinutes += (s.totalDuration || 0);
            });
            
            let meetingMinutes = 0;
            let shiftCode = '';
            if (dayData) {
                meetingMinutes = dayData.hasMeeting ? (dayData.meetingDuration || 120) : 0;
                shiftCode = dayData.shift || '';
            }
            
            const shiftCodeLower = (shiftCode || '').toLowerCase();
            const isOffShift = ['i', 'yi', 'r', 'izin', 'rapor', 'tatil'].includes(shiftCodeLower) || shiftCodeLower.includes('izin');
            const worked = sahaMinutes > 0 || meetingMinutes > 0;
            const isWorkDay = worked || (shiftCode && !isOffShift);
            
            if (isWorkDay) {
                const shiftDuration = 480;
                let officeMinutes = Math.max(0, shiftDuration - sahaMinutes - meetingMinutes);
                
                const sahaHours = sahaMinutes / 60;
                const meetingHours = meetingMinutes / 60;
                const officeHours = officeMinutes / 60;
                
                const weekName = getMonthWeekName(day);
                
                weeklyData[weekName].saha += sahaHours;
                weeklyData[weekName].meeting += meetingHours;
                weeklyData[weekName].office += officeHours;
                weeklyData[weekName].workDays += 1;
                
                userData[user.name].saha += sahaHours;
                userData[user.name].meeting += meetingHours;
                userData[user.name].office += officeHours;
                userData[user.name].workDays += 1;
                
                titleData[title].saha += sahaHours;
                titleData[title].meeting += meetingHours;
                titleData[title].office += officeHours;
                titleData[title].workDays += 1;
                
                lineData[primaryLine].saha += sahaHours;
                lineData[primaryLine].meeting += meetingHours;
                lineData[primaryLine].office += officeHours;
                lineData[primaryLine].workDays += 1;

                totalSahaHours += sahaHours;
                totalMeetingHours += meetingHours;
                totalOfficeHours += officeHours;
                totalWorkDays += 1;
            }
        }
    });

    const totalHours = totalSahaHours + totalMeetingHours + totalOfficeHours;
    const totalShiftDays = totalWorkDays;

    Object.keys(titleData).forEach(k => { if (titleData[k].workDays === 0) delete titleData[k]; });
    Object.keys(lineData).forEach(k => { if (lineData[k].workDays === 0) delete lineData[k]; });
    Object.keys(userData).forEach(k => { if (userData[k].workDays === 0) delete userData[k]; });

    // İstasyon Bazlı Kalma ve Ziyaret Yoğunluğu Hesaplamaları
    let stationStats = {};
    sessions.forEach(s => {
        if (Array.isArray(s.visits)) {
            s.visits.forEach(v => {
                if (!v.stationName) return;
                if (!stationStats[v.stationName]) {
                    stationStats[v.stationName] = {
                        totalMinutes: 0,
                        visitsCount: 0,
                        uniqueUsers: new Set()
                    };
                }
                stationStats[v.stationName].totalMinutes += (v.duration || 0);
                stationStats[v.stationName].visitsCount++;
                stationStats[v.stationName].uniqueUsers.add(s.userId);
            });
        }
    });

    const sortedStations = Object.keys(stationStats).map(name => ({
        name: name,
        totalMinutes: stationStats[name].totalMinutes,
        visitsCount: stationStats[name].visitsCount,
        usersCount: stationStats[name].uniqueUsers.size
    })).sort((a, b) => b.totalMinutes - a.totalMinutes);

    let stationRowsHtml = '';
    if (sortedStations.length === 0) {
        stationRowsHtml = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">Bu dönemde istasyon ziyareti bulunmuyor.</td></tr>`;
    } else {
        sortedStations.forEach((st, idx) => {
            const avgStay = st.visitsCount > 0 ? Math.round(st.totalMinutes / st.visitsCount) : 0;
            stationRowsHtml += `
                <tr>
                    <td style="font-weight:700; text-align:center; width:50px;">${idx + 1}</td>
                    <td style="font-weight:700; color:var(--text-primary);"><i class="fas fa-map-marker-alt mr-2" style="color:var(--accent);"></i> ${escapeHtml(st.name)}</td>
                    <td style="text-align:center; font-weight:700; color:#8b5cf6;">${st.visitsCount} Giriş</td>
                    <td style="text-align:center; font-weight:700; color:#3b82f6;">${formatFieldDuration(st.totalMinutes)}</td>
                    <td style="text-align:center; font-weight:600;">Ort. ${avgStay} dk</td>
                    <td style="text-align:center; font-weight:600; color:#10b981;">${st.usersCount} Personel</td>
                </tr>
            `;
        });
    }

    container.innerHTML = `
        <div class="field-chart-grid">
            <!-- Haftalık Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card">
                <h4><i class="fas fa-chart-bar mr-2" style="color:#8b5cf6;"></i>Haftalık Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-time-weekly"></canvas>
                </div>
            </div>

            <!-- Ünvan Bazlı Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card">
                <h4><i class="fas fa-users-gear mr-2" style="color:#3b82f6;"></i>Ünvan Bazlı Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-time-title"></canvas>
                </div>
            </div>

            <!-- Hat Bazlı Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card">
                <h4><i class="fas fa-route mr-2" style="color:#10b981;"></i>Hat Bazlı Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-time-line"></canvas>
                </div>
            </div>

            <!-- Kişi Bazlı Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card">
                <h4><i class="fas fa-user-clock mr-2" style="color:#f59e0b;"></i>Kişi Bazlı Günlük Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-time-user"></canvas>
                </div>
            </div>

            <!-- Kişi Bazlı Toplam Saha Süreleri -->
            <div class="field-chart-card">
                <h4><i class="fas fa-chart-bar mr-2" style="color:rgb(37,99,235);"></i>Kişi Bazlı Toplam Saha Süreleri</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-field-user-duration"></canvas>
                </div>
            </div>

            <div class="field-chart-card">
                <h4><i class="fas fa-chart-line mr-2" style="color:#f59e0b;"></i>Günlük Ortalama Saha Süresi Dağılımı</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-field-daily-trend"></canvas>
                </div>
            </div>

            <div class="field-chart-card full-width">
                <h4><i class="fas fa-train mr-2" style="color:#a855f7;"></i>En Çok Vakit Geçirilen İstasyonlar</h4>
                <div style="position:relative; height:320px; width:100%;">
                    <canvas id="chart-field-station-pie"></canvas>
                </div>
            </div>
        </div>

        <!-- İstasyon Bazlı Kalma ve Ziyaret Yoğunluğu Tablosu -->
        <div class="card shadow-sm border-0" style="background:var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px; margin-top: 1rem; margin-bottom: 1.5rem;">
            <div class="card-header border-0 p-3" style="background:none;">
                <h4 class="card-title mb-0" style="font-size:1.1rem; font-weight:700;"><i class="fas fa-train mr-2" style="color:var(--accent);"></i> İstasyon Bazlı Kalma ve Ziyaret Yoğunluğu</h4>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table mb-0">
                        <thead>
                            <tr style="background:var(--bg-card-sub); border-bottom:1px solid var(--border-main); font-size:0.75rem;">
                                <th style="padding:12px 16px; text-align:center; width:50px;">#</th>
                                <th style="text-align:left;">İstasyon Adı</th>
                                <th style="text-align:center;">Ziyaret Sayısı</th>
                                <th style="text-align:center;">Toplam Geçirilen Süre</th>
                                <th style="text-align:center;">Ziyaret Başına Ort. Kalma</th>
                                <th style="text-align:center;">Bulunan Kişi Sayısı</th>
                            </tr>
                        </thead>
                        <tbody style="font-size:0.8rem;">
                            ${stationRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    setTimeout(() => {
        buildGeneralCharts(userTotals, dailyTotals, dailyCounts, stationDurations);
        buildTimeDistributionCharts(weeklyData, userData, titleData, lineData);
    }, 50);
}

/**
 * Chart.js kütüphanesi kullanarak istatistik grafiklerini çizer
 */
function buildGeneralCharts(userTotals, dailyTotals, dailyCounts, stationDurations) {
    const isDark = !document.body.classList.contains('light-mode');
    const labelColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(71, 85, 105, 0.08)';

    // 1. Kişi Bazlı Grafik (Yatay Bar)
    const userLabels = Object.keys(userTotals);
    const userData = userLabels.map(u => Math.round((userTotals[u] / 60) * 10) / 10); // Saate çevir

    const ctxUser = document.getElementById('chart-field-user-duration');
    if (ctxUser) {
        const uChart = new Chart(ctxUser, {
            type: 'bar',
            data: {
                labels: userLabels,
                datasets: [{
                    label: 'Saha Süresi (Saat)',
                    data: userData,
                    backgroundColor: 'rgba(37, 99, 235, 0.75)',
                    borderColor: 'rgb(37, 99, 235)',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        color: isDark ? '#fff' : '#000',
                        anchor: 'end',
                        align: 'left',
                        formatter: (val) => val > 0 ? `${val}s` : ''
                    }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: labelColor }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: labelColor }
                    }
                }
            }
        });
        fieldTrackingCharts.push(uChart);
    }

    // 2. Günlük Trend Grafik (Çizgi Grafik)
    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
    const trendLabels = [];
    const trendData = [];

    for (let d = 1; d <= daysInMonth; d++) {
        trendLabels.push(d);
        const dailyTotal = dailyTotals[d] || 0;
        const dailyCount = dailyCounts[d] || 0;
        const avgHours = dailyCount > 0 ? Math.round((dailyTotal / dailyCount / 60) * 10) / 10 : 0;
        trendData.push(avgHours);
    }

    const ctxTrend = document.getElementById('chart-field-daily-trend');
    if (ctxTrend) {
        const tChart = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: trendLabels,
                datasets: [{
                    label: 'Ort. Saha Süresi (Saat)',
                    data: trendData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#f59e0b'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: labelColor }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: { color: labelColor }
                    }
                }
            }
        });
        fieldTrackingCharts.push(tChart);
    }

    // 3. İstasyon Grafiği (Dikey Bar)
    const stationLabels = Object.keys(stationDurations);
    // En yüksek süreye göre sırala ve ilk 12 istasyonu al
    const sortedStations = stationLabels.map(st => ({
        name: st,
        hours: Math.round((stationDurations[st] / 60) * 10) / 10
    })).sort((a, b) => b.hours - a.hours).slice(0, 15);

    const ctxPie = document.getElementById('chart-field-station-pie');
    if (ctxPie) {
        const sChart = new Chart(ctxPie, {
            type: 'bar',
            data: {
                labels: sortedStations.map(s => s.name),
                datasets: [{
                    label: 'Toplam Süre (Saat)',
                    data: sortedStations.map(s => s.hours),
                    backgroundColor: 'rgba(168, 85, 247, 0.75)',
                    borderColor: 'rgb(168, 85, 247)',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        formatter: (val) => val > 0 ? `${val}s` : '',
                        color: labelColor
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: labelColor, maxRotation: 45, minRotation: 45 }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: { color: labelColor }
                    }
                }
            }
        });
        fieldTrackingCharts.push(sChart);
    }
}

/**
 * -----------------------------------------------------------------------------
 * SEKME 3: İSTASYON ANALİZİ GÖRÜNÜMÜ
 * -----------------------------------------------------------------------------
 */
function renderFieldStationAnalysis(container) {
    let stationStats = {}; // stationName -> { visitsCount, totalMinutes, visitors: {} }

    fieldSessionsCache.forEach(s => {
        if (Array.isArray(s.visits)) {
            s.visits.forEach(v => {
                const st = v.stationName;
                if (!stationStats[st]) {
                    stationStats[st] = {
                        name: st,
                        visitsCount: 0,
                        totalMinutes: 0,
                        visitors: {}
                    };
                }
                stationStats[st].visitsCount++;
                stationStats[st].totalMinutes += v.duration || 0;
                stationStats[st].visitors[s.userName] = (stationStats[st].visitors[s.userName] || 0) + (v.duration || 0);
            });
        }
    });

    const sortedStats = Object.values(stationStats).sort((a, b) => b.totalMinutes - a.totalMinutes);

    let rowsHtml = '';
    if (sortedStats.length === 0) {
        rowsHtml = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-dim);">Ziyaret edilmiş herhangi bir istasyon bulunmuyor.</td></tr>`;
    } else {
        sortedStats.forEach((stat, index) => {
            // En aktif ziyaretçiyi bul
            let topVisitor = '—';
            let topVisitorMinutes = 0;
            Object.keys(stat.visitors).forEach(vis => {
                if (stat.visitors[vis] > topVisitorMinutes) {
                    topVisitor = vis;
                    topVisitorMinutes = stat.visitors[vis];
                }
            });

            const avgVisitMinutes = Math.round(stat.totalMinutes / stat.visitsCount);

            rowsHtml += `
                <tr>
                    <td style="font-weight:700; padding:12px 16px;">
                        <span style="display:inline-block; width:22px; height:22px; border-radius:50%; background:var(--accent-dim); color:var(--accent); text-align:center; line-height:22px; font-size:0.75rem; margin-right:8px;">${index + 1}</span>
                        ${escapeHtml(stat.name)}
                    </td>
                    <td style="text-align:center;">${stat.visitsCount} Kez Ziyaret</td>
                    <td style="text-align:center; font-weight:600; color:var(--accent);">${formatFieldDuration(stat.totalMinutes)}</td>
                    <td style="text-align:center;">${formatFieldDuration(avgVisitMinutes)}</td>
                    <td>
                        <div style="display:flex; flex-direction:column; max-width: 180px; overflow: hidden;">
                            <span style="font-weight:600; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(topVisitor)}</span>
                            <small style="color:var(--text-dim); font-size:0.7rem;">Toplam: ${formatFieldDuration(topVisitorMinutes)}</small>
                        </div>
                    </td>
                </tr>
            `;
        });
    }

    container.innerHTML = `
        <div class="card shadow-sm border-0" style="background:var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px; margin-top: 1rem; margin-bottom: 1.5rem;">
            <div class="card-header border-0 p-3" style="background:none;">
                <h4 class="card-title mb-0" style="font-size:1.1rem; font-weight:700;"><i class="fas fa-train mr-2" style="color:var(--accent);"></i> İstasyon Bazlı Kalma ve Ziyaret Yoğunluğu</h4>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table mb-0">
                        <thead>
                            <tr style="background:var(--bg-card-sub); border-bottom:1px solid var(--border-main);">
                                <th style="padding:12px 16px; text-align:left;">İstasyon Adı</th>
                                <th style="text-align:center;">Ziyaret Sayısı</th>
                                <th style="text-align:center;">Toplam Geçirilen Süre</th>
                                <th style="text-align:center;">Ziyaret Başına Ort. Kalma</th>
                                <th style="text-align:left;">En Çok Vakit Geçiren Personel</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * -----------------------------------------------------------------------------
 * SEKME 4: BİREYSEL PERFORMANS GÖRÜNÜMÜ
 * -----------------------------------------------------------------------------
 */
let fieldTrackingSelectedUserForPerf = '';

function renderFieldIndividualPerf(container) {
    // Tüm personeli listele
    const users = (appData.users || []).filter(u => {
        const title = (u.title || u.jobTitle || '').toLowerCase();
        const isValidRole = title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
        if (!isValidRole) return false;

        const hasSession = fieldSessionsCache.some(s => s.userId === u.id);
        const hasTrackingPerm = getTitleMobilePermission(u.title || u.jobTitle, 'sahaTakip');
        return hasSession || hasTrackingPerm;
    });

    if (users.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:3rem; color:var(--text-dim);">Gösterilecek personel bulunmuyor.</p>`;
        return;
    }

    // Eğer henüz bir kullanıcı seçilmediyse ilkini seç
    if (!fieldTrackingSelectedUserForPerf || !users.some(u => u.id === fieldTrackingSelectedUserForPerf)) {
        fieldTrackingSelectedUserForPerf = users[0].id;
    }

    const userOptions = users.map(u => 
        `<option value="${u.id}" ${u.id === fieldTrackingSelectedUserForPerf ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.title || u.jobTitle || 'Saha')})</option>`
    ).join('');

    // Seçilen kullanıcının verilerini filtrele
    const userSessions = fieldSessionsCache.filter(s => s.userId === fieldTrackingSelectedUserForPerf);
    const selectedUserObj = users.find(u => u.id === fieldTrackingSelectedUserForPerf);
    
    // Değerleri hesapla
    const totalMissions = userSessions.length;
    const uniqueDays = new Set(userSessions.map(s => {
        let d = s.startTime || s.date;
        if (d && !(d instanceof Date)) d = new Date(d);
        return d ? getLocalDateString(d) : '';
    }).filter(Boolean)).size;

    let totalMinutes = 0;
    let totalVisitsCount = 0;
    let autoClosedVisitsCount = 0;
    let startTimesSum = 0;
    let endTimesSum = 0;
    let validEndCount = 0;
    let userStationDurations = {}; // stationName -> { minutes, count }

    userSessions.forEach(s => {
        totalMinutes += (s.totalDuration || 0);
        
        let st = s.startTime ? (s.startTime instanceof Date ? s.startTime : new Date(s.startTime)) : null;
        let et = s.endTime ? (s.endTime instanceof Date ? s.endTime : new Date(s.endTime)) : null;

        if (st && !isNaN(st.getTime())) {
            startTimesSum += st.getHours() * 60 + st.getMinutes();
        }
        if (et && !isNaN(et.getTime())) {
            endTimesSum += et.getHours() * 60 + et.getMinutes();
            validEndCount++;
        }

        if (Array.isArray(s.visits)) {
            totalVisitsCount += s.visits.length;
            s.visits.forEach(v => {
                if (v.autoClosed || v.flagged) autoClosedVisitsCount++;
                const stName = v.stationName || 'Bilinmiyor';
                if (!userStationDurations[stName]) {
                    userStationDurations[stName] = { minutes: 0, count: 0 };
                }
                userStationDurations[stName].minutes += (v.duration || 0);
                userStationDurations[stName].count += 1;
            });
        }
    });

    const avgMissionDuration = totalMissions > 0 ? Math.round(totalMinutes / totalMissions) : 0;
    const avgDailyDuration = uniqueDays > 0 ? Math.round(totalMinutes / uniqueDays) : 0;
    
    const avgStartMinutes = totalMissions > 0 ? Math.round(startTimesSum / totalMissions) : 0;
    const avgEndMinutes = validEndCount > 0 ? Math.round(endTimesSum / validEndCount) : 0;

    const formatTimeOfDay = (totalMins) => {
        if (!totalMins) return '—';
        const h = Math.floor(totalMins / 60);
        const m = Math.round(totalMins % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const userAudits = (appData.audits || []).filter(a => {
        const isMatchUser = a.auditorId === fieldTrackingSelectedUserForPerf || 
            (a.auditorName && selectedUserObj && a.auditorName.trim().toLowerCase() === selectedUserObj.name.trim().toLowerCase());
        if (!isMatchUser) return false;
        let aDate = a.date ? new Date(a.date) : null;
        if (!aDate || isNaN(aDate.getTime())) return false;
        return aDate.getFullYear() === activeYear && (aDate.getMonth() + 1) === activeMonth;
    });

    const totalAuditsCount = userAudits.length;
    const uniqueStationsCount = Object.keys(userStationDurations).length;
    const avgStationStay = totalVisitsCount > 0 ? Math.round(Object.values(userStationDurations).reduce((sum, v) => sum + v.minutes, 0) / totalVisitsCount) : 0;

    const sortedUserStations = Object.keys(userStationDurations).map(st => ({
        name: st,
        minutes: userStationDurations[st].minutes,
        count: userStationDurations[st].count
    })).sort((a, b) => b.minutes - a.minutes).slice(0, 5);

    let stationsListHtml = '';
    if (sortedUserStations.length === 0) {
        stationsListHtml = `<li style="padding:16px; text-align:center; color:var(--text-dim);">Bu dönemde kayıtlı istasyon ziyareti bulunmuyor.</li>`;
    } else {
        sortedUserStations.forEach((st, idx) => {
            const avgStay = st.count > 0 ? Math.round(st.minutes / st.count) : 0;
            stationsListHtml += `
                <li style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:${idx < 4 ? '1px solid var(--border-main)' : 'none'};">
                    <div>
                        <div style="font-weight:700; font-size:0.85rem; color:var(--text-primary);">
                            <i class="fas fa-map-marker-alt mr-2" style="color:var(--accent);"></i> ${escapeHtml(st.name)}
                        </div>
                        <small style="color:var(--text-dim); font-size:0.72rem;">${st.count} Ziyaret | Ort. ${avgStay} dk</small>
                    </div>
                    <span class="badge" style="background:rgba(249, 115, 22, 0.15); color:var(--accent); font-weight:800; padding:6px 10px; border-radius:8px; font-size:0.78rem;">
                        ${formatFieldDuration(st.minutes)}
                    </span>
                </li>
            `;
        });
    }

    let sessionRowsHtml = '';
    const sortedSessions = [...userSessions].sort((a, b) => {
        let da = a.startTime ? (a.startTime instanceof Date ? a.startTime : new Date(a.startTime)) : (a.date instanceof Date ? a.date : new Date(a.date));
        let db = b.startTime ? (b.startTime instanceof Date ? b.startTime : new Date(b.startTime)) : (b.date instanceof Date ? b.date : new Date(b.date));
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    if (sortedSessions.length === 0) {
        sessionRowsHtml = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">Bu dönemde saha seansı kaydı bulunmuyor.</td></tr>`;
    } else {
        sortedSessions.forEach((s, idx) => {
            let sDate = s.startTime ? (s.startTime instanceof Date ? s.startTime : new Date(s.startTime)) : (s.date instanceof Date ? s.date : new Date(s.date));
            const dateStr = sDate ? sDate.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
            
            let st = s.startTime ? (s.startTime instanceof Date ? s.startTime : new Date(s.startTime)) : null;
            let et = s.endTime ? (s.endTime instanceof Date ? s.endTime : new Date(s.endTime)) : null;
            const startStr = st ? `${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}` : '—';
            const endStr = et ? `${String(et.getHours()).padStart(2, '0')}:${String(et.getMinutes()).padStart(2, '0')}` : (s.status === 'active' ? '<span style="color:#10b981; font-weight:700;">Devam Ediyor</span>' : '—');

            let visitsBadges = '—';
            if (Array.isArray(s.visits) && s.visits.length > 0) {
                visitsBadges = s.visits.map(v => {
                    const isFlagged = v.autoClosed || v.flagged;
                    return `<span title="${isFlagged ? (v.autoCloseReason || 'Oto Kapatıldı') : 'Ziyaret Süresi'}" style="display:inline-flex; align-items:center; gap:4px; margin:2px; padding:3px 8px; border-radius:6px; background:${isFlagged ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.12)'}; color:${isFlagged ? '#ef4444' : '#3b82f6'}; font-size:0.72rem; font-weight:700; border:1px solid ${isFlagged ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.25)'};">
                        <i class="fas ${isFlagged ? 'fa-triangle-exclamation' : 'fa-train'}" style="font-size:0.65rem;"></i> ${escapeHtml(v.stationName || '')} (${v.duration || 0} dk)
                    </span>`;
                }).join(' ');
            }

            sessionRowsHtml += `
                <tr style="cursor:pointer;" onclick="openFieldSessionDetail('${escapeAttr(s.id)}')">
                    <td style="font-weight:700; text-align:center; width:45px;">${idx + 1}</td>
                    <td style="font-weight:700; color:var(--text-primary); white-space:nowrap;">${dateStr}</td>
                    <td style="text-align:center;"><span style="background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:6px; font-weight:700; font-size:0.75rem;">${escapeHtml(s.shiftCode || 'G1')}</span></td>
                    <td style="text-align:center; white-space:nowrap;">${startStr} - ${endStr}</td>
                    <td style="text-align:center; font-weight:800; color:var(--accent);">${formatFieldDuration(s.totalDuration || 0)}</td>
                    <td style="max-width:280px;">${visitsBadges}</td>
                    <td style="text-align:center; white-space:nowrap;">
                        <button onclick="event.stopPropagation(); openFieldSessionDetail('${escapeAttr(s.id)}')" class="btn-outline" style="padding:4px 10px; font-size:0.75rem; border-radius:6px; font-weight:700; color:var(--accent); border-color:rgba(249,115,22,0.4);">
                            <i class="fas fa-route mr-1"></i> Rapor
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    // Sıralama ve Kıyaslama hesaplamaları (Liderlik Tablosu)
    let userRankings = {};
    fieldSessionsCache.forEach(s => {
        if (!userRankings[s.userId]) {
            userRankings[s.userId] = {
                id: s.userId,
                name: s.userName,
                title: s.userTitle || 'Saha Personeli',
                totalDuration: 0,
                missionsCount: 0,
                daysSet: new Set(),
                totalVisits: 0
            };
        }
        userRankings[s.userId].totalDuration += (s.totalDuration || 0);
        userRankings[s.userId].missionsCount++;
        let d = s.startTime || s.date;
        if (d && !(d instanceof Date)) d = new Date(d);
        if (d) userRankings[s.userId].daysSet.add(getLocalDateString(d));
        if (Array.isArray(s.visits)) {
            userRankings[s.userId].totalVisits += s.visits.length;
        }
    });

    Object.values(userRankings).forEach(rank => {
        rank.daysCount = rank.daysSet.size;
    });

    const sortedRankings = Object.values(userRankings).sort((a, b) => b.totalDuration - a.totalDuration);

    let compareRowsHtml = '';
    if (sortedRankings.length === 0) {
        compareRowsHtml = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--text-dim);">Sıralama verisi bulunmuyor.</td></tr>`;
    } else {
        sortedRankings.forEach((rank, index) => {
            const isChecked = fieldTrackingCompareUsers.includes(rank.id);
            const avgDuration = rank.missionsCount > 0 ? Math.round(rank.totalDuration / rank.missionsCount) : 0;
            const isHighlighted = rank.id === fieldTrackingSelectedUserForPerf ? 'style="background: rgba(249, 115, 22, 0.05); border-left: 3px solid var(--accent);"' : '';

            compareRowsHtml += `
                <tr ${isHighlighted} style="cursor:pointer;" onclick="selectUserForDetail('${escapeAttr(rank.id)}')">
                    <td style="text-align:center; width:50px;" onclick="event.stopPropagation();">
                        <input type="checkbox" class="compare-checkbox" value="${rank.id}" ${isChecked ? 'checked' : ''} onchange="toggleCompareUser(this)" style="cursor:pointer; width:16px; height:16px;">
                    </td>
                    <td style="font-weight:700; text-align:center; width:60px;">
                        ${index + 1 === 1 ? '🏆' : index + 1 === 2 ? '🥈' : index + 1 === 3 ? '🥉' : index + 1}
                    </td>
                    <td>
                        <div style="display:flex; flex-direction:column; max-width: 180px; overflow: hidden;">
                            <span style="font-weight:700; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(rank.name)}</span>
                            <small style="color:var(--text-dim); font-size:0.7rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(rank.title)}">${escapeHtml(rank.title)}</small>
                        </div>
                    </td>
                    <td style="text-align:center; font-weight:700; color:var(--accent);">${rank.missionsCount} Sefer</td>
                    <td style="text-align:center; font-weight:600;">${rank.daysCount} Gün</td>
                    <td style="text-align:center; font-weight:700; color:#3b82f6;">${formatFieldDuration(rank.totalDuration)}</td>
                    <td style="text-align:center;">${formatFieldDuration(avgDuration)}</td>
                    <td style="text-align:center; font-weight:600; color:#8b5cf6;">${rank.totalVisits} Ziyaret</td>
                </tr>
            `;
        });
    }

    let compareGraphHtml = '';
    if (fieldTrackingCompareUsers.length > 0) {
        compareGraphHtml = `
            <div class="card shadow-sm border-0 p-3" style="background:var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px; margin-bottom:1.5rem;">
                <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:1rem; color:var(--text-primary);"><i class="fas fa-users mr-2" style="color:var(--accent);"></i> Seçilen Personellerin Saha Karşılaştırması</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-field-compare"></canvas>
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="card shadow-sm border-0" style="background:rgba(11, 34, 61, 0.3); border:1px solid var(--border-main) !important; border-radius:12px; margin-top: 0px; margin-bottom: 0.5rem;">
            <div class="card-body p-3 d-flex align-items-center gap-3 flex-wrap justify-content-between">
                <div class="d-flex align-items-center gap-3 flex-wrap">
                    <span style="font-weight:700; color:var(--text-primary);"><i class="fas fa-user-gear mr-2" style="color:var(--accent);"></i> İncelenen Personel:</span>
                    <select id="field-perf-user-select" class="cms-input" style="min-width:260px;" onchange="onFieldPerfUserChange()">
                        ${userOptions}
                    </select>
                </div>
                <div style="font-size:0.8rem; color:var(--text-dim);">
                    <i class="fas fa-info-circle mr-1" style="color:#3b82f6;"></i> Saha görevleri ve denetim kayıtları anlık olarak senkronize edilmiştir.
                </div>
            </div>
        </div>

        <div class="field-chart-grid">
            <!-- Favori İstasyonlar -->
            <div class="field-chart-card" style="height: fit-content;">
                <h4><i class="fas fa-map-marker-alt mr-2" style="color:var(--accent);"></i> En Çok Bulunduğu İstasyonlar (İlk 5)</h4>
                <ul style="list-style:none; padding:0; margin:0;">
                    ${stationsListHtml}
                </ul>
            </div>

            <!-- Günlük Trend (Seçilen Personel) -->
            <div class="field-chart-card">
                <h4><i class="fas fa-chart-area mr-2" style="color:#f59e0b;"></i> Günlük Saha Görevi & Süre Dağılımı</h4>
                <div style="position:relative; height:280px; width:100%;">
                    <canvas id="chart-field-indiv-trend"></canvas>
                </div>
            </div>
        </div>

        <!-- Seans Geçmişi ve Saha Günlüğü Tablosu -->
        <div class="card shadow-sm border-0" style="background:var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px; margin-top: 0.75rem; margin-bottom: 0.75rem;">
            <div class="card-header border-0 d-flex justify-content-between align-items-center p-3" style="background:none;">
                <h4 class="card-title mb-0" style="font-size:1rem; font-weight:700;"><i class="fas fa-history mr-2" style="color:var(--accent);"></i> Saha Görev ve Seans Günlüğü</h4>
                <span style="font-size:0.75rem; color:var(--text-dim); background:rgba(255,255,255,0.05); padding:4px 10px; border-radius:6px;">Toplam ${totalMissions} Sefer Kaydı</span>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table mb-0">
                        <thead>
                            <tr style="background:var(--bg-card-sub); border-bottom:1px solid var(--border-main); font-size:0.75rem;">
                                <th style="text-align:center; width:45px;">#</th>
                                <th style="text-align:left;">Tarih</th>
                                <th style="text-align:center;">Vardiya</th>
                                <th style="text-align:center;">Çıkış - Dönüş</th>
                                <th style="text-align:center;">Saha Süresi</th>
                                <th style="text-align:left;">Ziyaret Edilen İstasyonlar</th>
                                <th style="text-align:center; width:90px;">İşlem</th>
                            </tr>
                        </thead>
                        <tbody style="font-size:0.8rem;">
                            ${sessionRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

    `;

    setTimeout(() => {
        buildIndividualTrendChart(userSessions);
    }, 50);
}

function selectUserForDetail(userId) {
    fieldTrackingSelectedUserForPerf = userId;
    renderActiveTabContent();
    const el = document.getElementById('field-perf-user-select');
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function onFieldPerfUserChange() {
    const select = document.getElementById('field-perf-user-select');
    if (select) {
        fieldTrackingSelectedUserForPerf = select.value;
        renderActiveTabContent();
    }
}

function buildIndividualTrendChart(sessions) {
    const isDark = !document.body.classList.contains('light-mode');
    const labelColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(71, 85, 105, 0.08)';

    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
    const labels = [];
    const durationData = [];
    const missionCountData = [];

    for (let d = 1; d <= daysInMonth; d++) {
        labels.push(d);
        const daySessions = sessions.filter(s => {
            let dt = s.startTime || s.date;
            if (dt && !(dt instanceof Date)) dt = new Date(dt);
            return dt && dt.getDate() === d;
        });

        if (daySessions.length > 0) {
            const totalDayMins = daySessions.reduce((sum, s) => sum + (s.totalDuration || 0), 0);
            durationData.push(Math.round((totalDayMins / 60) * 10) / 10);
            missionCountData.push(daySessions.length);
        } else {
            durationData.push(0);
            missionCountData.push(0);
        }
    }

    const ctx = document.getElementById('chart-field-indiv-trend');
    if (ctx) {
        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Saha Süresi (Saat)',
                        data: durationData,
                        backgroundColor: 'rgba(249, 115, 22, 0.75)',
                        borderColor: '#ea580c',
                        borderRadius: 4,
                        order: 2
                    },
                    {
                        type: 'line',
                        label: 'Sefer Sayısı',
                        data: missionCountData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2,
                        pointRadius: 3,
                        tension: 0.2,
                        yAxisID: 'yCount',
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: labelColor, boxWidth: 12, font: { size: 10 } }
                    },
                    datalabels: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: labelColor }
                    },
                    y: {
                        position: 'left',
                        grid: { color: gridColor },
                        ticks: { color: labelColor },
                        title: { display: true, text: 'Saat', color: labelColor, font: { size: 10 } }
                    },
                    yCount: {
                        position: 'right',
                        grid: { display: false },
                        ticks: { color: '#3b82f6', stepSize: 1 },
                        title: { display: true, text: 'Sefer', color: '#3b82f6', font: { size: 10 } }
                    }
                }
            }
        });
        fieldTrackingCharts.push(chart);
    }
}

/**
 * -----------------------------------------------------------------------------
 * SEKME 5: SIRALAMA & KIYASLAMA GÖRÜNÜMÜ
 * -----------------------------------------------------------------------------
 */
let fieldTrackingCompareUsers = []; // Kıyaslama için seçili kullanıcılar (maks 3)

function renderFieldComparison(container) {
    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    // Tüm kullanıcılardan toplamları hesapla
    let userRankings = {}; // userId -> { id, name, title, totalDuration, missionsCount, daysSet, totalVisits, auditsCount }

    fieldSessionsCache.forEach(s => {
        if (!userRankings[s.userId]) {
            userRankings[s.userId] = {
                id: s.userId,
                name: s.userName,
                title: s.userTitle || 'Saha Personeli',
                totalDuration: 0,
                missionsCount: 0,
                daysSet: new Set(),
                totalVisits: 0
            };
        }
        userRankings[s.userId].totalDuration += (s.totalDuration || 0);
        userRankings[s.userId].missionsCount++;
        let d = s.startTime || s.date;
        if (d && !(d instanceof Date)) d = new Date(d);
        if (d) userRankings[s.userId].daysSet.add(getLocalDateString(d));
        if (Array.isArray(s.visits)) {
            userRankings[s.userId].totalVisits += s.visits.length;
        }
    });

    // Kullanıcı bazlı denetimleri hesapla
    Object.values(userRankings).forEach(rank => {
        const uAudits = (appData.audits || []).filter(a => {
            const isMatch = a.auditorId === rank.id || (a.auditorName && a.auditorName.trim().toLowerCase() === rank.name.trim().toLowerCase());
            if (!isMatch) return false;
            let aDate = a.date ? new Date(a.date) : null;
            return aDate && aDate.getFullYear() === activeYear && (aDate.getMonth() + 1) === activeMonth;
        });
        rank.auditsCount = uAudits.length;
        rank.daysCount = rank.daysSet.size;
    });

    const sortedRankings = Object.values(userRankings).sort((a, b) => b.totalDuration - a.totalDuration);

    let rowsHtml = '';
    if (sortedRankings.length === 0) {
        rowsHtml = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--text-dim);">Sıralama verisi bulunmuyor.</td></tr>`;
    } else {
        sortedRankings.forEach((rank, index) => {
            const isChecked = fieldTrackingCompareUsers.includes(rank.id);
            const avgDuration = rank.missionsCount > 0 ? Math.round(rank.totalDuration / rank.missionsCount) : 0;

            rowsHtml += `
                <tr>
                    <td style="text-align:center; width:50px;">
                        <input type="checkbox" class="compare-checkbox" value="${rank.id}" ${isChecked ? 'checked' : ''} onchange="toggleCompareUser(this)" style="cursor:pointer; width:16px; height:16px;">
                    </td>
                    <td style="font-weight:700; text-align:center; width:60px;">
                        ${index + 1 === 1 ? '🏆' : index + 1 === 2 ? '🥈' : index + 1 === 3 ? '🥉' : index + 1}
                    </td>
                    <td>
                        <div style="display:flex; flex-direction:column; max-width: 180px; overflow: hidden;">
                            <span style="font-weight:700; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(rank.name)}</span>
                            <small style="color:var(--text-dim); font-size:0.7rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(rank.title)}">${escapeHtml(rank.title)}</small>
                        </div>
                    </td>
                    <td style="text-align:center; font-weight:700; color:var(--accent);">${rank.missionsCount} Sefer</td>
                    <td style="text-align:center; font-weight:600;">${rank.daysCount} Gün</td>
                    <td style="text-align:center; font-weight:700; color:#3b82f6;">${formatFieldDuration(rank.totalDuration)}</td>
                    <td style="text-align:center;">${formatFieldDuration(avgDuration)}</td>
                    <td style="text-align:center; font-weight:600; color:#8b5cf6;">${rank.totalVisits} İstasyon</td>
                    <td style="text-align:center; font-weight:700; color:#10b981;">${rank.auditsCount} Denetim</td>
                </tr>
            `;
        });
    }

    // Karşılaştırma Grafiği Bölümü
    let compareGraphHtml = '';
    if (fieldTrackingCompareUsers.length > 0) {
        compareGraphHtml = `
            <div class="card shadow-sm border-0 p-3" style="background:var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px; margin-top:2rem;">
                <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:1rem; color:var(--text-primary);"><i class="fas fa-users mr-2" style="color:var(--accent);"></i> Seçilen Personellerin Saha Karşılaştırması</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-field-compare"></canvas>
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr; gap: 1.5rem;">
            <!-- Sıralama Tablosu -->
            <div class="card shadow-sm border-0" style="background:var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px; margin-top: 1rem; margin-bottom: 1.5rem;">
                <div class="card-header border-0 d-flex justify-content-between align-items-start align-items-sm-center p-3 flex-wrap gap-2" style="background:none;">
                    <h4 class="card-title mb-0" style="font-size:1.1rem; font-weight:700;"><i class="fas fa-trophy mr-2" style="color:#f59e0b;"></i> Saha Performans Liderlik Tablosu</h4>
                    <span style="font-size:0.8rem; color:var(--text-dim); background: rgba(30, 41, 59, 0.25); padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border-main); display: inline-block;">Personel karşılaştırması yapmak için listeden kutucukları işaretleyin (Maks. 3)</span>
                </div>
                <div class="card-body p-0">
                    <div class="table-responsive">
                        <table class="table mb-0">
                            <thead>
                                <tr style="background:var(--bg-card-sub); border-bottom:1px solid var(--border-main); font-size:0.75rem;">
                                    <th style="text-align:center; width:50px;">Kıyasla</th>
                                    <th style="text-align:center; width:60px;">Sıra</th>
                                    <th style="text-align:left;">Personel Bilgisi</th>
                                    <th style="text-align:center;">Saha Görevi</th>
                                    <th style="text-align:center;">Aktif Gün</th>
                                    <th style="text-align:center;">Toplam Saha Süresi</th>
                                    <th style="text-align:center;">Görev Başına Ort.</th>
                                    <th style="text-align:center;">İstasyon Ziyareti</th>
                                    <th style="text-align:center;">Tamamlanan Denetim</th>
                                </tr>
                            </thead>
                            <tbody style="font-size:0.8rem;">
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Karşılaştırma Grafiği -->
            ${compareGraphHtml}
        </div>
    `;

    // Grafik varsa çiz
    if (fieldTrackingCompareUsers.length > 0) {
        setTimeout(() => {
            buildCompareChart(userRankings);
        }, 50);
    }
}

/**
 * Karşılaştırma listesine kullanıcı ekler/çıkar
 */
function toggleCompareUser(checkbox) {
    const uId = checkbox.value;
    if (checkbox.checked) {
        if (fieldTrackingCompareUsers.length >= 3) {
            checkbox.checked = false;
            showToast('En fazla 3 personeli karşılaştırabilirsiniz.');
            return;
        }
        if (!fieldTrackingCompareUsers.includes(uId)) {
            fieldTrackingCompareUsers.push(uId);
        }
    } else {
        fieldTrackingCompareUsers = fieldTrackingCompareUsers.filter(id => id !== uId);
    }

    renderActiveTabContent();
}

/**
 * Karşılaştırmalı bar chart çizer
 */
function buildCompareChart(userRankings) {
    const isDark = !document.body.classList.contains('light-mode');
    const labelColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(71, 85, 105, 0.08)';

    const datasets = [];
    const colors = ['rgba(37, 99, 235, 0.85)', 'rgba(245, 158, 11, 0.85)', 'rgba(16, 185, 129, 0.85)'];
    const borderColors = ['rgb(37, 99, 235)', 'rgb(245, 158, 11)', 'rgb(16, 185, 129)'];

    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
    const labels = [];
    for (let d = 1; d <= daysInMonth; d++) labels.push(d);

    fieldTrackingCompareUsers.forEach((uId, idx) => {
        const rank = userRankings[uId];
        if (!rank) return;

        const dataArray = [];
        const userSessions = fieldSessionsCache.filter(s => s.userId === uId);

        for (let d = 1; d <= daysInMonth; d++) {
            const session = userSessions.find(s => {
                let sDate = s.startTime || s.date;
                if (sDate && !(sDate instanceof Date)) sDate = new Date(sDate);
                return sDate && sDate.getDate() === d && sDate.getFullYear() === activeYear && (sDate.getMonth() + 1) === activeMonth;
            });
            dataArray.push(session ? Math.round((session.totalDuration / 60) * 10) / 10 : 0);
        }

        datasets.push({
            label: rank.name,
            data: dataArray,
            backgroundColor: colors[idx],
            borderColor: borderColors[idx],
            borderWidth: 2,
            tension: 0.15,
            fill: false
        });
    });

    const ctx = document.getElementById('chart-field-compare');
    if (ctx) {
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: labelColor }
                    },
                    datalabels: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: labelColor }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: { color: labelColor },
                        min: 0,
                        max: 12
                    }
                }
            }
        });
        fieldTrackingCharts.push(chart);
    }
}

/**
 * -----------------------------------------------------------------------------
 * DETAY MODALI VE HARİTA ÇİZİM MANTIĞI
 * -----------------------------------------------------------------------------
 */
function toSafeDate(val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val.toDate === 'function') {
        try { return val.toDate(); } catch(e) {}
    }
    if (typeof val === 'object' && val.seconds !== undefined) {
        return new Date(val.seconds * 1000 + (val.nanoseconds || 0) / 1000000);
    }
    if (typeof val === 'object' && val._seconds !== undefined) {
        return new Date(val._seconds * 1000 + (val._nanoseconds || 0) / 1000000);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

function formatTimeStr(dateObj) {
    const d = toSafeDate(dateObj);
    if (!d) return '—';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function openFieldSessionDetail(sessionId) {
    const session = (fieldSessionsCache || []).find(s => s.id === sessionId) || 
        (appData.fieldSessions || []).find(s => s.id === sessionId) || 
        (rawFieldSessionsCache || []).find(s => s.id === sessionId);

    if (!session) {
        showToast('Saha seans detayı bulunamadı.');
        return;
    }

    let modal = document.getElementById('field-session-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'field-session-modal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    const sDate = toSafeDate(session.date || session.startTime);
    const dateFormatted = sDate ? sDate.toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
    const startTimeStr = formatTimeStr(session.startTime);
    const endTimeStr = formatTimeStr(session.endTime);
    const durationStr = formatFieldDuration(session.totalDuration || 0);

    // Timeline HTML'ini oluştur
    let timelineItemsHtml = `
        <div class="field-tracking-timeline-item" style="display:flex; gap:12px; margin-bottom:14px; position:relative;">
            <div style="width:32px; height:32px; border-radius:50%; background:#10b981; color:white; display:flex; align-items:center; justify-content:center; font-size:0.8rem; flex-shrink:0; box-shadow:0 2px 6px rgba(16,185,129,0.3);">
                <i class="fas fa-play"></i>
            </div>
            <div style="flex:1; background:var(--bg-card-sub); padding:10px 14px; border-radius:10px; border:1px solid var(--border-main);">
                <div style="font-weight:800; font-size:0.85rem; color:var(--text-primary);">🚀 Sahaya Çıkış (Görev Başlangıcı)</div>
                <div style="font-size:0.75rem; color:var(--text-dim); margin-top:3px;">
                    <strong>Çıkış Saati:</strong> ${startTimeStr} | <strong>Vardiya:</strong> ${escapeHtml(session.shiftCode || 'G1')}
                </div>
            </div>
        </div>
    `;

    // İstasyon giriş/çıkışlarını kronolojik sıralayalım
    if (Array.isArray(session.visits) && session.visits.length > 0) {
        session.visits.forEach((v, idx) => {
            const isAutoClosed = v.autoClosed === true || v.flagged === true;
            const entryStr = formatTimeStr(v.entryTime);
            const exitStr = formatTimeStr(v.exitTime);
            const stayStr = formatFieldDuration(v.duration || 0);

            timelineItemsHtml += `
                <div class="field-tracking-timeline-item" style="display:flex; gap:12px; margin-bottom:14px; position:relative;">
                    <div style="width:32px; height:32px; border-radius:50%; background:${isAutoClosed ? '#f59e0b' : '#3b82f6'}; color:white; display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:800; flex-shrink:0; box-shadow:0 2px 6px ${isAutoClosed ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)'};">
                        ${idx + 1}
                    </div>
                    <div style="flex:1; background:var(--bg-card-sub); padding:10px 14px; border-radius:10px; border:1px solid ${isAutoClosed ? 'rgba(245,158,11,0.35)' : 'var(--border-main)'};">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                            <div style="font-weight:800; font-size:0.88rem; color:var(--text-primary);">
                                📍 ${escapeHtml(v.stationName || 'Bilinmeyen İstasyon')}
                            </div>
                            <span style="background:rgba(59, 130, 246, 0.15); color:#3b82f6; font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:6px;">
                                ${stayStr} Kalındı
                            </span>
                        </div>
                        <div style="font-size:0.76rem; color:var(--text-dim); margin-top:6px; display:flex; gap:14px; flex-wrap:wrap;">
                            <span style="background:rgba(16,185,129,0.1); padding:2px 8px; border-radius:4px; color:#10b981; font-weight:700;"><i class="fas fa-arrow-right-to-bracket mr-1"></i> Giriş: ${entryStr}</span>
                            <span style="background:rgba(239,68,68,0.1); padding:2px 8px; border-radius:4px; color:#ef4444; font-weight:700;"><i class="fas fa-arrow-right-from-bracket mr-1"></i> Çıkış: ${exitStr}</span>
                        </div>
                        ${isAutoClosed ? `
                            <div style="margin-top:6px; background:rgba(245, 158, 11, 0.12); border:1px solid rgba(245, 158, 11, 0.3); color:#d97706; padding:3px 8px; border-radius:6px; font-size:0.7rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
                                <i class="fas fa-triangle-exclamation"></i> ${escapeHtml(v.autoCloseReason || 'Çıkış Unutuldu (Maks 45dk Sınırı Uygulandı)')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });
    } else {
        timelineItemsHtml += `
            <div style="padding:1.5rem; text-align:center; color:var(--text-dim); font-size:0.82rem; background:var(--bg-card-sub); border-radius:10px; border:1px dashed var(--border-main); margin-bottom:14px;">
                <i class="fas fa-map-location-dot" style="font-size:1.5rem; color:#94a3b8; display:block; margin-bottom:6px;"></i>
                Bu seansta kayıtlı istasyon giriş/çıkışı bulunmuyor.
            </div>
        `;
    }

    timelineItemsHtml += `
        <div class="field-tracking-timeline-item" style="display:flex; gap:12px; margin-bottom:14px; position:relative;">
            <div style="width:32px; height:32px; border-radius:50%; background:#ef4444; color:white; display:flex; align-items:center; justify-content:center; font-size:0.8rem; flex-shrink:0; box-shadow:0 2px 6px rgba(239,68,68,0.3);">
                <i class="fas fa-stop"></i>
            </div>
            <div style="flex:1; background:var(--bg-card-sub); padding:10px 14px; border-radius:10px; border:1px solid var(--border-main);">
                <div style="font-weight:800; font-size:0.85rem; color:var(--text-primary);">🏁 Sahadan Dönüş (Görev Tamamlandı)</div>
                <div style="font-size:0.75rem; color:var(--text-dim); margin-top:3px;">
                    <strong>Dönüş Saati:</strong> ${endTimeStr} | <strong>Toplam Süre:</strong> ${durationStr}
                </div>
            </div>
        </div>
    `;

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 980px; width: 95%;">
            <div class="modal-header" style="padding:1rem 1.5rem; border-bottom:1px solid var(--border-main); display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; flex-direction:column;">
                    <h3 style="margin:0; font-size:1.2rem; font-weight:800; color:var(--text-primary);"><i class="fas fa-route mr-2" style="color:var(--accent);"></i> Saha Detay Raporu</h3>
                    <small style="color:var(--text-dim); font-size:0.82rem; margin-top:2px;">${escapeHtml(session.userName || 'Bilinmiyor')} — ${dateFormatted} (${escapeHtml(session.shiftCode || 'G1')} Vardiyası)</small>
                </div>
                <i class="fas fa-times close-modal" onclick="closeFieldSessionModal()" style="cursor: pointer; font-size:1.2rem; color:var(--text-dim);"></i>
            </div>
            <div class="modal-body" style="padding:1.5rem; display:grid; grid-template-columns: 1fr 1.15fr; gap:1.5rem; max-height:calc(100vh - 180px); overflow-y:auto;">
                <!-- Sol Kolon: Zaman Çizelgesi & Giriş-Çıkış Noktaları -->
                <div>
                    <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:1rem; border-bottom:1px solid var(--border-main); padding-bottom:6px; color:var(--text-primary);"><i class="fas fa-clock-rotate-left mr-2" style="color:var(--accent);"></i> İstasyon Giriş - Çıkış Noktaları</h4>
                    <div class="field-tracking-timeline" style="max-height: 440px; overflow-y: auto; padding-right:8px;">
                        ${timelineItemsHtml}
                    </div>
                </div>
                <!-- Sağ Kolon: Rota Haritası -->
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:0; border-bottom:1px solid var(--border-main); padding-bottom:6px; color:var(--text-primary);"><i class="fas fa-map-location-dot mr-2" style="color:#3b82f6;"></i> Ziyaret ve Navigasyon Rotası</h4>
                    <div id="field-detail-map" class="field-tracking-map" style="height:440px; border-radius:12px; border:1px solid var(--border-main); overflow:hidden;"></div>
                </div>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    // Leaflet haritasını yükle
    setTimeout(() => {
        initializeDetailMap(session);
    }, 150);
}

function closeFieldSessionModal() {
    const modal = document.getElementById('field-session-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (detailMapInstance) {
        try { detailMapInstance.remove(); } catch(e) {}
        detailMapInstance = null;
    }
    detailMapMarkers = [];
    detailMapPolyline = null;
}

/**
 * Haritayı başlatır ve koordinatları çizer
 */
function initializeDetailMap(session) {
    if (detailMapInstance) {
        try { detailMapInstance.remove(); } catch(e) {}
        detailMapInstance = null;
    }
    detailMapMarkers = [];
    detailMapPolyline = null;

    const mapEl = document.getElementById('field-detail-map');
    if (!mapEl) return;

    if (typeof L === 'undefined') {
        mapEl.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-dim);">Harita bileşeni (Leaflet) yüklenemedi.</div>';
        return;
    }

    const defaultCenter = [41.0082, 28.9784]; 
    detailMapInstance = L.map('field-detail-map').setView(defaultCenter, 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(detailMapInstance);

    const latlngs = [];
    const bounds = [];

    // 1. Ziyaret Edilen İstasyon Pinlerini Çiz
    if (Array.isArray(session.visits) && session.visits.length > 0) {
        session.visits.forEach((v, idx) => {
            let lat = v.lat || v.latitude;
            let lng = v.lng || v.longitude;

            // GPS trail içinde bu istasyona ait koordinat var mı?
            if ((!lat || !lng) && Array.isArray(session.gpsTrail)) {
                const trailPt = session.gpsTrail.find(pt => pt.stationName && pt.stationName.toLowerCase() === (v.stationName || '').toLowerCase());
                if (trailPt && trailPt.lat && trailPt.lng) {
                    lat = trailPt.lat;
                    lng = trailPt.lng;
                }
            }

            // stationLocations içinde ara
            if (!lat || !lng) {
                const loc = findStationCoordsByName(v.stationName, session.line);
                if (loc && loc.latitude && loc.longitude) {
                    lat = Number(loc.latitude);
                    lng = Number(loc.longitude);
                }
            }

            if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                const isAutoClosed = v.autoClosed === true || v.flagged === true;
                const markerHtml = `
                    <div style="background:${isAutoClosed ? '#f59e0b' : '#3b82f6'}; color:white; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:0.75rem; border:2px solid white; box-shadow:0 3px 8px rgba(0,0,0,0.35);">
                        ${idx + 1}
                    </div>
                `;
                const customIcon = L.divIcon({
                    html: markerHtml,
                    className: 'custom-field-map-marker',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });

                const marker = L.marker([lat, lng], { icon: customIcon })
                    .addTo(detailMapInstance)
                    .bindPopup(`
                        <div style="font-family:inherit; padding:4px; min-width:190px;">
                            <strong style="display:block; font-size:0.9rem; color:#1e293b; margin-bottom:4px;">📍 ${idx + 1}. ${escapeHtml(v.stationName)}</strong>
                            <div style="font-size:0.78rem; color:#475569; line-height:1.5;">
                                <div><strong style="color:#10b981;">Giriş:</strong> ${formatTimeStr(v.entryTime)}</div>
                                <div><strong style="color:#ef4444;">Çıkış:</strong> ${formatTimeStr(v.exitTime)}</div>
                                <div><strong>Kalış Süresi:</strong> ${formatFieldDuration(v.duration)}</div>
                            </div>
                            ${isAutoClosed ? `<div style="margin-top:6px; background:#fef3c7; border:1px solid #fde68a; color:#b45309; padding:3px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">⚠️ ${escapeHtml(v.autoCloseReason || 'Maks 45dk Sınırı')}</div>` : ''}
                        </div>
                    `);
                detailMapMarkers.push(marker);
                latlngs.push([lat, lng]);
                bounds.push([lat, lng]);
            }
        });
    }

    // 2. GPS İzini (Path/Trail) Çiz
    if (Array.isArray(session.gpsTrail) && session.gpsTrail.length > 0) {
        session.gpsTrail.forEach(pt => {
            if (pt.lat && pt.lng && !isNaN(pt.lat) && !isNaN(pt.lng)) {
                latlngs.push([pt.lat, pt.lng]);
                bounds.push([pt.lat, pt.lng]);
            }
        });
    }

    // Eğer noktalar varsa polyline çiz
    if (latlngs.length > 1) {
        detailMapPolyline = L.polyline(latlngs, {
            color: '#f97316',
            weight: 4,
            opacity: 0.85,
            dashArray: '6, 8'
        }).addTo(detailMapInstance);
    }

    // Harita alanını çizilen noktalara göre ortala
    if (bounds.length > 0) {
        detailMapInstance.fitBounds(bounds, { padding: [40, 40] });
    }
}

/**
 * İsme göre istasyon koordinat araması
 */
function findStationCoordsByName(stationName, lineName = '') {
    if (!stationName) return null;
    const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9ğüşıöç]/gi, '').trim();
    const targetClean = clean(stationName);

    if (appData.stationLocations && typeof appData.stationLocations === 'object') {
        // 1. Line + Station direct key
        if (lineName && lineName !== 'Tümü') {
            const locKey = `${lineName}_${stationName}`;
            if (appData.stationLocations[locKey]) return appData.stationLocations[locKey];
        }

        // 2. Tüm key'lerde ara
        for (const [key, loc] of Object.entries(appData.stationLocations)) {
            if (!loc || loc.latitude === undefined || loc.longitude === undefined) continue;
            const keyParts = key.split('_');
            const stInKey = keyParts.length >= 2 ? keyParts.slice(1).join('_') : key;
            const cleanSt = clean(stInKey);

            if (cleanSt === targetClean || (targetClean.length >= 3 && cleanSt.includes(targetClean)) || (cleanSt.length >= 3 && targetClean.includes(cleanSt))) {
                return loc;
            }
        }
    }
    return null;
}

/**
 * -----------------------------------------------------------------------------
 * EXCEL EXPORT İŞLEMLERİ
 * -----------------------------------------------------------------------------
 */
/**
 * -----------------------------------------------------------------------------
 * SEKME 6: RAPORLAR GÖRÜNÜMÜ
 * -----------------------------------------------------------------------------
 */
function renderFieldReports(container) {
    const monthNamesTr = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const selectedMonthName = monthNamesTr[activeMonth - 1] || '';
    const periodLabel = `${selectedMonthName} ${activeYear}`;

    const reports = [
        {
            icon: 'fa-table-cells-large',
            color: '#3b82f6',
            title: 'Saha Süre Takip Matrisi',
            desc: 'Personel bazlı günlük saha çalışma sürelerini içeren aylık matris tablosu. Her personelin hangi gün ne kadar sahada kaldığını gösteren detaylı rapor.',
            sheets: 'Matris Tablosu',
            format: 'pdf',
            action: 'exportFieldMatrixPDF()'
        },
        {
            icon: 'fa-user-chart',
            color: '#10b981',
            title: 'Saha Haftalık/Aylık Performans Raporu',
            desc: 'Görsel 1 standardına uygun; personellerin hat bazlı gruplandığı, aktif gün, saha ve ofis sürelerinin yüzdeleriyle gösterildiği liste raporu.',
            sheets: 'Performans Listesi',
            format: 'pdf',
            action: 'exportFieldPerformancePDF()'
        },
        {
            icon: 'fa-file-lines',
            color: '#ec4899',
            title: 'Kurumsal Personel Çalışma Verileri',
            desc: 'Görsel 3 standardına uygun; her personelin toplam çalışma/saha/toplantı sürelerini ve en çok/en az/hiç ziyaret ettiği istasyonları içeren detaylı kurumsal analiz raporu.',
            sheets: 'Kurumsal Detay Raporu',
            format: 'pdf',
            action: 'exportFieldIndividualPDF()'
        },
        {
            icon: 'fa-train',
            color: '#a855f7',
            title: 'İstasyon Ziyaret Analizi',
            desc: 'İstasyon bazlı ziyaret sayıları, toplam kalma süreleri ve ortalama ziyaret sürelerini içeren detaylı analiz raporu.',
            sheets: 'İstasyon Detayları',
            format: 'pdf',
            action: 'exportFieldStationPDF()'
        },
        {
            icon: 'fa-ranking-star',
            color: '#f59e0b',
            title: 'Saha Performans Sıralaması',
            desc: 'Tüm saha personelinin toplam saha sürelerine göre sıralaması, gün sayıları ve günlük ortalamaları içeren sıralama raporu.',
            sheets: 'Sıralama Tablosu',
            format: 'pdf',
            action: 'exportFieldRankingPDF()'
        }
    ];

    const cardsHtml = reports.map(r => `
        <div class="field-report-card" style="background: var(--bg-card); border: 1px solid var(--border-main); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; transition: all 0.2s ease; cursor: default;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div style="width: 42px; height: 42px; border-radius: 12px; background: ${r.color}15; color: ${r.color}; display: grid; place-items: center; font-size: 1.1rem; flex-shrink: 0;">
                    <i class="fas ${r.icon}"></i>
                </div>
                <div style="min-width: 0;">
                    <h4 style="margin: 0; font-size: 0.92rem; font-weight: 800; color: var(--text-primary); line-height: 1.3;">${r.title}</h4>
                    <span style="font-size: 0.68rem; color: ${r.color}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;">${r.format.toUpperCase()} • ${r.sheets}</span>
                </div>
            </div>
            <p style="margin: 0; font-size: 0.78rem; color: var(--text-dim); line-height: 1.5;">${r.desc}</p>
            <button onclick="${r.action}" class="btn-primary" style="align-self: flex-start; padding: 0.45rem 1.1rem; font-size: 0.8rem; border-radius: 8px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; margin-top: auto;">
                <i class="fas fa-download"></i> İndir
            </button>
        </div>
    `).join('');

    container.innerHTML = `
        <div style="margin-top: 0px; margin-bottom: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
                <div style="width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; display: grid; place-items: center; font-size: 1.15rem; flex-shrink: 0;">
                    <i class="fas fa-file-arrow-down"></i>
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--text-primary);">Saha Performans Raporları</h3>
                    <p style="margin: 0; font-size: 0.8rem; color: var(--text-dim);">Dönem: <strong style="color: var(--accent);">${periodLabel}</strong> • Filtrelenen verilere göre rapor üretilir</p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 0.75rem;">
                ${cardsHtml}
            </div>

            <!-- Veri Yönetimi Bölümü -->
            <div style="margin-top: 1.25rem; border-top: 1px solid var(--border-main); padding-top: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
                    <div style="width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; display: grid; place-items: center; font-size: 1.15rem; flex-shrink: 0;">
                        <i class="fas fa-database"></i>
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--text-primary);">Saha Oturum Yönetimi</h3>
                        <p style="margin: 0; font-size: 0.8rem; color: var(--text-dim);">Test veya hatalı kayıtları buradan seçerek silebilirsiniz</p>
                    </div>
                </div>
                ${renderFieldSessionsTable()}
            </div>
        </div>
    `;

    // Checkbox event listeners
    setTimeout(() => {
        const selectAll = document.getElementById('field-session-select-all');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                document.querySelectorAll('.field-session-checkbox').forEach(cb => {
                    cb.checked = e.target.checked;
                });
                updateFieldDeleteButtonState();
            });
        }
    }, 50);
}

function renderFieldSessionsTable() {
    const sessions = fieldSessionsCache || [];
    if (sessions.length === 0) {
        return '<div style="text-align:center; padding: 2rem; color: var(--text-dim); font-size: 0.85rem;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>Kayıtlı saha oturumu bulunmuyor.</div>';
    }

    const sortedSessions = [...sessions].sort((a, b) => {
        const da = a.date ? a.date.getTime() : 0;
        const db = b.date ? b.date.getTime() : 0;
        return db - da;
    });

    let rowsHtml = '';
    sortedSessions.forEach((s, idx) => {
        const dateStr = s.date ? s.date.toLocaleDateString('tr-TR') : '—';
        const startStr = s.startTime ? s.startTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—';
        const endStr = s.endTime ? s.endTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'Devam';
        const duration = s.totalDuration || 0;
        const statusBadge = s.status === 'active'
            ? '<span style="background:#f59e0b22; color:#f59e0b; padding:2px 8px; border-radius:6px; font-size:0.7rem; font-weight:700;">Aktif</span>'
            : '<span style="background:#10b98122; color:#10b981; padding:2px 8px; border-radius:6px; font-size:0.7rem; font-weight:700;">Tamamlandı</span>';

        rowsHtml += `
            <tr style="border-bottom: 1px solid var(--border-main);">
                <td style="text-align:center; padding: 10px 8px;">
                    <input type="checkbox" class="field-session-checkbox" data-session-id="${escapeAttr(s.id || '')}" style="cursor:pointer; width:15px; height:15px;" onchange="updateFieldDeleteButtonState()">
                </td>
                <td style="padding: 10px 8px; font-weight: 700; font-size: 0.82rem; white-space: nowrap;">${escapeHtml(s.userName || '—')}</td>
                <td style="padding: 10px 8px; font-size: 0.78rem; color: var(--text-dim);">${escapeHtml(s.userTitle || '—')}</td>
                <td style="padding: 10px 8px; text-align: center; font-size: 0.82rem;">${dateStr}</td>
                <td style="padding: 10px 8px; text-align: center; font-size: 0.82rem;">${startStr}</td>
                <td style="padding: 10px 8px; text-align: center; font-size: 0.82rem;">${endStr}</td>
                <td style="padding: 10px 8px; text-align: center; font-weight: 700; color: var(--accent); font-size: 0.82rem;">${formatFieldDuration(duration)}</td>
                <td style="padding: 10px 8px; text-align: center;">${statusBadge}</td>
                <td style="padding: 10px 8px; text-align: center;">
                    <button onclick="deleteFieldSession('${escapeAttr(s.id || '')}')" class="btn-sm" style="background: #ef444422; color: #ef4444; border: 1px solid #ef444444; border-radius: 6px; padding: 4px 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer;" title="Bu oturumu sil">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    return `
        <div class="card shadow-sm border-0" style="background: var(--bg-card); border: 1px solid var(--border-main) !important; border-radius: 12px;">
            <div class="card-header border-0 d-flex justify-content-between align-items-center p-3 flex-wrap gap-2" style="background:none;">
                <span style="font-size: 0.85rem; color: var(--text-dim);">Toplam <strong style="color: var(--text-primary);">${sessions.length}</strong> oturum kaydı</span>
                <button id="field-delete-selected-btn" onclick="deleteSelectedFieldSessions()" class="btn-sm" style="background: #ef444422; color: #ef4444; border: 1px solid #ef444444; border-radius: 8px; padding: 6px 14px; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: none;">
                    <i class="fas fa-trash-alt mr-1"></i> Seçilenleri Sil
                </button>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table mb-0" style="font-size: 0.82rem;">
                        <thead>
                            <tr style="background: var(--bg-card-sub); border-bottom: 1px solid var(--border-main);">
                                <th style="text-align:center; width: 40px; padding: 10px 8px;">
                                    <input type="checkbox" id="field-session-select-all" style="cursor:pointer; width:15px; height:15px;">
                                </th>
                                <th style="padding: 10px 8px;">Personel</th>
                                <th style="padding: 10px 8px;">Ünvan</th>
                                <th style="text-align:center; padding: 10px 8px;">Tarih</th>
                                <th style="text-align:center; padding: 10px 8px;">Başlangıç</th>
                                <th style="text-align:center; padding: 10px 8px;">Bitiş</th>
                                <th style="text-align:center; padding: 10px 8px;">Süre</th>
                                <th style="text-align:center; padding: 10px 8px;">Durum</th>
                                <th style="text-align:center; width: 60px; padding: 10px 8px;">İşlem</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function updateFieldDeleteButtonState() {
    const checked = document.querySelectorAll('.field-session-checkbox:checked');
    const btn = document.getElementById('field-delete-selected-btn');
    if (btn) {
        btn.style.display = checked.length > 0 ? 'inline-flex' : 'none';
        btn.innerHTML = `<i class="fas fa-trash-alt mr-1"></i> Seçilenleri Sil (${checked.length})`;
    }
}

async function deleteFieldSession(sessionId) {
    if (!sessionId) { showToast('Oturum ID bulunamadı.'); return; }
    if (!confirm('Bu saha oturumunu kalıcı olarak silmek istediğinizden emin misiniz?')) return;

    try {
        await db.collection('field_sessions').doc(sessionId).delete();
        showToast('Saha oturumu başarıyla silindi.');
        // Veri cache'den de kaldır
        const idx = fieldSessionsCache.findIndex(s => s.id === sessionId);
        if (idx !== -1) fieldSessionsCache.splice(idx, 1);
        renderActiveTabContent();
    } catch (err) {
        console.error('Delete error:', err);
        showToast('Silme işleminde hata oluştu: ' + err.message);
    }
}

async function deleteSelectedFieldSessions() {
    const checkboxes = document.querySelectorAll('.field-session-checkbox:checked');
    if (checkboxes.length === 0) { showToast('Lütfen silinecek oturumları seçin.'); return; }
    if (!confirm(`Seçilen ${checkboxes.length} saha oturumunu kalıcı olarak silmek istediğinizden emin misiniz?\n\nBu işlem geri alınamaz!`)) return;

    const ids = Array.from(checkboxes).map(cb => cb.dataset.sessionId).filter(Boolean);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
        try {
            await db.collection('field_sessions').doc(id).delete();
            const idx = fieldSessionsCache.findIndex(s => s.id === id);
            if (idx !== -1) fieldSessionsCache.splice(idx, 1);
            successCount++;
        } catch (err) {
            console.error('Batch delete error for', id, err);
            failCount++;
        }
    }

    if (failCount === 0) {
        showToast(`${successCount} oturum başarıyla silindi.`);
    } else {
        showToast(`${successCount} silindi, ${failCount} silinemedi.`);
    }
    renderActiveTabContent();
}

/**
 * Akıllı filtrelerden aktif olan günleri belirler
 */
function getSelectedPeriodDays(activeYear, activeMonth) {
    const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
    let periodDays = [];
    
    if (typeof unifiedDateFilters !== 'undefined' && unifiedDateFilters.field) {
        const uDays = unifiedDateFilters.field.days || [];
        const uWeeks = unifiedDateFilters.field.weeks || [];
        
        if (uDays.length > 0) {
            uDays.forEach(dStr => {
                const dt = new Date(dStr);
                if (dt.getFullYear() === activeYear && (dt.getMonth() + 1) === activeMonth) {
                    periodDays.push(dt.getDate());
                }
            });
        } else if (uWeeks.length > 0) {
            for (let d = 1; d <= daysInMonth; d++) {
                const dt = new Date(activeYear, activeMonth - 1, d);
                const wNum = getISOWeekNumber(dt);
                if (uWeeks.includes(wNum.toString())) {
                    periodDays.push(d);
                }
            }
        }
    }
    
    if (periodDays.length === 0) {
        for (let d = 1; d <= daysInMonth; d++) {
            periodDays.push(d);
        }
    }
    
    return periodDays.sort((a, b) => a - b);
}

/**
 * Filtre detaylarına göre rapor aralığı, dönem tipi ve başlık eklerini hesaplar
 */
function getReportPeriodDetails(activeYear, activeMonth) {
    const periodDays = getSelectedPeriodDays(activeYear, activeMonth);
    let firstDayDate = new Date(activeYear, activeMonth - 1, periodDays[0]);
    let lastDayDate = new Date(activeYear, activeMonth - 1, periodDays[periodDays.length - 1]);
    let dateRangeStr = `${firstDayDate.toLocaleDateString('tr-TR')} - ${lastDayDate.toLocaleDateString('tr-TR')}`;
    
    let periodType = 'aylik'; // 'aylik', 'haftalik', 'gunluk'
    let periodName = '';
    let docTitleSuffix = '';
    
    if (typeof unifiedDateFilters !== 'undefined' && unifiedDateFilters.field) {
        const uDays = unifiedDateFilters.field.days || [];
        const uWeeks = unifiedDateFilters.field.weeks || [];
        const uMonths = unifiedDateFilters.field.months || [];
        
        if (uDays.length > 0) {
            periodType = 'gunluk';
            periodName = `${getLocalDateString(firstDayDate)}_${getLocalDateString(lastDayDate)}`;
            docTitleSuffix = dateRangeStr;
        } else if (uWeeks.length > 0) {
            periodType = 'haftalik';
            periodName = `Hafta_${uWeeks[0]}`;
            docTitleSuffix = `${uWeeks[0]}. HAFTA`;
        } else if (uMonths.length > 0) {
            const monthNamesTr = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
            periodType = 'aylik';
            periodName = `${activeYear}_${uMonths[0]}`;
            docTitleSuffix = `${monthNamesTr[parseInt(uMonths[0]) - 1].toUpperCase()} ${activeYear}`;
        }
    }
    
    if (!periodName) {
        const monthNamesTr = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
        periodName = `${activeYear}_${activeMonth}`;
        docTitleSuffix = `${monthNamesTr[activeMonth - 1].toUpperCase()} ${activeYear}`;
    }
    
    return {
        periodDays,
        dateRangeStr,
        periodType,
        periodName,
        docTitleSuffix
    };
}

/**
 * Belirli bir dönem için personelin çalışma, saha ve toplantı sürelerini hesaplar
 */
function calculateUserMetricsForPeriod(user, activeYear, activeMonth, sessions, periodDays) {
    const roster = fieldRosterCache[user.id] || {};
    const daysObj = roster.days || {};
    
    let sahaMinutesTotal = 0;
    let meetingMinutesTotal = 0;
    let officeMinutesTotal = 0;
    let workDaysCount = 0;
    
    let stationDurations = {}; // stationName -> { minutes, count }
    
    periodDays.forEach(day => {
        const dayKey = String(day);
        const dayData = daysObj[dayKey];
        
        const daySessions = sessions.filter(s => {
            let sDate = s.startTime || s.date;
            if (sDate && !(sDate instanceof Date)) sDate = new Date(sDate);
            return s.userId === user.id && sDate && sDate.getDate() === day && sDate.getFullYear() === activeYear && (sDate.getMonth() + 1) === activeMonth;
        });
        
        let sahaMinutes = 0;
        daySessions.forEach(s => {
            sahaMinutes += (s.totalDuration || 0);
            if (Array.isArray(s.visits)) {
                s.visits.forEach(v => {
                    const stName = v.stationName || 'Bilinmiyor';
                    if (!stationDurations[stName]) {
                        stationDurations[stName] = { minutes: 0, count: 0 };
                    }
                    stationDurations[stName].minutes += (v.duration || 0);
                    stationDurations[stName].count += 1;
                });
            }
        });
        
        let meetingMinutes = 0;
        let shiftCode = '';
        if (dayData) {
            meetingMinutes = dayData.hasMeeting ? (dayData.meetingDuration || 120) : 0;
            shiftCode = dayData.shift || '';
        }
        
        const shiftCodeLower = (shiftCode || '').toLowerCase();
        const isOffShift = ['i', 'yi', 'r', 'izin', 'rapor', 'tatil'].includes(shiftCodeLower) || shiftCodeLower.includes('izin');
        const worked = sahaMinutes > 0 || meetingMinutes > 0;
        const isWorkDay = worked || (shiftCode && !isOffShift);
        
        if (isWorkDay) {
            const shiftDuration = 480; // 8 saat
            let officeMinutes = Math.max(0, shiftDuration - sahaMinutes - meetingMinutes);
            
            sahaMinutesTotal += sahaMinutes;
            meetingMinutesTotal += meetingMinutes;
            officeMinutesTotal += officeMinutes;
            workDaysCount += 1;
        }
    });
    
    const totalMinutes = sahaMinutesTotal + meetingMinutesTotal + officeMinutesTotal;
    const pctSaha = totalMinutes > 0 ? Math.round((sahaMinutesTotal / totalMinutes) * 100) : 0;
    const pctMeeting = totalMinutes > 0 ? Math.round((meetingMinutesTotal / totalMinutes) * 100) : 0;
    const pctOffice = totalMinutes > 0 ? Math.round((officeMinutesTotal / totalMinutes) * 100) : 0;
    
    return {
        workDays: workDaysCount,
        sahaMin: sahaMinutesTotal,
        meetingMin: meetingMinutesTotal,
        officeMin: officeMinutesTotal,
        pctSaha,
        pctMeeting,
        pctOffice,
        stationDurations
    };
}

/**
 * PDF için Türkçe karakter destekli DejaVuSans fontunu hazırlar
 */
async function ensureFieldPdfFonts(doc) {
    if (typeof ensureAuditPdfFonts === 'function') {
        await ensureAuditPdfFonts(doc);
        return 'DejaVuSans';
    }
    try {
        if (typeof window._auditPdfFontCache === 'undefined') {
            window._auditPdfFontCache = null;
        }
        if (!window._auditPdfFontCache) {
            const fetchFont = async (url) => {
                const resp = await fetch(url);
                return await resp.arrayBuffer();
            };
            const toBase64 = (buf) => {
                let binary = '';
                const bytes = new Uint8Array(buf);
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary);
            };
            const [reg, bld] = await Promise.all([
                fetchFont('https://raw.githubusercontent.com/dompdf/dompdf/master/lib/fonts/DejaVuSans.ttf'),
                fetchFont('https://raw.githubusercontent.com/dompdf/dompdf/master/lib/fonts/DejaVuSans-Bold.ttf')
            ]);
            window._auditPdfFontCache = { regular: toBase64(reg), bold: toBase64(bld) };
        }
        doc.addFileToVFS('DejaVuSans.ttf', window._auditPdfFontCache.regular);
        doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
        doc.addFileToVFS('DejaVuSans-Bold.ttf', window._auditPdfFontCache.bold);
        doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
        return 'DejaVuSans';
    } catch (e) {
        console.warn('Field PDF font load warning:', e);
        return 'helvetica';
    }
}

/**
 * Kurumsal Personel Raporu sayfa üst bilgisi
 */
function drawReportHeaderAndFooterPortrait(doc, fontName, pageNumber, totalPages, pDetails, showRunningTitle = true) {
    doc.setFont(fontName, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text("METRO İSTANBUL", 10, 11);
    
    const nowStr = new Date().toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    doc.text(`Rapor Tarihi: ${nowStr}`, 200, 11, { align: 'right' });
    
    doc.setLineWidth(0.2);
    doc.setDrawColor(226, 232, 240);
    doc.line(10, 13, 200, 13);
    
    if (showRunningTitle) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(15, 23, 42);
        doc.text(`${pDetails.docTitleSuffix} PERSONEL ÇALIŞMA VERİLERİ`, 105, 19, { align: 'center' });
        
        doc.setLineWidth(0.4);
        doc.setDrawColor(71, 85, 105);
        doc.line(10, 22, 200, 22);
    }
    
    doc.setFont(fontName, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Sayfa: ${pageNumber} / ${totalPages}`, 105, 287, { align: 'center' });
    doc.text("Saha Denetim ve Performans Raporlama", 10, 287);
}

function drawReportHeaderAndFooterLandscape(doc, fontName, pageNumber, totalPages, pDetails) {
    doc.setFont(fontName, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text("METRO İSTANBUL", 10, 11);
    
    const nowStr = new Date().toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    doc.text(`Rapor Tarihi: ${nowStr}`, 287, 11, { align: 'right' });
    
    doc.setLineWidth(0.2);
    doc.setDrawColor(226, 232, 240);
    doc.line(10, 13, 287, 13);
    
    doc.setFont(fontName, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Sayfa: ${pageNumber} / ${totalPages}`, 148, 200, { align: 'center' });
    doc.text("Saha Denetim ve Performans Raporlama", 10, 200);
}

/**
 * 1. Haftalık/Aylık Performans Raporu (Görsel 1 ile Tam Uyumlu)
 */
async function exportFieldPerformancePDF() {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
        showToast('PDF kitaplığı yüklenemedi. Lütfen sayfayı yenileyin.');
        return;
    }
    
    try {
        const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
        const pDetails = getReportPeriodDetails(activeYear, activeMonth);
        const periodDays = pDetails.periodDays;
        
        showToast(`${pDetails.docTitleSuffix} Performans Raporu PDF formatında hazırlanıyor...`);
        
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const fontName = await ensureFieldPdfFonts(doc);
        
        let filteredUsers = (appData.users || []).filter(u => {
            const title = (u.title || u.jobTitle || '').toLowerCase();
            return title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
        });
        
        const usersWithStats = filteredUsers.map(user => {
            const stats = calculateUserMetricsForPeriod(user, activeYear, activeMonth, fieldSessionsCache, periodDays);
            return {
                user,
                stats,
                primaryLine: (user.primaryLine || user.line || 'M1').toUpperCase()
            };
        });
        
        const grouped = {};
        usersWithStats.forEach(item => {
            const lineName = item.primaryLine;
            if (!grouped[lineName]) grouped[lineName] = [];
            grouped[lineName].push(item);
        });
        
        const sortedLines = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'tr'));
        const bodyData = [];
        let counter = 1;
        
        sortedLines.forEach(lineName => {
            const grpHdr = [`${lineName} HATTI AMİRLERİ`, '', '', '', '', '', '', '', ''];
            grpHdr.isGroupHeader = true;
            grpHdr.lineName = lineName;
            bodyData.push(grpHdr);
            
            const lineUsers = grouped[lineName].sort((a, b) => a.user.name.localeCompare(b.user.name, 'tr'));
            
            lineUsers.forEach(item => {
                const u = item.user;
                const s = item.stats;
                
                const formatMin = (mins) => {
                    if (mins === 0) return '0 dk';
                    const hrs = Math.floor(mins / 60);
                    const rm = Math.round(mins % 60);
                    if (hrs > 0) return `${hrs} sa ${rm} dk`;
                    return `${rm} dk`;
                };
                
                const row = [
                    counter++,
                    u.name.toUpperCase(),
                    u.title || u.jobTitle || 'Hat Vardiya Amiri',
                    lineName,
                    s.workDays,
                    formatMin(s.sahaMin),
                    `%${s.pctSaha}`,
                    formatMin(s.officeMin),
                    `%${s.pctOffice}`
                ];
                row.isGroupHeader = false;
                bodyData.push(row);
            });
        });
        
        // Mavi Banner (Slick Modern Header)
        doc.setFillColor(30, 58, 138); // Deep Navy (#1e3a8a)
        doc.roundedRect(10, 15, 190, 16, 2, 2, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(10.5);
        
        const isTram = sortedLines.some(l => l.startsWith('T'));
        const lineType = isTram ? 'TRAMVAY' : 'METRO';
        let bannerTitle = '';
        if (pDetails.periodType === 'haftalik') {
            bannerTitle = `${lineType} HATTI HAFTALIK PERFORMANS RAPORU (${pDetails.docTitleSuffix})`;
        } else if (pDetails.periodType === 'aylik') {
            bannerTitle = `${lineType} HATTI AYLIK PERFORMANS RAPORU (${pDetails.docTitleSuffix})`;
        } else {
            bannerTitle = `${lineType} HATTI PERFORMANS RAPORU (${pDetails.docTitleSuffix})`;
        }
        doc.text(bannerTitle, 15, 25);
        
        // Rapor Aralığı
        doc.setTextColor(71, 85, 105);
        doc.setFont(fontName, 'normal');
        doc.setFontSize(8.5);
        doc.text(`Rapor Aralığı: ${pDetails.dateRangeStr}`, 10, 38);
        
        doc.setLineWidth(0.3);
        doc.setDrawColor(226, 232, 240);
        doc.line(10, 41, 200, 41);
        
        // Premium Tablo Çizimi
        doc.autoTable({
            startY: 44,
            head: [['NO', 'AD SOYAD', 'ÜNVAN', 'HAT', 'GÜN', 'SAHA SÜRESİ', '%SAHA', 'OFİS / İDARİ', '%OFİS']],
            body: bodyData,
            theme: 'striped',
            styles: {
                font: fontName,
                fontSize: 8,
                cellPadding: 3,
                valign: 'middle',
                textColor: [51, 65, 85],
                lineColor: [241, 245, 249],
                lineWidth: 0.1
            },
            headStyles: {
                font: fontName,
                fontStyle: 'bold',
                fillColor: [30, 58, 138],
                textColor: [255, 255, 255],
                fontSize: 8.5
            },
            columnStyles: {
                0: { halign: 'center', width: 10 },
                1: { halign: 'left', width: 35 },
                2: { halign: 'left', width: 35 },
                3: { halign: 'center', width: 12 },
                4: { halign: 'center', width: 12 },
                5: { halign: 'left', width: 24 },
                6: { halign: 'center', width: 15 },
                7: { halign: 'left', width: 24 },
                8: { halign: 'center', width: 15 }
            },
            didParseCell: function(data) {
                const rawRow = data.row.raw;
                if (rawRow && rawRow.isGroupHeader) {
                    data.cell.styles.fillColor = [239, 246, 255]; // Blue-50
                    data.cell.styles.textColor = [29, 78, 216]; // Blue-700
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize = 8.5;
                    data.cell.styles.cellPadding = 3.5;
                    if (data.column.index > 0) {
                        data.cell.text = '';
                    }
                } else if (rawRow && !rawRow.isGroupHeader) {
                    if (data.column.index === 5 || data.column.index === 6) {
                        data.cell.styles.textColor = [21, 128, 61]; // Green-700
                        data.cell.styles.fontStyle = 'bold';
                    }
                    if (data.column.index === 7 || data.column.index === 8) {
                        data.cell.styles.textColor = [29, 78, 216]; // Blue-700
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            },
            willDrawCell: function(data) {
                const rawRow = data.row.raw;
                if (rawRow && rawRow.isGroupHeader && data.column.index === 0) {
                    data.cell.width = 190;
                }
            },
            didDrawCell: function(data) {
                const rawRow = data.row.raw;
                if (rawRow && rawRow.isGroupHeader && data.column.index === 0) {
                    doc.setFillColor(37, 99, 235);
                    doc.rect(data.cell.x, data.cell.y, 2.5, data.cell.height, 'F');
                }
            },
            margin: { left: 10, right: 10, top: 28, bottom: 15 }
        });
        
        // Header & Footer Render
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            drawReportHeaderAndFooterPortrait(doc, fontName, i, totalPages, pDetails, i > 1);
        }
        
        doc.save(`saha_performans_raporu_${pDetails.periodName}.pdf`);
        showToast('Performans raporu PDF olarak indirildi.');
    } catch (err) {
        console.error('PDF error:', err);
        showToast('PDF raporu üretilirken hata oluştu.');
    }
}

/**
 * 2. Kurumsal Personel Çalışma Verileri (Görsel 3 ile Tam Uyumlu)
 */
async function exportFieldIndividualPDF() {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
        showToast('PDF kitaplığı yüklenemedi. Lütfen sayfayı yenileyin.');
        return;
    }
    
    try {
        const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
        const pDetails = getReportPeriodDetails(activeYear, activeMonth);
        const periodDays = pDetails.periodDays;
        
        showToast(`${pDetails.docTitleSuffix} Kurumsal Detay Raporu PDF formatında hazırlanıyor...`);
        
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const fontName = await ensureFieldPdfFonts(doc);
        
        let filteredUsers = (appData.users || []).filter(u => {
            const title = (u.title || u.jobTitle || '').toLowerCase();
            return title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
        });
        
        const usersWithStats = filteredUsers.map(user => {
            const stats = calculateUserMetricsForPeriod(user, activeYear, activeMonth, fieldSessionsCache, periodDays);
            return {
                user,
                stats,
                primaryLine: (user.primaryLine || user.line || 'M1').toUpperCase()
            };
        });
        
        const grouped = {};
        usersWithStats.forEach(item => {
            const lineName = item.primaryLine;
            if (!grouped[lineName]) grouped[lineName] = [];
            grouped[lineName].push(item);
        });
        
        const sortedLines = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'tr'));
        
        let currentY = 28;
        const pageHeightLimit = 270;
        const blockHeight = 44;
        const blockGap = 4;
        
        sortedLines.forEach(lineName => {
            if (currentY + 8 + blockHeight > pageHeightLimit) {
                doc.addPage();
                currentY = 28;
            }
            
            doc.setFont(fontName, 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(37, 99, 235);
            doc.text(`${lineName} HATTI AMİRLERİ`, 10, currentY);
            
            currentY += 5;
            
            const lineUsers = grouped[lineName].sort((a, b) => a.user.name.localeCompare(b.user.name, 'tr'));
            
            lineUsers.forEach(item => {
                if (currentY + blockHeight > pageHeightLimit) {
                    doc.addPage();
                    
                    doc.setFont(fontName, 'bold');
                    doc.setFontSize(8.5);
                    doc.setTextColor(37, 99, 235);
                    doc.text(`${lineName} HATTI AMİRLERİ (DEVAM)`, 10, 28);
                    currentY = 33;
                }
                
                const u = item.user;
                const stats = item.stats;
                const blockStartY = currentY;
                
                // --- SÜTUN 1: ÖZET BİLGİ KARTI ---
                doc.setFillColor(248, 250, 252); // Slate-50 background
                doc.roundedRect(10, blockStartY, 58, 44, 2, 2, 'F');
                doc.setFillColor(37, 99, 235); // Blue-600 left bar
                doc.rect(10, blockStartY, 1.5, 44, 'F');
                
                doc.setFont(fontName, 'bold');
                doc.setFontSize(8);
                doc.setTextColor(15, 23, 42);
                doc.text(u.name.toUpperCase(), 13, blockStartY + 5);
                
                doc.setFont(fontName, 'normal');
                doc.setFontSize(6.8);
                doc.setTextColor(100, 116, 139);
                doc.text(u.title || 'Hat Vardiya Amiri', 13, blockStartY + 9);
                
                doc.setLineWidth(0.15);
                doc.setDrawColor(226, 232, 240);
                doc.line(13, blockStartY + 11, 64, blockStartY + 11);
                
                const formatMinCompact = (mins) => {
                    const hrs = Math.floor(mins / 60);
                    const rm = Math.round(mins % 60);
                    if (hrs > 0) return `${hrs}sa ${rm}dk`;
                    return `${rm}dk`;
                };
                
                doc.setFont(fontName, 'normal');
                doc.setFontSize(7.2);
                doc.setTextColor(71, 85, 105);
                
                doc.text("Aylık Mesai:", 13, blockStartY + 17);
                doc.setFont(fontName, 'bold');
                doc.setTextColor(15, 23, 42);
                doc.text(`${stats.workDays} Gün`, 35, blockStartY + 17);
                
                doc.setFont(fontName, 'normal');
                doc.setTextColor(71, 85, 105);
                doc.text("Saha Süresi:", 13, blockStartY + 23);
                doc.setFont(fontName, 'bold');
                doc.setTextColor(22, 163, 74); // Green-600
                doc.text(`${formatMinCompact(stats.sahaMin)} (%${stats.pctSaha})`, 35, blockStartY + 23);
                
                doc.setFont(fontName, 'normal');
                doc.setTextColor(71, 85, 105);
                doc.text("Toplantı:", 13, blockStartY + 29);
                doc.setFont(fontName, 'bold');
                doc.setTextColor(147, 51, 234); // Purple-600
                doc.text(`${formatMinCompact(stats.meetingMin)} (%${stats.pctMeeting})`, 35, blockStartY + 29);
                
                doc.setFont(fontName, 'normal');
                doc.setTextColor(71, 85, 105);
                doc.text("Ofis / İdari:", 13, blockStartY + 35);
                doc.setFont(fontName, 'bold');
                doc.setTextColor(37, 99, 235); // Blue-600
                doc.text(`${formatMinCompact(stats.officeMin)} (%${stats.pctOffice})`, 35, blockStartY + 35);
                
                // --- SÜTUN 2: EN ÇOK ZİYARET EDİLENLER KARTI ---
                doc.setFillColor(239, 246, 255); // Blue-50 background
                doc.roundedRect(72, blockStartY, 62, 44, 2, 2, 'F');
                doc.setFillColor(59, 130, 246); // Blue-500 left bar
                doc.rect(72, blockStartY, 1.2, 44, 'F');
                
                doc.setFont(fontName, 'bold');
                doc.setFontSize(7.5);
                doc.setTextColor(29, 78, 216); // Blue-700
                doc.text("EN ÇOK ZİYARET EDİLENLER", 76, blockStartY + 5);
                
                const visitedList = Object.entries(stats.stationDurations).map(([name, data]) => ({
                    name,
                    minutes: data.minutes,
                    count: data.count
                }));
                const mostVisited = [...visitedList].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
                
                doc.setFont(fontName, 'normal');
                doc.setFontSize(6.8);
                doc.setTextColor(51, 65, 85);
                
                let mvY = blockStartY + 10;
                if (mostVisited.length === 0) {
                    doc.setFont(fontName, 'normal');
                    doc.setTextColor(148, 163, 184);
                    doc.text("• Ziyaret kaydı bulunmuyor.", 76, mvY);
                } else {
                    mostVisited.forEach(st => {
                        const trName = st.name.toUpperCase();
                        const displayName = trName.length > 15 ? trName.substring(0, 13) + '..' : trName;
                        
                        doc.setFont(fontName, 'normal');
                        doc.setTextColor(71, 85, 105);
                        doc.text(`• ${displayName}`, 76, mvY);
                        
                        doc.setFont(fontName, 'bold');
                        doc.setTextColor(29, 78, 216);
                        doc.text(`${st.count}g / ${formatMinCompact(st.minutes)}`, 131, mvY, { align: 'right' });
                        mvY += 4.5;
                    });
                }
                
                // --- SÜTUN 3: EN AZ VE HİÇ ZİYARET EDİLMEYEN KARTLARI ---
                // Üst Kart: En Az Ziyaret Edilenler
                doc.setFillColor(254, 242, 242); // Red-50 background
                doc.roundedRect(138, blockStartY, 62, 21, 2, 2, 'F');
                doc.setFillColor(239, 68, 68); // Red-500 left bar
                doc.rect(138, blockStartY, 1.2, 21, 'F');
                
                doc.setFont(fontName, 'bold');
                doc.setFontSize(7.2);
                doc.setTextColor(185, 28, 28); // Red-700
                doc.text("EN AZ ZİYARET EDİLENLER", 142, blockStartY + 4.5);
                
                const leastVisited = [...visitedList].sort((a, b) => a.count - b.count).slice(0, 3);
                
                doc.setFont(fontName, 'normal');
                doc.setFontSize(6.5);
                
                let lvY = blockStartY + 9;
                if (leastVisited.length === 0) {
                    doc.setTextColor(148, 163, 184);
                    doc.text("• Ziyaret kaydı bulunmuyor.", 142, lvY);
                } else {
                    leastVisited.forEach(st => {
                        const trName = st.name.toUpperCase();
                        const displayName = trName.length > 18 ? trName.substring(0, 16) + '..' : trName;
                        doc.setFont(fontName, 'normal');
                        doc.setTextColor(127, 29, 29);
                        doc.text(`• ${displayName}`, 142, lvY);
                        
                        doc.setFont(fontName, 'bold');
                        doc.text(`${st.count} kez`, 197, lvY, { align: 'right' });
                        lvY += 4.2;
                    });
                }
                
                // Alt Kart: Hiç Ziyaret Edilmeyenler
                doc.setFillColor(248, 250, 252); // Slate-50 background
                doc.roundedRect(138, blockStartY + 23, 62, 21, 2, 2, 'F');
                doc.setFillColor(100, 116, 139); // Slate-500 left bar
                doc.rect(138, blockStartY + 23, 1.2, 21, 'F');
                
                doc.setFont(fontName, 'bold');
                doc.setFontSize(7.2);
                doc.setTextColor(71, 85, 105);
                doc.text("HİÇ ZİYARET EDİLMEYENLER", 142, blockStartY + 27.5);
                
                const allLineStations = getSortedLineStations(item.primaryLine);
                const visitedNamesSet = new Set(visitedList.map(v => v.name.toLowerCase().trim()));
                const neverVisited = allLineStations.filter(stName => !visitedNamesSet.has(stName.toLowerCase().trim())).slice(0, 3);
                
                doc.setFont(fontName, 'normal');
                doc.setFontSize(6.5);
                doc.setTextColor(100, 116, 139);
                
                let nvY = blockStartY + 32;
                if (neverVisited.length === 0) {
                    doc.text("• Tüm istasyonlar ziyaret edildi.", 142, nvY);
                } else {
                    neverVisited.forEach(stName => {
                        const trName = stName.toUpperCase();
                        const displayName = trName.length > 22 ? trName.substring(0, 20) + '..' : trName;
                        doc.text(`• ${displayName}`, 142, nvY);
                        nvY += 4.2;
                    });
                }
                
                currentY += blockHeight + blockGap;
            });
            
            currentY += 4;
        });
        
        // Header & Footer Render
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            drawReportHeaderAndFooterPortrait(doc, fontName, i, totalPages, pDetails, true);
        }
        
        doc.save(`kurumsal_personel_calisma_verileri_${pDetails.periodName}.pdf`);
        showToast('Kurumsal detay raporu PDF olarak indirildi.');
    } catch (err) {
        console.error('Individual PDF error:', err);
        showToast('PDF raporu üretilirken hata oluştu.');
    }
}

/**
 * 3. Saha Süre Takip Matrisi (Yatay PDF Tablosu)
 */
async function exportFieldMatrixPDF() {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { showToast('PDF kitaplığı yüklenemedi.'); return; }
    
    try {
        const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
        const pDetails = getReportPeriodDetails(activeYear, activeMonth);
        const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
        
        showToast(`${pDetails.docTitleSuffix} Saha Süre Takip Matrisi PDF formatında hazırlanıyor...`);
        
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const fontName = await ensureFieldPdfFonts(doc);
        
        const headers = ['Personel', 'Ünvan'];
        for (let d = 1; d <= daysInMonth; d++) headers.push(`${d}`);
        headers.push('Toplam');
        
        let filteredUsers = (appData.users || []).filter(u => {
            const title = (u.title || u.jobTitle || '').toLowerCase();
            return (title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör')) && (fieldSessionsCache.some(s => s.userId === u.id) || getTitleMobilePermission(u.title || u.jobTitle, 'sahaTakip'));
        });
        
        const tableRows = [];
        filteredUsers.forEach(user => {
            const roster = fieldRosterCache[user.id] || {};
            const daysObj = roster.days || {};
            let totalMin = 0;
            const row = [user.name.toUpperCase(), user.title || 'Saha Personeli'];
            
            for (let d = 1; d <= daysInMonth; d++) {
                const shiftCode = daysObj[d] || '';
                const shiftStr = (typeof shiftCode === 'object' ? (shiftCode.shift || '') : shiftCode).toString();
                const isOff = ['İ', 'Yİ', 'R', 'OFF'].includes(shiftStr.toUpperCase());
                
                const session = fieldSessionsCache.find(s => {
                    let sDate = s.startTime || s.date;
                    if (sDate && !(sDate instanceof Date)) sDate = new Date(sDate);
                    return s.userId === user.id && sDate && sDate.getDate() === d && sDate.getFullYear() === activeYear && (sDate.getMonth() + 1) === activeMonth;
                });
                
                if (session) {
                    const duration = session.totalDuration || 0;
                    const hrs = Math.floor(duration / 60);
                    const rm = Math.round(duration % 60);
                    row.push(hrs > 0 ? `${hrs}s` : `${rm}d`);
                    totalMin += duration;
                } else if (isOff) {
                    row.push('OFF');
                } else {
                    row.push('—');
                }
            }
            
            const totalHrs = Math.floor(totalMin / 60);
            const totalRm = Math.round(totalMin % 60);
            row.push(totalHrs > 0 ? `${totalHrs}sa` : `${totalRm}dk`);
            tableRows.push(row);
        });
        
        doc.setFillColor(37, 99, 235);
        doc.rect(10, 12, 277, 14, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.text(`SAHA SÜRE TAKİP MATRİSİ (${pDetails.docTitleSuffix})`, 15, 21);
        
        doc.autoTable({
            startY: 32,
            head: [headers],
            body: tableRows,
            styles: {
                font: fontName,
                fontSize: 6.2,
                cellPadding: 1.5,
                valign: 'middle',
                halign: 'center',
                textColor: [51, 65, 85],
                lineWidth: 0.1,
                lineColor: [226, 232, 240]
            },
            columnStyles: {
                0: { halign: 'left', fontStyle: 'bold', width: 35 },
                1: { halign: 'left', width: 32 }
            },
            headStyles: { font: fontName, fontStyle: 'bold', fillColor: [37, 99, 235], textColor: [255, 255, 255] },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didDrawPage: function(data) {
                doc.setFont(fontName, 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(148, 163, 184);
                doc.text(`Sayfa: ${doc.internal.getNumberOfPages()} / ${doc.internal.getNumberOfPages()}`, 148, 200, { align: 'center' });
            },
            margin: { left: 10, right: 10, bottom: 15 }
        });
        
        doc.save(`saha_sure_takip_matrisi_${pDetails.periodName}.pdf`);
        showToast('Saha matris raporu PDF olarak indirildi.');
    } catch (err) {
        console.error(err);
        showToast('PDF raporu üretilirken hata oluştu.');
    }
}

/**
 * 4. İstasyon Ziyaret Analizi PDF Tablosu
 */
async function exportFieldStationPDF() {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { showToast('PDF kitaplığı yüklenemedi.'); return; }
    
    try {
        const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
        const pDetails = getReportPeriodDetails(activeYear, activeMonth);
        
        showToast(`${pDetails.docTitleSuffix} İstasyon Ziyaret Analiz Raporu PDF formatında hazırlanıyor...`);
        
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const fontName = await ensureFieldPdfFonts(doc);
        
        let stationStats = {};
        fieldSessionsCache.forEach(s => {
            if (Array.isArray(s.visits)) {
                s.visits.forEach(v => {
                    const st = v.stationName;
                    if (!stationStats[st]) stationStats[st] = { name: st, count: 0, total: 0, visitors: {} };
                    stationStats[st].count++;
                    stationStats[st].total += v.duration || 0;
                    stationStats[st].visitors[s.userName] = (stationStats[st].visitors[s.userName] || 0) + (v.duration || 0);
                });
            }
        });
        
        const stationData = [];
        let counter = 1;
        Object.values(stationStats).sort((a, b) => b.total - a.total).forEach(stat => {
            let topVisitor = '—';
            let topMin = 0;
            Object.entries(stat.visitors).forEach(([name, mins]) => {
                if (mins > topMin) { topVisitor = name; topMin = mins; }
            });
            
            const formatMin = (mins) => {
                const hrs = Math.floor(mins / 60);
                const rm = Math.round(mins % 60);
                if (hrs > 0) return `${hrs} sa ${rm} dk`;
                return `${rm} dk`;
            };
            
            stationData.push([
                counter++,
                stat.name.toUpperCase(),
                `${stat.count} Giriş`,
                formatMin(stat.total),
                `${Math.round(stat.total / stat.count)} dk`,
                topVisitor.toUpperCase()
            ]);
        });
        
        doc.setFillColor(168, 85, 247);
        doc.rect(10, 12, 190, 14, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.text(`İSTASYON BAZLI SAHA ZİYARET ANALİZİ (${pDetails.docTitleSuffix})`, 15, 21);
        
        doc.autoTable({
            startY: 32,
            head: [['NO', 'İSTASYON ADI', 'ZİYARET SAYISI', 'TOPLAM GEÇİRİLEN SÜRE', 'ORT. KALMA SÜRESİ', 'EN AKTİF ZİYARETÇİ']],
            body: stationData,
            styles: { font: fontName, fontSize: 8.5, cellPadding: 3.5, valign: 'middle', textColor: [51, 65, 85] },
            headStyles: { font: fontName, fontStyle: 'bold', fillColor: [168, 85, 247], textColor: [255, 255, 255] },
            alternateRowStyles: { fillColor: [250, 245, 255] },
            didDrawPage: function(data) {
                doc.setFont(fontName, 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(148, 163, 184);
                doc.text(`Sayfa: ${doc.internal.getNumberOfPages()} / ${doc.internal.getNumberOfPages()}`, 105, 287, { align: 'center' });
            }
        });
        
        doc.save(`istasyon_ziyaret_analizi_${pDetails.periodName}.pdf`);
        showToast('İstasyon analiz raporu PDF olarak indirildi.');
    } catch (err) {
        console.error(err);
        showToast('PDF raporu üretilirken hata oluştu.');
    }
}

/**
 * 5. Saha Performans Sıralaması (Liderlik PDF Tablosu)
 */
async function exportFieldRankingPDF() {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { showToast('PDF kitaplığı yüklenemedi.'); return; }
    
    try {
        const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
        const pDetails = getReportPeriodDetails(activeYear, activeMonth);
        const periodDays = pDetails.periodDays;
        
        showToast(`${pDetails.docTitleSuffix} Sıralama Raporu PDF formatında hazırlanıyor...`);
        
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const fontName = await ensureFieldPdfFonts(doc);
        
        let filteredUsers = (appData.users || []).filter(u => {
            const title = (u.title || u.jobTitle || '').toLowerCase();
            return title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
        });
        
        const rankings = filteredUsers.map(user => {
            const stats = calculateUserMetricsForPeriod(user, activeYear, activeMonth, fieldSessionsCache, periodDays);
            return {
                user,
                stats
            };
        }).sort((a, b) => b.stats.sahaMin - a.stats.sahaMin);
        
        const formatMin = (mins) => {
            const hrs = Math.floor(mins / 60);
            const rm = Math.round(mins % 60);
            if (hrs > 0) return `${hrs} sa ${rm} dk`;
            return `${rm} dk`;
        };
        
        const tableRows = rankings.map((r, idx) => [
            idx + 1 === 1 ? '🏆 1' : idx + 1 === 2 ? '🥈 2' : idx + 1 === 3 ? '🥉 3' : idx + 1,
            r.user.name.toUpperCase(),
            r.user.title || 'Vardiya Amiri',
            `${r.stats.workDays} Gün`,
            formatMin(r.stats.sahaMin),
            formatMin(r.stats.workDays > 0 ? Math.round(r.stats.sahaMin / r.stats.workDays) : 0),
            `%${r.stats.pctSaha}`,
            `%${r.stats.pctOffice}`
        ]);
        
        doc.setFillColor(245, 158, 11);
        doc.rect(10, 12, 190, 14, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.text(`SAHA PERFORMANS SIRALAMASI VE LİDERLİK TABLOSU (${pDetails.docTitleSuffix})`, 15, 21);
        
        doc.autoTable({
            startY: 32,
            head: [['SIRA', 'PERSONEL', 'ÜNVAN', 'AKTİF GÜN', 'TOPLAM SAHA', 'GÜNLÜK ORT. SAHA', 'SAHA %', 'OFİS %']],
            body: tableRows,
            styles: { font: fontName, fontSize: 8.5, cellPadding: 3.5, valign: 'middle', textColor: [51, 65, 85] },
            headStyles: { font: fontName, fontStyle: 'bold', fillColor: [245, 158, 11], textColor: [255, 255, 255] },
            alternateRowStyles: { fillColor: [255, 251, 240] },
            didDrawPage: function(data) {
                doc.setFont(fontName, 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(148, 163, 184);
                doc.text(`Sayfa: ${doc.internal.getNumberOfPages()} / ${doc.internal.getNumberOfPages()}`, 105, 287, { align: 'center' });
            }
        });
        
        doc.save(`saha_performans_siralama_${pDetails.periodName}.pdf`);
        showToast('Sıralama raporu PDF olarak indirildi.');
    } catch (err) {
        console.error(err);
        showToast('PDF raporu üretilirken hata oluştu.');
    }
}

/**
 * -----------------------------------------------------------------------------
 * TEST VE MOCK VERİ ÜRETİMİ ( Firestore'da kayıt yoksa render etmesi için )
 * -----------------------------------------------------------------------------
 */
function generateFieldTrackingMockData() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    console.log(`Generating Field Tracking Mock Data for ${month}/${year}...`);

    // Saha görevi yapan personel bul
    let fieldUsers = (appData.users || []).filter(u => {
        const title = (u.title || u.jobTitle || '').toLowerCase();
        return title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
    });

    // Eğer veri tabanında hiç kullanıcı yoksa veya saha personeli yoksa demo amaçlı geçici kullanıcılar kullanalım
    if (fieldUsers.length === 0) {
        fieldUsers = [
            { id: 'DEMO_USER_1', name: 'Ahmet Yılmaz', title: 'Saha Süpervizörü' },
            { id: 'DEMO_USER_2', name: 'Mehmet Kaya', title: 'Hat Vardiya Amiri' },
            { id: 'DEMO_USER_3', name: 'Elif Demir', title: 'Hat Vardiya Amiri' }
        ];
    }

    const daysInMonth = new Date(year, month, 0).getDate();

    // Bazı istasyon isimleri (koordinatlı olanlardan seçelim)
    const stations = [
        'Kızılay', 'Batıkent', 'Mesa', 'Akköprü', 'Çemberlitaş', 'Güngören', 'Taksim', 'Mecidiyeköy', 'Yenikapı'
    ];

    fieldUsers.forEach((user, uIdx) => {
        // Her kullanıcı için ay boyunca rastgele 15-20 gün saha seansı ekleyelim
        const activeDaysCount = 15 + (uIdx % 6); 
        const selectedDays = [];
        while (selectedDays.length < activeDaysCount) {
            const rDay = Math.floor(Math.random() * daysInMonth) + 1;
            if (!selectedDays.includes(rDay)) selectedDays.push(rDay);
        }

        selectedDays.forEach((day, dIdx) => {
            // Puantaj durumuna bak. İzinli olmasın
            const roster = fieldRosterCache[user.id] || {};
            const daysObj = roster.days || {};
            const shiftCode = daysObj[day] || 'G';
            const shiftStr = (typeof shiftCode === 'object' ? (shiftCode.shift || '') : shiftCode).toString();
            if (['İ', 'Yİ', 'R', 'OFF'].includes(shiftStr.toUpperCase())) return;

            // Giriş / çıkış saatleri (SS:DD)
            const entryHour = 8 + (dIdx % 2); // 8 veya 9
            const entryMin = Math.floor(Math.random() * 60);
            
            const exitHour = 16 + (dIdx % 2); // 16 veya 17
            const exitMin = Math.floor(Math.random() * 60);

            const startTime = new Date(year, month - 1, day, entryHour, entryMin);
            const endTime = new Date(year, month - 1, day, exitHour, exitMin);
            
            const totalDuration = Math.round((endTime - startTime) / 60000); // dakika bazında

            // Ziyaret edilecek istasyon adetleri
            const visitCount = 3 + (dIdx % 3); // 3-5 istasyon arası
            const visits = [];
            const travels = [];
            
            let lastExitTime = new Date(startTime.getTime() + 15 * 60000); // çıkıştan 15 dk sonra ilk istasyon

            for (let v = 0; v < visitCount; v++) {
                const stName = stations[(uIdx + dIdx + v) % stations.length];
                const entry = new Date(lastExitTime.getTime() + (10 + Math.random() * 20) * 60000); // 10-30 dk yolculuktan sonra giriş
                const exit = new Date(entry.getTime() + (45 + Math.random() * 90) * 60000); // 45-135 dk kalma
                const duration = Math.round((exit - entry) / 60000);

                visits.push({
                    stationId: `ST_${v}`,
                    stationName: stName,
                    entryTime: entry,
                    exitTime: exit,
                    duration: duration
                });

                if (v > 0) {
                    // Yolculuk detayı ekle
                    travels.push({
                        fromStation: visits[v-1].stationName,
                        toStation: stName,
                        startTime: visits[v-1].exitTime,
                        endTime: entry,
                        duration: Math.round((entry - visits[v-1].exitTime) / 60000)
                    });
                }

                lastExitTime = exit;
            }

            // GPS trail navigasyon izi mock
            const gpsTrail = [];
            // İstanbul/Ankara koordinatları etrafında rastgele noktalar
            const startLat = 41.0082 + (uIdx * 0.02);
            const startLng = 28.9784 + (dIdx * 0.02);
            for (let g = 0; g < 15; g++) {
                gpsTrail.push({
                    lat: startLat + (g * 0.002) + (Math.random() * 0.001),
                    lng: startLng + (g * 0.002) + (Math.random() * 0.001),
                    timestamp: new Date(startTime.getTime() + (g * 30) * 60000)
                });
            }

            rawFieldSessionsCache.push({
                id: `MOCK_SESSION_${user.id}_${day}`,
                userId: user.id,
                userName: user.name,
                userTitle: user.title || user.jobTitle || 'Saha Personeli',
                line: 'Tümü',
                date: new Date(year, month - 1, day),
                startTime: startTime,
                endTime: endTime,
                totalDuration: totalDuration,
                shiftCode: shiftCode,
                status: 'completed',
                visits: visits,
                travels: travels,
                gpsTrail: gpsTrail
            });
        });
    });
}

function getMonthWeekName(dayOfMonth) {
    if (dayOfMonth <= 7) return "1. Hafta (1-7)";
    if (dayOfMonth <= 14) return "2. Hafta (8-14)";
    if (dayOfMonth <= 21) return "3. Hafta (15-21)";
    if (dayOfMonth <= 28) return "4. Hafta (22-28)";
    return "5. Hafta (29+)";
}

function renderFieldTimeDistribution(container) {
    const sessions = fieldSessionsCache;
    
    // 1. Filtrelenmiş personel listesini çıkar
    const lineSelect = document.getElementById('field-filter-line');
    const userSelect = document.getElementById('field-filter-user');
    const selectedLines = lineSelect ? getMultiSelectValues(lineSelect) : [];
    const selectedUsers = userSelect ? getMultiSelectValues(userSelect) : [];
    
    let activeUsers = (appData.users || []).filter(u => {
        const title = (u.title || u.jobTitle || '').toLowerCase();
        return title.includes('vardiya') || title.includes('supervizor') || title.includes('süpervizör');
    });
    
    if (selectedUsers.length > 0) {
        activeUsers = activeUsers.filter(u => selectedUsers.includes(u.id));
    }
    if (selectedLines.length > 0) {
        activeUsers = activeUsers.filter(u => {
            const hasSessionOnLine = sessions.some(s => s.userId === u.id);
            const hasLineAccess = Array.isArray(u.authorizedLines) && u.authorizedLines.some(l => selectedLines.includes(l));
            return hasSessionOnLine || hasLineAccess;
        });
    }

    const { year: activeYear, month: activeMonth } = getFieldActiveYearAndMonth();
    const daysInMonth = new Date(activeYear, activeMonth, 0).getDate();
    
    // Haftalık, Kişi, Ünvan ve Hat bazında verileri gruplayacak yapı
    const weeklyData = {}; // "1. Hafta (1-7)" -> { saha: 0, meeting: 0, office: 0, workDays: 0 }
    const userData = {};   // userName -> { saha: 0, meeting: 0, office: 0, workDays: 0 }
    const titleData = {};  // title -> { saha: 0, meeting: 0, office: 0, workDays: 0 }
    const lineData = {};   // line -> { saha: 0, meeting: 0, office: 0, workDays: 0 }
    
    // Haftaları başlat
    for (let d = 1; d <= daysInMonth; d++) {
        const weekName = getMonthWeekName(d);
        if (!weeklyData[weekName]) {
            weeklyData[weekName] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
    }
    
    // Özet kartları için toplamlar
    let totalSahaHours = 0;
    let totalMeetingHours = 0;
    let totalOfficeHours = 0;
    let totalWorkDays = 0;

    activeUsers.forEach(user => {
        const rosterUser = fieldRosterCache[user.id] || {};
        const days = rosterUser.days || {};
        
        const title = user.title || user.jobTitle || 'Saha Amiri';
        if (!titleData[title]) {
            titleData[title] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
        
        const primaryLine = (Array.isArray(user.authorizedLines) && user.authorizedLines.length > 0) 
            ? user.authorizedLines[0] 
            : 'Tümü';
            
        if (!lineData[primaryLine]) {
            lineData[primaryLine] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
        
        if (!userData[user.name]) {
            userData[user.name] = { saha: 0, meeting: 0, office: 0, workDays: 0 };
        }
        
        for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = String(day);
            const dayData = days[dayKey];
            
            const daySessions = sessions.filter(s => {
                const sDate = s.startTime ? (s.startTime instanceof Date ? s.startTime : new Date(s.startTime)) : (s.date instanceof Date ? s.date : new Date(s.date));
                return s.userId === user.id && sDate && sDate.getDate() === day;
            });
            
            let sahaMinutes = 0;
            daySessions.forEach(s => {
                sahaMinutes += (s.totalDuration || 0);
            });
            
            let meetingMinutes = 0;
            let shiftCode = '';
            if (dayData) {
                meetingMinutes = dayData.hasMeeting ? (dayData.meetingDuration || 120) : 0;
                shiftCode = dayData.shift || '';
            }
            
            const shiftCodeLower = (shiftCode || '').toLowerCase();
            const isOffShift = ['i', 'yi', 'r', 'izin', 'rapor', 'tatil'].includes(shiftCodeLower) || shiftCodeLower.includes('izin');
            const worked = sahaMinutes > 0 || meetingMinutes > 0;
            const isWorkDay = worked || (shiftCode && !isOffShift);
            
            if (isWorkDay) {
                const shiftDuration = 480; // 8 saat = 480 dakika
                let officeMinutes = Math.max(0, shiftDuration - sahaMinutes - meetingMinutes);
                
                const sahaHours = sahaMinutes / 60;
                const meetingHours = meetingMinutes / 60;
                const officeHours = officeMinutes / 60;
                
                const weekName = getMonthWeekName(day);
                
                // Haftaya ekle
                weeklyData[weekName].saha += sahaHours;
                weeklyData[weekName].meeting += meetingHours;
                weeklyData[weekName].office += officeHours;
                weeklyData[weekName].workDays += 1;
                
                // Personele ekle
                userData[user.name].saha += sahaHours;
                userData[user.name].meeting += meetingHours;
                userData[user.name].office += officeHours;
                userData[user.name].workDays += 1;
                
                // Ünvana ekle
                titleData[title].saha += sahaHours;
                titleData[title].meeting += meetingHours;
                titleData[title].office += officeHours;
                titleData[title].workDays += 1;
                
                // Hatta ekle
                lineData[primaryLine].saha += sahaHours;
                lineData[primaryLine].meeting += meetingHours;
                lineData[primaryLine].office += officeHours;
                lineData[primaryLine].workDays += 1;

                // Genel toplamlara ekle
                totalSahaHours += sahaHours;
                totalMeetingHours += meetingHours;
                totalOfficeHours += officeHours;
                totalWorkDays += 1;
            }
        }
    });

    const totalHours = totalSahaHours + totalMeetingHours + totalOfficeHours;
    const totalShiftDays = totalWorkDays;
    
    // Sıfır olan boş ünvan veya hatları temizle
    Object.keys(titleData).forEach(k => { if (titleData[k].workDays === 0) delete titleData[k]; });
    Object.keys(lineData).forEach(k => { if (lineData[k].workDays === 0) delete lineData[k]; });
    Object.keys(userData).forEach(k => { if (userData[k].workDays === 0) delete userData[k]; });

    container.innerHTML = `
        <div class="field-stat-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
            <div class="field-stat-card">
                <div class="stat-label">
                    <span>Toplam Takip Edilen Gün</span>
                    <i class="fas fa-calendar-alt" style="color:var(--accent);"></i>
                </div>
                <h3 class="stat-value">${totalShiftDays} Gün/Kişi</h3>
                <small class="stat-desc">Filtrelenmiş toplam çalışma günü</small>
            </div>
            
            <div class="field-stat-card">
                <div class="stat-label">
                    <span>Ofis / İdari İşler</span>
                    <i class="fas fa-building" style="color:#3b82f6;"></i>
                </div>
                <h3 class="stat-value">${Math.round(totalOfficeHours)} Saat</h3>
                <small class="stat-desc">Toplam çalışma süresinin %${totalHours > 0 ? Math.round((totalOfficeHours / totalHours) * 100) : 0}'i</small>
            </div>

            <div class="field-stat-card">
                <div class="stat-label">
                    <span>Saha Faaliyeti</span>
                    <i class="fas fa-person-walking" style="color:#8b5cf6;"></i>
                </div>
                <h3 class="stat-value">${Math.round(totalSahaHours)} Saat</h3>
                <small class="stat-desc">Toplam çalışma süresinin %${totalHours > 0 ? Math.round((totalSahaHours / totalHours) * 100) : 0}'i</small>
            </div>

            <div class="field-stat-card">
                <div class="stat-label">
                    <span>Toplantı / Eğitim</span>
                    <i class="fas fa-users" style="color:#f59e0b;"></i>
                </div>
                <h3 class="stat-value">${Math.round(totalMeetingHours)} Saat</h3>
                <small class="stat-desc">Toplam çalışma süresinin %${totalHours > 0 ? Math.round((totalMeetingHours / totalHours) * 100) : 0}'i</small>
            </div>
        </div>

        <div class="field-chart-grid">
            <!-- Haftalık Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card">
                <h4><i class="fas fa-chart-bar mr-2" style="color:#8b5cf6;"></i>Haftalık Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-time-weekly"></canvas>
                </div>
            </div>

            <!-- Ünvan Bazlı Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card">
                <h4><i class="fas fa-users-gear mr-2" style="color:#3b82f6;"></i>Ünvan Bazlı Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-time-title"></canvas>
                </div>
            </div>

            <!-- Hat Bazlı Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card">
                <h4><i class="fas fa-route mr-2" style="color:#10b981;"></i>Hat Bazlı Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:300px; width:100%;">
                    <canvas id="chart-time-line"></canvas>
                </div>
            </div>

            <!-- Kişi Bazlı Zaman Dağılımı Dikey Grafik -->
            <div class="field-chart-card full-width">
                <h4><i class="fas fa-user-clock mr-2" style="color:#f59e0b;"></i>Kişi Bazlı Günlük Zaman Dağılımı (Orta. Günlük 8 Saat)</h4>
                <div style="position:relative; height:340px; width:100%;">
                    <canvas id="chart-time-user"></canvas>
                </div>
            </div>
        </div>
    `;

    setTimeout(() => {
        buildTimeDistributionCharts(weeklyData, userData, titleData, lineData);
    }, 50);
}

function buildTimeDistributionCharts(weeklyData, userData, titleData, lineData) {
    const isDark = !document.body.classList.contains('light-mode');
    const labelColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(71, 85, 105, 0.08)';

    const chartConfigs = [
        { id: 'chart-time-weekly', data: weeklyData },
        { id: 'chart-time-title', data: titleData },
        { id: 'chart-time-line', data: lineData },
        { id: 'chart-time-user', data: userData }
    ];

    chartConfigs.forEach(conf => {
        const ctx = document.getElementById(conf.id);
        if (!ctx) return;

        const labels = Object.keys(conf.data);
        const sahaHours = [];
        const meetingHours = [];
        const officeHours = [];

        labels.forEach(lbl => {
            const item = conf.data[lbl];
            const workDays = item.workDays || 1;
            
            const avgSaha = Math.round((item.saha / workDays) * 10) / 10;
            const avgMeeting = Math.round((item.meeting / workDays) * 10) / 10;
            const avgOffice = Math.round((item.office / workDays) * 10) / 10;

            sahaHours.push(avgSaha);
            meetingHours.push(avgMeeting);
            officeHours.push(avgOffice);
        });

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Saha Süresi (Saat)',
                        data: sahaHours,
                        backgroundColor: '#8b5cf6', // Purple
                        borderColor: '#7c3aed',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Toplantı / Eğitim (Saat)',
                        data: meetingHours,
                        backgroundColor: '#f59e0b', // Orange
                        borderColor: '#d97706',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Ofis / İdari (Saat)',
                        data: officeHours,
                        backgroundColor: '#2563eb', // Blue
                        borderColor: '#1d4ed8',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: labelColor, boxWidth: 10, font: { weight: 'bold', size: 9 } }
                    },
                    datalabels: {
                        color: '#fff',
                        font: { weight: 'bold', size: 9 },
                        formatter: (val) => val > 0.4 ? `${val}s` : ''
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: labelColor, font: { weight: 'bold', size: 10 } }
                    },
                    y: {
                        stacked: true,
                        grid: { color: gridColor },
                        ticks: { 
                            color: labelColor,
                            callback: (val) => `${val}s`
                        },
                        max: 12
                    }
                }
            }
        });
        fieldTrackingCharts.push(chart);
    });
}

