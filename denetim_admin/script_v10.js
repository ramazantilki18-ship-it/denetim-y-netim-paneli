
function pushDebug(msg) {
    // Debug disabled
}
// Firebase Configuration
const firebaseConfig = {
    apiKey: 'AIzaSyA34MWjv-08j5T5hlMhGPV2HzZo9kSqY8g',
    authDomain: 'fir-denetim-c6abc.firebaseapp.com',
    projectId: 'fir-denetim-c6abc',
    storageBucket: 'fir-denetim-c6abc.firebasestorage.app',
    messagingSenderId: '1009095169052',
    appId: '1:1009095169052:web:ac551e94b618a222907bd9'
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

// Register Chart.js Plugins
if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

// Enable offline persistence
db.enablePersistence()
  .catch(function(err) {
      if (err.code == 'failed-precondition') {
          console.warn('Multiple tabs open, persistence can only be enabled in one tab at a a time.');
      } else if (err.code == 'unimplemented') {
          console.warn('The current browser does not support all of the features required to enable persistence');
      }
  });

const auth = firebase.auth();
const SECONDARY_FIREBASE_APP_NAME = 'PersonnelAuthSecondary';

function getSecondaryAuth() {
    try {
        return firebase.app(SECONDARY_FIREBASE_APP_NAME).auth();
    } catch (err) {
        return firebase.initializeApp(firebaseConfig, SECONDARY_FIREBASE_APP_NAME).auth();
    }
}

function mapFirebaseAuthError(error) {
    const code = error?.code || '';
    if (code === 'auth/email-already-in-use') return 'Bu e-posta Firebase\'de zaten kayıtlı.';
    if (code === 'auth/invalid-email') return 'Geçersiz e-posta formatı.';
    if (code === 'auth/weak-password') return 'Firebase şifresi en az 6 karakter olmalıdır.';
    if (code === 'auth/wrong-password') return 'Firebase şifresi hatalı.';
    if (code === 'auth/network-request-failed') return 'Firebase bağlantı hatası. İnternet bağlantınızı kontrol edin.';
    return error?.message || 'Firebase Authentication hatası.';
}

/** Admin oturumunu bozmadan Firebase Auth kullanıcısı oluşturur veya mevcut hesabı doğrular. */
async function ensureFirebaseAuthUser(email, password) {
    const normalizedEmail = email.trim();
    const secondaryAuth = getSecondaryAuth();
    try {
        const credential = await secondaryAuth.createUserWithEmailAndPassword(normalizedEmail, password);
        const uid = credential.user.uid;
        await secondaryAuth.signOut();
        return uid;
    } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
            try {
                const credential = await secondaryAuth.signInWithEmailAndPassword(normalizedEmail, password);
                const uid = credential.user.uid;
                await secondaryAuth.signOut();
                return uid;
            } catch (signInErr) {
                await secondaryAuth.signOut().catch(() => {});
                throw new Error('Bu e-posta Firebase\'de kayıtlı ancak girilen şifre eşleşmiyor.');
            }
        }
        throw new Error(mapFirebaseAuthError(err));
    }
}


// Current User State
let currentUser = null;
let ncCurrentPage = 1;
let ncCurrentFilter = 'Açık';
let auditsCurrentPage = 1;
let ncDateSortDirection = 'desc';
let auditDateSortDirection = 'desc';
let auditScoreSortDirection = null;
const ITEMS_PER_PAGE = 10;
let parentAuditIdForNC = null;
let currentAuditId = null;

/** RBAC: 6 sistem rolü — global vs kısıtlı kapsam */
const RBAC_ROLES = [
    { id: 'Super_Admin', name: 'Süper Admin', isGlobal: true },
    { id: 'Executive_Viewer_Global', name: 'Ü.Yönetici', isGlobal: true },
    { id: 'Executive_Viewer_Restricted', name: 'Yönetici', isGlobal: false },
    { id: 'Approver', name: 'Onaylayıcı', isGlobal: false },
    { id: 'Field_Auditor_Action_Owner', name: 'Saha Denetçisi + Aksiyon Sorumlusu', isGlobal: false },
    { id: 'Field_Auditor', name: 'Saha Denetçisi', isGlobal: false }
];

/** Rol bazlı kapsam / yetki açıklamaları (personel formu) */
const RBAC_ROLE_SCOPE_INFO = {
    Super_Admin: {
        variant: 'global',
        icon: 'fa-shield-halved',
        label: 'Süper Admin',
        text: 'Tüm modüllerde tam yönetim yetkisi. Personel, yetki matrisi, soru bankası, hat tanımları ve sistem ayarları dahil tüm hatlarda sınırsız erişim. Hat ataması gerekmez.'
    },
    Executive_Viewer_Global: {
        variant: 'global',
        icon: 'fa-chart-line',
        label: 'Ü.Yönetici',
        text: 'Tüm hatlarda denetimleri ve uygunsuzlukları görür; denetim raporlarının ve uygunsuzluk detaylarının içine girebilir, tam görüntüleme yetkisi vardır. Dashboard, istatistik ve raporları görüntüler. Saha denetimi başlatma veya operasyonel düzenleme yetkisi yoktur. Hat ataması gerekmez.'
    },
    Approver: {
        variant: 'restricted',
        icon: 'fa-circle-check',
        label: 'Onaylayıcı',
        text: 'Atandığı hatlarda denetim ve uygunsuzluk kayıtlarını görür; uygunsuzluk onaylama ve kapatma süreçlerini yönetir. En az bir hat seçilmelidir.'
    },
    Field_Auditor_Action_Owner: {
        variant: 'restricted',
        icon: 'fa-clipboard-check',
        label: 'Saha Denetçisi + Aksiyon Sorumlusu',
        text: 'Atandığı hatlarda denetim başlatır, uygunsuzluk açar ve aksiyon kapatma süreçlerini yürütür. En az bir hat seçilmelidir.'
    },
    Field_Auditor: {
        variant: 'restricted',
        icon: 'fa-magnifying-glass',
        label: 'Saha Denetçisi',
        text: 'Atandığı hatlarda denetim gerçekleştirir; öncelikle kendi başlattığı denetim ve kayıtları görür. En az bir hat seçilmelidir.'
    },
    Executive_Viewer_Restricted: {
        variant: 'restricted',
        icon: 'fa-eye',
        label: 'Yönetici',
        text: 'Atandığı hatlarda denetimleri ve uygunsuzlukları görür; denetim raporlarının ve uygunsuzluk detaylarının içine girebilir, salt okunur görüntüleme yetkisi vardır. Dashboard, istatistik ve raporları görüntüler. Denetim başlatma veya uygunsuzluk müdahalesi yapamaz. En az bir hat seçilmelidir.'
    }
};

/** Yetki matrisi modülleri */
const RBAC_PERMISSION_MODULES = [
    { id: 'user_add_edit', label: 'Personel Ekle / Düzenle' },
    { id: 'user_delete', label: 'Personel Silme' },
    { id: 'perm_mgmt', label: 'Yetki Matrisi Düzenleme' },
    { id: 'question_mgmt', label: 'Soru Bankası Yönetimi' },
    { id: 'line_mgmt', label: 'Hat & İstasyon Yönetimi' },
    { id: 'planning', label: 'Denetim Planlama' },
    { id: 'announcement_mgmt', label: 'Duyuru Yönetimi' },
    { id: 'audit_start', label: 'Yeni Denetim Başlatma' },
    { id: 'nc_close', label: 'Uygunsuzluk Kapatma' },
    { id: 'nc_approve', label: 'Uygunsuzluk Onaylama' },
    { id: 'nc_share', label: 'Uygunsuzluk Paylaşma' },
    { id: 'dashboard_view', label: 'Dashboard Görüntüleme' },
    { id: 'stats_view', label: 'İstatistiksel Analiz' },
    { id: 'export_data', label: 'Excel / PDF Dışa Aktar' },
    { id: 'backup_data', label: 'Veri Yedeği (JSON)' },
    { id: 'settings', label: 'Sistem Ayarları' },
    { id: 'view_logs', label: 'Sistem Loglarını Görüntüleme' }
];

const LEGACY_ROLE_KEY_TO_RBAC = {
    'süper_admin': 'Super_Admin',
    super_admin: 'Super_Admin',
    superadmin: 'Super_Admin',
    'süper admin': 'Super_Admin',
    'super admin': 'Super_Admin',
    onaylayıcı: 'Approver',
    onaylayici: 'Approver',
    'saha_denetçisi': 'Field_Auditor',
    saha_denetçisi: 'Field_Auditor',
    saha_denetci: 'Field_Auditor',
    saha_denetcisi: 'Field_Auditor',
    'saha denetçisi': 'Field_Auditor',
    'saha denetcisi': 'Field_Auditor',
    'saha_denetçisi_aksiyon_sorumlusu': 'Field_Auditor_Action_Owner',
    'saha_denetcisi_aksiyon_sorumlusu': 'Field_Auditor_Action_Owner',
    'saha denetçisi aksiyon sorumlusu': 'Field_Auditor_Action_Owner',
    'saha denetcisi aksiyon sorumlusu': 'Field_Auditor_Action_Owner',
    yönetici: 'Executive_Viewer_Restricted',
    yonetici: 'Executive_Viewer_Restricted',
    'ü_yönetici': 'Executive_Viewer_Global',
    'u_yonetici': 'Executive_Viewer_Global',
    'ü.yönetici': 'Executive_Viewer_Global',
    'u.yonetici': 'Executive_Viewer_Global'
};

function buildFullPermissionMap(value = true) {
    const map = {};
    RBAC_PERMISSION_MODULES.forEach(mod => { map[mod.id] = value; });
    return map;
}

const DEFAULT_RBAC_PERMISSIONS = {
    Super_Admin: buildFullPermissionMap(true),
    Executive_Viewer_Global: {
        user_add_edit: false, user_delete: false, perm_mgmt: false, question_mgmt: false, line_mgmt: false,
        planning: false, announcement_mgmt: false, audit_start: false, nc_close: false, nc_approve: false, nc_share: true,
        dashboard_view: true, stats_view: true, export_data: true, backup_data: false, settings: false, view_logs: true
    },
    Executive_Viewer_Restricted: {
        user_add_edit: false, user_delete: false, perm_mgmt: false, question_mgmt: false, line_mgmt: false,
        planning: false, announcement_mgmt: false, audit_start: false, nc_close: false, nc_approve: false, nc_share: false,
        dashboard_view: true, stats_view: true, export_data: true, backup_data: false, settings: false, view_logs: false
    },
    Approver: {
        user_add_edit: false, user_delete: false, perm_mgmt: false, question_mgmt: false, line_mgmt: false,
        planning: true, announcement_mgmt: false, audit_start: true, nc_close: true, nc_approve: true, nc_share: true,
        dashboard_view: true, stats_view: true, export_data: true, backup_data: false, settings: false, view_logs: false
    },
    Field_Auditor_Action_Owner: {
        user_add_edit: false, user_delete: false, perm_mgmt: false, question_mgmt: false, line_mgmt: false,
        planning: true, announcement_mgmt: false, audit_start: true, nc_close: true, nc_approve: false, nc_share: true,
        dashboard_view: true, stats_view: true, export_data: true, backup_data: false, settings: false, view_logs: false
    },
    Field_Auditor: {
        user_add_edit: false, user_delete: false, perm_mgmt: false, question_mgmt: false, line_mgmt: false,
        planning: false, announcement_mgmt: false, audit_start: true, nc_close: false, nc_approve: false, nc_share: true,
        dashboard_view: true, stats_view: false, export_data: false, backup_data: false, settings: false, view_logs: false
    }
};

function getDefaultPermissionsForRole(roleId) {
    return { ...(DEFAULT_RBAC_PERMISSIONS[roleId] || buildFullPermissionMap(false)) };
}

function resolveRbacRoleKey(key) {
    if (!key) return null;
    if (RBAC_ROLES.some(r => r.id === key)) return key;
    const normalized = String(key).trim().toLocaleLowerCase('tr-TR');
    return LEGACY_ROLE_KEY_TO_RBAC[normalized] || null;
}

function normalizeRolePermissions(raw) {
    const normalized = {};
    RBAC_ROLES.forEach(role => {
        normalized[role.id] = getDefaultPermissionsForRole(role.id);
    });
    if (!raw || typeof raw !== 'object') return normalized;

    Object.entries(raw).forEach(([key, perms]) => {
        const rbacId = resolveRbacRoleKey(key);
        if (!rbacId || !perms || typeof perms !== 'object') return;
        RBAC_PERMISSION_MODULES.forEach(mod => {
            if (perms[mod.id] !== undefined) {
                normalized[rbacId][mod.id] = !!perms[mod.id];
            }
        });
    });
    normalized.Super_Admin = buildFullPermissionMap(true);
    return normalized;
}

function hasPermission(permId, user = currentUser) {
    if (!permId || !user) return false;
    const roleId = inferRbacRoleId(user);
    if (roleId === 'Super_Admin') return true;
    const rolePerms = appData.rolePermissions?.[roleId];
    if (rolePerms && rolePerms[permId] !== undefined) return !!rolePerms[permId];
    return !!getDefaultPermissionsForRole(roleId)[permId];
}

function canManagePermissions(user = currentUser) {
    return hasPermission('perm_mgmt', user);
}

function isSuperAdmin(user = currentUser) {
    return inferRbacRoleId(user) === 'Super_Admin';
}

const FIELD_AUDITOR_WEB_VIEWS = new Set(['audits-view', 'nc-management-view']);
const ACTION_OWNER_WEB_VIEWS = new Set(['audits-view', 'nc-management-view', 'planning-view']);

function isFieldAuditor(user = currentUser) {
    return inferRbacRoleId(user) === 'Field_Auditor';
}

function isFieldAuditorActionOwner(user = currentUser) {
    return inferRbacRoleId(user) === 'Field_Auditor_Action_Owner';
}

function canOperationalRoleAccessView(viewId, user = currentUser) {
    if (isFieldAuditor(user)) {
        if (FIELD_AUDITOR_WEB_VIEWS.has(viewId)) return true;
        if ((viewId === 'stats-view' || viewId === 'reports-view') && hasPermission('stats_view', user)) return true;
        if (viewId === 'dashboard-view' && hasPermission('dashboard_view', user)) return true;
        return false;
    }
    if (isFieldAuditorActionOwner(user)) {
        if (ACTION_OWNER_WEB_VIEWS.has(viewId)) return true;
        if ((viewId === 'stats-view' || viewId === 'reports-view') && hasPermission('stats_view', user)) return true;
        if (viewId === 'dashboard-view' && hasPermission('dashboard_view', user)) return true;
        return false;
    }
    return true;
}

const ROLE_TITLE_TO_RBAC = {
    'Süper Admin': 'Super_Admin',
    'Super Admin': 'Super_Admin',
    'Ü.Yönetici': 'Executive_Viewer_Global',
    'U.Yonetici': 'Executive_Viewer_Global',
    'Yönetici': 'Executive_Viewer_Restricted',
    'Yonetici': 'Executive_Viewer_Restricted',
    'Onaylayıcı': 'Approver',
    'Onaylayici': 'Approver',
    'Saha Denetçisi + Aksiyon Sorumlusu': 'Field_Auditor_Action_Owner',
    'Saha Denetcisi + Aksiyon Sorumlusu': 'Field_Auditor_Action_Owner',
    'Saha Denetçisi': 'Field_Auditor',
    'Saha Denetcisi': 'Field_Auditor'
};

let personnelSelectedLines = [];
let announcementSelectedLines = [];

let appData = {
    lineColors: {
        'M1': '#E31E24', 'M2': '#009543', 'M3': '#009FE3',
        'M4': '#E91E63', 'M5': '#9C27B0', 'M6': '#B9A15E', 'M7': '#F29100',
        'M8': '#003D88', 'M9': '#EDD500', 'T1': '#003D88', 'T4': '#F29100',
        'T5': '#9C27B0', 'F1': '#333333', 'TF1': '#795548', 'TF2': '#795548'
    },
    lines: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'T1', 'T4', 'T5', 'F1', 'TF1', 'TF2'],
    stations: JSON.parse(JSON.stringify(DEFAULT_STATIONS)),
    stationNumbers: JSON.parse(JSON.stringify(DEFAULT_STATION_NUMBERS)),
    audits: [],
    nonconformities: [],
    users: [
        { name: 'Ramazan Tilki', role: 'Onaylayıcı', audits: 0, avgScore: 0 }
    ],
    auditTypes: [],
    questionGroups: [],
    questions: [],
    announcements: [],
    plans: [],
    systemLogs: [],
    selectedGroupId: null,
    currentPlanTab: 'all',
    collapsedUsers: {},
    selectedAuditIds: new Set(),
    selectedNCIds: new Set(),
    settings: {}
};

const DEFAULT_SYSTEM_SETTINGS = {
    darkMode: true,
    themePreferenceSaved: true,
    autoSync: true,
    orgName: 'Metro İstanbul',
    panelTitle: 'Denetim Sistemi',
    language: 'tr',
    passScore: 80,
    criticalThreshold: 3,
    auditPeriod: 'monthly',
    signatureRequired: false,
    ncCloseDays: 15,
    ncWarningDays: 3,
    ncApprovalRequired: true,
    reopenRejected: true,
    reportFormat: 'pdf',
    reportFooter: 'Metro İstanbul Denetim Sistemi',
    reportLogo: true,
    reportEvidence: true,
    overdueAlerts: true,
    planReminders: true,
    reminderTime: '09:00',
    offlineCache: true,
    retentionMonths: 36
};

// Charts
let performanceChart, categoryChart, auditorChart, statsTrendChart, statsLineDistChart, statsNcStatusChart, statsCategorySuccessChart;

// Unified Date Filter Configurations for Dashboard, Stats, Audits, and NC Pages
const unifiedDateFilters = {
    dashboard: { years: [], months: [], weeks: [], days: [], activeTab: 'year', labelId: 'unified-date-label', containerId: 'custom-options-unified-date', applyFn: () => renderAll() },
    stats: { years: [], months: [], weeks: [], days: [], activeTab: 'year', labelId: 'stats-unified-date-label', containerId: 'custom-options-stats-unified-date', applyFn: () => updateStats() },
    audits: { years: [], months: [], weeks: [], days: [], activeTab: 'year', labelId: 'audits-unified-date-label', containerId: 'custom-options-audits-unified-date', applyFn: () => renderAllAuditsTable() },
    nc: { years: [], months: [], weeks: [], days: [], activeTab: 'year', labelId: 'nc-unified-date-label', containerId: 'custom-options-nc-unified-date', applyFn: () => renderNCs() }
};

function getISOWeekNumber(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000
                          - 3 + (week1.getDay() + 6) % 7) / 7);
}

function getLocalDateString(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function switchDateTab(pageName = 'dashboard', tabName, e) {
    if (e) e.stopPropagation();
    unifiedDateFilters[pageName].activeTab = tabName;
    renderUnifiedDateOptions(pageName);
}

function toggleUnifiedDateItem(pageName = 'dashboard', type, value, checked) {
    const filter = unifiedDateFilters[pageName];
    if (type === 'year') {
        if (checked) {
            if (!filter.years.includes(value)) filter.years.push(value);
        } else {
            filter.years = filter.years.filter(y => y !== value);
        }
    } else if (type === 'month') {
        if (checked) {
            if (!filter.months.includes(value)) filter.months.push(value);
        } else {
            filter.months = filter.months.filter(m => m !== value);
        }
    } else if (type === 'week') {
        if (checked) {
            if (!filter.weeks.includes(value)) filter.weeks.push(value);
        } else {
            filter.weeks = filter.weeks.filter(w => w !== value);
        }
    } else if (type === 'day') {
        if (checked) {
            if (!filter.days.includes(value)) filter.days.push(value);
        } else {
            filter.days = filter.days.filter(d => d !== value);
        }
    }
    const sumEl = document.querySelector(`#${filter.containerId} .date-summary-text`);
    if (sumEl) sumEl.innerText = getUnifiedDateSummary(pageName);
}

function getUnifiedDateSummary(pageName = 'dashboard') {
    const filter = unifiedDateFilters[pageName];
    const parts = [];
    if (filter.years.length > 0) parts.push(`${filter.years.length} Yıl`);
    if (filter.months.length > 0) parts.push(`${filter.months.length} Ay`);
    if (filter.weeks.length > 0) parts.push(`${filter.weeks.length} Hf`);
    if (filter.days.length > 0) parts.push(`${filter.days.length} Gün`);
    return parts.length > 0 ? parts.join(', ') : 'Tüm Zamanlar';
}

function clearUnifiedDateFilters(pageName = 'dashboard', e) {
    if (e) e.stopPropagation();
    const filter = unifiedDateFilters[pageName];
    filter.years = [];
    filter.months = [];
    filter.weeks = [];
    filter.days = [];
    renderUnifiedDateOptions(pageName);
    updateUnifiedDateTriggerLabel(pageName);
}

function applyUnifiedDateFilters(pageName = 'dashboard', e) {
    if (e) e.stopPropagation();
    updateUnifiedDateTriggerLabel(pageName);
    const card = document.getElementById(unifiedDateFilters[pageName].containerId);
    if (card) card.style.display = 'none';
    if (typeof unifiedDateFilters[pageName].applyFn === 'function') {
        unifiedDateFilters[pageName].applyFn();
    }
}

function updateUnifiedDateTriggerLabel(pageName = 'dashboard') {
    const filter = unifiedDateFilters[pageName];
    const label = document.getElementById(filter.labelId);
    if (!label) return;
    label.innerText = getUnifiedDateSummary(pageName);
}

function renderUnifiedDateOptions(pageName = 'dashboard') {
    const filter = unifiedDateFilters[pageName];
    const container = document.getElementById(filter.containerId);
    if (!container) return;

    const audits = getFilteredAudits() || [];
    
    const yearsSet = new Set();
    const months = [
        { value: '1', text: 'Ocak' },
        { value: '2', text: 'Şubat' },
        { value: '3', text: 'Mart' },
        { value: '4', text: 'Nisan' },
        { value: '5', text: 'Mayıs' },
        { value: '6', text: 'Haziran' },
        { value: '7', text: 'Temmuz' },
        { value: '8', text: 'Ağustos' },
        { value: '9', text: 'Eylül' },
        { value: '10', text: 'Ekim' },
        { value: '11', text: 'Kasım' },
        { value: '12', text: 'Aralık' }
    ];
    
    const weeksSet = new Set();
    const daysSet = new Set();

    audits.forEach(audit => {
        if (!audit.date) return;
        const d = new Date(audit.date);
        if (isNaN(d.getTime())) return;
        
        const y = d.getFullYear().toString();
        yearsSet.add(y);
        
        const w = getISOWeekNumber(d);
        weeksSet.add(w);
        
        const localDateStr = getLocalDateString(audit.date);
        if (localDateStr) daysSet.add(localDateStr);
    });

    const years = [...yearsSet].sort((a, b) => b.localeCompare(a));
    const weeks = [...weeksSet].sort((a, b) => a - b);
    const days = [...daysSet].sort((a, b) => b.localeCompare(a));

    const activeTab = filter.activeTab || 'year';
    let listHtml = '';
    
    if (activeTab === 'year') {
        if (years.length === 0) {
            listHtml = '<div style="color:var(--text-dim);font-size:0.75rem;padding:0.5rem;text-align:center;">Veri bulunamadı.</div>';
        } else {
            years.forEach(y => {
                const checked = filter.years.includes(y) ? 'checked' : '';
                listHtml += `
                    <label style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.55rem;border-radius:6px;cursor:pointer;font-size:0.76rem;" class="custom-option-item" onclick="event.stopPropagation();">
                        <input type="checkbox" ${checked} onchange="toggleUnifiedDateItem('${pageName}', 'year', '${y}', this.checked)" style="width:14px;height:14px;accent-color:#f97316;">
                        <span style="color:var(--text-primary);">${y}</span>
                    </label>
                `;
            });
        }
    } else if (activeTab === 'month') {
        months.forEach(m => {
            const checked = filter.months.includes(m.value) ? 'checked' : '';
            listHtml += `
                <label style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.55rem;border-radius:6px;cursor:pointer;font-size:0.76rem;" class="custom-option-item" onclick="event.stopPropagation();">
                    <input type="checkbox" ${checked} onchange="toggleUnifiedDateItem('${pageName}', 'month', '${m.value}', this.checked)" style="width:14px;height:14px;accent-color:#f97316;">
                    <span style="color:var(--text-primary);">${m.text}</span>
                </label>
            `;
        });
    } else if (activeTab === 'week') {
        if (weeks.length === 0) {
            listHtml = '<div style="color:var(--text-dim);font-size:0.75rem;padding:0.5rem;text-align:center;">Veri bulunamadı.</div>';
        } else {
            weeks.forEach(w => {
                const checked = filter.weeks.includes(w.toString()) ? 'checked' : '';
                listHtml += `
                    <label style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.55rem;border-radius:6px;cursor:pointer;font-size:0.76rem;" class="custom-option-item" onclick="event.stopPropagation();">
                        <input type="checkbox" ${checked} onchange="toggleUnifiedDateItem('${pageName}', 'week', '${w}', this.checked)" style="width:14px;height:14px;accent-color:#f97316;">
                        <span style="color:var(--text-primary);">Hafta ${w}</span>
                    </label>
                `;
            });
        }
    } else if (activeTab === 'day') {
        if (days.length === 0) {
            listHtml = '<div style="color:var(--text-dim);font-size:0.75rem;padding:0.5rem;text-align:center;">Veri bulunamadı.</div>';
        } else {
            days.forEach(dayStr => {
                const checked = filter.days.includes(dayStr) ? 'checked' : '';
                const parts = dayStr.split('-');
                const displayDay = `${parts[2]}.${parts[1]}.${parts[0]}`;
                listHtml += `
                    <label style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.55rem;border-radius:6px;cursor:pointer;font-size:0.76rem;" class="custom-option-item" onclick="event.stopPropagation();">
                        <input type="checkbox" ${checked} onchange="toggleUnifiedDateItem('${pageName}', 'day', '${dayStr}', this.checked)" style="width:14px;height:14px;accent-color:#f97316;">
                        <span style="color:var(--text-primary);">${displayDay}</span>
                    </label>
                `;
            });
        }
    }
    
    container.innerHTML = `
        <div style="display: flex; gap: 4px; border-bottom: 1px solid var(--border-main); margin-bottom: 0.6rem; padding-bottom: 0.4rem;">
            <button type="button" class="date-tab-btn" onclick="switchDateTab('${pageName}', 'year', event)" style="flex: 1; background: ${activeTab === 'year' ? 'rgba(249, 115, 22, 0.16)' : 'transparent'}; border: 1px solid ${activeTab === 'year' ? 'rgba(249, 115, 22, 0.3)' : 'transparent'}; color: ${activeTab === 'year' ? '#f97316' : 'var(--text-dim)'}; font-size: 0.75rem; font-weight: 700; cursor: pointer; padding: 0.35rem; border-radius: 6px; transition: all 0.2s;">Yıl</button>
            <button type="button" class="date-tab-btn" onclick="switchDateTab('${pageName}', 'month', event)" style="flex: 1; background: ${activeTab === 'month' ? 'rgba(249, 115, 22, 0.16)' : 'transparent'}; border: 1px solid ${activeTab === 'month' ? 'rgba(249, 115, 22, 0.3)' : 'transparent'}; color: ${activeTab === 'month' ? '#f97316' : 'var(--text-dim)'}; font-size: 0.75rem; font-weight: 700; cursor: pointer; padding: 0.35rem; border-radius: 6px; transition: all 0.2s;">Ay</button>
            <button type="button" class="date-tab-btn" onclick="switchDateTab('${pageName}', 'week', event)" style="flex: 1; background: ${activeTab === 'week' ? 'rgba(249, 115, 22, 0.16)' : 'transparent'}; border: 1px solid ${activeTab === 'week' ? 'rgba(249, 115, 22, 0.3)' : 'transparent'}; color: ${activeTab === 'week' ? '#f97316' : 'var(--text-dim)'}; font-size: 0.75rem; font-weight: 700; cursor: pointer; padding: 0.35rem; border-radius: 6px; transition: all 0.2s;">Hafta</button>
            <button type="button" class="date-tab-btn" onclick="switchDateTab('${pageName}', 'day', event)" style="flex: 1; background: ${activeTab === 'day' ? 'rgba(249, 115, 22, 0.16)' : 'transparent'}; border: 1px solid ${activeTab === 'day' ? 'rgba(249, 115, 22, 0.3)' : 'transparent'}; color: ${activeTab === 'day' ? '#f97316' : 'var(--text-dim)'}; font-size: 0.75rem; font-weight: 700; cursor: pointer; padding: 0.35rem; border-radius: 6px; transition: all 0.2s;">Gün</button>
        </div>
        <div class="date-tab-content" style="max-height: 200px; overflow-y: auto; padding-right: 2px; margin-bottom: 0.8rem;" class="custom-scrollbar">
            ${listHtml}
        </div>
        <div style="border-top: 1px solid var(--border-main); padding-top: 0.6rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
            <span class="date-summary-text" style="font-size: 0.65rem; color: var(--text-dim); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${getUnifiedDateSummary(pageName)}</span>
            <div style="display: flex; gap: 4px;">
                <button type="button" onclick="clearUnifiedDateFilters('${pageName}', event)" style="background: transparent; border: 1px dashed rgba(239, 68, 68, 0.4); color: #ef4444; font-size: 0.7rem; font-weight: 700; padding: 0.3rem 0.5rem; border-radius: 6px; cursor: pointer; transition: all 0.2s;">Temizle</button>
                <button type="button" onclick="applyUnifiedDateFilters('${pageName}', event)" style="background: #f97316; border: none; color: white; font-size: 0.7rem; font-weight: 800; padding: 0.3rem 0.6rem; border-radius: 6px; cursor: pointer; transition: all 0.2s;">Uygula</button>
            </div>
        </div>
    `;
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    normalizeDashboardStatLayout();

    // Apply theme preference on startup
    const localDarkMode = localStorage.getItem('darkMode');
    const defaultDark = true;
    const isDark = localDarkMode !== null ? (localDarkMode === 'true') : defaultDark;
    document.body.classList.toggle('light-mode', !isDark);
    updateThemeIcon();

    // Apply compact sidebar preference on startup
    const isCompact = localStorage.getItem('compactSidebar') === 'true';
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && isCompact) {
        sidebar.classList.add('compact');
    }
    updateSidebarToggleIcon(isCompact);

    initAuthListener();
    initPersonnelRoleSelect();
    initAnnouncementAutoRefresh();
});

function initAuthListener() {
    // Başlangıçta her şeyi gizle
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-overlay').style.display = 'none';

    firebase.auth().onAuthStateChanged(async (user) => {
        pushDebug('onAuthStateChanged fired! user: ' + (user ? user.email : 'null'));
        const loginOverlay = document.getElementById('login-overlay');
        const mainApp = document.getElementById('main-app');

        if (user) {
            console.log('Aktif oturum bulundu:', user.email);
            await loadUserProfile(user);
            loginOverlay.style.display = 'none';
        mainApp.style.display = 'flex';
        pushDebug('loginOverlay hidden and mainApp flexed!');
            pushDebug('Calling initRealtimeSync...');
            initRealtimeSync();
            pushDebug('initRealtimeSync returned!');
        } else {
            console.log('Oturum yok, giriş ekranına yönlendiriliyor.');
            loginOverlay.style.display = 'flex';
            mainApp.style.display = 'none';
            currentUser = null;
            
            // Giriş butonunun yükleniyor durumunu sıfırla
            const loginBtn = document.querySelector('.login-btn');
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = 'GİRİŞ YAP';
            }
        }
    });
}

async function loadUserProfile(firebaseUser) {
    pushDebug('loadUserProfile called for: ' + firebaseUser.uid);
    try {
        pushDebug('Fetching user doc from Firestore...');
        const doc = await db.collection('users').doc(firebaseUser.uid).get();
        pushDebug('User doc fetched! exists: ' + doc.exists);
        if (doc.exists) {
            currentUser = { id: firebaseUser.uid, ...doc.data() };
        } else {
            pushDebug('Calling findExistingUserProfile...');
            currentUser = await findExistingUserProfile(firebaseUser);
            pushDebug('findExistingUserProfile returned!');
            if (!currentUser) {
            const isAdmin = firebaseUser.email && (
                firebaseUser.email.toLowerCase().includes('admin') ||
                firebaseUser.email === 'ramazan@test.com' ||
                firebaseUser.email === 'ramazan.tilki@metro.istanbul'
            );
            let defaultRoleId = 'Field_Auditor_Action_Owner';
            const emailLower = (firebaseUser.email || '').toLowerCase();
            if (isAdmin) {
                defaultRoleId = 'Super_Admin';
            } else if (emailLower.includes('yonetici') || emailLower.includes('yönetici')) {
                defaultRoleId = 'Executive_Viewer_Restricted';
            } else if (emailLower.includes('onay') || emailLower.includes('approver') || emailLower.includes('koordinat')) {
                defaultRoleId = 'Approver';
            } else if (emailLower.includes('denetci') || emailLower.includes('denetçi') || emailLower.includes('auditor')) {
                defaultRoleId = 'Field_Auditor';
            }
            const defaultRole = getRbacRoleById(defaultRoleId);
            currentUser = {
                id: firebaseUser.uid,
                username: firebaseUser.email.split('@')[0],
                email: firebaseUser.email,
                roleId: defaultRoleId,
                roleName: defaultRole.name,
                title: defaultRole.name,
                role: getLegacyRoleFromRbac(defaultRoleId),
                scopeType: defaultRole.isGlobal ? 'global' : 'restricted',
                isGlobalScope: defaultRole.isGlobal,
                authorizedLines: [],
                authorizedStations: [],
                createdAt: new Date().toISOString()
            };
            // Otomatik olarak Firestore'a kaydet
            pushDebug('Saving new user doc...');
            await db.collection('users').doc(firebaseUser.uid).set(currentUser);
            pushDebug('New user doc saved!');
            console.log('Yeni kullanıcı profili otomatik oluşturuldu.');
            }
        }

        // UI Güncelleme
        const name = currentUser.username || currentUser.name || 'K';
        document.getElementById('user-display-name').textContent = name;
        document.getElementById('user-display-role').textContent = getRbacRoleDisplayName(currentUser);
        document.getElementById('user-display-lines').textContent = getUserLineSummary(currentUser);
        renderUserLineLogos(currentUser);
        pushDebug('updatePermissionGatedUI called...');
        updatePermissionGatedUI();
        if (isFieldAuditor(currentUser) || isFieldAuditorActionOwner(currentUser)) {
            switchView('audits-view');
        }

        // Force refresh matrix if we are on that view
        if (document.getElementById('permissions-view').style.display !== 'none') {
            renderPermissions();
        }

    } catch (err) {
        console.error('Profile load error:', err);
    }
}

function getRbacRoleById(roleId) {
    return RBAC_ROLES.find(r => r.id === roleId) || null;
}

function inferRbacRoleId(user) {
    if (!user) return '';
    if (user.roleId && getRbacRoleById(user.roleId)) return user.roleId;
    const title = String(user.title || '').trim();
    if (ROLE_TITLE_TO_RBAC[title]) return ROLE_TITLE_TO_RBAC[title];
    const role = String(user.role || '').toLowerCase();
    if (role === 'admin') return 'Super_Admin';
    if (role === 'coordinator') return 'Approver';
    return 'Field_Auditor';
}

function hasGlobalScope(user) {
    if (!user) return false;
    
    // Explicitly restrict these roles from having global scope regardless of legacy fields
    if (['Approver', 'Field_Auditor', 'Field_Auditor_Action_Owner', 'Executive_Viewer_Restricted'].includes(user.roleId)) {
        return false;
    }

    if (user.isGlobalScope === true || user.scopeType === 'global') return true;
    const rbac = getRbacRoleById(user.roleId);
    if (rbac) return rbac.isGlobal;
    const role = String(user.role || '').toLowerCase();
    if (role === 'admin') return true;
    const title = String(user.title || '').trim();
    return ['Süper Admin', 'Super Admin', 'Ü.Yönetici', 'U.Yonetici'].includes(title);
}

function getLegacyRoleFromRbac(roleId) {
    switch (roleId) {
        case 'Super_Admin':
        case 'Executive_Viewer_Global':
            return 'admin';
        case 'Approver':
            return 'coordinator';
        default:
            return 'user';
    }
}

function getRbacRoleDisplayName(user) {
    if (!user) return 'Kullanıcı';
    const rbac = getRbacRoleById(user.roleId);
    if (rbac) return rbac.name;
    if (user.roleName) return user.roleName;
    return user.title || 'Kullanıcı';
}

function initPersonnelRoleSelect() {
    const select = document.getElementById('personnel-role-id');
    if (!select || select.dataset.rbacReady === '1') return;
    select.innerHTML = '<option value="">Bir Rol Seçiniz...</option>' +
        RBAC_ROLES.map(role => `<option value="${role.id}">${role.name}</option>`).join('');
    select.dataset.rbacReady = '1';
}

function populatePersonnelPickers() {
    const linePicker = document.getElementById('personnel-line-picker');
    if (!linePicker) return;
    const current = linePicker.value;
    const available = (appData.lines || []).filter(line => !personnelSelectedLines.includes(line));
    linePicker.innerHTML = '<option value="">Hat seçip ekleyin...</option>' +
        available.map(line => `<option value="${escapeAttr(line)}">${escapeAttr(line)}</option>`).join('');
    linePicker.value = current && available.includes(current) ? current : '';
}

function renderPersonnelTags() {
    const linesEl = document.getElementById('personnel-lines-tags');
    if (!linesEl) return;
    linesEl.innerHTML = personnelSelectedLines.map(line =>
        `<span class="personnel-tag"><span>${escapeAttr(line)}</span><button type="button" onclick="removePersonnelLine('${jsArg(line)}')" aria-label="Kaldır">×</button></span>`
    ).join('');
    populatePersonnelPickers();
}

function onPersonnelRoleChange() {
    const roleId = document.getElementById('personnel-role-id')?.value || '';
    const selectedRole = getRbacRoleById(roleId);
    if (selectedRole && selectedRole.isGlobal) {
        personnelSelectedLines = [];
        renderPersonnelTags();
    }
    updatePersonnelScopeUI();
}

function updatePersonnelScopeUI() {
    const roleId = document.getElementById('personnel-role-id')?.value || '';
    const section = document.getElementById('personnel-scope-section');
    const scopeBanner = document.getElementById('personnel-role-scope-banner');
    const scopeIcon = document.getElementById('personnel-role-scope-icon');
    const scopeText = document.getElementById('personnel-role-scope-text');
    const restrictedPanel = document.getElementById('personnel-restricted-panel');
    if (!section) return;

    if (!roleId) {
        section.hidden = true;
        section.classList.remove('is-visible');
        if (scopeBanner) scopeBanner.hidden = true;
        if (restrictedPanel) restrictedPanel.hidden = true;
        return;
    }

    const selectedRole = getRbacRoleById(roleId);
    const isGlobal = selectedRole ? selectedRole.isGlobal : false;
    const scopeInfo = RBAC_ROLE_SCOPE_INFO[roleId] || {
        variant: isGlobal ? 'global' : 'restricted',
        icon: 'fa-info-circle',
        label: selectedRole?.name || 'Rol',
        text: isGlobal
            ? 'Bu rol tüm hatlarda tam yetki kapsamıyla çalışır. Hat ataması gerekmez.'
            : 'Bu rol yalnızca atanan hatlarda çalışır. En az bir hat seçilmelidir.'
    };

    section.hidden = false;
    section.classList.add('is-visible');

    if (scopeBanner) {
        scopeBanner.hidden = false;
        scopeBanner.classList.remove('personnel-banner--global', 'personnel-banner--restricted');
        scopeBanner.classList.add(scopeInfo.variant === 'global' ? 'personnel-banner--global' : 'personnel-banner--restricted');
    }
    if (scopeIcon) {
        scopeIcon.className = `fas ${scopeInfo.icon}`;
    }
    if (scopeText) {
        scopeText.innerHTML = `<strong>${escapeAttr(scopeInfo.label)}:</strong> ${escapeAttr(scopeInfo.text)}`;
    }
    if (restrictedPanel) restrictedPanel.hidden = isGlobal;
}

function addPersonnelLineFromPicker(selectEl) {
    const value = selectEl?.value;
    if (value && !personnelSelectedLines.includes(value)) {
        personnelSelectedLines.push(value);
        renderPersonnelTags();
    }
    if (selectEl) selectEl.value = '';
}

function removePersonnelLine(line) {
    personnelSelectedLines = personnelSelectedLines.filter(item => item !== line);
    renderPersonnelTags();
}

function splitPersonName(user) {
    const full = String(user?.firstName || user?.name || user?.username || '').trim();
    if (user?.firstName || user?.lastName) {
        return {
            firstName: user.firstName || '',
            lastName: user.lastName || ''
        };
    }
    const parts = full.split(/\s+/).filter(Boolean);
    if (!parts.length) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function resetPersonnelForm() {
    document.getElementById('edit-user-id').value = '';
    document.getElementById('personnel-first-name').value = '';
    document.getElementById('personnel-last-name').value = '';
    document.getElementById('new-user-email').value = '';
    document.getElementById('new-user-pass').value = '';
    document.getElementById('personnel-role-id').value = '';
    const titleInput = document.getElementById('personnel-title');
    if (titleInput) titleInput.value = '';
    personnelSelectedLines = [];
    renderPersonnelTags();
    updatePersonnelScopeUI();
    const passInput = document.getElementById('new-user-pass');
    const passHint = document.getElementById('new-user-pass-hint');
    if (passInput) passInput.required = true;
    if (passHint) {
        passHint.textContent = 'Mobil uygulama ve panel girişi için bu şifreyle Firebase Authentication hesabı oluşturulur.';
    }
    const submitBtn = document.getElementById('personnel-submit-btn');
    if (submitBtn) submitBtn.textContent = 'Personeli Sisteme Kaydet';
}

function setPersonnelPasswordFieldMode(isEdit) {
    const passInput = document.getElementById('new-user-pass');
    const passHint = document.getElementById('new-user-pass-hint');
    if (!passInput) return;
    passInput.required = !isEdit;
    if (passHint) {
        passHint.textContent = isEdit
            ? 'Boş bırakırsanız yalnızca personel bilgileri güncellenir; Firebase giriş şifresi değişmez. Şifre girerseniz Firebase hesabı oluşturulur veya girilen şifreyle eşleştirilir — otomatik e-posta gönderilmez.'
            : 'Mobil uygulama ve panel girişi için bu şifreyle Firebase Authentication hesabı oluşturulur.';
    }
}

function getUserLineSummary(user) {
    if (hasGlobalScope(user)) return 'Sorumlu Hatlar: Tüm Hatlar';
    const lines = Array.isArray(user?.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
    if (lines.length) return `Sorumlu Hatlar: ${lines.join(', ')}`;
    return 'Sorumlu Hat: Tanımlı değil';
}

function renderUserLineLogos(user) {
    const container = document.getElementById('user-display-lines-logos');
    if (!container) return;
    container.innerHTML = '';

    if (hasGlobalScope(user)) {
        container.innerHTML = `<span class="profile-line-logo" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); width: auto; padding: 0 8px; border-radius: 6px; font-size: 0.6rem; line-height: 20px; height: 20px; font-weight: 800;">TÜM</span>`;
        return;
    }

    const lines = Array.isArray(user?.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
    if (lines.length === 0) {
        container.innerHTML = `<span class="profile-line-logo" style="background: #64748b; width: auto; padding: 0 8px; border-radius: 6px; font-size: 0.6rem; line-height: 20px; height: 20px; font-weight: 800;">YOK</span>`;
        return;
    }

    lines.forEach(line => {
        const color = appData.lineColors[line] || '#64748b';
        const span = document.createElement('span');
        span.className = 'profile-line-logo';
        span.style.backgroundColor = color;
        span.textContent = line;
        container.appendChild(span);
    });
}

async function findExistingUserProfile(firebaseUser) {
    const email = (firebaseUser.email || '').trim();
    const username = email.split('@')[0];
    const lookups = [];
    if (email) lookups.push(db.collection('users').where('email', '==', email).limit(1).get());
    if (username) lookups.push(db.collection('users').where('username', '==', username).limit(1).get());

    for (const lookup of lookups) {
        try {
            const snapshot = await lookup;
            if (!snapshot.empty) {
                const userDoc = snapshot.docs[0];
                return { id: userDoc.id, ...userDoc.data() };
            }
        } catch (err) {
            console.warn('Existing user lookup skipped:', err);
        }
    }

    return null;
}

async function handleLogin(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    const loginBtn = document.querySelector('.login-btn');

    if (!email || !pass) {
        errorDiv.textContent = 'Lütfen e-posta ve şifrenizi girin.';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        errorDiv.style.display = 'none';
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GİRİŞ YAPILIYOR...';

        let finalEmail = email.trim();
        if (!finalEmail.includes('@')) {
            finalEmail += '@test.com';
        }

        pushDebug('Calling signInWithEmailAndPassword...');
        await auth.signInWithEmailAndPassword(finalEmail, pass);
        pushDebug('signInWithEmailAndPassword returned successfully!');
        // Başarılı giriş durumunda onAuthStateChanged tetiklenecektir
    } catch (err) {
        console.error('Login error detail:', err);
        loginBtn.disabled = false;
        loginBtn.innerText = 'GİRİŞ YAP';

        const errorCode = err.code || 'Bilinmeyen Hata';
        const errorMessage = err.message || 'Bir hata oluştu.';

        let msg = 'Giriş başarısız. Lütfen bilgilerinizi kontrol edin.';
        if (errorCode === 'auth/user-not-found') msg = 'Kullanıcı bulunamadı.';
        else if (errorCode === 'auth/wrong-password') msg = 'Hatalı şifre.';
        else if (errorCode === 'auth/network-request-failed') msg = 'Bağlantı hatası (İnternet yok).';
        else if (errorCode === 'auth/invalid-email') msg = 'Geçersiz e-posta formatı.';

        errorDiv.innerHTML = `${msg}<br><span style="font-size: 0.7rem; opacity: 0.8;">Hata: ${errorCode}<br>${errorMessage}</span>`;
        errorDiv.style.display = 'block';
    }
}

async function handleLogout() {
    try {
        if (currentUser && currentUser.id) {
            await db.collection('users').doc(currentUser.id).update({
                lastActive: firebase.firestore.FieldValue.delete(),
                activePlatform: firebase.firestore.FieldValue.delete()
            }).catch(() => {});
        }
        if (presenceHeartbeatInterval) {
            clearInterval(presenceHeartbeatInterval);
            presenceHeartbeatInterval = null;
        }
        await firebase.auth().signOut();
    } catch (err) {
        console.error('Logout error:', err);
    }
}

function initRealtimeSync() {
    pushDebug('Inside initRealtimeSync');
    console.log('Real-time sync başlatıldı...');
    startPresenceHeartbeat();

    // Automatically clean up old duplicate 'audit-type-5s' document if it exists in Firestore
    db.collection('auditTypes').doc('audit-type-5s').delete()
      .then(() => console.log('Successfully deleted old duplicate audit-type-5s document'))
      .catch(err => console.warn('Failed to delete old duplicate audit-type-5s document:', err));

    // Audits Listener
    db.collection('audits').orderBy('date', 'desc').onSnapshot(snapshot => {
        appData.audits = snapshot.docs.map(doc => normalizeAuditScore({ id: doc.id, ...doc.data() }));
        appData.auditsLoaded = true;
        renderAll();
    }, err => console.error('Audits Sync Error:', err));

    // Nonconformities Listener
    db.collection('nonconformities').onSnapshot(snapshot => {
        appData.nonconformities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Auto-clean orphaned closure fields for open/inProgress/overdue NCs
        appData.nonconformities.forEach(nc => {
            const hasClosureFields = nc.closureComment !== undefined || 
                                     nc.closurePhotoPaths !== undefined || 
                                     nc.closedByName !== undefined || 
                                     nc.closureDate !== undefined;
            const isOpenStatus = nc.status === 'open' || nc.status === 'inProgress' || nc.status === 'overdue';
            if (isOpenStatus && hasClosureFields) {
                console.log(`Cleaning orphaned closure fields for NC: ${nc.id}`);
                db.collection('nonconformities').doc(nc.id).update({
                    closureComment: firebase.firestore.FieldValue.delete(),
                    closurePhotoPaths: firebase.firestore.FieldValue.delete(),
                    closedByName: firebase.firestore.FieldValue.delete(),
                    closureDate: firebase.firestore.FieldValue.delete()
                }).catch(err => console.error('Error cleaning orphaned NC fields:', err));
            }
        });

        updateStats();
        renderNCs();
    }, err => console.error('NC Sync Error:', err));

    // Users Listener
    db.collection('users').onSnapshot(snapshot => {
        appData.users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPeople();
        renderPermissions();
        populateStatsFilters();
        if (document.getElementById('online-users-view')?.style.display !== 'none') {
            renderOnlineUsers();
        }
        if (appData.auditsLoaded) {
            renderAll();
        }
    }, err => console.error('Users Sync Error:', err));

    // Permissions Listener
    db.collection('system_config').doc('permissions').onSnapshot(doc => {
        appData.rolePermissions = normalizeRolePermissions(doc.exists ? doc.data() : null);
        permissionsDirty = false;
        if (!doc.exists) {
            console.warn('Yetki matrisi bulunamadı, RBAC varsayılanları yüklendi.');
        }
        renderPermissions();
        updatePermissionGatedUI();
    });

    db.collection('system_config').doc('settings').onSnapshot(doc => {
        appData.settings = { ...DEFAULT_SYSTEM_SETTINGS, ...(doc.exists ? doc.data() : {}) };
        renderSettings();
    });



    // Listen for Lines/Stations (Firebase Sync)
    db.collection('system_config').doc('lines_stations').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            if (data.lineColors) appData.lineColors = data.lineColors;
            if (data.lines) appData.lines = data.lines;
            if (data.stations) appData.stations = data.stations;
            if (data.stationNumbers) appData.stationNumbers = data.stationNumbers;
            if (data.stationNfcs) appData.stationNfcs = data.stationNfcs;
            if (data.stationLocations) appData.stationLocations = data.stationLocations;
            
            runM1Migration();
        } else {
            seedLinesStationsToFirebase();
        }
        pushDebug('Calling renderLines...');
        renderLines();
        pushDebug('renderLines returned!');
        renderAnnouncements();
        renderAll();
        populateStatsFilters();
        populateNfcLineFilter();
        renderNfcList();
        populateLocationLineFilter();
        renderLocationList();
        if (document.getElementById('user-modal')?.style.display === 'flex') {
            populatePersonnelPickers();
        }
    });

    // Question Groups Listener
    db.collection('question_groups').onSnapshot(snapshot => {
        if (window.__questionBankRealtimeInstalled) return;
        appData.questionGroups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Ensure default general audit group exists
        if (appData.questionGroups.length === 0) {
            const defaultGroup = { id: 'g1', name: 'Genel Denetim', icon: 'fa-clipboard-check', createdAt: new Date().toISOString() };
            appData.questionGroups = [defaultGroup];
            db.collection('question_groups').doc('g1').set(defaultGroup);
        }
        renderQuestionGroups();
        renderPlanning();
    }, err => console.error('Question Groups Sync Error:', err));

    // Questions Listener
    db.collection('questions').orderBy('orderIndex').onSnapshot(snapshot => {
        if (window.__questionBankRealtimeInstalled) return;
        appData.questions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Seed default general audit questions if empty
        if (appData.questions.length === 0) {
            seedDefaultGeneralQuestions();
        }
        renderQuestionGroups();
        // Auto-select first group if none selected
        if (!appData.selectedGroupId && appData.questionGroups.length > 0) {
            appData.selectedGroupId = appData.questionGroups[0].id;
        }
        if (appData.selectedGroupId) {
            renderQuestions(appData.selectedGroupId);
            document.getElementById('selected-group-questions').style.display = 'block';
        }
    }, err => console.error('Questions Sync Error:', err));

    db.collection('plans').orderBy('startDate', 'desc').onSnapshot(snapshot => {
        appData.plans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPlanning();
        if (document.getElementById('stats-view')?.style.display === 'block') updateStats();
    }, err => console.error('Plans Sync Error:', err));

    db.collection('announcements').onSnapshot(snapshot => {
        appData.announcements = snapshot.docs
            .map(doc => normalizeAnnouncement({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (parseAnnouncementDate(b.startAt)?.getTime() || 0) - (parseAnnouncementDate(a.startAt)?.getTime() || 0));
        cleanupExpiredAnnouncements();
        renderAnnouncements();
    }, err => console.error('Announcements Sync Error:', err));
}

function mapScore6ToPercent(score) {
    const s = Number(score);
    if (s === 0) return 0;
    if (s === 1) return 25;
    if (s === 2) return 50;
    if (s === 3) return 80;
    if (s === 4) return 99;
    if (s === 5) return 100;
    return 0;
}

function findCategoryByNameOrId(audit, categoryName) {
    const typeId = audit.auditTypeId || appData.selectedAuditTypeId;
    const type = (appData.auditTypes || []).find(t => String(t.id) === String(typeId));
    if (!type || !type.categories) return null;
    return type.categories.find(c => String(c.id) === String(categoryName) || String(c.name).toUpperCase() === String(categoryName).toUpperCase());
}

function normalizeAuditScore(audit) {
    const answers = Array.isArray(audit.answers) ? audit.answers : [];
    if (answers.length === 0) return audit;

    const metrics = buildAuditDetailMetrics(audit);

    return {
        ...audit,
        score: metrics.categoryAveragePercent
    };
}

function getActiveAuditTypesForFilters() {
    const types = Array.isArray(appData.auditTypes) ? appData.auditTypes : [];
    return types
        .filter(t => t && t.isDeleted !== true && t.isActive !== false)
        .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
}

function normalizeAuditTypeValue(value) {
    return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function getAuditTypeAliasSet(type = {}) {
    return new Set([
        type.id,
        type.title,
        type.name,
        type.label
    ].filter(Boolean).map(normalizeAuditTypeValue));
}

function getAuditTypeValues(audit = {}) {
    const explicitTypeId = String(audit.auditTypeId || '').trim();
    if (explicitTypeId) return [explicitTypeId];

    const explicitTypeNames = [
        audit.auditType,
        audit.type
    ].filter(value => String(value || '').trim()).map(String);
    if (explicitTypeNames.length) return [...new Set(explicitTypeNames)];

    const values = [
        audit.questionGroupId,
        audit.groupId
    ].filter(Boolean).map(String);

    const group = (appData.questionGroups || []).find(g => values.some(v =>
        String(g.id) === v || String(g.name) === v || String(g.title) === v
    ));
    if (group?.auditTypeId) values.push(String(group.auditTypeId));

    (audit.answers || []).slice(0, 8).forEach(answer => {
        const q = (appData.questions || []).find(item => String(item.id) === String(answer.questionId));
        if (q?.auditTypeId) values.push(String(q.auditTypeId));
        if (q?.groupId) {
            const qGroup = (appData.questionGroups || []).find(item => String(item.id) === String(q.groupId));
            if (qGroup?.auditTypeId) values.push(String(qGroup.auditTypeId));
        }
    });

    return [...new Set(values.filter(Boolean))];
}

function getAuditForNonconformity(nc = {}) {
    return getAccessibleAuditById(nc.auditId) || {};
}

function getNonconformityTypeValues(nc = {}) {
    const audit = getAuditForNonconformity(nc);
    const parentTypeId = String(audit.auditTypeId || '').trim();
    if (parentTypeId) return [parentTypeId];

    const nonconformityTypeId = String(nc.auditTypeId || '').trim();
    if (nonconformityTypeId) return [nonconformityTypeId];

    const parentTypeNames = [audit.auditType, audit.type]
        .filter(value => String(value || '').trim())
        .map(String);
    if (parentTypeNames.length) return [...new Set(parentTypeNames)];

    const nonconformityTypeNames = [nc.auditType, nc.type]
        .filter(value => String(value || '').trim())
        .map(String);
    if (nonconformityTypeNames.length) return [...new Set(nonconformityTypeNames)];

    return getAuditTypeValues({
        ...audit,
        answers: nc.answers || audit.answers || []
    });
}

function auditTypeValuesMatch(values, selectedTypeId, source = {}) {
    if (!selectedTypeId || selectedTypeId === 'all') return true;

    const selectedType = getActiveAuditTypesForFilters().find(t => String(t.id) === String(selectedTypeId))
        || { id: selectedTypeId, title: selectedTypeId };
    const aliases = getAuditTypeAliasSet(selectedType);
    const normalizedValues = values.map(normalizeAuditTypeValue);
    return normalizedValues.some(v => aliases.has(v));
}

function filterByAuditType(items, type, resolver = getAuditTypeValues) {
    if (!type || type === 'all') return items;
    return items.filter(item => auditTypeValuesMatch(resolver(item), type, item));
}

function isStationAuditTypeId(typeId) {
    if (!typeId || typeId === 'all') return false;
    const type = getActiveAuditTypesForFilters().find(t => String(t.id) === String(typeId));
    const raw = `${typeId} ${type?.title || ''} ${type?.name || ''} ${type?.scoringStrategy || ''}`.toLocaleLowerCase('tr-TR');
    return raw.includes('istasyon') || raw.includes('station') || raw.includes('booleanaverage');
}

function populateAuditTypeFilters() {
    const types = getActiveAuditTypesForFilters();
    const targets = [
        { id: 'dashboard-filter-type', allLabel: 'Tüm Denetim Tipleri' },
        { id: 'filter-stats-type', allLabel: 'Tüm Denetim Tipleri' },
        { id: 'audit-filter-type', allLabel: 'Tüm Denetim Tipleri' },
        { id: 'nc-filter-type', allLabel: 'Tüm Denetim Tipleri' }
    ];

    targets.forEach(({ id, allLabel }) => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value || 'all';
        select.innerHTML = '';
        select.add(new Option(allLabel, 'all'));
        types.forEach(type => select.add(new Option(type.title || type.name || 'Denetim Tipi', type.id)));
        select.value = Array.from(select.options).some(opt => opt.value === current) ? current : 'all';
    });

    if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
    }
}

function handleNcAuditTypeChange() {
    const selectedTypes = getMultiSelectValues('nc-filter-type');
    const isStationType = selectedTypes.some(type => isStationAuditTypeId(type));
    document.querySelectorAll('#nc-filter-tabs .nc-filter-btn').forEach(btn => {
        const text = btn.textContent || '';
        const isStationHidden = isStationType && (text.includes('Geciken') || text.includes('Kontrol'));
        btn.style.display = isStationHidden ? 'none' : '';
    });
    const activeBtn = document.querySelector('#nc-filter-tabs .nc-filter-btn.active');
    if (isStationType && activeBtn && activeBtn.style.display === 'none') {
        const openBtn = Array.from(document.querySelectorAll('#nc-filter-tabs .nc-filter-btn')).find(btn => (btn.textContent || '').includes('Açık'));
        if (openBtn) filterNCs('Açık', openBtn);
        return;
    }
    renderNCs();
}

function getMultiSelectValues(selectOrId) {
    const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
    if (!select) return [];
    const values = Array.from(select.selectedOptions || []).map(option => option.value).filter(Boolean);
    if (!values.length || values.includes('all')) return [];
    return values;
}

function setMultiSelectValues(select, values = []) {
    if (!select) return;
    const wanted = new Set(values.filter(Boolean));
    const hasWanted = Array.from(select.options).some(option => wanted.has(option.value));
    Array.from(select.options).forEach(option => {
        option.selected = hasWanted ? wanted.has(option.value) : option.value === 'all';
    });
}

function handleAuditMultiFilterChange(select) {
    if (!select) return;
    const selectedOptions = Array.from(select.selectedOptions || []);
    if (selectedOptions.length > 1 && selectedOptions.some(option => option.value === 'all')) {
        Array.from(select.options).forEach(option => {
            if (option.value === 'all') option.selected = false;
        });
    }
    if (!Array.from(select.selectedOptions || []).length) {
        const allOption = Array.from(select.options).find(option => option.value === 'all');
        if (allOption) allOption.selected = true;
    }
}

function populateStatsFilters() {
    renderUnifiedDateOptions('stats');
    updateUnifiedDateTriggerLabel('stats');
    populateAuditTypeFilters();

    const lineSelect = document.getElementById('filter-stats-line');
    const stationSelect = document.getElementById('filter-stats-station');
    const userSelect = document.getElementById('filter-stats-user');
    const yearSelect = document.getElementById('filter-stats-year');
    const monthSelect = document.getElementById('filter-stats-month');
    const accessibleAudits = getFilteredAudits();
    const scopedLines = getScopedAuditLines();

    // 1. Hat Filtresi
    if (lineSelect) {
        const currentLines = getMultiSelectValues(lineSelect);
        if (lineSelect.options.length <= 1) {
            lineSelect.innerHTML = '<option value="all">Tüm Hatlar</option>';
            scopedLines.forEach(l => lineSelect.add(new Option(l, l)));
            setMultiSelectValues(lineSelect, currentLines);
        }
    }

    // 2. İstasyon Filtresi (Seçili hatlara göre)
    if (stationSelect) {
        const selectedLines = getMultiSelectValues(lineSelect);
        const currentStations = getMultiSelectValues(stationSelect);
        stationSelect.innerHTML = '<option value="all">Tüm İstasyonlar</option>';

        let stationsToDisplay = [];
        if (!selectedLines.length) {
            scopedLines.forEach(line => {
                stationsToDisplay.push(...((appData.stations || {})[line] || []));
            });
            accessibleAudits.forEach(audit => {
                if (audit.station) stationsToDisplay.push(audit.station);
            });
        } else {
            selectedLines.forEach(line => {
                stationsToDisplay.push(...((appData.stations || {})[line] || []));
            });
            stationsToDisplay.push(...accessibleAudits
                .filter(audit => selectedLines.includes(audit.line))
                .map(audit => audit.station)
                .filter(Boolean));
        }

        [...new Set(stationsToDisplay)].sort((a, b) => a.localeCompare(b, 'tr')).forEach(station => {
            stationSelect.add(new Option(station, station));
        });
        setMultiSelectValues(stationSelect, currentStations);
    }

    // 3. Kullanıcı Filtresi (yalnızca mevcut denetimlerdeki denetçiler, Türkçe normalize)
    if (userSelect) {
        const currentUsers = getMultiSelectValues(userSelect);
        if (userSelect.options.length <= 1) {
            userSelect.innerHTML = '<option value="all">Tüm Denetçiler</option>';
            const auditorMap = new Map();
            accessibleAudits.forEach(audit => {
                if (!audit.auditorName) return;
                const key = normalizeTurkish(audit.auditorName);
                if (!auditorMap.has(key)) auditorMap.set(key, audit.auditorName);
            });
            const auditors = [...auditorMap.values()];
            auditors.sort((a, b) => getAuditorDisplayName(a).localeCompare(getAuditorDisplayName(b), 'tr')).forEach(auditor => {
                userSelect.add(new Option(getAuditorDisplayName(auditor), auditor));
            });
            setMultiSelectValues(userSelect, currentUsers);
        }
    }

    // 4. Yıl Filtresi
    if (yearSelect) {
        const currentYears = getMultiSelectValues(yearSelect);
        if (yearSelect.options.length <= 1) {
            yearSelect.innerHTML = '<option value="all">Tüm Yıllar</option>';
            const years = accessibleAudits
                .map(audit => audit.date ? new Date(audit.date).getFullYear() : null)
                .filter(year => Number.isFinite(year))
                .map(String);
            [...new Set(years)].sort((a, b) => Number(b) - Number(a)).forEach(year => {
                yearSelect.add(new Option(year, year));
            });
            setMultiSelectValues(yearSelect, currentYears);
        }
    }

    // 5. Ay Filtresi
    if (monthSelect) {
        const currentMonths = getMultiSelectValues(monthSelect);
        if (monthSelect.options.length <= 1) {
            monthSelect.innerHTML = '<option value="all">Tüm Aylar</option>';
            const aylarnames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            aylarnames.forEach((name, index) => {
                monthSelect.add(new Option(name, String(index + 1)));
            });
            setMultiSelectValues(monthSelect, currentMonths);
        }
    }

    // Sync custom select UI
    if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
    }
}

async function fetchData() {
    try {
        const response = await fetch(API_URL);
        if (response.ok) {
            const data = await response.json();
            appData = data;
        }
    } catch (e) {
        console.warn('Backend verisi alınamadı; kayıtlar boş gösterilecek.');
    }
    renderAll();
}

// Populate Audits page dynamic filters (Line, Station, User, Year)
function populateAuditPageFilters() {
    renderUnifiedDateOptions('audits');
    updateUnifiedDateTriggerLabel('audits');
    const lineSelect = document.getElementById('audit-filter-line');
    const stationSelect = document.getElementById('audit-filter-station');
    const userSelect = document.getElementById('audit-filter-user');
    const yearSelect = document.getElementById('audit-filter-year');
    const accessibleAudits = getFilteredAudits();
    const scopedLines = getScopedAuditLines();

    if (!lineSelect || !stationSelect || !userSelect || !yearSelect) return;

    // 1. Hat Filtresi
    const currentLines = getMultiSelectValues(lineSelect);
    if (lineSelect.options.length <= 1) {
        lineSelect.innerHTML = '<option value="all">Tüm Hatlar</option>';
        scopedLines.forEach(l => lineSelect.add(new Option(l, l)));
        setMultiSelectValues(lineSelect, currentLines);
    }

    // 2. İstasyon Filtresi (Seçili hatlara göre)
    const selectedLines = getMultiSelectValues(lineSelect);
    const currentStations = getMultiSelectValues(stationSelect);
    stationSelect.innerHTML = '<option value="all">Tüm İstasyonlar</option>';

    let stationsToDisplay = [];
    if (!selectedLines.length) {
        scopedLines.forEach(line => {
            stationsToDisplay.push(...((appData.stations || {})[line] || []));
        });
        accessibleAudits.forEach(audit => {
            if (audit.station) stationsToDisplay.push(audit.station);
        });
    } else {
        selectedLines.forEach(line => {
            stationsToDisplay.push(...((appData.stations || {})[line] || []));
        });
        stationsToDisplay.push(...accessibleAudits
            .filter(audit => selectedLines.includes(audit.line))
            .map(audit => audit.station)
            .filter(Boolean));
    }
    [...new Set(stationsToDisplay)].sort((a, b) => a.localeCompare(b, 'tr')).forEach(station => {
        stationSelect.add(new Option(station, station));
    });
    setMultiSelectValues(stationSelect, currentStations);

    // 3. Kullanıcı Filtresi (Türkçe karakter normalizasyonu ile tekil)
    const currentUsers = getMultiSelectValues(userSelect);
    if (userSelect.options.length <= 1) {
        userSelect.innerHTML = '<option value="all">Tüm Kullanıcılar</option>';
        const auditorMap = new Map();
        accessibleAudits.forEach(audit => {
            if (!audit.auditorName) return;
            const key = normalizeTurkish(audit.auditorName);
            if (!auditorMap.has(key)) auditorMap.set(key, audit.auditorName);
        });
        const auditors = [...auditorMap.values()];
        auditors.sort((a, b) => getAuditorDisplayName(a).localeCompare(getAuditorDisplayName(b), 'tr')).forEach(auditor => {
            userSelect.add(new Option(getAuditorDisplayName(auditor), auditor));
        });
        setMultiSelectValues(userSelect, currentUsers);
    }

    // 4. Yıl Filtresi
    const currentYears = getMultiSelectValues(yearSelect);
    if (yearSelect.options.length <= 1) {
        yearSelect.innerHTML = '<option value="all">Tüm Yıllar</option>';
        const years = accessibleAudits
            .map(audit => audit.date ? new Date(audit.date).getFullYear() : null)
            .filter(year => Number.isFinite(year))
            .map(String);
        [...new Set(years)].sort((a, b) => Number(b) - Number(a)).forEach(year => {
            yearSelect.add(new Option(year, year));
        });
        setMultiSelectValues(yearSelect, currentYears);
    }

    // Sync custom select UI
    if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
    }
}

function renderAll() {
    populateDashboardFilters();
    populateAuditPageFilters();
    populateStatsFilters();
    updateStats();
    renderRecentTable();
    renderAllAuditsTable();
    renderPeople();
    renderStationMatrix();
    updateCharts(appData);
    renderAuditorPerformance();
}

const VIEW_TITLES = {
    'dashboard-view': 'Genel Bakış',
    'audits-view': 'Denetim Kayıtları',
    'nc-management-view': 'Uygunsuzluk Takibi & Aksiyonlar',
    'stats-view': 'Kurumsal Analiz Raporu',
    'people-view': 'Personel Yönetimi',
    'permissions-view': 'Yetki Yönetimi',
    'lines-view': 'Hat ve İstasyon Yönetimi',
    'nfc-view': 'NFC Tanımları',
    'location-view': 'Konum Tanımları',
    'questions-view': 'Soru Bankası Yönetimi',
    'planning-view': 'Görev Atama ve Planlama',
    'announcements-view': 'Duyuru Yönetimi',
    'feedbacks-view': 'Geri Bildirimler',
    'reports-view': 'Raporlar & Analizler',
    'settings-view': 'Sistem Ayarları',
    'logs-view': 'Sistem Logları',
    'online-users-view': 'Günlük Aktif Kullanıcılar',
};

const VIEW_DESCRIPTIONS = {
    'dashboard-view': 'Operasyonel durum, denetim performansı ve aksiyon takibi.',
    'audits-view': 'Tüm denetim kayıtlarını filtreleyin, inceleyin ve raporlayın.',
    'nc-management-view': 'Uygunsuzlukları, sorumluları ve aksiyon kapanışlarını yönetin.',
    'stats-view': 'Kurumsal başarı, kategori performansı ve trend analizleri.',
    'people-view': 'Personel, rol ve hat sorumluluklarını yönetin.',
    'permissions-view': 'Altı sistem rolü için modül erişim matrisini yönetin (RBAC).',
    'lines-view': 'Hat ve istasyon tanımlarını kurumsal ağ yapısında yönetin.',
    'nfc-view': 'İstasyonların NFC kart UID tanımlarını listeleyin ve dışa aktarın.',
    'location-view': 'İstasyonların coğrafi koordinat ve doğrulama yarıçap tanımlarını listeleyin ve düzenleyin.',
    'questions-view': 'Denetim tipleri, kategoriler ve soru setlerini yönetin.',
    'planning-view': 'Planlı görevleri ve denetim atamalarını oluşturun.',
    'announcements-view': 'Mobil uygulamada hat bazlı görünecek duyuruları planlayın.',
    'feedbacks-view': 'Uygulamadan iletilen geri bildirimleri ve hata kayıtlarını inceleyin.',
    'reports-view': 'Kurumsal rapor çıktıları ve dışa aktarma işlemleri.',
    'settings-view': 'Sistem davranışı, rapor ve bildirim ayarları.',
    'logs-view': 'Sistem genelinde yapılan işlemlerin geçmiş kayıtları ve denetim logları.',
    'online-users-view': 'Bugün sistemde aktif olan (giriş yapan veya işlem gerçekleştiren) web kullanıcılarını görüntüleyin.',
};

function updateActivePageTitle(viewId) {
    const titleEl = document.getElementById('active-page-title');
    const descEl = document.getElementById('active-page-description');
    if (titleEl) titleEl.textContent = VIEW_TITLES[viewId] || 'Genel Bakış';
    if (descEl) descEl.textContent = VIEW_DESCRIPTIONS[viewId] || VIEW_DESCRIPTIONS['dashboard-view'];
}

// View Switching Logic
const NAV_VIEW_PERMISSIONS = {
    'people-view': 'user_add_edit',
    'permissions-view': 'perm_mgmt',
    'questions-view': 'question_mgmt',
    'lines-view': 'line_mgmt',
    'nfc-view': 'line_mgmt',
    'location-view': 'line_mgmt',
    'planning-view': 'planning',
    'announcements-view': 'announcement_mgmt',
    'logs-view': 'view_logs',
    'settings-view': 'settings',
    'stats-view': 'stats_view',
    'reports-view': 'stats_view',
    'dashboard-view': 'dashboard_view',
    'online-users-view': 'perm_mgmt'
};

function canShowNavView(viewId, user = currentUser) {
    if (viewId === 'feedbacks-view') return isSuperAdmin(user);
    if (isFieldAuditor(user)) {
        if (FIELD_AUDITOR_WEB_VIEWS.has(viewId)) return true;
        if ((viewId === 'stats-view' || viewId === 'reports-view') && hasPermission('stats_view', user)) return true;
        if (viewId === 'dashboard-view' && hasPermission('dashboard_view', user)) return true;
        return false;
    }
    if (isFieldAuditorActionOwner(user)) {
        if (ACTION_OWNER_WEB_VIEWS.has(viewId)) return true;
        if ((viewId === 'stats-view' || viewId === 'reports-view') && hasPermission('stats_view', user)) return true;
        if (viewId === 'dashboard-view' && hasPermission('dashboard_view', user)) return true;
        return false;
    }
    const requiredPerm = NAV_VIEW_PERMISSIONS[viewId];
    return requiredPerm ? hasPermission(requiredPerm, user) : true;
}

function updatePermissionGatedUI() {
    const superAdminOnlyVisible = isSuperAdmin();
    const fieldAuditorOnly = isFieldAuditor();
    const feedbackNavItem = document.getElementById('feedbacks-nav-item');
    const refreshNavItem = document.getElementById('refresh-nav-item');
    const logsNavItem = document.getElementById('logs-nav-item');
    if (feedbackNavItem) feedbackNavItem.style.display = superAdminOnlyVisible ? '' : 'none';
    if (refreshNavItem) refreshNavItem.style.display = superAdminOnlyVisible ? '' : 'none';
    if (logsNavItem) logsNavItem.style.display = hasPermission('view_logs') ? '' : 'none';
    const clearAllPlansBtn = document.getElementById('clear-all-plans-btn');
    if (clearAllPlansBtn) {
        clearAllPlansBtn.innerHTML = superAdminOnlyVisible
            ? '<i class="fas fa-trash-alt"></i> Tümünü Sil'
            : '<i class="fas fa-trash-alt"></i> Kendi Planlarımı Sil';
        clearAllPlansBtn.title = superAdminOnlyVisible
            ? 'Aktif sekmedeki tüm planları sil'
            : 'Aktif sekmede yalnızca kendi oluşturduğunuz planları sil';
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        const onclick = item.getAttribute('onclick') || '';
        const match = onclick.match(/switchView\('([^']+)'\)/);
        if (!match) return;
        const viewId = match[1];
        const li = item.closest('li');
        if (!li) return;
        li.style.display = canShowNavView(viewId) ? '' : 'none';
    });

    // YÖNETİM başlığı ve ayırıcı çizginin durumunu güncelle
    const mgmtViews = ['people-view', 'questions-view', 'lines-view', 'nfc-view', 'location-view', 'planning-view', 'announcements-view', 'logs-view', 'permissions-view', 'online-users-view'];
    const hasAnyMgmtPermission = !fieldAuditorOnly && mgmtViews.some(viewId => {
        const perm = NAV_VIEW_PERMISSIONS[viewId];
        return perm ? hasPermission(perm) : false;
    });

    const mgmtDivider = document.getElementById('management-divider');
    const mgmtHeader = document.getElementById('management-header');
    if (mgmtDivider) mgmtDivider.style.display = hasAnyMgmtPermission ? '' : 'none';
    if (mgmtHeader) mgmtHeader.style.display = hasAnyMgmtPermission ? '' : 'none';

    const addPersonnelBtn = document.querySelector('#people-view .section-header .btn-primary');
    if (addPersonnelBtn) addPersonnelBtn.style.display = hasPermission('user_add_edit') ? '' : 'none';

    const permSaveBtns = document.querySelectorAll('#permissions-view .btn-primary[onclick="savePermissions()"]');
    permSaveBtns.forEach(btn => { btn.style.display = canManagePermissions() ? '' : 'none'; });
}

function switchView(viewId) {
    console.log('Switching to view:', viewId);
    if (!canOperationalRoleAccessView(viewId)) {
        const message = isFieldAuditorActionOwner()
            ? 'Saha Denetçisi + Aksiyon Sorumlusu web panelinde yalnızca Denetimler, Uygunsuzluklar ve Görev Planlama sayfalarına erişebilir.'
            : 'Saha Denetçisi web panelinde yalnızca Denetimler ve Uygunsuzluklar sayfalarına erişebilir.';
        showToast(message);
        return;
    }
    if (viewId === 'feedbacks-view' && !isSuperAdmin()) {
        showToast('Geri bildirimler sayfası yalnızca Süper Admin tarafından görüntülenebilir.');
        return;
    }
    const requiredPerm = NAV_VIEW_PERMISSIONS[viewId];
    if (requiredPerm && !hasPermission(requiredPerm)) {
        showToast('Bu sayfaya erişim yetkiniz bulunmuyor.');
        return;
    }
    updateActivePageTitle(viewId);

    // Hide all views
    document.querySelectorAll('.view-section').forEach(view => {
        view.style.display = 'none';
    });

    // Show target view
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.style.display = 'block';
        window.scrollTo(0, 0);

        // Re-render charts if stats view is active
        if (viewId === 'stats-view') {
            updateStats();
        }
        if (viewId === 'settings-view') {
            loadSettingsPage();
        }
        if (viewId === 'audits-view') {
            populateStatsFilters();
            renderAllAuditsTable();
        }
        if (viewId === 'feedbacks-view') {
            loadFeedbacks();
        }
        if (viewId === 'logs-view') {
            renderLogsList();
        }
    } else {
        console.warn('View not found:', viewId);
    }

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        // More robust check for active state
        const onClickAttr = item.getAttribute('onclick') || '';
        if (onClickAttr.includes(`'${viewId}'`) || onClickAttr.includes(`"${viewId}"`)) {
            item.classList.add('active');
        }
    });

    // Run view-specific rendering
    if (viewId === 'dashboard-view') renderAll();
    if (viewId === 'stats-view') {
        updateStats();
    }
    if (viewId === 'audits-view') renderAllAuditsTable();
    if (viewId === 'people-view') renderPeople();
    if (viewId === 'lines-view') renderLines();
    if (viewId === 'questions-view') {
        renderQuestionGroups();
        if (appData.selectedGroupId) renderQuestions(appData.selectedGroupId);
    }
    if (viewId === 'planning-view') renderPlanning();
    if (viewId === 'announcements-view') renderAnnouncements();
    if (viewId === 'permissions-view') renderPermissions();
    if (viewId === 'nfc-view') {
        populateNfcLineFilter();
        renderNfcList();
    }
    if (viewId === 'location-view') {
        populateLocationLineFilter();
        renderLocationList();
    }
    if (viewId === 'nc-management-view') {
        initNCFilters();
        renderNCs();
    }
    if (viewId === 'online-users-view') {
        renderOnlineUsers();
    }
}

function populateNfcLineFilter() {
    const select = document.getElementById('nfc-filter-line');
    if (!select) return;
    const current = select.value || 'all';
    select.innerHTML = '<option value="all">Tüm Hatlar</option>';
    (appData.lines || []).forEach(line => {
        select.add(new Option(line, line));
    });
    select.value = current;
}

function renderNfcList() {
    const tableBody = document.getElementById('nfc-table-body');
    const emptyState = document.getElementById('nfc-empty-state');
    if (!tableBody) return;

    const lineFilter = document.getElementById('nfc-filter-line')?.value || 'all';
    const searchInput = document.getElementById('nfc-search-input');
    const query = (searchInput?.value || '').toLowerCase().trim();

    let html = '';
    let matchCount = 0;

    const lines = lineFilter === 'all' ? (appData.lines || []) : [lineFilter];
    
    lines.forEach(line => {
        const stations = appData.stations?.[line] || [];
        stations.forEach(station => {
            const nfcKey = `${line}_${station}`;
            const nfcData = appData.stationNfcs?.[nfcKey];
            const nfcUid = (nfcData && nfcData.uid) ? nfcData.uid : '';
            
            const matchesSearch = !query || 
                station.toLowerCase().includes(query) || 
                nfcUid.toLowerCase().includes(query) || 
                line.toLowerCase().includes(query);

            if (matchesSearch) {
                matchCount++;
                const color = appData.lineColors?.[line] || '#64748b';
                const badgeHtml = nfcUid 
                    ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-check-circle"></i> Tanımlı</span>`
                    : `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-exclamation-triangle"></i> Tanımsız</span>`;
                
                const escapedLine = escapeAttr(line).replace(/'/g, "\\'");
                const escapedStation = escapeAttr(station).replace(/'/g, "\\'");
                const escapedUid = escapeAttr(nfcUid).replace(/'/g, "\\'");

                html += `
                    <tr style="border-bottom: 1px solid var(--border-main); transition: background 0.2s;">
                        <td style="padding: 12px 16px;">
                            <span class="profile-line-logo" style="background-color: ${color}; color: white; font-weight: bold; font-size: 0.65rem; width: 22px; height: 22px; border-radius: 50%;">${escapeAttr(line)}</span>
                        </td>
                        <td style="padding: 12px 16px; font-weight: 600; color: var(--text-primary);">${escapeAttr(station)}</td>
                        <td style="padding: 12px 16px; font-family: monospace; font-size: 0.9rem; color: var(--text-primary); font-weight: 700;">${nfcUid ? escapeAttr(nfcUid) : '<span style="color: var(--text-dim); font-weight: normal; font-style: italic;">Atanmamış</span>'}</td>
                        <td style="padding: 12px 16px; text-align: center;">${badgeHtml}</td>
                        <td style="padding: 12px 16px; text-align: center;">
                            <button class="btn-outline" onclick="openNfcEditModal('${escapedLine}', '${escapedStation}', '${escapedUid}')" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                                <i class="fas fa-edit"></i> Düzenle
                            </button>
                        </td>
                    </tr>
                `;
            }
        });
    });

    tableBody.innerHTML = html;
    if (emptyState) {
        emptyState.style.display = matchCount === 0 ? 'flex' : 'none';
    }
}

function downloadNfcTemplate() {
    try {
        if (typeof XLSX === 'undefined') {
            showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');
            return;
        }

        const lineFilter = document.getElementById('nfc-filter-line')?.value || 'all';
        const lines = lineFilter === 'all' ? (appData.lines || []) : [lineFilter];
        
        // Excel Başlıkları
        const header = [
            "Hat",
            "İstasyon",
            "NFC Kart Uid (Kart ID)"
        ];

        const data = [header];
        
        lines.forEach(line => {
            const stations = [...(appData.stations?.[line] || [])];
            // İstasyonları durak sıralarına göre dizelim
            const stationNums = appData.stationNumbers?.[line] || {};
            stations.sort((a, b) => {
                const numA = stationNums[a] !== undefined ? stationNums[a] : 999;
                const numB = stationNums[b] !== undefined ? stationNums[b] : 999;
                if (numA !== numB) return numA - numB;
                return a.localeCompare(b, 'tr');
            });

            stations.forEach(station => {
                data.push([
                    line,
                    station,
                    "" // Kullanıcı burayı dolduracak
                ]);
            });
        });

        const worksheet = XLSX.utils.aoa_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "NFC Şablonu");
        
        // Kolon genişlikleri ayarla
        worksheet['!cols'] = [
            { wch: 10 }, // Hat
            { wch: 20 }, // İstasyon
            { wch: 30 }  // NFC Kart Uid (Kart ID)
        ];

        const fileName = lineFilter === 'all' ? 'istasyon_nfc_sablonu_hepsi.xlsx' : `istasyon_nfc_sablonu_${lineFilter}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        showToast('NFC şablonu başarıyla indirildi.');
    } catch (error) {
        console.error("NFC Şablon indirme hatası:", error);
        showToast("Şablon indirilirken bir hata oluştu: " + error.message, "error");
    }
}

function exportNfcsToExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');
        return;
    }

    const lineFilter = document.getElementById('nfc-filter-line')?.value || 'all';
    const lines = lineFilter === 'all' ? (appData.lines || []) : [lineFilter];
    
    const excelData = [];
    
    lines.forEach(line => {
        const stations = appData.stations?.[line] || [];
        stations.forEach(station => {
            const nfcKey = `${line}_${station}`;
            const nfcData = appData.stationNfcs?.[nfcKey];
            const nfcUid = (nfcData && nfcData.uid) ? nfcData.uid : '';
            
            excelData.push({
                'Hat': line,
                'İstasyon': station,
                'NFC Kart Uid (Kart ID)': nfcUid || 'Tanımlanmamış',
                'Durum': nfcUid ? 'Tanımlı' : 'Tanımsız'
            });
        });
    });

    if (excelData.length === 0) {
        showToast('Aktarılacak veri bulunamadı.');
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'NFC Listesi');

    const max_widths = [
        { wch: 10 },
        { wch: 25 },
        { wch: 30 },
        { wch: 15 }
    ];
    worksheet['!cols'] = max_widths;

    XLSX.writeFile(workbook, `Metro_Istanbul_NFC_Listesi_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('Excel raporu başarıyla indirildi.');
}

function openNfcEditModal(line, station, currentUid) {
    document.getElementById('nfc-edit-line').value = line;
    document.getElementById('nfc-edit-station').value = station;
    document.getElementById('nfc-modal-line-display').textContent = line;
    document.getElementById('nfc-modal-station-display').textContent = station;
    document.getElementById('nfc-uid-input').value = currentUid || '';
    document.getElementById('nfc-modal').style.display = 'flex';
}

function closeNfcModal() {
    document.getElementById('nfc-modal').style.display = 'none';
    document.getElementById('nfc-edit-line').value = '';
    document.getElementById('nfc-edit-station').value = '';
    document.getElementById('nfc-uid-input').value = '';
}

async function saveNfcUid() {
    const line = document.getElementById('nfc-edit-line').value;
    const station = document.getElementById('nfc-edit-station').value;
    const uid = document.getElementById('nfc-uid-input').value.trim();

    if (!line || !station) {
        showToast('Hata: Hat ve istasyon bilgileri eksik.');
        return;
    }

    const saveBtn = document.querySelector('#nfc-modal .btn-primary');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const nfcKey = `${line}_${station}`;
        const updatedNfcs = { ...appData.stationNfcs };
        if (uid) {
            updatedNfcs[nfcKey] = { uid: uid };
        } else {
            delete updatedNfcs[nfcKey];
        }

        await db.collection('system_config').doc('lines_stations').update({
            stationNfcs: updatedNfcs
        });
        showToast('NFC kodu başarıyla güncellendi.');
        closeNfcModal();
    } catch (err) {
        console.error('NFC kaydetme hatası:', err);
        showToast('Hata: ' + (err.message || 'Kayıt başarısız oldu.'));
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function importNfcsFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                showToast('Dosya boş veya veri bulunamadı.');
                return;
            }

            let updatedCount = 0;
            const updatedNfcs = { ...appData.stationNfcs };

            jsonData.forEach(row => {
                const line = (row['Hat'] || row['line'] || '').toString().trim();
                const station = (row['İstasyon'] || row['istasyon'] || row['station'] || '').toString().trim();
                const rawUid = row['NFC Kart Uid (Kart ID)'] || row['NFC Kart Uid'] || row['NFC UID'] || row['UID'] || row['Nfc'] || row['nfc'] || row['nfc_uid'] || '';
                const uid = rawUid.toString().trim();

                if (line && station && uid) {
                    const exists = appData.lines?.includes(line) && appData.stations?.[line]?.includes(station);
                    if (exists) {
                        const nfcKey = `${line}_${station}`;
                        updatedNfcs[nfcKey] = { uid: uid };
                        updatedCount++;
                    }
                }
            });

            if (updatedCount > 0) {
                await db.collection('system_config').doc('lines_stations').update({
                    stationNfcs: updatedNfcs
                });
                showToast(`${updatedCount} adet istasyonun NFC kodu başarıyla yüklendi.`);
            } else {
                showToast('Yüklenecek uygun hat ve istasyon eşleşmesi bulunamadı. Lütfen Excel formatını kontrol edin.', 'warning');
            }
        } catch (err) {
            console.error('Excel içe aktarım hatası:', err);
            showToast('Excel dosyası işlenirken bir hata oluştu.', 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function populateLocationLineFilter() {
    const select = document.getElementById('location-filter-line');
    if (!select) return;
    const current = select.value || 'all';
    select.innerHTML = '<option value="all">Tüm Hatlar</option>';
    (appData.lines || []).forEach(line => {
        select.add(new Option(line, line));
    });
    select.value = current;
}

function renderLocationList() {
    const tableBody = document.getElementById('location-table-body');
    const emptyState = document.getElementById('location-empty-state');
    if (!tableBody) return;

    const lineFilter = document.getElementById('location-filter-line')?.value || 'all';
    const searchInput = document.getElementById('location-search-input');
    const query = (searchInput?.value || '').toLowerCase().trim();

    let html = '';
    let matchCount = 0;

    const lines = lineFilter === 'all' ? (appData.lines || []) : [lineFilter];
    
    lines.forEach(line => {
        const stations = [...(appData.stations?.[line] || [])];
        const stationNums = appData.stationNumbers?.[line] || {};
        stations.sort((a, b) => {
            const numA = stationNums[a] !== undefined ? stationNums[a] : 999;
            const numB = stationNums[b] !== undefined ? stationNums[b] : 999;
            if (numA !== numB) {
                return numA - numB;
            }
            return a.localeCompare(b, 'tr');
        });

        stations.forEach(station => {
            const locKey = `${line}_${station}`;
            const locData = appData.stationLocations?.[locKey];
            const lat = (locData && locData.latitude) ? locData.latitude : '';
            const lng = (locData && locData.longitude) ? locData.longitude : '';
            const radius = (locData && locData.radius) ? locData.radius : '';
            
            const matchesSearch = !query || 
                station.toLowerCase().includes(query) || 
                line.toLowerCase().includes(query) ||
                lat.toString().includes(query) ||
                lng.toString().includes(query);

            if (matchesSearch) {
                matchCount++;
                const color = appData.lineColors?.[line] || '#64748b';
                const hasLoc = lat && lng;
                const badgeHtml = hasLoc 
                    ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-check-circle"></i> Tanımlı</span>`
                    : `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-exclamation-triangle"></i> Tanımsız</span>`;
                
                const escapedLine = escapeAttr(line).replace(/'/g, "\\'");
                const escapedStation = escapeAttr(station).replace(/'/g, "\\'");

                html += `
                    <tr style="border-bottom: 1px solid var(--border-main); transition: background 0.2s;">
                        <td style="padding: 12px 16px;">
                            <span class="profile-line-logo" style="background-color: ${color}; color: white; font-weight: bold; font-size: 0.65rem; width: 22px; height: 22px; border-radius: 50%;">${escapeAttr(line)}</span>
                        </td>
                        <td style="padding: 12px 16px; font-weight: 600; color: var(--text-primary);">${escapeAttr(station)}</td>
                        <td style="padding: 12px 16px; font-family: monospace; font-size: 0.9rem; color: var(--text-primary); font-weight: 700;">
                            ${hasLoc ? `${lat}, ${lng}` : '<span style="color: var(--text-dim); font-weight: normal; font-style: italic;">Tanımlanmamış</span>'}
                        </td>
                        <td style="padding: 12px 16px; font-weight: 600; color: var(--text-primary);">${radius ? `${radius} m` : '-'}</td>
                        <td style="padding: 12px 16px; text-align: center;">${badgeHtml}</td>
                        <td style="padding: 12px 16px; text-align: center;">
                            <button class="btn-outline" onclick="openLocationEditModal('${escapedLine}', '${escapedStation}', '${lat}', '${lng}', '${radius}')" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                                <i class="fas fa-edit"></i> Düzenle
                            </button>
                        </td>
                    </tr>
                `;
            }
        });
    });

    tableBody.innerHTML = html;
    if (emptyState) {
        emptyState.style.display = matchCount === 0 ? 'flex' : 'none';
    }
}

function openLocationEditModal(line, station, currentLat, currentLng, currentRadius) {
    document.getElementById('location-edit-line').value = line;
    document.getElementById('location-edit-station').value = station;
    document.getElementById('location-modal-line-display').textContent = line;
    document.getElementById('location-modal-station-display').textContent = station;
    document.getElementById('location-lat-input').value = currentLat || '';
    document.getElementById('location-lng-input').value = currentLng || '';
    document.getElementById('location-radius-input').value = currentRadius || '50';
    document.getElementById('location-quick-paste').value = '';
    document.getElementById('location-modal').style.display = 'flex';
}

function closeLocationModal() {
    document.getElementById('location-modal').style.display = 'none';
    document.getElementById('location-edit-line').value = '';
    document.getElementById('location-edit-station').value = '';
    document.getElementById('location-lat-input').value = '';
    document.getElementById('location-lng-input').value = '';
    document.getElementById('location-radius-input').value = '';
    document.getElementById('location-quick-paste').value = '';
}

async function saveLocationCoords() {
    const line = document.getElementById('location-edit-line').value;
    const station = document.getElementById('location-edit-station').value;
    const latVal = document.getElementById('location-lat-input').value.trim();
    const lngVal = document.getElementById('location-lng-input').value.trim();
    const radiusVal = document.getElementById('location-radius-input').value.trim();

    if (!line || !station) {
        showToast('Hata: Hat ve istasyon bilgileri eksik.');
        return;
    }

    const saveBtn = document.querySelector('#location-modal .btn-primary');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const locKey = `${line}_${station}`;
        const updatedLocations = { ...appData.stationLocations };
        if (latVal && lngVal) {
            updatedLocations[locKey] = {
                latitude: parseFloat(latVal),
                longitude: parseFloat(lngVal),
                radius: radiusVal ? parseFloat(radiusVal) : 50
            };
        } else {
            delete updatedLocations[locKey];
        }

        await db.collection('system_config').doc('lines_stations').update({
            stationLocations: updatedLocations
        });
        showToast('Konum koordinatları başarıyla güncellendi.');
        closeLocationModal();
    } catch (err) {
        console.error('Konum kaydetme hatası:', err);
        showToast('Hata: ' + (err.message || 'Kayıt başarısız oldu.'));
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function dmsToDecimal(dmsStr) {
    if (!dmsStr) return NaN;
    dmsStr = dmsStr.trim();
    // 41°01'11.25"N veya 41° 01' 11.25" N formatı
    const regex = /(\d+)\s*°\s*(\d+)\s*'\s*([\d.]+)\s*"\s*([NSEWnsew])/;
    const match = dmsStr.match(regex);
    if (match) {
        const degrees = parseFloat(match[1]);
        const minutes = parseFloat(match[2]);
        const seconds = parseFloat(match[3]);
        const direction = match[4].toUpperCase();
        
        let decimal = degrees + (minutes / 60) + (seconds / 3600);
        if (direction === 'S' || direction === 'W') {
            decimal = -decimal;
        }
        return parseFloat(decimal.toFixed(6));
    }
    
    // Eğer sadece decimal ise
    const cleanStr = dmsStr.replace(',', '.');
    const decVal = parseFloat(cleanStr);
    if (!isNaN(decVal) && /^[-+]?\d*\.?\d+$/.test(cleanStr)) return decVal;
    return NaN;
}

function handleQuickPaste(event) {
    const val = event.target.value.trim();
    if (!val) return;
    
    // Komple yapıştırma durumlarını yakalayalım:
    // Örnek 1: 41°01'11.25"N 28°55'15.08"E (DMS)
    // Örnek 2: 41.012345, 28.956789 (Ondalık Virgüllü)
    // Örnek 3: 41.012345 28.956789 (Ondalık Boşluklu)
    
    const doubleDmsRegex = /(\d+°\s*\d+'\s*[\d.]+"\s*[NSns])\s+[,;\s]*\s*(\d+°\s*\d+'\s*[\d.]+"\s*[EWew])/i;
    const doubleDecRegex = /^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/;

    let matchDms = val.match(doubleDmsRegex);
    let matchDec = val.match(doubleDecRegex);

    if (matchDms) {
        const latDec = dmsToDecimal(matchDms[1]);
        const lngDec = dmsToDecimal(matchDms[2]);
        if (!isNaN(latDec) && !isNaN(lngDec)) {
            document.getElementById('location-lat-input').value = latDec;
            document.getElementById('location-lng-input').value = lngDec;
            showToast('Konum (DMS) başarıyla desimale dönüştürüldü.', 'info');
        }
    } else if (matchDec) {
        const latDec = parseFloat(matchDec[1]);
        const lngDec = parseFloat(matchDec[2]);
        if (!isNaN(latDec) && !isNaN(lngDec)) {
            document.getElementById('location-lat-input').value = latDec;
            document.getElementById('location-lng-input').value = lngDec;
            showToast('Koordinatlar başarıyla ayrıştırıldı.', 'info');
        }
    }
}

function parseLocationInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    
    const dec = dmsToDecimal(val);
    if (!isNaN(dec)) {
        input.value = dec;
    }
}

function downloadLocationTemplate() {
    try {
        if (typeof XLSX === 'undefined') {
            showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');
            return;
        }

        const lineFilter = document.getElementById('location-filter-line')?.value || 'all';
        const lines = lineFilter === 'all' ? (appData.lines || []) : [lineFilter];
        
        // Excel Başlıkları (Enlem ve Boylam formülleri tamamen kaldırıldı, sistem arka planda parse edecek)
        const header = [
            "Hat",
            "İstasyon",
            "Google Earth Koordinatı (DMS)",
            "Yarıçap (Radius)"
        ];

        const data = [header];
        
        lines.forEach(line => {
            const stations = [...(appData.stations?.[line] || [])];
            // İstasyonları sıralayalım
            const stationNums = appData.stationNumbers?.[line] || {};
            stations.sort((a, b) => {
                const numA = stationNums[a] !== undefined ? stationNums[a] : 999;
                const numB = stationNums[b] !== undefined ? stationNums[b] : 999;
                if (numA !== numB) return numA - numB;
                return a.localeCompare(b, 'tr');
            });

            stations.forEach(station => {
                data.push([
                    line,
                    station,
                    "", // Google Earth Koordinatı (DMS) - Kullanıcı doğrudan dizeyi yapıştıracak
                    50  // Varsayılan yarıçap
                ]);
            });
        });

        const worksheet = XLSX.utils.aoa_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Konum Şablonu");
        
        // Kolon genişlikleri ayarla
        worksheet['!cols'] = [
            { wch: 10 }, // Hat
            { wch: 20 }, // İstasyon
            { wch: 35 }, // Google Earth Koordinatı (DMS)
            { wch: 15 }  // Yarıçap
        ];

        const fileName = lineFilter === 'all' ? 'istasyon_konum_sablonu_hepsi.xlsx' : `istasyon_konum_sablonu_${lineFilter}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        showToast('Örnek konum şablonu başarıyla indirildi.');
    } catch (error) {
        console.error("Şablon indirme hatası:", error);
        showToast("Şablon indirilirken bir hata oluştu: " + error.message, "error");
    }
}

function exportLocationsToExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');
        return;
    }

    const lineFilter = document.getElementById('location-filter-line')?.value || 'all';
    const lines = lineFilter === 'all' ? (appData.lines || []) : [lineFilter];
    
    const excelData = [];
    
    lines.forEach(line => {
        const stations = appData.stations?.[line] || [];
        stations.forEach(station => {
            const locKey = `${line}_${station}`;
            const locData = appData.stationLocations?.[locKey];
            const lat = (locData && locData.latitude) ? locData.latitude : '';
            const lng = (locData && locData.longitude) ? locData.longitude : '';
            const radius = (locData && locData.radius) ? locData.radius : '';
            
            excelData.push({
                'Hat': line,
                'İstasyon': station,
                'Enlem (Latitude)': lat || '',
                'Boylam (Longitude)': lng || '',
                'Yarıçap (Radius)': radius || '',
                'Durum': (lat && lng) ? 'Tanımlı' : 'Tanımsız'
            });
        });
    });

    if (excelData.length === 0) {
        showToast('Aktarılacak veri bulunamadı.');
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Konum Listesi');

    const max_widths = [
        { wch: 10 },
        { wch: 25 },
        { wch: 20 },
        { wch: 20 },
        { wch: 15 },
        { wch: 15 }
    ];
    worksheet['!cols'] = max_widths;

    XLSX.writeFile(workbook, `Metro_Istanbul_Konum_Listesi_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('Excel raporu başarıyla indirildi.');
}

async function importLocationsFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                showToast('Dosya boş veya veri bulunamadı.');
                return;
            }

            let updatedCount = 0;
            const updatedLocations = { ...appData.stationLocations };

            jsonData.forEach(row => {
                const line = (row['Hat'] || row['line'] || '').toString().trim();
                const station = (row['İstasyon'] || row['istasyon'] || row['station'] || '').toString().trim();
                
                const rawLat = row['Enlem (Latitude)'] || row['Enlem'] || row['Latitude'] || row['lat'] || row['latitude'] || '';
                const rawLng = row['Boylam (Longitude)'] || row['Boylam'] || row['Longitude'] || row['lng'] || row['longitude'] || row['lon'] || '';
                const rawRadius = row['Yarıçap (Radius)'] || row['Yarıçap'] || row['Radius'] || row['radius'] || row['range'] || '';
                const rawCoord = row['Google Earth Koordinatı (DMS)'] || row['Google Earth Koordinati'] || row['Koordinat'] || row['coordinate'] || '';

                let lat = dmsToDecimal(rawLat.toString().trim());
                let lng = dmsToDecimal(rawLng.toString().trim());

                if ((Number.isNaN(lat) || Number.isNaN(lng)) && rawCoord) {
                    const coordStr = rawCoord.toString().trim();
                    const doubleDmsRegex = /(\d+°\s*\d+'\s*[\d.]+"\s*[NSns])\s+[,;\s]*\s*(\d+°\s*\d+'\s*[\d.]+"\s*[EWew])/i;
                    const doubleDecRegex = /^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/;

                    let matchDms = coordStr.match(doubleDmsRegex);
                    let matchDec = coordStr.match(doubleDecRegex);

                    if (matchDms) {
                        lat = dmsToDecimal(matchDms[1]);
                        lng = dmsToDecimal(matchDms[2]);
                    } else if (matchDec) {
                        lat = parseFloat(matchDec[1]);
                        lng = parseFloat(matchDec[2]);
                    }
                }

                let radius = parseFloat(rawRadius.toString().trim());
                if (Number.isNaN(radius) || radius <= 0) {
                    radius = 50; // default to 50
                }

                if (line && station && !Number.isNaN(lat) && !Number.isNaN(lng)) {
                    const exists = appData.lines?.includes(line) && appData.stations?.[line]?.includes(station);
                    if (exists) {
                        const locKey = `${line}_${station}`;
                        updatedLocations[locKey] = {
                            latitude: lat,
                            longitude: lng,
                            radius: radius
                        };
                        updatedCount++;
                    }
                }
            });

            if (updatedCount > 0) {
                await db.collection('system_config').doc('lines_stations').update({
                    stationLocations: updatedLocations
                });
                showToast(`${updatedCount} adet istasyonun konum bilgisi başarıyla yüklendi.`);
            } else {
                showToast('Yüklenecek uygun hat, istasyon ve koordinat eşleşmesi bulunamadı. Lütfen Excel formatını kontrol edin.', 'warning');
            }
        } catch (err) {
            console.error('Excel içe aktarım hatası:', err);
            showToast('Excel dosyası işlenirken bir hata oluştu.', 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}







function initNCFilters() {
    renderUnifiedDateOptions('nc');
    updateUnifiedDateTriggerLabel('nc');
    const activeNCs = getFilteredNCs();
    const lines = [...new Set(activeNCs.map(n => {
        const audit = getAccessibleAuditById(n.auditId) || {};
        return audit.line || n.line || 'N/A';
    }))].sort((a, b) => a.localeCompare(b, 'tr'));

    const stations = [...new Set(activeNCs.map(n => {
        const audit = getAccessibleAuditById(n.auditId) || {};
        return audit.station || n.station || 'N/A';
    }))].sort((a, b) => a.localeCompare(b, 'tr'));

    const categories = [...new Set(activeNCs.map(n => n.category))].sort((a, b) => a.localeCompare(b, 'tr'));

    const years = [...new Set(activeNCs.map(n => {
        const audit = getAccessibleAuditById(n.auditId) || {};
        const dateStr = n.detectionDate || n.date || audit.date;
        return dateStr ? new Date(dateStr).getFullYear().toString() : null;
    }).filter(Boolean))].sort((a, b) => Number(b) - Number(a));

    const responsibles = [...new Set(activeNCs.map(n => {
        const audit = getAccessibleAuditById(n.auditId) || {};
        return getNcResponsibleTitle(n, audit);
    }).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));

    const lineSelect = document.getElementById('filter-nc-line');
    const stationSelect = document.getElementById('filter-nc-station');
    const catSelect = document.getElementById('filter-nc-category');
    const yearSelect = document.getElementById('filter-nc-year');
    const monthSelect = document.getElementById('filter-nc-month');
    const statusSelect = document.getElementById('filter-nc-status');
    const respSelect = document.getElementById('filter-nc-responsible');

    if (lineSelect) {
        const current = getMultiSelectValues(lineSelect);
        lineSelect.innerHTML = '<option value="all">Tüm Hatlar</option>';
        lines.forEach(l => lineSelect.add(new Option(l, l)));
        setMultiSelectValues(lineSelect, current);
    }
    if (stationSelect) {
        const current = getMultiSelectValues(stationSelect);
        stationSelect.innerHTML = '<option value="all">Tüm İstasyonlar</option>';
        stations.forEach(s => stationSelect.add(new Option(s, s)));
        setMultiSelectValues(stationSelect, current);
    }
    if (catSelect) {
        const current = getMultiSelectValues(catSelect);
        catSelect.innerHTML = '<option value="all">Tüm Kategoriler</option>';
        categories.forEach(c => catSelect.add(new Option(c, c)));
        setMultiSelectValues(catSelect, current);
    }
    if (yearSelect) {
        const current = getMultiSelectValues(yearSelect);
        yearSelect.innerHTML = '<option value="all">Tüm Yıllar</option>';
        years.forEach(y => yearSelect.add(new Option(y, y)));
        setMultiSelectValues(yearSelect, current);
    }
    if (monthSelect) {
        const current = getMultiSelectValues(monthSelect);
        setMultiSelectValues(monthSelect, current);
    }
    if (statusSelect) {
        const current = getMultiSelectValues(statusSelect);
        setMultiSelectValues(statusSelect, current);
    }
    if (respSelect) {
        const current = getMultiSelectValues(respSelect);
        respSelect.innerHTML = '<option value="all">Tüm Kullanıcılar</option>';
        responsibles.forEach(r => respSelect.add(new Option(r, r)));
        setMultiSelectValues(respSelect, current);
    }
    if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
    }
}

function userMatchesLineScope(user, line) {
    if (hasGlobalScope(user)) return true;
    const lines = Array.isArray(user?.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
    if (!lines.length) return false;
    return lines.includes(line);
}

function isAuditTypeActive(typeId, typeName) {
    if (!appData.auditTypes) return true;
    const type = appData.auditTypes.find(t => 
        (typeId && String(t.id) === String(typeId)) || 
        (!typeId && typeName && (String(t.title) === String(typeName) || String(t.name) === String(typeName)))
    );
    if (!type) return true;
    return type.isActive !== false;
}

function getFilteredAudits() {
    if (!currentUser) return [];

    let audits = (appData.audits || []).filter(audit => {
        const typeId = audit.auditTypeId;
        const typeName = audit.auditType || audit.type;
        return isAuditTypeActive(typeId, typeName);
    });

    if (hasGlobalScope(currentUser)) return audits;

    const roleId = inferRbacRoleId(currentUser);
    if (roleId === 'Field_Auditor') {
        const auditorKey = currentUser.username || currentUser.name;
        return audits.filter(audit =>
            audit.auditorName === auditorKey &&
            userMatchesLineScope(currentUser, audit.line)
        );
    }

    return audits.filter(audit => userMatchesLineScope(currentUser, audit.line));
}

function getFilteredNCs() {
    if (!currentUser) return [];

    let ncs = getActiveNonconformities().filter(nc => {
        const audit = (appData.audits || []).find(a => String(a.id) === String(nc.auditId));
        if (audit) {
            const typeId = audit.auditTypeId;
            const typeName = audit.auditType || audit.type;
            if (!isAuditTypeActive(typeId, typeName)) return false;
        } else {
            const typeId = nc.auditTypeId;
            const typeName = nc.auditType || nc.type;
            if ((typeId || typeName) && !isAuditTypeActive(typeId, typeName)) return false;
        }
        return true;
    });

    return ncs.filter(nc => {
        const audit = getAccessibleAuditById(nc.auditId) || {};
        const ncLine = audit.line || nc.line || 'N/A';

        if (hasGlobalScope(currentUser)) return true;

        const roleId = inferRbacRoleId(currentUser);
        if (roleId === 'Field_Auditor') {
            return nc.auditorName === (currentUser.username || currentUser.name) &&
                userMatchesLineScope(currentUser, ncLine);
        }

        return userMatchesLineScope(currentUser, ncLine);
    });
}

function getScopedAuditLines() {
    if (!currentUser) return [];

    if (hasGlobalScope(currentUser)) {
        const knownLines = [
            ...(appData.lines || []),
            ...(appData.audits || []).map(audit => audit.line).filter(Boolean)
        ];
        return [...new Set(knownLines)].sort((a, b) => a.localeCompare(b, 'tr'));
    }

    return [...new Set(
        (Array.isArray(currentUser.authorizedLines) ? currentUser.authorizedLines : [])
            .map(line => String(line || '').trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr'));
}

function getAccessibleAuditById(id) {
    return getFilteredAudits().find(audit => String(audit.id) === String(id)) || null;
}

// Mobil uygulama ile ortak fotoğraf yolu çözümleme
function isLocalDevicePhotoPath(pathStr) {
    return pathStr.startsWith('/') ||
        pathStr.startsWith('file://') ||
        pathStr.startsWith('content://') ||
        pathStr.startsWith('C:') ||
        pathStr.startsWith('D:');
}

function gsPathToHttpsUrl(pathStr) {
    const parts = pathStr.replace('gs://', '').split('/');
    const bucket = parts.shift();
    const objPath = encodeURIComponent(parts.join('/'));
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${objPath}?alt=media`;
}

function resolveImagePath(pathStr) {
    if (!pathStr) return '';
    if (pathStr.startsWith('http://') || pathStr.startsWith('https://') || pathStr.startsWith('data:')) {
        return pathStr;
    }
    if (pathStr.startsWith('assets/')) {
        return '../denetim_app/' + pathStr;
    }
    if (pathStr.startsWith('gs://')) {
        return gsPathToHttpsUrl(pathStr);
    }
    if (pathStr.startsWith('mock_')) {
        return `https://picsum.photos/seed/${encodeURIComponent(pathStr)}/400/300`;
    }
    if (isLocalDevicePhotoPath(pathStr)) {
        return '';
    }
    if (pathStr.includes('firebasestorage.googleapis.com')) {
        return pathStr;
    }
    return '';
}

function findNcForAuditAnswer(audit, ans, categoryName = '', questionText = '') {
    if (!audit || !appData.nonconformities) return null;
    const answerQuestion = resolveAuditAnswerQuestion(audit, ans);
    const resolvedQuestionText = questionText || answerQuestion.questionText || '';
    const resolvedCategoryName = categoryName || answerQuestion.categoryName || '';
    const auditNcs = appData.nonconformities.filter(n =>
        n &&
        !n.isDeleted &&
        !n.deleted &&
        !n.deletedAt &&
        String(n.auditId) === String(audit.id)
    );

    return auditNcs.find(n =>
        ans?.questionId &&
        n.questionId &&
        String(n.questionId) === String(ans.questionId)
    ) || auditNcs.find(n =>
        normalizeText(n.questionText) &&
        normalizeText(n.questionText) === normalizeText(resolvedQuestionText)
    ) || auditNcs.find(n =>
        normalizeText(n.category) === normalizeText(resolvedCategoryName) &&
        normalizeText(n.questionText).includes(normalizeText(resolvedQuestionText).substring(0, 10))
    ) || null;
}

function collectAuditAnswerPhotoPaths(audit, ans) {
    const merged = new Set();
    const nc = findNcForAuditAnswer(audit, ans);
    const closurePaths = new Set((nc?.closurePhotoPaths || []).filter(Boolean));
    normalizeAuditPhotoPaths(ans)
        .filter(path => !closurePaths.has(path))
        .forEach(path => merged.add(path));
    (nc?.auditorPhotoPaths || []).forEach(p => merged.add(p));
    return Array.from(merged);
}

function collectAuditAnswerClosurePhotoPaths(audit, ans) {
    const nc = findNcForAuditAnswer(audit, ans);
    return [...new Set((nc?.closurePhotoPaths || []).filter(Boolean))];
}

const _resolvedImageUrlCache = {};

async function resolveImagePathAsync(pathStr) {
    if (!pathStr) return '';
    const cached = _resolvedImageUrlCache[pathStr];
    if (cached) return cached;

    const syncResolved = resolveImagePath(pathStr);
    if (syncResolved) {
        _resolvedImageUrlCache[pathStr] = syncResolved;
        return syncResolved;
    }

    if (isLocalDevicePhotoPath(pathStr)) {
        return '';
    }

    try {
        if (typeof storage !== 'undefined' && storage) {
            let storagePath = pathStr;
            if (pathStr.startsWith('gs://')) {
                storagePath = pathStr.replace('gs://', '').split('/').slice(1).join('/');
            }
            if (!storagePath.startsWith('http') && !isLocalDevicePhotoPath(storagePath)) {
                const url = await storage.ref(storagePath).getDownloadURL();
                _resolvedImageUrlCache[pathStr] = url;
                return url;
            }
        }
    } catch (e) {
        console.warn('Storage getDownloadURL failed:', pathStr, e);
    }
}

// Sayfalama Ortak Fonksiyonu (Hem Denetimler hem de Uygunsuzluklar tabloları için)
function renderTablePagination(containerId, currentPage, totalPages, onPageChange) {
    let pContainer = document.getElementById(containerId);
    if (!pContainer) {
        pContainer = document.createElement('div');
        pContainer.id = containerId;
        pContainer.className = 'table-pagination-container';
        pContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 1rem; margin-top: 1rem; border-top: 1px solid var(--border-main); flex-wrap: wrap; gap: 1rem;';
        
        // Tablonun responsive sarmalayıcısının yanına yerleştir
        const table = document.getElementById(containerId.replace('-pagination', ''));
        if (table) {
            const responsiveWrapper = table.closest('.table-responsive');
            if (responsiveWrapper) {
                responsiveWrapper.parentNode.appendChild(pContainer);
            } else {
                table.parentNode.insertBefore(pContainer, table.nextSibling);
            }
        }
    }
    
    if (totalPages <= 1) {
        pContainer.innerHTML = '';
        pContainer.style.display = 'none';
        return;
    }
    pContainer.style.display = 'flex';
    
    let html = `
        <div style="font-size: 0.78rem; color: var(--text-dim); font-weight: 600;">
            Sayfa ${currentPage} / ${totalPages}
        </div>
        <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
            <button class="btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.72rem; border-radius: 8px;" ${currentPage === 1 ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : `onclick="${onPageChange}(${currentPage - 1})"`}>
                <i class="fas fa-chevron-left"></i> Önceki
            </button>
    `;
    
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
        const isCurrent = i === currentPage;
        const btnStyle = isCurrent 
            ? 'background: linear-gradient(135deg, var(--primary), #7c3aed); color: white; border: none;' 
            : '';
        html += `
            <button class="${isCurrent ? 'btn-primary' : 'btn-secondary'}" style="padding: 0.35rem 0.75rem; font-size: 0.72rem; min-width: 32px; border-radius: 8px; ${btnStyle}" onclick="${onPageChange}(${i})">
                ${i}
            </button>
        `;
    }
    
    html += `
            <button class="btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.72rem; border-radius: 8px;" ${currentPage === totalPages ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : `onclick="${onPageChange}(${currentPage + 1})"`}>
                Sonraki <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
    pContainer.innerHTML = html;
}

window.changeNcPage = function(page) {
    ncCurrentPage = page;
    renderNCs();
};

window.changeAuditsPage = function(page) {
    auditsCurrentPage = page;
    renderAllAuditsTable();
};

function getAuditListDate(audit) {
    return statsToDate(audit?.date || audit?.completedAt || audit?.createdAt);
}

function getNcListDate(nc) {
    const audit = getAccessibleAuditById(nc?.auditId) || {};
    return statsToDate(nc?.detectionDate || nc?.createdAt || nc?.date || audit.date);
}

function sortRecordsByDate(items, direction, dateResolver) {
    const multiplier = direction === 'asc' ? 1 : -1;
    return items.sort((left, right) => {
        const leftTime = dateResolver(left)?.getTime();
        const rightTime = dateResolver(right)?.getTime();
        const leftValid = Number.isFinite(leftTime);
        const rightValid = Number.isFinite(rightTime);
        if (!leftValid && !rightValid) return 0;
        if (!leftValid) return 1;
        if (!rightValid) return -1;
        return (leftTime - rightTime) * multiplier;
    });
}

function updateDateSortHeader(headerId, iconId, direction) {
    const header = document.getElementById(headerId);
    const icon = document.getElementById(iconId);
    const isDescending = direction === 'desc';
    if (header) header.setAttribute('aria-sort', isDescending ? 'descending' : 'ascending');
    if (icon) {
        icon.className = `fas ${isDescending ? 'fa-arrow-down' : 'fa-arrow-up'}`;
        icon.style.opacity = '1';
    }
    const button = header?.querySelector('button');
    if (button) {
        button.title = isDescending
            ? 'En yeni kayıtlar üstte. Eski kayıtları üste almak için tıklayın.'
            : 'En eski kayıtlar üstte. Yeni kayıtları üste almak için tıklayın.';
    }
}

function resetSortHeader(headerId, iconId) {
    const header = document.getElementById(headerId);
    const icon = document.getElementById(iconId);
    if (header) header.removeAttribute('aria-sort');
    if (icon) {
        icon.className = 'fas fa-sort';
        icon.style.opacity = '0.4';
    }
}

window.toggleAuditDateSort = function() {
    auditDateSortDirection = auditDateSortDirection === 'desc' ? 'asc' : 'desc';
    auditScoreSortDirection = null;
    auditsCurrentPage = 1;
    updateDateSortHeader('audit-date-sort-header', 'audit-date-sort-icon', auditDateSortDirection);
    resetSortHeader('audit-score-sort-header', 'audit-score-sort-icon');
    renderAllAuditsTable();
};

window.toggleAuditScoreSort = function() {
    if (auditScoreSortDirection === null) {
        auditScoreSortDirection = 'desc';
    } else {
        auditScoreSortDirection = auditScoreSortDirection === 'desc' ? 'asc' : 'desc';
    }
    auditDateSortDirection = null;
    auditsCurrentPage = 1;
    updateDateSortHeader('audit-score-sort-header', 'audit-score-sort-icon', auditScoreSortDirection);
    const scoreBtn = document.querySelector('#audit-score-sort-header button');
    if (scoreBtn) {
        scoreBtn.title = auditScoreSortDirection === 'desc'
            ? 'En yüksek puanlar üstte. Düşük puanları üste almak için tıklayın.'
            : 'En düşük puanlar üstte. Yüksek puanları üste almak için tıklayın.';
    }
    resetSortHeader('audit-date-sort-header', 'audit-date-sort-icon');
    renderAllAuditsTable();
};

window.toggleNcDateSort = function() {
    ncDateSortDirection = ncDateSortDirection === 'desc' ? 'asc' : 'desc';
    ncCurrentPage = 1;
    updateDateSortHeader('nc-date-sort-header', 'nc-date-sort-icon', ncDateSortDirection);
    renderNCs();
};

// NC Management Logic with App Parity
function renderNCs(filter) {
    if (filter !== undefined) {
        ncCurrentFilter = filter;
    } else {
        filter = ncCurrentFilter || 'Açık';
    }

    const selectedTypes = getMultiSelectValues('nc-filter-type');
    let allNcs = getFilteredNCs();
    if (selectedTypes.length) {
        allNcs = allNcs.filter(nc => selectedTypes.some(typeVal => filterByAuditType([nc], typeVal, getNonconformityTypeValues).length > 0));
    }
    const tbody = document.getElementById('nc-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Advanced Filters from UI
    const searchTerm = document.getElementById('nc-search-input')?.value.toLowerCase() || '';
    const filterLines = getMultiSelectValues('filter-nc-line');
    const filterStations = getMultiSelectValues('filter-nc-station');
    const filterCats = getMultiSelectValues('filter-nc-category');
    const filterYears = getMultiSelectValues('filter-nc-year');
    const filterMonths = getMultiSelectValues('filter-nc-month');
    const filterStatuses = getMultiSelectValues('filter-nc-status');
    const filterResponsibles = getMultiSelectValues('filter-nc-responsible');

    // Step 1: Apply Advanced Filters first to get the REALLY final list
    let filtered = allNcs.filter(nc => {
        const audit = getAccessibleAuditById(nc.auditId) || {};
        const ncLine = audit.line || nc.line || 'N/A';
        const ncStation = audit.station || nc.station || 'N/A';

        const ncDateStr = nc.detectionDate || nc.date || audit.date;
        const ncDate = ncDateStr ? new Date(ncDateStr) : null;

        const ncResp = getNcResponsibleTitle(nc, audit);

        let ncStatusKey = 'open';
        if (isNcClosed(nc)) ncStatusKey = 'completed';
        else if (isNcWaitingControl(nc)) ncStatusKey = 'waitingControl';
        else if (isNcOverdue(nc)) ncStatusKey = 'overdue';
        else if (isNcOpen(nc)) ncStatusKey = 'open';

        const matchesSearch = !searchTerm ||
            nc.id.toLowerCase().includes(searchTerm) ||
            nc.category.toLowerCase().includes(searchTerm) ||
            (nc.questionText || nc.detail || '').toLowerCase().includes(searchTerm) ||
            (nc.auditorComment || '').toLowerCase().includes(searchTerm) ||
            (nc.closureComment || '').toLowerCase().includes(searchTerm) ||
            (audit.station || '').toLowerCase().includes(searchTerm);

        const matchesLine = !filterLines.length || filterLines.includes(ncLine);
        const matchesStation = !filterStations.length || filterStations.includes(ncStation);
        const matchesCat = !filterCats.length || filterCats.includes(nc.category);

        // Unified Date Filters for NC
        let matchesUnifiedDate = true;
        if (ncDate) {
            const ncYear = ncDate.getFullYear().toString();
            const ncMonth = (ncDate.getMonth() + 1).toString();
            const uYears = unifiedDateFilters.nc.years || [];
            const uMonths = unifiedDateFilters.nc.months || [];
            const uWeeks = unifiedDateFilters.nc.weeks || [];
            const uDays = unifiedDateFilters.nc.days || [];

            if (uYears.length && !uYears.includes(ncYear)) matchesUnifiedDate = false;
            if (uMonths.length && !uMonths.includes(ncMonth)) matchesUnifiedDate = false;
            if (uWeeks.length && !uWeeks.includes(getISOWeekNumber(ncDate).toString())) matchesUnifiedDate = false;
            if (uDays.length && !uDays.includes(getLocalDateString(ncDate))) matchesUnifiedDate = false;
        } else {
            const uYears = unifiedDateFilters.nc.years || [];
            const uMonths = unifiedDateFilters.nc.months || [];
            const uWeeks = unifiedDateFilters.nc.weeks || [];
            const uDays = unifiedDateFilters.nc.days || [];
            if (uYears.length || uMonths.length || uWeeks.length || uDays.length) {
                matchesUnifiedDate = false;
            }
        }

        const matchesStatus = !filterStatuses.length || filterStatuses.includes(ncStatusKey);
        const matchesResp = !filterResponsibles.length || filterResponsibles.includes(ncResp);

        return matchesSearch && matchesLine && matchesStation && matchesCat && matchesUnifiedDate && matchesStatus && matchesResp;
    });

    // Step 2: Update status tabs counts based on ADVANCED filtered data
    if (document.getElementById('nc-count-all')) document.getElementById('nc-count-all').innerText = filtered.length;
    if (document.getElementById('nc-count-open')) document.getElementById('nc-count-open').innerText = filtered.filter(isNcOpen).length;
    if (document.getElementById('nc-count-closed')) document.getElementById('nc-count-closed').innerText = filtered.filter(isNcClosed).length;
    if (document.getElementById('nc-count-delayed')) document.getElementById('nc-count-delayed').innerText = filtered.filter(isNcOverdue).length;
    if (document.getElementById('nc-count-control')) document.getElementById('nc-count-control').innerText = filtered.filter(isNcWaitingControl).length;

    // Step 3: Apply Status Tab Filter
    const isStationType = selectedTypes.some(type => isStationAuditTypeId(type));
    if (isStationType && (filter === 'Geciken' || filter === 'Kontrol')) {
        filter = 'Açık';
    }
    const statusPredicates = {
        'Açık': isNcOpen,
        'Kapalı': isNcClosed,
        'Geciken': isNcOverdue,
        'Kontrol': isNcWaitingControl
    };
    if (statusPredicates[filter]) {
        filtered = filtered.filter(statusPredicates[filter]);
    }

    sortRecordsByDate(filtered, ncDateSortDirection, getNcListDate);
    updateDateSortHeader('nc-date-sort-header', 'nc-date-sort-icon', ncDateSortDirection);

    if (!filtered.length) {
        tbody.innerHTML = `
            <tr class="nc-empty-row">
                <td colspan="11">
                    <div class="nc-empty-state">
                        <i class="fas fa-check-circle"></i>
                        <span>Filtrelere uygun uygunsuzluk kaydı bulunamadı.</span>
                    </div>
                </td>
            </tr>
        `;
        syncNCSelectionUI();
        // Sayfalama kabını sıfırla
        renderTablePagination('nc-table-pagination', 1, 0, 'changeNcPage');
        return;
    }

    // Sayfalama Sınır ve Dilimleme Ayarı
    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    if (ncCurrentPage > totalPages) {
        ncCurrentPage = Math.max(1, totalPages);
    }
    const startIdx = (ncCurrentPage - 1) * ITEMS_PER_PAGE;
    const paginatedNCs = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    paginatedNCs.forEach(nc => {
        const audit = appData.audits.find(a => a.id === nc.auditId) || {};
        const tr = document.createElement('tr');
        const rowStatus = String(nc.status || 'open').replace(/[^a-zA-Z0-9_-]/g, '');
        tr.className = `nc-table-row nc-table-row--${rowStatus || 'open'}`;
        let statusStyle = '';
        let statusText = '';

        if (nc.status === 'open' || nc.status === 'inProgress') {
            statusStyle = 'background: rgba(59, 130, 246, 0.1); color: #3b82f6; border-color: rgba(59, 130, 246, 0.2);';
            statusText = 'AÇIK';
        } else if (nc.status === 'completed') {
            statusStyle = 'background: rgba(16, 185, 129, 0.1); color: #10b981; border-color: rgba(16, 185, 129, 0.2);';
            statusText = 'KAPALI';
        } else if (nc.status === 'overdue') {
            statusStyle = 'background: rgba(225, 29, 72, 0.1); color: #E11D48; border-color: rgba(225, 29, 72, 0.2);';
            statusText = 'GECİKEN';
        } else if (nc.status === 'waitingControl') {
            statusStyle = 'background: rgba(245, 158, 11, 0.1); color: #f59e0b; border-color: rgba(245, 158, 11, 0.2);';
            statusText = 'KONTROL';
        }

        const hasPhotos = (nc.auditorPhotoPaths && nc.auditorPhotoPaths.length > 0) || (nc.closurePhotoPaths && nc.closurePhotoPaths.length > 0);
        const firstPhoto = (nc.auditorPhotoPaths && nc.auditorPhotoPaths[0]) || (nc.closurePhotoPaths && nc.closurePhotoPaths[0]);
        const resolvedPhoto = resolveImagePath(firstPhoto);
        const photoThumb = (hasPhotos && resolvedPhoto)
            ? `<div onclick="openImagePreview('${resolvedPhoto}'); event.stopPropagation();" style="width: 28px; height: 28px; border-radius: 7px; overflow: hidden; background: #f8fafc; border: 1px solid #ddd; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Görseli büyük aç">
                <img src="${resolvedPhoto}" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.parentElement.innerHTML='<i class=\'fas fa-image\' style=\'color:#94a3b8;font-size:1rem\'></i>';this.parentElement.style.display='flex';this.parentElement.style.alignItems='center';this.parentElement.style.justifyContent='center';">
               </div>`
            : `<div style="width: 28px; height: 28px; border-radius: 7px; background: #f8fafc; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 0.72rem;"><i class="fas fa-camera"></i></div>`;

        let actionBtns = `
            <div class="nc-row-actions">
                <button class="btn-outline" style="padding: 4px 8px; font-size: 0.7rem;" onclick="shareNC('${nc.id}')" title="PDF İndir"><i class="fas fa-download"></i></button>
            </div>
        `;

        if (nc.status === 'open' || nc.status === 'inProgress' || nc.status === 'overdue') {
            const canClose = hasPermission('nc_close');
            const canApprove = hasPermission('nc_approve');
            actionBtns = `
                <div class="nc-row-actions">
                    ${canClose ? `<button class="btn-primary" style="padding: 4px 10px; font-size: 0.7rem; background: #3b82f6;" onclick="openNCCloseModal('${nc.id}')">Kapat</button>` : ''}
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 0.7rem;" onclick="shareNC('${nc.id}')" title="PDF İndir"><i class="fas fa-download"></i></button>
                </div>
            `;
        } else if (nc.status === 'waitingControl') {
            const canApproveNc = hasPermission('nc_approve');
            actionBtns = `
                <div class="nc-row-actions">
                    ${canApproveNc ? `
                        <button class="btn-primary" style="padding: 4px 10px; font-size: 0.7rem; background: #10b981;" onclick="approveNC('${nc.id}')">Onayla</button>
                        <button class="btn-outline" style="padding: 4px 10px; font-size: 0.7rem; color: #ef4444; border-color: #ef4444;" onclick="rejectNC('${nc.id}')">Reddet</button>
                    ` : '<span style="font-size: 0.65rem; color: var(--text-dim);">Onay yetkisi bekleniyor</span>'}
                </div>
            `;
        } else if (nc.status === 'completed') {
             actionBtns = `
                <div class="nc-row-actions">
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 0.7rem;" onclick="shareNC('${nc.id}')" title="PDF İndir"><i class="fas fa-download"></i></button>
                </div>
            `;
        }

        const ncDateObj = new Date(nc.detectionDate || nc.date || audit.date);
        const dateFormatted = isNaN(ncDateObj.getTime()) ? '-' : ncDateObj.toLocaleDateString('tr-TR');
        const timeFormatted = isNaN(ncDateObj.getTime()) ? '-' : ncDateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const line = audit.line || nc.line || 'N/A';
        const station = audit.station || nc.station || 'N/A';
        const owner = getNcResponsibleTitle(nc, audit);
        const auditorComment = String(nc.auditorComment || '').trim();
        const closureComment = String(nc.closureComment || '').trim();
        
        const closedByName = getAuditorDisplayName(nc.closedByName) || getAuditorDisplayName(nc.auditorName) || owner || '-';
        const approvedByName = (nc.approvedByName && nc.approvedByName !== '-')
            ? nc.approvedByName
            : (nc.status === 'completed' ? 'Ramazan Tilki' : '-');
        
        let closureMetaHtml = '';
        if (nc.status === 'completed' || nc.status === 'waitingControl') {
            closureMetaHtml = `
                <div class="nc-closure-meta" style="margin-top:4px; font-size:0.68rem; color: var(--text-secondary); display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
                    <span><i class="fas fa-user-pen" style="color: #2563eb; margin-right: 4px;"></i><strong>Kapatan:</strong> ${escapeAttr(closedByName)}</span>
                    ${nc.status === 'completed' ? `<span><i class="fas fa-user-check" style="color: #16a34a; margin-right: 4px;"></i><strong>Onaylayan:</strong> ${escapeAttr(approvedByName)}</span>` : ''}
                </div>
            `;
        }

        const ans = audit.answers ? audit.answers.find(a => String(a.questionId) === String(nc.questionId) || String(a.questionText) === String(nc.questionText)) : null;
        const firstCommentHtml = ans ? (ans.comment || ans.detail || '').trim() : nc.detail;

        const ncWeekNum = isNaN(ncDateObj.getTime()) ? '-' : getISOWeekNumber(ncDateObj);

        tr.innerHTML = `
            <td><input type="checkbox" class="nc-row-select" data-nc-id="${nc.id}" ${appData.selectedNCIds.has(nc.id) ? 'checked' : ''} onchange="toggleNCSelection(this)"></td>
            <td class="nc-date-cell">${dateFormatted}</td>
            <td class="nc-week-cell" style="text-align:center; font-size:0.8rem; color:var(--text-dim); font-weight:600;">${ncWeekNum !== '-' ? `${ncWeekNum}. Hf` : '-'}</td>
            <td><span style="color: var(--text-dim); font-weight: 500;">${timeFormatted}</span></td>
            <td style="text-align:center;">${photoThumb}</td>
            <td class="nc-detail-cell" title="Uygunsuzluğu incele">
                <div class="nc-category-text">${nc.category}</div>
                <div class="nc-question-text">${nc.questionText || 'Belirtilmedi'}</div>
                ${firstCommentHtml ? `<div class="nc-comment-text" style="margin-top:4px; font-size:0.7rem; color:#64748b;"><strong>Açıklama:</strong> ${firstCommentHtml}</div>` : ''}
                ${closureComment ? `<div class="nc-closure-text"><strong>Kapanış:</strong> ${escapeAttr(closureComment)}</div>` : ''}
                ${closureMetaHtml}
            </td>
            <td style="text-align:center;">
                <div class="line-logo" style="background: ${appData.lineColors[line] || '#64748b'}; margin: 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; font-size: 0.54rem; border-radius: 50%; color: #fff; font-weight: 900;">${line}</div>
            </td>
            <td style="max-width: 140px;">
                <div style="font-weight: 800; color: var(--text-primary); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${station}">${station}</div>
            </td>
            <td class="nc-owner-cell">${owner}</td>
            <td><span class="status-badge" style="${statusStyle}">${statusText}</span></td>
            <td>${actionBtns}</td>
        `;
        const commentLabel = tr.querySelector('.nc-comment-text strong');
        if (commentLabel) commentLabel.textContent = 'Açıklama:';
        tr.addEventListener('click', event => {
            if (event.target.closest('button, input, a, select, textarea')) return;
            inspectNC(nc.id);
        });
        tbody.appendChild(tr);
    });
    syncNCSelectionUI();
    // Sayfalama butonlarını çiz
    renderTablePagination('nc-table-pagination', ncCurrentPage, totalPages, 'changeNcPage');
}

async function loadNCPhotosForPdf(nc) {
    const paths = [
        ...(nc.auditorPhotoPaths || []),
        ...(nc.closurePhotoPaths || [])
    ].filter(Boolean);
    const loaded = [];
    for (const p of paths) {
        const url = await resolveImagePathAsync(p);
        if (url) {
            const img = await loadAuditPdfImage(url);
            loaded.push({ ...img, type: (nc.closurePhotoPaths || []).includes(p) ? 'closure' : 'auditor' });
        }
    }
    return loaded;
}

function drawNCPdfHero(doc, nc, audit, y) {
    const margin = 15;
    const pageW = 210;
    const isClosed = isNcClosed(nc);
    const statusText = isClosed ? 'KAPALI' : 'AÇIK';
    const statusColorHex = isClosed ? '#10b981' : '#f59e0b';
    const statusRgb = hexToRgb(statusColorHex);
    
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, pageW - margin * 2, 22, 2, 2, 'FD');
    doc.setFillColor(statusRgb[0], statusRgb[1], statusRgb[2]);
    doc.rect(margin, y, 3, 22, 'F');
    
    const lineLabel = (audit.line || nc.line || '');
    const shortLineLabel = lineLabel.length > 3 ? lineLabel.substring(0, 3) : lineLabel;
    const lineColorHex = (typeof appData !== 'undefined' && appData.lineColors && appData.lineColors[lineLabel]) ? appData.lineColors[lineLabel] : '#0f172a';
    const lineRgb = hexToRgb(lineColorHex);

    const circleSize = 18;
    const circleX = margin + 6;
    const circleY = y + 2;
    
    if (shortLineLabel) {
        doc.setFillColor(lineRgb[0], lineRgb[1], lineRgb[2]);
        doc.circle(circleX + circleSize / 2, circleY + circleSize / 2, circleSize / 2, 'F');
        setAuditPdfFont(doc, 'bold');
        doc.setFontSize(10.5);
        setAuditPdfRgb(doc, [255, 255, 255]);
        auditPdfText(doc, shortLineLabel, circleX + circleSize / 2, circleY + circleSize / 2, { align: 'center', baseline: 'middle' });
    }

    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(11);
    setAuditPdfRgb(doc, [15, 23, 42]);
    const stationX = shortLineLabel ? (circleX + circleSize + 3) : (margin + 6);
    auditPdfText(doc, audit.station || nc.station || 'Istasyon Yok', stationX, y + 10);
    
    setAuditPdfFont(doc, 'normal');
    doc.setFontSize(8);
    setAuditPdfRgb(doc, [100, 116, 139]);
    const ncDateStr = nc.detectionDate || nc.date || audit.date;
    auditPdfText(doc, `${nc.category || 'Kategori Yok'} | Tespit: ${formatAuditPdfDate(ncDateStr)}`, stationX, y + 16);
    
    doc.setFillColor(statusRgb[0], statusRgb[1], statusRgb[2]);
    doc.roundedRect(pageW - margin - 30, y + 7, 24, 8, 1, 1, 'F');
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(8);
    setAuditPdfRgb(doc, [255, 255, 255]);
    auditPdfText(doc, statusText, pageW - margin - 18, y + 12.5, { align: 'center' });

    return y + 22;
}

function drawNCPdfDetailBlock(doc, nc, categoryName, questionText, loadedPhotos, y) {
    const margin = 15;
    const pageW = 210;
    const contentW = pageW - margin * 2;
    const isClosed = isNcClosed(nc);
    const statusColorRgb = isClosed ? [34, 197, 94] : [227, 30, 36];

    const fullHeader = auditPdfStr(`Kategori: ${categoryName} \nBulgu: ${questionText}`);
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(8);
    const headerLines = doc.splitTextToSize(fullHeader, contentW - 6);
    const headerH = 2 + headerLines.length * 4;

    let bodyH = 0;
    const auditorNote = (nc.auditorComment || '').trim();
    let auditorLines = [];
    if (auditorNote) {
        setAuditPdfFont(doc, 'normal');
        doc.setFontSize(7.5);
        auditorLines = doc.splitTextToSize(auditPdfStr(`Denetçi Açıklaması: ${auditorNote}`), contentW - 8);
        bodyH += auditorLines.length * 4 + 3;
    }

    const closureNote = (nc.closureComment || '').trim();
    let closureLines = [];
    if (closureNote) {
        setAuditPdfFont(doc, 'normal');
        doc.setFontSize(7.5);
        closureLines = doc.splitTextToSize(auditPdfStr(`Çözüm Açıklaması: ${closureNote}`), contentW - 14);
    }

    const auditorPhotos = loadedPhotos.filter(photo => photo && photo.dataUrl && photo.type !== 'closure');
    const closurePhotos = loadedPhotos.filter(photo => photo && photo.dataUrl && photo.type === 'closure');
    const detectionImage = { width: 40, height: 30, columns: 4, gap: 4 };
    const resolutionImage = { width: 78, height: 48, columns: 2, gap: 8 };
    const photoGroupHeight = (photos, layout) => photos.length > 0
        ? 6 + Math.ceil(photos.length / layout.columns) * (layout.height + 5)
        : 0;

    bodyH += photoGroupHeight(auditorPhotos, detectionImage);

    const hasResolution = Boolean(closureNote || closurePhotos.length > 0);
    const closureBlockH = hasResolution
        ? 12
            + (closureLines.length > 0 ? closureLines.length * 4 + 3 : 0)
            + photoGroupHeight(closurePhotos, resolutionImage)
            + 3
        : 0;
    if (hasResolution) bodyH += closureBlockH + 4;

    const totalH = headerH + bodyH + (bodyH > 0 ? 5 : 2);
    y = auditPdfEnsureSpace(doc, y, totalH + 6);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.setFillColor(252, 253, 255);
    doc.rect(margin, y, contentW, totalH, 'FD');

    doc.setFillColor(statusColorRgb[0], statusColorRgb[1], statusColorRgb[2]);
    doc.rect(margin, y, 1.5, totalH, 'F');

    let currentY = y + 5;
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(8);
    setAuditPdfRgb(doc, [15, 23, 42]);
    auditPdfText(doc, headerLines, margin + 4, currentY);
    currentY += headerH - 2;

    if (bodyH > 0) {
        doc.setDrawColor(241, 245, 249);
        doc.line(margin + 2, currentY, pageW - margin - 2, currentY);
        currentY += 4;
    }

    setAuditPdfFont(doc, 'normal');
    doc.setFontSize(7.5);
    setAuditPdfRgb(doc, [51, 65, 85]);

    if (auditorNote) {
        auditPdfText(doc, auditorLines, margin + 4, currentY);
        currentY += auditorLines.length * 4 + 3;
    }

    function drawPhotoGroup(
        photos,
        startY,
        heading,
        labelPrefix,
        borderRgb,
        headingRgb,
        layout
    ) {
        if (photos.length === 0) return startY;

        setAuditPdfFont(doc, 'bold');
        doc.setFontSize(7.5);
        setAuditPdfRgb(doc, headingRgb);
        auditPdfText(doc, heading, margin + 5, startY + 3);

        const imageStartY = startY + 6;
        photos.forEach((photo, index) => {
            const row = Math.floor(index / layout.columns);
            const column = index % layout.columns;
            const imgX = margin + 5 + column * (layout.width + layout.gap);
            const imgY = imageStartY + row * (layout.height + 5);
            try {
                doc.addImage(
                    photo.dataUrl,
                    'JPEG',
                    imgX,
                    imgY,
                    layout.width,
                    layout.height
                );
                doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
                doc.setLineWidth(0.35);
                doc.rect(imgX, imgY, layout.width, layout.height);
                doc.setFontSize(6);
                setAuditPdfFont(doc, 'bold');
                setAuditPdfRgb(doc, headingRgb);
                auditPdfText(
                    doc,
                    `${labelPrefix} ${index + 1}`,
                    imgX + (layout.width / 2),
                    imgY + layout.height + 3,
                    { align: 'center' }
                );
            } catch (e) {}
        });

        return imageStartY
            + Math.ceil(photos.length / layout.columns) * (layout.height + 5);
    }

    currentY = drawPhotoGroup(
        auditorPhotos,
        currentY,
        'TESPİT FOTOĞRAFLARI',
        'Tespit',
        [147, 197, 253],
        [37, 99, 235],
        detectionImage
    );

    if (hasResolution) {
        currentY += 4;
        doc.setFillColor(240, 253, 244);
        doc.setDrawColor(134, 239, 172);
        doc.setLineWidth(0.35);
        doc.roundedRect(margin + 3, currentY, contentW - 6, closureBlockH, 2, 2, 'FD');

        let resolutionY = currentY + 6;
        setAuditPdfFont(doc, 'bold');
        doc.setFontSize(9);
        setAuditPdfRgb(doc, [21, 128, 61]);
        auditPdfText(doc, 'ÇÖZÜM VE KAPANIŞ', margin + 6, resolutionY);
        resolutionY += 6;

        if (closureLines.length > 0) {
            setAuditPdfFont(doc, 'normal');
            doc.setFontSize(7.5);
            setAuditPdfRgb(doc, [22, 101, 52]);
            auditPdfText(doc, closureLines, margin + 6, resolutionY);
            resolutionY += closureLines.length * 4 + 3;
        }

        resolutionY = drawPhotoGroup(
            closurePhotos,
            resolutionY,
            'ÇÖZÜM FOTOĞRAFLARI',
            'Çözüm',
            [74, 222, 128],
            [21, 128, 61],
            resolutionImage
        );

        currentY += closureBlockH;
    }

    return y + totalH + 2;
}

async function renderNCDetailsToPdf(doc, nc, audit, imageCache, startY = 20, isBulk = false, pageIndex = 1, totalPages = 1) {
    let y = startY;
    const margin = 15;
    const pageW = 210;

    doc.setFillColor(227, 30, 36); 
    doc.rect(0, 0, 210, 3, 'F');

    try {
        const logoData = await getCorporateLogoBase64();
        if (logoData) {
            doc.addImage(logoData, 'PNG', margin, y - 8, 15, 12);
        }
    } catch(e) {}

    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(18);
    setAuditPdfRgb(doc, [11, 42, 74]);
    auditPdfText(doc, 'UYGUNSUZLUK RAPORU', margin + 20, y);
    
    setAuditPdfFont(doc, 'normal');
    doc.setFontSize(8);
    auditPdfText(doc, 'Kayit ID: ' + String(nc.id).substring(0,8), pageW - margin, y - 3, { align: 'right' });
    const ncDateStr = nc.detectionDate || nc.date || audit.date;
    const ncPdfWeekNum = ncDateStr ? getISOWeekNumber(new Date(ncDateStr)) : '-';
    const ncPdfWeekText = ncPdfWeekNum !== '-' ? ` (${ncPdfWeekNum}. Hafta)` : '';
    auditPdfText(doc, 'Tarih: ' + formatAuditPdfDate(ncDateStr) + ncPdfWeekText, pageW - margin, y + 2, { align: 'right' });
    
    if (isBulk) {
        doc.setFontSize(7);
        auditPdfText(doc, `Kayit ${pageIndex} / ${totalPages}`, pageW - margin, y + 6, { align: 'right' });
    }
    
    doc.setDrawColor(227, 30, 36);
    doc.setLineWidth(0.5);
    doc.line(margin, y + 8, pageW - margin, y + 8);
    
    y += 16;
    y = drawNCPdfHero(doc, nc, audit, y);
    y += 10;
    
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(12);
    setAuditPdfRgb(doc, [11, 42, 74]);
    y = auditPdfEnsureSpace(doc, y, 12);
    auditPdfText(doc, 'UYGUNSUZLUK DETAYI', margin, y);
    y += 2;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    const questionText = nc.questionText || nc.detail || 'Soru metni bulunamadi';
    const categoryName = nc.category || 'Kategori Yok';
    const loadedPhotos = imageCache[nc.id] || [];
    
    y = drawNCPdfDetailBlock(doc, nc, categoryName, questionText, loadedPhotos, y);
}

async function shareNC(id) {
    const nc = getFilteredNCs().find(n => String(n.id) === String(id));
    if (!nc) {
        showToast('Uygunsuzluk kaydı bulunamadı!');
        return;
    }
    const audit = getAccessibleAuditById(nc.auditId) || {};

    try {
        showToast('Uygunsuzluk PDF indiriliyor...');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        await ensureAuditPdfFonts(doc);

        const imageCache = {};
        imageCache[nc.id] = await loadNCPhotosForPdf(nc);

        await renderNCDetailsToPdf(doc, nc, audit, imageCache, 20, false, 1, 1);

        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(6);
            setAuditPdfFont(doc, 'normal');
            setAuditPdfRgb(doc, [148, 163, 184]);
            auditPdfText(doc, 'Bu belge elektronik denetim sistemi tarafindan otomatik olarak uretilmistir.', 105, 292, { align: 'center' });
        }

        const d = toAuditPdfDate(nc.detectionDate || nc.date || audit.date);
        const datePart = `${String(d.getDate()).padStart(2, '0')}_${String(d.getMonth() + 1).padStart(2, '0')}_${d.getFullYear()}`;
        const outputFileName = `${audit.line || nc.line || 'Hat'}_${audit.station || nc.station || 'Istasyon'}_${datePart}_Uygunsuzluk_Raporu.pdf`.replace(/ /g, '_');
        await handleBulkPdfOutput(doc, outputFileName, 'Uygunsuzluk Takibi Raporu', 'download');
    } catch (err) {
        console.error('NC PDF download error:', err);
        showToast(`PDF indirilemedi: ${err && err.message ? err.message : 'bilinmeyen hata'}`);
    }
}

function toggleAuditSelection(checkbox) {
    const id = checkbox.getAttribute('data-audit-id');
    if (!id) return;
    if (checkbox.checked) appData.selectedAuditIds.add(id);
    else appData.selectedAuditIds.delete(id);
    syncAuditSelectionUI();
}

function toggleSelectAllAudits(checkbox) {
    document.querySelectorAll('.audit-row-select').forEach(input => {
        input.checked = checkbox.checked;
        const id = input.getAttribute('data-audit-id');
        if (!id) return;
        if (checkbox.checked) appData.selectedAuditIds.add(id);
        else appData.selectedAuditIds.delete(id);
    });
    syncAuditSelectionUI();
}

function syncAuditSelectionUI() {
    const selectedCount = appData.selectedAuditIds.size;
    const shareBtn = document.getElementById('bulk-audit-share-btn');
    const downloadBtn = document.getElementById('bulk-audit-download-btn');
    const deleteBtn = document.getElementById('bulk-audit-delete-btn');
    if (shareBtn) {
        shareBtn.style.display = selectedCount > 0 ? 'inline-flex' : 'none';
        shareBtn.innerHTML = `<i class="fas fa-download"></i> PDF İndir (${selectedCount})`;
    }
    if (downloadBtn) {
        downloadBtn.style.display = selectedCount > 0 ? 'inline-flex' : 'none';
        downloadBtn.innerHTML = `<i class="fas fa-download"></i> İndir (${selectedCount})`;
    }
    if (deleteBtn) {
        deleteBtn.style.display = selectedCount > 0 ? 'inline-flex' : 'none';
        deleteBtn.innerHTML = `<i class="fas fa-trash-alt"></i> Seçilenleri Sil (${selectedCount})`;
    }

    const visible = Array.from(document.querySelectorAll('.audit-row-select'));
    const selectAll = document.getElementById('select-all-audits');
    if (selectAll) {
        selectAll.checked = visible.length > 0 && visible.every(input => input.checked);
        selectAll.indeterminate = visible.some(input => input.checked) && !selectAll.checked;
    }
}

async function deleteBulkAudits() {
    const selectedCount = appData.selectedAuditIds.size;
    if (selectedCount === 0) return;
    if (!confirm(`Seçilen ${selectedCount} denetim kaydını ve bunlara bağlı tüm uygunsuzlukları silmek istediğinize emin misiniz? Bu işlem geri alınamaz!`)) return;

    const btn = document.getElementById('bulk-audit-delete-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Siliniyor...';
    }

    try {
        const ids = Array.from(appData.selectedAuditIds);
        for (const id of ids) {
            // Delete related nonconformities first
            const relatedNCs = await db.collection('nonconformities').where('auditId', '==', id).get();
            for (const doc of relatedNCs.docs) {
                await doc.ref.delete();
            }
            // Delete the audit document
            await db.collection('audits').doc(id).delete();
        }

        showToast(`Seçilen ${selectedCount} denetim kaydı başarıyla silindi.`);
        appData.selectedAuditIds.clear();
        syncAuditSelectionUI();
        renderAllAuditsTable();
    } catch (err) {
        console.error('Bulk delete audits error:', err);
        showToast('Kayıtlar silinirken bir hata oluştu: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-trash-alt"></i> Seçilenleri Sil`;
        }
    }
}

function toggleNCSelection(checkbox) {
    const id = checkbox.getAttribute('data-nc-id');
    if (!id) return;
    if (checkbox.checked) appData.selectedNCIds.add(id);
    else appData.selectedNCIds.delete(id);
    syncNCSelectionUI();
}

function toggleSelectAllNCs(checkbox) {
    document.querySelectorAll('.nc-row-select').forEach(input => {
        input.checked = checkbox.checked;
        const id = input.getAttribute('data-nc-id');
        if (!id) return;
        if (checkbox.checked) appData.selectedNCIds.add(id);
        else appData.selectedNCIds.delete(id);
    });
    syncNCSelectionUI();
}

function syncNCSelectionUI() {
    const selectedCount = appData.selectedNCIds.size;
    const shareBtn = document.getElementById('bulk-nc-share-btn');
    const downloadBtn = document.getElementById('bulk-nc-download-btn');
    if (shareBtn) {
        shareBtn.style.display = selectedCount > 0 ? 'inline-flex' : 'none';
        shareBtn.innerHTML = `<i class="fas fa-download"></i> PDF İndir (${selectedCount})`;
    }

    const visible = Array.from(document.querySelectorAll('.nc-row-select'));
    const selectAll = document.getElementById('select-all-ncs');
    if (selectAll) {
        selectAll.checked = visible.length > 0 && visible.every(input => input.checked);
        selectAll.indeterminate = visible.some(input => input.checked) && !selectAll.checked;
    }
}

function inspectNC(id, parentAuditId = null) {
    console.log('Inspecting NC ID:', id);
    parentAuditIdForNC = parentAuditId;
    const nc = getFilteredNCs().find(n => String(n.id) === String(id));
    if (!nc) {
        console.warn('NC not found for ID:', id);
        showToast('Uygunsuzluk kaydı bulunamadı!');
        return;
    }
    const audit = getAccessibleAuditById(nc.auditId) || {};
    const auditUserName = audit.auditorName || nc.auditorName || nc.owner || 'Sistem';

    currentAuditId = audit.id || null;
    const modal = document.getElementById('audit-modal');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    if (!modal || !body || !title) return;
    modal.classList.add('nc-detail-modal');
    title.innerText = 'Uygunsuzluk Detayı';
    configureAuditModalFooter({
        showReport: true,
        reportLabel: 'Uygunsuzluk Raporu',
        reportAction: () => shareNC(nc.id)
    });

    const score = Number(nc.score) || 0;
    const normalizedStatus = normalizeNcStatus(nc.status);
    const statusMeta = {
        open: { label: 'Açık Kayıt', icon: 'fa-circle-exclamation', color: '#e11d48' },
        inProgress: { label: 'İşlem Devam Ediyor', icon: 'fa-spinner', color: '#2563eb' },
        overdue: { label: 'Gecikmiş', icon: 'fa-clock', color: '#ea580c' },
        waitingControl: { label: 'Kontrol Bekliyor', icon: 'fa-hourglass-half', color: '#d97706' },
        completed: { label: 'Kapatıldı', icon: 'fa-circle-check', color: '#16a34a' }
    }[normalizedStatus] || { label: 'Açık Kayıt', icon: 'fa-circle-exclamation', color: '#e11d48' };
    const scoreColor = score >= 4 ? '#16A34A' : '#E11D48';
    const ans = audit.answers ? audit.answers.find(a => String(a.questionId) === String(nc.questionId) || String(a.questionText) === String(nc.questionText)) : null;
    const commentParts = ans
        ? [(ans.comment || ans.detail || '').trim(), ...(Array.isArray(ans.additionalComments) ? ans.additionalComments : [])]
        : [nc.detail];
    const commentsHtml = commentParts
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(item => `<p>${escapeAttr(item)}</p>`)
        .join('');
    const recordDate = new Date(nc.detectionDate || nc.date || audit.date);
    const recordDateText = Number.isNaN(recordDate.getTime())
        ? '-'
        : recordDate.toLocaleString('tr-TR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    const recordDateWeekNum = isNaN(recordDate.getTime()) ? '-' : getISOWeekNumber(recordDate);
    const recordDateTextWithWeek = recordDateText + (recordDateWeekNum !== '-' ? ` (${recordDateWeekNum}. Hafta)` : '');
    const line = audit.line || nc.line || 'Hat Belirtilmedi';
    const station = audit.station || nc.station || 'İstasyon Belirtilmedi';
    const lineColor = appData.lineColors?.[line] || '#64748b';

    const closureDate = nc.closureDate ? new Date(nc.closureDate) : null;
    const closureDateText = closureDate && !Number.isNaN(closureDate.getTime())
        ? closureDate.toLocaleString('tr-TR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        : '-';
    const closedByName = nc.closedByName || nc.auditorName || auditUserName || '-';
    const approvedByName = (nc.approvedByName && nc.approvedByName !== '-')
        ? nc.approvedByName
        : (normalizedStatus === 'completed' ? 'Ramazan Tilki' : '-');

    body.innerHTML = `
        <div class="nc-detail-shell" style="--nc-status-color:${statusMeta.color};--nc-score-color:${scoreColor};--nc-line-color:${escapeAttr(lineColor)};">
            <section class="nc-detail-overview">
                <div class="nc-detail-overview-main">
                    <div class="nc-detail-badges">
                        <span class="nc-detail-status"><i class="fas ${statusMeta.icon}"></i>${statusMeta.label}</span>
                        <span class="nc-detail-score"><i class="fas fa-star"></i> Denetim Puanı: ${escapeAttr(score)}</span>
                    </div>
                    <div class="nc-detail-location">
                        <span class="nc-detail-line-logo">${escapeAttr(line)}</span>
                        <div>
                            <h2>${escapeAttr(station)}</h2>
                            <p>${escapeAttr(nc.category || 'Kategori Belirtilmedi')}</p>
                        </div>
                    </div>
                </div>
                <div class="nc-detail-overview-meta">
                    <span><i class="fas fa-calendar-day"></i> Kayıt Tarihi</span>
                    <strong>${escapeAttr(recordDateTextWithWeek)}</strong>
                </div>
            </section>

            <div class="nc-detail-grid">
                <section class="nc-detail-section nc-detail-section--finding">
                    <div class="nc-detail-section-heading">
                        <span><i class="fas fa-triangle-exclamation"></i></span>
                        <div><h3>Uygunsuzluk Bulgusu</h3><p>Denetimde tespit edilen soru veya kontrol maddesi</p></div>
                    </div>
                    <div class="nc-detail-text-card">${escapeAttr(nc.questionText || 'Belirtilmedi')}</div>
                </section>

                <section class="nc-detail-section nc-detail-section--owner">
                    <div class="nc-detail-section-heading">
                        <span><i class="fas fa-user-shield"></i></span>
                        <div><h3>Kayıt Sorumlusu</h3><p>Denetim kaydını oluşturan kullanıcı</p></div>
                    </div>
                    <div class="nc-detail-owner-card">
                        <span><i class="fas fa-user"></i></span>
                        <div><small>Kullanıcı</small><strong>${escapeAttr(auditUserName)}</strong></div>
                    </div>
                </section>
            </div>

            ${commentsHtml ? `
                <section class="nc-detail-section">
                    <div class="nc-detail-section-heading">
                        <span><i class="fas fa-message"></i></span>
                        <div><h3>Denetçi Açıklamaları</h3><p>Bulguya ilişkin saha notları ve ek açıklamalar</p></div>
                    </div>
                    <div class="nc-detail-comment-card">${commentsHtml}</div>
                </section>
            ` : ''}

            <section class="nc-detail-section nc-detail-section--evidence">
                <div class="nc-detail-section-heading">
                    <span><i class="fas fa-camera"></i></span>
                    <div><h3>Denetim Kanıtları</h3><p>Uygunsuzluk tespitinde eklenen görseller</p></div>
                </div>
                ${renderImageGallery(nc.auditorPhotoPaths || [])}
            </section>

            ${(nc.closureComment || (nc.closurePhotoPaths || []).length > 0) ? `
                <section class="nc-detail-resolution">
                    <div class="nc-detail-section-heading">
                        <span><i class="fas fa-circle-check"></i></span>
                        <div><h3>Çözüm ve Kapanış</h3><p>Uygunsuzluk için uygulanan düzeltici işlem</p></div>
                    </div>
                    
                    <div class="nc-resolution-meta-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px;">
                        <div class="nc-detail-owner-card" style="margin: 0;">
                            <span style="color: #ea580c; background: color-mix(in srgb, #ea580c 11%, transparent);"><i class="fas fa-calendar-check"></i></span>
                            <div><small>Kapatma Tarihi</small><strong>${escapeAttr(closureDateText)}</strong></div>
                        </div>
                        <div class="nc-detail-owner-card" style="margin: 0;">
                            <span style="color: #2563eb; background: color-mix(in srgb, #2563eb 11%, transparent);"><i class="fas fa-user-pen"></i></span>
                            <div><small>Kapatan Kişi</small><strong>${escapeAttr(closedByName)}</strong></div>
                        </div>
                        <div class="nc-detail-owner-card" style="margin: 0;">
                            <span style="color: #16a34a; background: color-mix(in srgb, #16a34a 11%, transparent);"><i class="fas fa-user-check"></i></span>
                            <div><small>Onaylayan Kişi</small><strong>${escapeAttr(approvedByName)}</strong></div>
                        </div>
                    </div>

                    ${nc.closureComment
                        ? `<div class="nc-detail-resolution-text" style="margin-bottom: 12px;">${escapeAttr(nc.closureComment)}</div>`
                        : ''}
                    <div class="nc-detail-resolution-evidence">
                        <span class="nc-detail-resolution-label"><i class="fas fa-images"></i> Çözüm Kanıtları</span>
                        ${renderImageGallery(nc.closurePhotoPaths || [])}
                    </div>
                </section>
            ` : ''}
        </div>
    `;

    modal.style.display = 'flex';
}

function getNcResponsibleTitle(nc, audit = {}) {
    const raw = audit.auditorName || nc.auditorName || nc.owner || 'Kullanıcı Atanmamış';
    return getAuditorDisplayName(raw);
}

function renderImageGallery(paths) {
    if (!paths || paths.length === 0) {
        return `
            <div class="nc-image-empty">
                <i class="fas fa-image"></i>
                <p>Görsel kaydı bulunmuyor</p>
            </div>
        `;
    }

    const validPaths = paths.map(p => resolveImagePath(p)).filter(p => p && p.length > 0);
    if (validPaths.length === 0) {
        return `
            <div class="nc-image-empty">
                <i class="fas fa-cloud-arrow-up"></i>
                <p>Görseller cihazda kayıtlı, sunucuya yüklenmemiş</p>
            </div>
        `;
    }

    return `
        <div class="nc-image-gallery">
            ${validPaths.map(resolved => {
                return `
                    <button type="button" class="nc-image-item" onclick="openImagePreview('${escapeAttr(jsArg(resolved))}')" title="Görseli büyüt">
                        <img src="${escapeAttr(resolved)}" alt="Uygunsuzluk kanıt görseli" loading="lazy"
                            onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                        <span class="nc-image-error"><i class="fas fa-image"></i> Yüklenemedi</span>
                        <span class="nc-image-zoom"><i class="fas fa-magnifying-glass-plus"></i></span>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

let selectedClosePhotos = [];

function openNCCloseModal(id) {
    document.getElementById('nc-close-id').value = id;
    document.getElementById('nc-close-comment').value = '';
    
    // Reset photo selection
    selectedClosePhotos = [];
    const input = document.getElementById('nc-photo-input');
    if (input) input.value = '';
    
    const previews = document.getElementById('nc-photo-previews');
    if (previews) previews.innerHTML = '';
    
    const btn = document.getElementById('nc-photo-btn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-camera" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i><span style="font-size: 0.8rem; font-weight: 600;">Kanıt Fotoğrafı Ekle</span>';
        btn.style.borderColor = '';
        btn.style.background = '';
    }

    document.getElementById('nc-close-modal').style.display = 'flex';
}

function closeNCModal() {
    document.getElementById('nc-close-modal').style.display = 'none';
}

function compressImage(file, maxWidth = 1200, quality = 0.75) {
    return new Promise((resolve) => {
        // 5 saniyelik güvenlik zaman aşımı (timeout)
        const timeoutId = setTimeout(() => {
            console.warn('Görsel sıkıştırma zaman aşımına uğradı, orijinal dosya kullanılıyor.');
            resolve(file);
        }, 5000);

        if (!file.type.startsWith('image/')) {
            clearTimeout(timeoutId);
            resolve(file);
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.src = objectUrl;

        img.onerror = (error) => {
            clearTimeout(timeoutId);
            URL.revokeObjectURL(objectUrl);
            console.warn('Görsel yüklenirken hata oluştu:', error);
            resolve(file);
        };

        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            URL.revokeObjectURL(objectUrl);

            if (!canvas.toBlob) {
                clearTimeout(timeoutId);
                resolve(file);
                return;
            }

            canvas.toBlob((blob) => {
                clearTimeout(timeoutId);
                if (!blob) {
                    resolve(file);
                    return;
                }
                // Blob olarak çözümlüyoruz (iOS File constructor hatasını önler)
                resolve(blob);
            }, 'image/jpeg', quality);
        };
    });
}

async function uploadToCloudinary(file, folder = 'nonconformities') {
    const cloudName = 'dpk2rnnfn';
    const uploadPreset = 'denetimuygulaması';
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', folder);

    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error('Cloudinary upload failed: ' + errText);
    }

    const data = await response.json();
    return data.secure_url;
}

async function processNCClose() {
    const id = document.getElementById('nc-close-id').value;
    const comment = document.getElementById('nc-close-comment').value;

    if (!comment.trim()) {
        showToast('Lütfen çözüm açıklamasını giriniz!');
        return;
    }

    if (selectedClosePhotos.length === 0) {
        showToast('Lütfen en az 1 adet çözüm kanıt fotoğrafı ekleyiniz!');
        return;
    }

    const saveBtn = document.querySelector('#nc-close-modal .btn-primary');
    let originalBtnHtml = '';
    if (saveBtn) {
        originalBtnHtml = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Yükleniyor...';
    }

    try {
        const uploadPromises = selectedClosePhotos.map(async (file, index) => {
            let uploadFile = file;
            try {
                showToast(`${index + 1}. fotoğraf optimize ediliyor...`);
                uploadFile = await compressImage(file, 1200, 0.75);
            } catch (compressErr) {
                console.warn('Compression failed, using original file:', compressErr);
            }

            showToast(`${index + 1}. fotoğraf yükleniyor...`);
            // Firebase Storage yerine Cloudinary kullanıyoruz (CORS kilitlenmesini engeller)
            const downloadUrl = await uploadToCloudinary(uploadFile, `nonconformities/${id}`);
            return downloadUrl;
        });

        const closurePhotoPaths = await Promise.all(uploadPromises);
        const closureName = currentUser ? (currentUser.name || currentUser.username || (currentUser.email ? currentUser.email.split('@')[0] : '')) : 'Admin';

        await db.collection('nonconformities').doc(id).update({
            status: 'waitingControl',
            closureComment: comment,
            closureDate: new Date().toISOString(),
            closedByName: closureName,
            closurePhotoPaths: closurePhotoPaths
        });

        showToast(`${id} kontrol için gönderildi.`);
        closeNCModal();
        if (typeof renderNCs === 'function') renderNCs();
    } catch (err) {
        console.error('NC Close Error:', err);
        alert('NC Close Error: ' + err.message + '\n' + err.stack);
        showToast('Fotoğraflar yüklenirken veya durum güncellenirken hata oluştu!');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnHtml;
        }
    }
}

function approveNC(id) {
    const approverName = currentUser ? (currentUser.name || currentUser.username || (currentUser.email ? currentUser.email.split('@')[0] : '')) : 'Admin';
    db.collection('nonconformities').doc(id).update({
        status: 'completed',
        approvedByName: approverName
    }).then(() => {
        showToast(`${id} onaylandı ve kapatıldı.`);
        const nc = appData.nonconformities.find(n => n.id === id);
        logActivity('Uygunsuzluk Onaylandı', `${nc ? nc.line : ''} hattı, ${nc ? nc.station : ''} istasyonundaki uygunsuzluk çözümü web panelinden onaylandı ve kapatıldı. (ID: ${id})`);
    }).catch(err => console.error('Approve Error:', err));
}

function rejectNC(id) {
    db.collection('nonconformities').doc(id).update({
        status: 'open',
        closureComment: firebase.firestore.FieldValue.delete(),
        closurePhotoPaths: firebase.firestore.FieldValue.delete(),
        closedByName: firebase.firestore.FieldValue.delete(),
        closureDate: firebase.firestore.FieldValue.delete()
    }).then(() => {
        showToast(`${id} reddedildi, tekrar açıldı.`);
        const nc = appData.nonconformities.find(n => n.id === id);
        logActivity('Uygunsuzluk Reddedildi', `${nc ? nc.line : ''} hattı, ${nc ? nc.station : ''} istasyonundaki uygunsuzluk çözümü web panelinden reddedildi. (ID: ${id})`);
    }).catch(err => console.error('Reject Error:', err));
}

function filterNCs(status, btn) {
    document.querySelectorAll('.nc-filter-btn').forEach(b => {
        b.classList.remove('active', 'btn-primary');
        b.classList.add('btn-outline');
        b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active', 'btn-primary');
    btn.classList.remove('btn-outline');
    btn.setAttribute('aria-selected', 'true');
    renderNCs(status);
}

let permissionsDirty = false;

const PERMISSION_PRESENTATION = {
    user_add_edit: { group: 'Kullanıcı ve Organizasyon', icon: 'fa-user-pen', description: 'Personel kayıtlarını oluşturma ve güncelleme' },
    user_delete: { group: 'Kullanıcı ve Organizasyon', icon: 'fa-user-minus', description: 'Personel kayıtlarını sistemden kaldırma' },
    perm_mgmt: { group: 'Kullanıcı ve Organizasyon', icon: 'fa-shield-halved', description: 'Rol ve modül erişimlerini değiştirme' },
    question_mgmt: { group: 'İçerik ve Tanımlar', icon: 'fa-list-check', description: 'Denetim tipleri, kategoriler ve soruları yönetme' },
    line_mgmt: { group: 'İçerik ve Tanımlar', icon: 'fa-route', description: 'Hat ve istasyon tanımlarını yönetme' },
    announcement_mgmt: { group: 'İçerik ve Tanımlar', icon: 'fa-bullhorn', description: 'Duyuruları oluşturma ve yayınlama' },
    planning: { group: 'Saha Operasyonları', icon: 'fa-calendar-days', description: 'Denetim görevlerini planlama ve takip etme' },
    audit_start: { group: 'Saha Operasyonları', icon: 'fa-clipboard-check', description: 'Yeni saha denetimi başlatma' },
    nc_close: { group: 'Uygunsuzluk Süreçleri', icon: 'fa-lock', description: 'Aksiyon tamamlanan uygunsuzlukları kapatma' },
    nc_approve: { group: 'Uygunsuzluk Süreçleri', icon: 'fa-circle-check', description: 'Uygunsuzluk aksiyonlarını onaylama' },
    nc_share: { group: 'Uygunsuzluk Süreçleri', icon: 'fa-share-nodes', description: 'Uygunsuzluk kayıtlarını paylaşma' },
    dashboard_view: { group: 'Analiz ve Raporlama', icon: 'fa-gauge-high', description: 'Yönetim dashboard ekranını görüntüleme' },
    stats_view: { group: 'Analiz ve Raporlama', icon: 'fa-chart-column', description: 'İstatistiksel analiz ekranına erişme' },
    export_data: { group: 'Analiz ve Raporlama', icon: 'fa-file-export', description: 'Excel ve PDF raporlarını dışa aktarma' },
    backup_data: { group: 'Sistem ve Güvenlik', icon: 'fa-database', description: 'Sistem verilerinin JSON yedeğini alma' },
    settings: { group: 'Sistem ve Güvenlik', icon: 'fa-sliders', description: 'Genel sistem ayarlarını değiştirme' }
};

const PERMISSION_GROUP_ORDER = [
    'Kullanıcı ve Organizasyon',
    'İçerik ve Tanımlar',
    'Saha Operasyonları',
    'Uygunsuzluk Süreçleri',
    'Analiz ve Raporlama',
    'Sistem ve Güvenlik',
    'Diğer Yetkiler'
];

function getPermissionPresentation(permission) {
    return PERMISSION_PRESENTATION[permission.id] || {
        group: 'Diğer Yetkiler',
        icon: 'fa-key',
        description: permission.label
    };
}

function getPermissionRoleColor(role, index = 0) {
    if (role.id === 'Super_Admin') return '#2563eb';
    const colors = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#e11d48'];
    return colors[Math.max(0, index - 1) % colors.length];
}

function updatePermissionsSaveState(dirty = permissionsDirty) {
    permissionsDirty = dirty;
    const status = document.getElementById('permissions-save-status');
    if (!status) return;
    status.classList.toggle('is-dirty', dirty);
    status.classList.toggle('is-saved', !dirty);
    const text = status.querySelector('.permissions-status-text');
    if (text) text.textContent = dirty ? 'Kaydedilmemiş değişiklikler var' : 'Tüm değişiklikler kayıtlı';
}

function updatePermissionsSummary() {
    const activeCount = RBAC_ROLES
        .filter(role => role.id !== 'Super_Admin')
        .reduce((total, role) => (
            total + RBAC_PERMISSION_MODULES.filter(mod => getMatrixPermissionValue(role.id, mod.id)).length
        ), 0);
    const values = {
        'permissions-role-count': RBAC_ROLES.length,
        'permissions-module-count': RBAC_PERMISSION_MODULES.length,
        'permissions-active-count': activeCount,
        'permissions-global-count': RBAC_ROLES.filter(role => role.isGlobal).length
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });

    document.querySelectorAll('[data-permission-role]').forEach(card => {
        const roleId = card.dataset.permissionRole;
        const roleActiveCount = RBAC_PERMISSION_MODULES.filter(mod => getMatrixPermissionValue(roleId, mod.id)).length;
        const count = card.querySelector('.permission-role-card-count');
        const footerCount = card.querySelector('.permission-role-active-count');
        if (count) count.textContent = `${roleActiveCount}/${RBAC_PERMISSION_MODULES.length}`;
        if (footerCount) footerCount.textContent = `${roleActiveCount} aktif yetki`;
    });
}

function filterPermissionMatrix() {
    const input = document.getElementById('permissions-search-input');
    const noResults = document.getElementById('permissions-no-results');
    const query = String(input?.value || '').trim().toLocaleLowerCase('tr-TR');
    const rows = Array.from(document.querySelectorAll('#permissions-matrix-body .permission-matrix-row'));
    let visibleCount = 0;

    rows.forEach(row => {
        const matches = !query || String(row.dataset.search || '').includes(query);
        row.style.display = matches ? '' : 'none';
        if (matches) visibleCount += 1;
    });

    document.querySelectorAll('#permissions-matrix-body .permission-group-row').forEach(groupRow => {
        const group = groupRow.dataset.group;
        const hasVisibleRows = rows.some(row => row.dataset.group === group && row.style.display !== 'none');
        groupRow.style.display = hasVisibleRows ? '' : 'none';
    });
    if (noResults) noResults.style.display = visibleCount ? 'none' : 'flex';
}

function renderPermissionsRoleLegend() {
    const legend = document.getElementById('permissions-role-legend');
    if (!legend) return;

    legend.innerHTML = RBAC_ROLES.map((role, index) => {
        const info = RBAC_ROLE_SCOPE_INFO[role.id] || {};
        const color = getPermissionRoleColor(role, index);
        return `
            <div class="permissions-legend-item" style="--role-color:${color};">
                <span class="permissions-legend-icon"><i class="fas ${info.icon || 'fa-user'}"></i></span>
                <span class="permissions-legend-copy">
                    <strong>${escapeAttr(role.name)}</strong>
                    <small>${role.isGlobal ? 'Küresel kapsam' : 'Atanmış hat kapsamı'}</small>
                </span>
                <span class="permissions-legend-scope">${role.isGlobal ? 'GLOBAL' : 'KISITLI'}</span>
            </div>
        `;
    }).join('');
}

function getMatrixPermissionValue(roleId, permId) {
    if (roleId === 'Super_Admin') return true;
    const rolePerms = appData.rolePermissions?.[roleId];
    if (rolePerms && rolePerms[permId] !== undefined) return !!rolePerms[permId];
    return !!getDefaultPermissionsForRole(roleId)[permId];
}

function getPermissionRoleMatrixLabel(role) {
    if (role.id === 'Field_Auditor_Action_Owner') return 'Denetçi + Aksiyon';
    return role.name;
}

function renderPermissions() {
    const matrixBody = document.getElementById('permissions-matrix-body');
    const descBody = document.getElementById('permissions-descriptions-body');
    if (!matrixBody || !descBody) return;

    matrixBody.innerHTML = '';
    descBody.innerHTML = '';

    try {
        const theadTr = document.querySelector('#permissions-view .matrix-table thead tr');
        if (theadTr) {
            theadTr.innerHTML = `
                <th class="permission-module-column">
                    <span>Modül / Yetki Tanımı</span>
                    <small>${RBAC_PERMISSION_MODULES.length} erişim kuralı</small>
                </th>
                ${RBAC_ROLES.map((role, index) => {
                    const info = RBAC_ROLE_SCOPE_INFO[role.id] || {};
                    const color = getPermissionRoleColor(role, index);
                    return `
                        <th class="permission-role-column" style="--role-color:${color};">
                            <div class="permission-role-heading">
                                <span class="permission-role-heading-icon"><i class="fas ${info.icon || 'fa-user'}"></i></span>
                                <strong title="${escapeAttr(role.name)}">${escapeAttr(getPermissionRoleMatrixLabel(role))}</strong>
                                <small>${role.isGlobal ? 'GLOBAL' : 'KISITLI'}</small>
                            </div>
                        </th>
                    `;
                }).join('')}
            `;
        }

        let currentGroup = '';
        const groupedPermissions = [...RBAC_PERMISSION_MODULES].sort((left, right) => {
            const leftIndex = PERMISSION_GROUP_ORDER.indexOf(getPermissionPresentation(left).group);
            const rightIndex = PERMISSION_GROUP_ORDER.indexOf(getPermissionPresentation(right).group);
            return leftIndex - rightIndex;
        });
        groupedPermissions.forEach(mod => {
            const presentation = getPermissionPresentation(mod);
            if (presentation.group !== currentGroup) {
                currentGroup = presentation.group;
                const groupRow = document.createElement('tr');
                groupRow.className = 'permission-group-row';
                groupRow.dataset.group = currentGroup;
                groupRow.innerHTML = `
                    <td colspan="${RBAC_ROLES.length + 1}">
                        <span>${escapeAttr(currentGroup)}</span>
                    </td>
                `;
                matrixBody.appendChild(groupRow);
            }

            const tr = document.createElement('tr');
            tr.className = 'permission-matrix-row';
            tr.dataset.group = currentGroup;
            tr.dataset.search = `${mod.label} ${mod.id} ${presentation.group} ${presentation.description}`.toLocaleLowerCase('tr-TR');

            let cellsHtml = `
                <td class="permission-module-cell">
                    <div class="permission-module-layout" title="${escapeAttr(`${presentation.description} (${mod.id})`)}">
                        <span class="permission-module-icon"><i class="fas ${presentation.icon}"></i></span>
                        <div class="permission-module-copy">
                            <strong>${escapeAttr(mod.label)}</strong>
                        </div>
                    </div>
                </td>
            `;

            RBAC_ROLES.forEach(role => {
                const has = getMatrixPermissionValue(role.id, mod.id);
                const isSuperAdmin = role.id === 'Super_Admin';
                const iconClass = has ? 'fa-check' : 'fa-xmark';
                const cellClickHandler = isSuperAdmin
                    ? ''
                    : `onclick="toggleMatrixPerm(this.querySelector('.permission-toggle'), '${role.id}', '${mod.id}')"`;

                cellsHtml += `
                    <td class="permission-toggle-cell ${isSuperAdmin ? 'is-locked' : ''}" ${cellClickHandler}>
                        <button type="button"
                            class="permission-toggle ${has ? 'is-enabled' : 'is-disabled'} ${isSuperAdmin ? 'is-locked' : ''}"
                            onclick="event.stopPropagation(); toggleMatrixPerm(this, '${role.id}', '${mod.id}')"
                            data-role-name="${escapeAttr(role.name)}"
                            data-permission-label="${escapeAttr(mod.label)}"
                            aria-pressed="${has}"
                            aria-disabled="${isSuperAdmin}"
                            aria-label="${escapeAttr(role.name)} - ${escapeAttr(mod.label)}: ${has ? 'Açık' : 'Kapalı'}"
                            title="${isSuperAdmin ? 'Süper Admin yetkileri sabittir' : `${role.name} erişimini ${has ? 'kapat' : 'aç'}`}">
                            <span class="permission-toggle-track">
                                <span class="permission-toggle-thumb"><i class="fa-solid ${iconClass}"></i></span>
                            </span>
                            <small>${has ? 'Açık' : 'Kapalı'}</small>
                        </button>
                    </td>
                `;
            });

            tr.innerHTML = cellsHtml;
            matrixBody.appendChild(tr);
        });

        RBAC_ROLES.forEach((role, index) => {
            const info = RBAC_ROLE_SCOPE_INFO[role.id] || {};
            const accentColor = getPermissionRoleColor(role, index);
            const activePermissions = RBAC_PERMISSION_MODULES.filter(mod => getMatrixPermissionValue(role.id, mod.id)).length;
            const card = document.createElement('article');
            card.className = 'permission-role-card';
            card.dataset.permissionRole = role.id;
            card.style.setProperty('--role-color', accentColor);
            card.innerHTML = `
                <div class="permission-role-card-header">
                    <span class="permission-role-card-icon"><i class="fas ${info.icon || 'fa-user'}"></i></span>
                    <div class="permission-role-card-title">
                        <span>${role.isGlobal ? 'Küresel Sistem Rolü' : 'Hat Kapsamlı Sistem Rolü'}</span>
                        <h4>${escapeAttr(role.name)}</h4>
                    </div>
                    <span class="permission-role-card-count">${activePermissions}/${RBAC_PERMISSION_MODULES.length}</span>
                </div>
                <p>${escapeAttr(info.text || '')}</p>
                <div class="permission-role-card-footer">
                    <span><i class="fas ${role.isGlobal ? 'fa-earth-europe' : 'fa-location-dot'}"></i> ${role.isGlobal ? 'Tüm hatlara erişim' : 'Atanmış hatlarla sınırlı'}</span>
                    <strong class="permission-role-active-count">${activePermissions} aktif yetki</strong>
                </div>
            `;
            descBody.appendChild(card);
        });

        renderPermissionsRoleLegend();
        updatePermissionsSummary();
        updatePermissionsSaveState();
        filterPermissionMatrix();
    } catch (e) {
        console.error('Matris tablosu oluşturma hatası:', e);
        matrixBody.innerHTML = `
            <tr>
                <td colspan="${RBAC_ROLES.length + 1}" class="permissions-render-error">
                    <i class="fas fa-triangle-exclamation"></i>
                    Yetki matrisi yüklenirken bir hata oluştu.
                </td>
            </tr>
        `;
    }
}

function toggleMatrixPerm(button, roleKey, permId) {
    if (!canManagePermissions()) {
        showToast('Yetki matrisini düzenleme izniniz yok.');
        return;
    }
    if (roleKey === 'Super_Admin') return;

    if (!appData.rolePermissions) appData.rolePermissions = normalizeRolePermissions(null);
    if (!appData.rolePermissions[roleKey]) appData.rolePermissions[roleKey] = getDefaultPermissionsForRole(roleKey);

    appData.rolePermissions[roleKey][permId] = !getMatrixPermissionValue(roleKey, permId);

    const has = appData.rolePermissions[roleKey][permId];
    button.classList.toggle('is-enabled', has);
    button.classList.toggle('is-disabled', !has);
    button.setAttribute('aria-pressed', String(has));
    button.setAttribute('aria-label', `${button.dataset.roleName} - ${button.dataset.permissionLabel}: ${has ? 'Açık' : 'Kapalı'}`);
    button.title = `${button.dataset.roleName} erişimini ${has ? 'kapat' : 'aç'}`;
    const icon = button.querySelector('.permission-toggle-thumb i');
    const label = button.querySelector('small');
    if (icon) icon.className = 'fa-solid ' + (has ? 'fa-check' : 'fa-xmark');
    if (label) label.textContent = has ? 'Açık' : 'Kapalı';
    updatePermissionsSummary();
    updatePermissionsSaveState(true);
}

async function savePermissions() {
    if (!canManagePermissions()) {
        showToast('Yetki matrisini kaydetme izniniz yok.');
        return;
    }
    const buttons = document.querySelectorAll('[onclick="savePermissions()"]');
    buttons.forEach(btn => {
        btn.dataset.originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kaydediliyor...';
    });

    try {
        const payload = normalizeRolePermissions(appData.rolePermissions);
        appData.rolePermissions = payload;
        await db.collection('system_config').doc('permissions').set(payload);
        updatePermissionsSaveState(false);
        showToast('RBAC yetki matrisi kaydedildi.');
    } catch (err) {
        console.error('Save Perm Error:', err);
        showToast('Yetkiler kaydedilirken hata!');
    } finally {
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalHtml || '<i class="fas fa-save"></i> Değişiklikleri Kaydet';
            delete btn.dataset.originalHtml;
        });
    }
}

// ─── QUESTION GROUP & QUESTION MANAGEMENT ───

function seedDefaultGeneralQuestions() {
    const defaultQuestions = [
        { id: 'q1', groupId: 'g1', categoryName: 'SINIFLANDIRMA', questionText: 'Fazla Sarf Malzeme /Ekipman var mı?', orderIndex: 1, maxScore: 5 },
        { id: 'q2', groupId: 'g1', categoryName: 'SINIFLANDIRMA', questionText: 'Fazla Demirbaş var mı?', orderIndex: 2, maxScore: 5 },
        { id: 'q3', groupId: 'g1', categoryName: 'SINIFLANDIRMA', questionText: 'Kullanılmayan Malzeme/Ekipman/Doküman var mı?', orderIndex: 3, maxScore: 5 },
        { id: 'q4', groupId: 'g1', categoryName: 'SINIFLANDIRMA', questionText: 'İşlevini Yitirmiş Malzeme/Ekipman/Doküman/İlk Yardım Çan. var mı?', orderIndex: 4, maxScore: 5 },
        { id: 'q5', groupId: 'g1', categoryName: 'SINIFLANDIRMA', questionText: 'Ulaşılamayan oda, bölge veya alan var mı? (Kilitli odalar için kilitler Sor odasında bulunuyor mu?)', orderIndex: 5, maxScore: 5 },
        { id: 'q6', groupId: 'g1', categoryName: 'SINIFLANDIRMA', questionText: 'Karantina alanına ihtiyaç var mı? Karantina alanı mevcut mu? Gereksiz/Fazla Malzeme ve ekipmanın kaydı tutulmuş mu?', orderIndex: 6, maxScore: 5 },
        
        { id: 'q7', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Yeri belli olmayan malzeme ekipman vb. var mı?', orderIndex: 7, maxScore: 5 },
        { id: 'q8', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Yeri uygun olmayan malzeme ekipman vb. var mı?', orderIndex: 8, maxScore: 5 },
        { id: 'q9', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Dekota / etiket çalışması yapılmış mı?', orderIndex: 9, maxScore: 5 },
        { id: 'q10', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Temizlik Dolabı içinin Etiketleri var mı?', orderIndex: 10, maxScore: 5 },
        { id: 'q11', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Anahtarlık Dolabı içinin Etiketleri var mı?', orderIndex: 11, maxScore: 5 },
        { id: 'q12', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Acil Müdahale Dolabı içinin etiketleri var mı?', orderIndex: 12, maxScore: 5 },
        { id: 'q13', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Soyunma Dolabı Etiketleri var mı?', orderIndex: 13, maxScore: 5 },
        { id: 'q14', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Diğer Dolap içi Etiketleri var mı?', orderIndex: 14, maxScore: 5 },
        { id: 'q15', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Yer çizgisi çalışması ile alan belirlenmesi yapılmış mı?', orderIndex: 15, maxScore: 5 },
        { id: 'q16', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Stoklamaya önden başlama, farklı ürünlerin ayırt edilmesi, zemine direkt ekipman bırakılmaması (palet vb.), yer tahsisinde derinlik ve yükseklik dikkate alınması kriterleri sağlanıyor mu?', orderIndex: 16, maxScore: 5 },
        { id: 'q17', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Temizlik malzemeleri ayrı dolaplarda ve uygun şekilde muhafaza ediliyor mu?', orderIndex: 17, maxScore: 5 },
        { id: 'q18', groupId: 'g1', categoryName: 'SIRALAMA', questionText: 'Temizlik malzeme etiketleri ve Güvenlik Bilgi Formları (MSDS) var mı?', orderIndex: 18, maxScore: 5 },

        { id: 'q19', groupId: 'g1', categoryName: 'SİLME', questionText: 'Zemin temiz tutuluyor ve akışkan maddelerin yerlere akmaması için gerekliyse koruyucu önlemler alınıyor mu?', orderIndex: 19, maxScore: 5 },
        { id: 'q20', groupId: 'g1', categoryName: 'SİLME', questionText: 'Ekipmanlar, malzemeler temiz tutuluyor mu?', orderIndex: 20, maxScore: 5 },
        { id: 'q21', groupId: 'g1', categoryName: 'SİLME', questionText: 'Duvarlar, kolonlar, korkuluklar, panolar, YM ve Asansörler vb. boyalı ve/veya temiz tutuluyor mu?', orderIndex: 21, maxScore: 5 },

        { id: 'q22', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'İstasyon Kat Planları var mı?', orderIndex: 22, maxScore: 5 },
        { id: 'q23', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'Temizlik Odası Planları var mı?', orderIndex: 23, maxScore: 5 },
        { id: 'q24', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'Dinlenme Odası Planı var mı?', orderIndex: 24, maxScore: 5 },
        { id: 'q25', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'İstasyon Amirliği Odası Planı var mı?', orderIndex: 25, maxScore: 5 },
        { id: 'q26', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'Varsa Diğer Odaların Planı Var mı? (İlk yardım, makinist, bebek bakım odası vb.)', orderIndex: 26, maxScore: 5 },
        { id: 'q27', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'Acil Müdahale Dolabı Planı var mı?', orderIndex: 27, maxScore: 5 },
        { id: 'q28', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'Temizlik Dolabı planı var mı?', orderIndex: 28, maxScore: 5 },
        { id: 'q29', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'Anahtarlık Dolabı Planı var mı?', orderIndex: 29, maxScore: 5 },
        { id: 'q30', groupId: 'g1', categoryName: 'STANDARTLAŞTIRMA', questionText: 'İyileştirme panosu mevcut ve pano içinde olması gereken dökümanlar bulunuyor mu? (İstasyon denetim sorumlusu, Denetim Kontrol Formu, önce/sonra fotoğrafları vb.)', orderIndex: 30, maxScore: 5 },

        { id: 'q31', groupId: 'g1', categoryName: 'SAHİPLENME', questionText: 'Tutum ve davranışlar denetim yaklaşımının faydalarının anlaşıldığını gösteriyor mu?', orderIndex: 31, maxScore: 5 },
        { id: 'q32', groupId: 'g1', categoryName: 'SAHİPLENME', questionText: 'denetim standartlarını uygularken israflardan kaçınılmış mı?', orderIndex: 32, maxScore: 5 },
        { id: 'q33', groupId: 'g1', categoryName: 'SAHİPLENME', questionText: 'denetim çalışması yaparken örnek alınacak uygulamalar geliştiriliyor mu?', orderIndex: 33, maxScore: 5 }
    ];
    defaultQuestions.forEach(q => {
        db.collection('questions').doc(q.id).set(q);
    });
    appData.questions = defaultQuestions;
}


function selectQuestionGroup(groupId) {
    appData.selectedGroupId = groupId;
    renderQuestionGroups();
    renderQuestions(groupId);
    document.getElementById('selected-group-questions').style.display = 'block';
}


// Modal Functions for Question Groups




// Modal Functions for Questions




async function deleteCategory() {
    const groupId = appData.selectedGroupId;
    if (!groupId) return;
    const groupQuestions = appData.questions.filter(q => q.groupId === groupId);
    const categories = [...new Set(groupQuestions.map(q => q.categoryName))];

    if (categories.length === 0) {
        showToast('Bu grupta silinecek kategori bulunmuyor.');
        return;
    }

    const catList = categories.map((c, i) => `${i + 1}- ${c}`).join('\\n');
    const input = prompt(`Silmek istediğiniz kategorinin numarasını veya adını tam olarak yazın:\n\n${catList}`);
    
    if (!input) return;
    
    let targetCat = input.trim();
    
    // Eğer numara girildiyse
    const idx = parseInt(targetCat);
    if (!isNaN(idx) && idx > 0 && idx <= categories.length) {
        targetCat = categories[idx - 1];
    }

    if (!categories.includes(targetCat)) {
        showToast('Geçerli bir kategori bulunamadı.');
        return;
    }

    if (confirm(`"${targetCat}" kategorisindeki tüm sorular silinecek. Emin misiniz?`)) {
        try {
            const toDelete = groupQuestions.filter(q => q.categoryName === targetCat);
            for (const q of toDelete) {
                await db.collection('questions').doc(q.id).delete();
            }
            showToast(`"${targetCat}" kategorisi ve bağlı sorular silindi.`);
        } catch (err) {
            console.error('Category delete error:', err);
            showToast('Kategori silinirken hata oluştu!');
        }
    }
}

// ─── PLANNING WITH DENETIM TIPI ───

function normalizeText(value) {
    return (value || '').toString().trim().toLocaleLowerCase('tr-TR');
}

function isPrivilegedPlanningUser() {
    return hasPermission('planning');
}

function isPlanAssignedToCurrentUser(plan) {
    if (!currentUser || !plan) return false;
    if (plan.assignedUserId && plan.assignedUserId === currentUser.id) return true;
    return normalizeText(plan.assignedTitle) === normalizeText(currentUser.title);
}

function canDeletePlan(plan, user = currentUser) {
    if (!plan || !user) return false;
    if (inferRbacRoleId(user) === 'Super_Admin') return true;
    return Boolean(plan.createdBy) && plan.createdBy === user.id;
}

function renderPlanning() {
    const container = document.getElementById('planning-cards-container');
    if (!container) return;
    container.innerHTML = '';
    
    let plans = appData.plans || [];
    if (!isPrivilegedPlanningUser()) {
        plans = plans.filter(isPlanAssignedToCurrentUser);
    }
    
    // Filter based on tab
    if (appData.currentPlanTab === 'monthly') {
        plans = plans.filter(p => p.id && p.id.startsWith('MT-'));
    } else if (appData.currentPlanTab === 'yearly') {
        plans = plans.filter(p => p.id && p.id.startsWith('YT-'));
    } else if (appData.currentPlanTab === 'yearly-weekly') {
        plans = plans.filter(p => p.id && p.id.startsWith('YWT-'));
    } else if (appData.currentPlanTab === 'manual') {
        // Manual: Everything that doesn't start with MT-, YT- or YWT-
        plans = plans.filter(p => !p.id || (!p.id.startsWith('MT-') && !p.id.startsWith('YT-') && !p.id.startsWith('YWT-')));
    } else {
        // 'all': Show all plans, no filtering
    }

    if (plans.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: var(--bg-card); border-radius: 16px; border: 1px dashed var(--border-main); color: var(--text-dim); margin-top: 1rem;">
                <i class="fas fa-calendar-times" style="font-size: 2.5rem; color: var(--primary); opacity: 0.6; margin-bottom: 1rem; display: block;"></i>
                Bu sekmede henüz planlanmış görev bulunmuyor.
            </div>
        `;
        return;
    }

    // Group by Auditor
    const groupedPlans = {};
    plans.forEach(p => {
        const userId = p.assignedUserId || 'unassigned';
        if (!groupedPlans[userId]) groupedPlans[userId] = [];
        groupedPlans[userId].push(p);
    });

    Object.keys(groupedPlans).forEach(userId => {
        const user = appData.users.find(u => u.id === userId);
        const userName = user ? (user.name || user.username) : (userId === 'unassigned' ? 'Atanmamış Denetçi' : 'Bilinmeyen');
        const userTitle = user ? (user.title || 'Denetçi') : (userId === 'unassigned' ? 'Kullanıcı Belirtilmemiş' : 'Sistem Kullanıcısı');
        const isCollapsed = appData.collapsedUsers[userId] === false ? false : true; // Collapsed by default
        
        const card = document.createElement('div');
        card.className = 'planning-premium-card';
        card.style.background = 'var(--bg-card)';
        card.style.border = '1px solid var(--border-main)';
        card.style.borderRadius = '14px';
        card.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.05)';
        card.style.padding = '0.75rem 0.9rem';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '0.6rem';
        card.style.transition = 'all 0.3s ease';

        // Header: User Profile
        const initial = userName.substring(0, 1).toUpperCase();
        
        let tasksHtml = '';
        if (!isCollapsed) {
            tasksHtml = groupedPlans[userId].map(p => {
                const type = getActiveAuditTypesForFilters().find(t => String(t.id) === String(p.auditTypeId));
                const auditTypeName = p.title || type?.title || type?.name || 'Genel Denetim';
                const lineColor = appData.lineColors[p.targetLine] || '#2563eb';
                
                const startDateStr = p.startDate ? new Date(p.startDate).toLocaleDateString('tr-TR') : 'N/A';
                const dueDateStr = p.dueDate ? new Date(p.dueDate).toLocaleDateString('tr-TR') : 'N/A';
                
                const canDelete = canDeletePlan(p);
                const deleteBtnHtml = canDelete ? `
                    <button class="btn-outline" onclick="deletePlan('${p.id}')" title="Görevi Sil" style="padding: 3px 6px; font-size: 0.65rem; border-color: rgba(239, 68, 68, 0.2); color: #ef4444; background: transparent; cursor: pointer; transition: 0.2s;">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                ` : '';

                return `
                    <div class="planning-task-item" style="border-left: 3px solid ${lineColor}; padding: 0.45rem 0.65rem; background: var(--bg-input); border-radius: 9px; display: flex; flex-direction: column; gap: 0.25rem; position: relative;">
                        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                                <div class="line-logo" style="background: ${lineColor}; margin: 0; flex-shrink: 0; width: 26px; height: 26px; line-height: 26px; font-size: 0.72rem; display: flex; align-items: center; justify-content: center; font-weight: 800; border-radius: 50%; color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">${p.targetLine || '?'}</div>
                                <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 160px;" title="${(p.targetStations || []).join(', ')}">
                                    ${(p.targetStations || []).join(', ')}
                                </span>
                            </div>
                            ${deleteBtnHtml}
                        </div>
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-primary); margin-top: 0.05rem; display: flex; align-items: center; gap: 4px;">
                            <i class="fas fa-clipboard-list" style="color: var(--primary); font-size: 0.7rem;"></i>
                            <span>${auditTypeName}</span>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: 0.2rem;">
                            <span style="font-size: 0.65rem; color: var(--text-dim); font-weight: 500;">
                                <i class="far fa-calendar-alt" style="margin-right: 2px;"></i> ${startDateStr} - ${dueDateStr}
                            </span>
                            <span class="status-badge" style="padding: 1.5px 5px; font-size: 0.6rem; font-weight: 700; border-radius: 5px; ${p.isCompleted ? 'background: rgba(16, 185, 129, 0.1); color: #10b981;' : 'background: rgba(139, 92, 246, 0.1); color: var(--primary);'}">
                                ${p.isCompleted ? 'Tamamlandı' : 'Bekliyor'}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        let linesHtml = '';
        if (user) {
            if (hasGlobalScope(user)) {
                linesHtml = `<span style="font-size: 0.62rem; color: var(--primary); font-weight: 700; background: rgba(139, 92, 246, 0.08); padding: 1.5px 5px; border-radius: 5px; margin-top: 3px; display: inline-block;">Tüm Hatlar</span>`;
            } else {
                const lines = Array.isArray(user?.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
                if (lines.length > 0) {
                    linesHtml = `
                        <div style="display: flex; gap: 4px; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                            ${lines.map(line => `<div class="line-logo" style="background: ${appData.lineColors[line] || '#64748b'}; margin: 0; flex-shrink: 0; font-size: 0.65rem; width: 22px; height: 22px; line-height: 22px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; border-radius: 50%; color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">${line}</div>`).join('')}
                        </div>
                    `;
                } else {
                    linesHtml = `<span style="font-size: 0.62rem; color: var(--text-dim); font-weight: 500; margin-top: 2px; display: inline-block;">Hat Yetkisi Yok</span>`;
                }
            }
        } else {
            linesHtml = `<span style="font-size: 0.62rem; color: var(--text-dim); font-weight: 500; margin-top: 2px; display: inline-block;">Kullanıcı Atanmamış</span>`;
        }

        const hasDeletablePlans = groupedPlans[userId].some(p => canDeletePlan(p));
        const bulkDeleteBtn = hasDeletablePlans ? `
            <button class="btn-outline" onclick="event.stopPropagation(); deletePlansForAuditor('${userId}')" title="Bu Sekmedeki Tüm Görevleri Sil" style="padding: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-color: rgba(239, 68, 68, 0.2); color: #ef4444; background: transparent; cursor: pointer; border-radius: 5px; transition: 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.08)';" onmouseout="this.style.background='transparent';">
                <i class="fas fa-trash-alt" style="font-size: 0.65rem;"></i>
            </button>
        ` : '';

        card.innerHTML = `
            <div onclick="toggleUserGroup('${userId}')" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 800; color: var(--text-primary); font-size: 0.88rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${userName}</div>
                    ${linesHtml}
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <span style="background: rgba(139, 92, 246, 0.1); color: var(--primary); font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 8px; white-space: nowrap; height: 18px; display: flex; align-items: center;">
                            ${groupedPlans[userId].length} Görev
                        </span>
                        <i class="fas ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}" style="color: var(--text-dim); font-size: 0.72rem; width: 10px; display: flex; align-items: center; justify-content: center;"></i>
                    </div>
                    ${bulkDeleteBtn}
                </div>
            </div>
            ${!isCollapsed ? `
            <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 220px; overflow-y: auto; padding-right: 4px;">
                ${tasksHtml}
            </div>
            ` : ''}
        `;
        container.appendChild(card);
    });
}

function toggleUserGroup(userId) {
    if (appData.collapsedUsers[userId] === undefined) {
        appData.collapsedUsers[userId] = false; // Collapse was default, so expand it
    } else {
        appData.collapsedUsers[userId] = !appData.collapsedUsers[userId];
    }
    renderPlanning();
}

// Modal Functions for Plans
function switchPlanTab(type, btn) {
    appData.currentPlanTab = type;
    
    // Update UI
    const container = btn.parentElement;
    container.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-secondary)';
    });
    
    btn.classList.add('active');
    btn.style.background = 'var(--primary)';
    btn.style.color = 'white';
    
    renderPlanning();
}

function togglePlanPeriodFields() {
    const type = document.getElementById('plan-period-type').value;
    
    document.getElementById('manual-date-fields').style.display = type === 'manual' ? 'grid' : 'none';
    document.getElementById('monthly-date-fields').style.display = type === 'monthly' ? 'block' : 'none';
    document.getElementById('yearly-date-fields').style.display = (type === 'yearly' || type === 'yearly_weekly') ? 'block' : 'none';
    
    document.getElementById('standard-station-selection').style.display = (type === 'yearly' || type === 'monthly' || type === 'yearly_weekly') ? 'none' : 'block';
    document.getElementById('yearly-station-distribution').style.display = type === 'yearly' ? 'block' : 'none';
    document.getElementById('yearly-weekly-station-distribution').style.display = type === 'yearly_weekly' ? 'block' : 'none';

    if (type === 'yearly') {
        renderYearlyMonths();
    } else if (type === 'yearly_weekly') {
        renderYearlyWeeklyMonths();
    } else if (type === 'monthly') {
        renderMonthlyWeeks();
    }
}

function handleYearOnlyChange() {
    const type = document.getElementById('plan-period-type').value;
    if (type === 'yearly') {
        renderYearlyMonths();
    } else if (type === 'yearly_weekly') {
        renderYearlyWeeklyMonths();
    }
}

function renderMonthlyWeeks() {
    const container = document.getElementById('monthly-weeks-container');
    const line = document.getElementById('plan-line').value;
    const stations = appData.stations[line] || [];
    container.innerHTML = '';
    
    for (let week = 1; week <= 4; week++) {
        const wDiv = document.createElement('div');
        wDiv.style.background = 'var(--bg-input)';
        wDiv.style.borderRadius = '12px';
        wDiv.style.padding = '1rem';
        wDiv.style.border = '1px solid var(--glass-border)';
        
        wDiv.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 0.75rem; font-size: 0.85rem; color: var(--primary); display: flex; align-items: center; justify-content: space-between;">
                <span>${week}. Hafta</span>
                <span class="station-count" style="font-size: 0.7rem; opacity: 0.7;">0 Seçili</span>
            </div>
            <div class="week-stations-grid" data-week="${week}" style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
                ${stations.map(s => `
                    <div class="mini-chip" onclick="toggleMiniChip(this)" style="padding: 3px 8px; font-size: 0.65rem; border-radius: 8px; border: 1px solid var(--border-main); cursor: pointer; transition: 0.2s;">${s}</div>
                `).join('')}
            </div>
        `;
        container.appendChild(wDiv);
    }
}

function renderYearlyMonths() {
    const container = document.getElementById('yearly-months-container');
    const line = document.getElementById('plan-line').value;
    const stations = appData.stations[line] || [];
    container.innerHTML = '';
    
    const yearSelect = document.getElementById('plan-year-only');
    const selectedYear = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
    
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonthIndex = currentDate.getMonth(); // 0-11
    
    const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    
    monthNames.forEach((month, index) => {
        const isPastMonth = (selectedYear === currentYear && index < currentMonthIndex) || (selectedYear < currentYear);
        const mDiv = document.createElement('div');
        mDiv.style.background = isPastMonth ? 'rgba(0,0,0,0.02)' : 'var(--bg-input)';
        mDiv.style.borderRadius = '12px';
        mDiv.style.padding = '1rem';
        mDiv.style.border = '1px solid var(--glass-border)';
        if (isPastMonth) {
            mDiv.style.opacity = '0.5';
            mDiv.style.pointerEvents = 'none';
        }
        
        mDiv.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 0.75rem; font-size: 0.85rem; color: ${isPastMonth ? 'var(--text-dim)' : 'var(--primary)'}; display: flex; align-items: center; justify-content: space-between;">
                <span>${month} ${isPastMonth ? '<span style="font-size: 0.7rem; font-weight: 500; color: var(--text-dim); margin-left: 6px;">(Geçmiş Ay)</span>' : ''}</span>
                <span class="station-count" style="font-size: 0.7rem; opacity: 0.7;">${isPastMonth ? 'Devre Dışı' : '0 Seçili'}</span>
            </div>
            <div class="month-stations-grid" data-month="${index + 1}" style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
                ${isPastMonth ? '' : stations.map(s => `
                    <div class="mini-chip" onclick="toggleMiniChip(this)" style="padding: 3px 8px; font-size: 0.65rem; border-radius: 8px; border: 1px solid var(--border-main); cursor: pointer; transition: 0.2s;">${s}</div>
                `).join('')}
            </div>
        `;
        container.appendChild(mDiv);
    });
}

function toggleMiniChip(chip) {
    chip.classList.toggle('active');
    if (chip.classList.contains('active')) {
        chip.style.background = 'var(--primary)';
        chip.style.color = 'white';
        chip.style.borderColor = 'var(--primary)';
    } else {
        chip.style.background = 'transparent';
        chip.style.color = 'var(--text-primary)';
        chip.style.borderColor = 'var(--border-main)';
    }
    
    // Update count
    const parent = chip.closest('.month-stations-grid').parentElement;
    const count = parent.querySelectorAll('.mini-chip.active').length;
    parent.querySelector('.station-count').innerText = `${count} Seçili`;
}

function renderYearlyWeeklyMonths() {
    const container = document.getElementById('yearly-weekly-months-container');
    const line = document.getElementById('plan-line').value;
    const stations = appData.stations[line] || [];
    container.innerHTML = '';
    
    const yearSelect = document.getElementById('plan-year-only');
    const selectedYear = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
    
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonthIndex = currentDate.getMonth(); // 0-11
    
    const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    
    monthNames.forEach((month, index) => {
        const isPastMonth = (selectedYear === currentYear && index < currentMonthIndex) || (selectedYear < currentYear);
        const mDiv = document.createElement('div');
        mDiv.style.background = isPastMonth ? 'rgba(0,0,0,0.02)' : 'var(--bg-input)';
        mDiv.style.borderRadius = '12px';
        mDiv.style.padding = '1rem';
        mDiv.style.border = '1px solid var(--glass-border)';
        mDiv.style.marginBottom = '1rem';
        if (isPastMonth) {
            mDiv.style.opacity = '0.5';
            mDiv.style.pointerEvents = 'none';
        }
        
        let weeksHtml = '';
        if (!isPastMonth) {
            for (let week = 1; week <= 4; week++) {
                weeksHtml += `
                    <div style="margin-top: 0.75rem; padding-left: 0.75rem; border-left: 2px solid var(--primary);">
                        <div style="font-weight: 600; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.4rem; display: flex; align-items: center; justify-content: space-between;">
                            <span>${week}. Hafta</span>
                            <span class="station-count-week" style="font-size: 0.65rem; opacity: 0.7;">0 Seçili</span>
                        </div>
                        <div class="yearly-weekly-stations-grid" data-month="${index + 1}" data-week="${week}" style="display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.5rem;">
                            ${stations.map(s => `
                                <div class="mini-chip" onclick="toggleMiniChipYearlyWeekly(this)" style="padding: 2px 6px; font-size: 0.65rem; border-radius: 6px; border: 1px solid var(--border-main); cursor: pointer; transition: 0.2s;">${s}</div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        }
        
        mDiv.innerHTML = `
            <div style="font-weight: 700; font-size: 0.85rem; color: ${isPastMonth ? 'var(--text-dim)' : 'var(--primary)'}; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-main); padding-bottom: 0.5rem;">
                <span>${month} ${isPastMonth ? '<span style="font-size: 0.7rem; font-weight: 500; color: var(--text-dim); margin-left: 6px;">(Geçmiş Ay)</span>' : ''}</span>
                <span class="month-total-count" style="font-size: 0.7rem; opacity: 0.7;">${isPastMonth ? 'Devre Dışı' : '0 İstasyon'}</span>
            </div>
            <div class="month-weeks-wrapper">
                ${isPastMonth ? '' : weeksHtml}
            </div>
        `;
        container.appendChild(mDiv);
    });
}

function toggleMiniChipYearlyWeekly(chip) {
    chip.classList.toggle('active');
    if (chip.classList.contains('active')) {
        chip.style.background = 'var(--primary)';
        chip.style.color = 'white';
        chip.style.borderColor = 'var(--primary)';
    } else {
        chip.style.background = 'transparent';
        chip.style.color = 'var(--text-primary)';
        chip.style.borderColor = 'var(--border-main)';
    }
    
    // Update week count
    const weekGrid = chip.closest('.yearly-weekly-stations-grid');
    const weekCount = weekGrid.querySelectorAll('.mini-chip.active').length;
    weekGrid.previousElementSibling.querySelector('.station-count-week').innerText = `${weekCount} Seçili`;
    
    // Update month total count
    const monthDiv = chip.closest('.month-weeks-wrapper').parentElement;
    const totalCount = monthDiv.querySelectorAll('.mini-chip.active').length;
    monthDiv.querySelector('.month-total-count').innerText = `${totalCount} İstasyon`;
}

function updatePlanLinesDropdown() {
    const auditorSelect = document.getElementById('plan-auditor');
    const lineSelect = document.getElementById('plan-line');
    if (!auditorSelect || !lineSelect) return;

    const auditorId = auditorSelect.value;
    const selectedUser = appData.users.find(u => u.id === auditorId);

    let allowedLines = [];
    if (!auditorId) {
        // If unassigned (Atanmadı), allow all lines
        allowedLines = appData.lines || [];
    } else if (hasGlobalScope(selectedUser)) {
        // If global scope user, allow all lines
        allowedLines = appData.lines || [];
    } else {
        // If limited scope user, allow only their authorizedLines
        allowedLines = Array.isArray(selectedUser?.authorizedLines) 
            ? selectedUser.authorizedLines.filter(line => appData.lines.includes(line)) 
            : [];
    }

    // Populate dropdown
    const previousSelectedLine = lineSelect.value;
    lineSelect.innerHTML = '';
    
    if (allowedLines.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Yetkili hat tanımlanmamış';
        lineSelect.appendChild(opt);
    } else {
        allowedLines.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l;
            opt.textContent = l;
            if (l === previousSelectedLine) {
                opt.selected = true;
            }
            lineSelect.appendChild(opt);
        });
    }

    // Since the lines changed, update the stations as well!
    updatePlanStations();
}

function openAddPlanModal() {
    // Populate audit type dropdown from the new AuditType model.
    const auditTypeSelect = document.getElementById('plan-audit-type');
    auditTypeSelect.innerHTML = '';
    getActiveAuditTypesForFilters().forEach(type => {
        const opt = document.createElement('option');
        opt.value = type.id;
        opt.textContent = type.title || type.name;
        auditTypeSelect.appendChild(opt);
    });

    // Populate auditor dropdown first
    const auditorSelect = document.getElementById('plan-auditor');
    auditorSelect.innerHTML = '<option value="">Atanmadı</option>';
    appData.users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.username || u.name || u.id;
        auditorSelect.appendChild(opt);
    });

    // Populate line dropdown dynamically based on selected auditor
    updatePlanLinesDropdown();

    // Reset form
    document.getElementById('plan-period-type').value = 'manual';
    togglePlanPeriodFields();

    // Set default dates
    const now = new Date();
    document.getElementById('plan-start-date').value = now.toISOString().split('T')[0];
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
    document.getElementById('plan-due-date').value = nextWeek.toISOString().split('T')[0];

    updatePlanStations();
    document.getElementById('plan-modal').style.display = 'flex';
}

function closePlanModal() {
    document.getElementById('plan-modal').style.display = 'none';
}

function updatePlanStations() {
    const line = document.getElementById('plan-line').value;
    const type = document.getElementById('plan-period-type').value;

    if (type === 'yearly') {
        renderYearlyMonths();
        return;
    } else if (type === 'yearly_weekly') {
        renderYearlyWeeklyMonths();
        return;
    } else if (type === 'monthly') {
        renderMonthlyWeeks();
        return;
    }

    const grid = document.getElementById('plan-stations-grid');
    grid.innerHTML = '';
    const stations = appData.stations[line] || [];
    stations.forEach(s => {
        const chip = document.createElement('div');
        chip.className = 'line-chip';
        chip.style.cursor = 'pointer';
        chip.style.padding = '4px 12px';
        chip.style.borderRadius = '20px';
        chip.style.fontSize = '0.7rem';
        chip.style.border = '1px solid var(--border-main)';
        chip.innerText = s;
        chip.onclick = () => {
            chip.classList.toggle('active');
            if (chip.classList.contains('active')) {
                chip.style.background = 'var(--primary)';
                chip.style.color = 'white';
                chip.style.borderColor = 'var(--primary)';
            } else {
                chip.style.background = 'transparent';
                chip.style.color = 'var(--text-primary)';
                chip.style.borderColor = 'var(--border-main)';
            }
        };
        grid.appendChild(chip);
    });
}

async function processNewPlan() {
    const periodType = document.getElementById('plan-period-type').value;
    const auditTypeId = document.getElementById('plan-audit-type').value;
    const line = document.getElementById('plan-line').value;
    const auditorId = document.getElementById('plan-auditor').value;
    const taskType = document.getElementById('plan-task-type').value;
    
    const auditType = getActiveAuditTypesForFilters().find(type => String(type.id) === String(auditTypeId));
    const selectedUser = appData.users.find(u => u.id === auditorId);
    const assignedTitle = selectedUser ? selectedUser.title : 'Saha Denetçisi';
    const auditTitle = auditType ? (auditType.title || auditType.name) : 'Genel Denetim';

    try {
        if (periodType === 'manual') {
            const activeChips = document.querySelectorAll('#plan-stations-grid .line-chip.active');
            const selectedStations = Array.from(activeChips).map(c => c.innerText);
            const startDateVal = document.getElementById('plan-start-date').value;
            const dueDateVal = document.getElementById('plan-due-date').value;

            if (!line || selectedStations.length === 0 || !startDateVal || !dueDateVal) {
                showToast('Lütfen hat, en az 1 istasyon ve tarihleri doldurunuz!');
                return;
            }

            const id = 'P-' + Date.now();
            const newPlan = {
                id,
                title: auditTitle,
                description: `${line} Hattı ${selectedStations.join(', ')} istasyonları denetimi.`,
                assignedTitle: assignedTitle,
                assignedUserId: auditorId || null,
                targetLine: line,
                targetStations: selectedStations,
                startDate: new Date(startDateVal).toISOString(),
                dueDate: new Date(dueDateVal).toISOString(),
                taskType,
                isCompleted: false,
                auditTypeId,
                createdBy: currentUser ? currentUser.id : null
            };
            await db.collection('plans').doc(id).set(newPlan);
            showToast('Plan başarıyla oluşturuldu!');
            switchPlanTab('manual', document.querySelector('[onclick*="switchPlanTab(\'manual\'"]'));

        } else if (periodType === 'monthly') {
            const year = parseInt(document.getElementById('plan-year').value);
            const month = parseInt(document.getElementById('plan-month').value);
            const weeksGrid = document.querySelectorAll('.week-stations-grid');

            if (!line || !auditorId) {
                showToast('Lütfen hat ve denetçi seçiniz!');
                return;
            }

            let hasSelection = false;
            // Create 4 weekly tasks
            for (const wGrid of weeksGrid) {
                const week = parseInt(wGrid.dataset.week);
                const activeChips = wGrid.querySelectorAll('.mini-chip.active');
                const selectedStations = Array.from(activeChips).map(c => c.innerText);

                if (selectedStations.length > 0) {
                    hasSelection = true;
                    const startDate = new Date(year, month - 1, (week - 1) * 7 + 1);
                    const endDate = new Date(year, month - 1, week * 7);
                    const id = `MT-${Date.now()}-${week}`;
                    
                    const task = {
                        id,
                        title: `${auditTitle} - ${week}. Hafta`,
                        description: `${line} Hattı ${month}. ay ${week}. hafta planlı denetimi.`,
                        assignedTitle,
                        assignedUserId: auditorId,
                        targetLine: line,
                        targetStations: selectedStations,
                        startDate: startDate.toISOString(),
                        dueDate: endDate.toISOString(),
                        taskType: 'Planlı Denetim',
                        isCompleted: false,
                        auditTypeId,
                        createdBy: currentUser ? currentUser.id : null
                    };
                    await db.collection('plans').doc(id).set(task);
                }
            }

            if (!hasSelection) {
                showToast('Lütfen en az bir hafta için istasyon seçiniz!');
                return;
            }

            showToast('Aylık plan başarıyla oluşturuldu!');
            switchPlanTab('monthly', document.querySelector('[onclick*="switchPlanTab(\'monthly\'"]'));

        } else if (periodType === 'yearly') {
            const year = parseInt(document.getElementById('plan-year-only').value);
            const monthsGrid = document.querySelectorAll('.month-stations-grid');
            
            let hasSelection = false;
            let taskCount = 0;

            for (const mGrid of monthsGrid) {
                const month = parseInt(mGrid.dataset.month);
                const activeChips = mGrid.querySelectorAll('.mini-chip.active');
                const selectedStations = Array.from(activeChips).map(c => c.innerText);

                if (selectedStations.length > 0) {
                    hasSelection = true;
                    const startDate = new Date(year, month - 1, 1);
                    const endDate = new Date(year, month, 0); // Last day of month
                    const id = `YT-${Date.now()}-${month}`;

                    const task = {
                        id,
                        title: `${auditTitle} - ${month}. Ay`,
                        description: `${line} Hattı yıllık planlı denetimi (${month}. ay).`,
                        assignedTitle,
                        assignedUserId: auditorId,
                        targetLine: line,
                        targetStations: selectedStations,
                        startDate: startDate.toISOString(),
                        dueDate: endDate.toISOString(),
                        taskType: 'Planlı Denetim',
                        isCompleted: false,
                        auditTypeId,
                        createdBy: currentUser ? currentUser.id : null
                    };
                    await db.collection('plans').doc(id).set(task);
                    taskCount++;
                }
            }

            if (!hasSelection || !auditorId) {
                showToast('Lütfen en az bir ay için istasyon ve denetçi seçiniz!');
                return;
            }
            showToast(`Yıllık plan (${taskCount} görev) başarıyla oluşturuldu!`);
            switchPlanTab('yearly', document.querySelector('[onclick*="switchPlanTab(\'yearly\'"]'));
        } else if (periodType === 'yearly_weekly') {
            const year = parseInt(document.getElementById('plan-year-only').value);
            const weeklyGrids = document.querySelectorAll('.yearly-weekly-stations-grid');

            if (!line || !auditorId) {
                showToast('Lütfen hat ve denetçi seçiniz!');
                return;
            }

            let hasSelection = false;
            let taskCount = 0;

            for (const wGrid of weeklyGrids) {
                const month = parseInt(wGrid.dataset.month);
                const week = parseInt(wGrid.dataset.week);
                const activeChips = wGrid.querySelectorAll('.mini-chip.active');
                const selectedStations = Array.from(activeChips).map(c => c.innerText);

                if (selectedStations.length > 0) {
                    hasSelection = true;
                    const startDate = new Date(year, month - 1, (week - 1) * 7 + 1);
                    const endDate = new Date(year, month - 1, week * 7);
                    const id = `YWT-${Date.now()}-${month}-${week}-${Math.floor(Math.random() * 1000)}`;

                    const task = {
                        id,
                        title: `${auditTitle} - ${month}. Ay ${week}. Hafta`,
                        description: `${line} Hattı yıllık haftalık planlı denetimi (${month}. ay ${week}. hafta).`,
                        assignedTitle,
                        assignedUserId: auditorId,
                        targetLine: line,
                        targetStations: selectedStations,
                        startDate: startDate.toISOString(),
                        dueDate: endDate.toISOString(),
                        taskType: 'Planlı Denetim',
                        isCompleted: false,
                        auditTypeId,
                        createdBy: currentUser ? currentUser.id : null
                    };
                    await db.collection('plans').doc(id).set(task);
                    taskCount++;
                }
            }

            if (!hasSelection) {
                showToast('Lütfen en az bir hafta için istasyon seçiniz!');
                return;
            }

            showToast(`Yıllık haftalık plan (${taskCount} görev) başarıyla oluşturuldu!`);
            switchPlanTab('yearly-weekly', document.querySelector('[onclick*="switchPlanTab(\'yearly-weekly\'"]'));
        }

        closePlanModal();
    } catch (err) {
        console.error('Plan create error:', err);
        showToast('Plan oluşturulurken hata!');
    }
}

async function deletePlan(planId) {
    const plan = (appData.plans || []).find(p => p.id === planId);
    if (!plan) {
        showToast('Plan bulunamadı.');
        return;
    }

    if (!canDeletePlan(plan)) {
        showToast('Bu görevi silme yetkiniz yok. Sadece kendi oluşturduğunuz görevleri silebilirsiniz.');
        return;
    }

    if (!confirm('Bu planı silmek istediğinize emin misiniz?')) return;
    try {
        await db.collection('plans').doc(planId).delete();
        showToast('Plan silindi.');
    } catch (err) {
        console.error('Plan delete error:', err);
        showToast('Silme hatası!');
    }
}

async function deletePlansForAuditor(userId) {
    let plansToDelete = appData.plans || [];
    
    // Filter based on tab first so we only delete what's currently viewed!
    if (appData.currentPlanTab === 'monthly') {
        plansToDelete = plansToDelete.filter(p => p.id && p.id.startsWith('MT-'));
    } else if (appData.currentPlanTab === 'yearly') {
        plansToDelete = plansToDelete.filter(p => p.id && p.id.startsWith('YT-'));
    } else if (appData.currentPlanTab === 'yearly-weekly') {
        plansToDelete = plansToDelete.filter(p => p.id && p.id.startsWith('YWT-'));
    } else if (appData.currentPlanTab === 'manual') {
        plansToDelete = plansToDelete.filter(p => !p.id || (!p.id.startsWith('MT-') && !p.id.startsWith('YT-') && !p.id.startsWith('YWT-')));
    }
    
    // Then filter by the specific auditor!
    plansToDelete = plansToDelete.filter(p => {
        const planUserId = p.assignedUserId || 'unassigned';
        return planUserId === userId;
    });

    plansToDelete = plansToDelete.filter(plan => canDeletePlan(plan));

    if (plansToDelete.length === 0) {
        showToast('Silinecek yetkiniz dahilinde görev bulunmuyor.');
        return;
    }

    const tabName = appData.currentPlanTab === 'monthly' ? 'Aylık' : (appData.currentPlanTab === 'yearly' ? 'Yıllık' : (appData.currentPlanTab === 'yearly-weekly' ? 'Yıllık Haftalık' : (appData.currentPlanTab === 'manual' ? 'Manuel' : 'Tüm')));
    if (!confirm(`Bu denetçiye ait bu sekmedeki (${tabName} Plan) yetkiniz dahilindeki tüm görevleri (${plansToDelete.length} adet) tek seferde silmek istediğinize emin misiniz?`)) return;

    try {
        showToast('Görevler siliniyor...');
        for (const plan of plansToDelete) {
            await db.collection('plans').doc(plan.id).delete();
        }
        showToast('Görevler başarıyla silindi!');
    } catch (err) {
        console.error('Bulk delete plans error:', err);
        showToast('Görevler silinirken hata oluştu.');
    }
}

async function deleteAllPlansInActiveTab() {
    let plansToDelete = appData.plans || [];
    
    // Filter based on active tab first so we only delete what's currently viewed!
    if (appData.currentPlanTab === 'monthly') {
        plansToDelete = plansToDelete.filter(p => p.id && p.id.startsWith('MT-'));
    } else if (appData.currentPlanTab === 'yearly') {
        plansToDelete = plansToDelete.filter(p => p.id && p.id.startsWith('YT-'));
    } else if (appData.currentPlanTab === 'manual') {
        plansToDelete = plansToDelete.filter(p => !p.id || (!p.id.startsWith('MT-') && !p.id.startsWith('YT-')));
    }
    
    plansToDelete = plansToDelete.filter(plan => canDeletePlan(plan));

    if (plansToDelete.length === 0) {
        showToast('Silinecek yetkiniz dahilinde görev bulunmuyor.');
        return;
    }

    const tabName = appData.currentPlanTab === 'monthly' ? 'Aylık' : (appData.currentPlanTab === 'yearly' ? 'Yıllık' : (appData.currentPlanTab === 'manual' ? 'Manuel' : 'Tüm'));
    if (!confirm(`Bu sekmedeki (${tabName} Plan) yetkiniz dahilindeki TÜM planlanmış görevleri (${plansToDelete.length} adet) tek seferde silmek istediğinize emin misiniz? Bu işlem geri alınamaz!`)) return;

    try {
        showToast('Görevler siliniyor...');
        for (const plan of plansToDelete) {
            await db.collection('plans').doc(plan.id).delete();
        }
        showToast('Görevler başarıyla silindi!');
    } catch (err) {
        console.error('Bulk delete all plans error:', err);
        showToast('Görevler silinirken hata oluştu.');
    }
}

function initAnalysisFilters() {
    const lineSelect = document.getElementById('filter-line');
    const auditorSelect = document.getElementById('filter-auditor');
    const accessibleAudits = getFilteredAudits();
    const scopedLines = getScopedAuditLines();

    if (!lineSelect || !auditorSelect) return;

    lineSelect.innerHTML = '<option value="all">Tüm Hatlar</option>';
    auditorSelect.innerHTML = '<option value="all">Tüm Denetçiler</option>';

    // Unique lines from appData
    const lines = scopedLines;
    lines.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        lineSelect.appendChild(opt);
    });

    // Unique auditors from audits
    const auditors = [...new Set(accessibleAudits.map(a => a.auditorName).filter(Boolean))];
    auditors.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        auditorSelect.appendChild(opt);
    });

    updateStationFilter();
}

function updateStationFilter() {
    const line = document.getElementById('filter-line').value;
    const stationSelect = document.getElementById('filter-station');
    if (!stationSelect) return;
    const accessibleAudits = getFilteredAudits();

    stationSelect.innerHTML = '<option value="all">Tüm İstasyonlar</option>';

    let stations = [];
    if (line === 'all') {
        stations = accessibleAudits.map(audit => audit.station).filter(Boolean);
    } else {
        stations = accessibleAudits
            .filter(audit => audit.line === line)
            .map(audit => audit.station)
            .filter(Boolean);
    }

    [...new Set(stations)].sort().forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        stationSelect.appendChild(opt);
    });
}

// ─── RAPORLAR SEKMESİ VE AKTİF EXCEL/PDF RAPORLAMA FONKSİYONLARI ───

function exportDetailedAnswersToExcel() {
    try {
        const audits = getFilteredAudits();
        if (!audits.length) {
            showToast('Dışa aktarılacak denetim kaydı bulunmuyor.');
            return;
        }

        // Step 1: Collect ALL unique question keys across all audits (preserving order)
        const questionKeySet = new Set();
        const questionKeyList = []; // Ordered list of { key, categoryName, questionText }
        const questionKeyMap = {};  // key -> { categoryName, questionText }

        audits.forEach(audit => {
            const metrics = buildAuditDetailMetrics(audit);
            (metrics.rows || []).forEach(row => {
                // Create a stable unique key for each question
                const key = (row.ans?.questionId || '') + '||' + (row.questionText || '').substring(0, 60);
                if (!questionKeySet.has(key)) {
                    questionKeySet.add(key);
                    const info = { key, categoryName: row.categoryName || 'Genel', questionText: row.questionText || 'Soru' };
                    questionKeyList.push(info);
                    questionKeyMap[key] = info;
                }
            });
        });

        if (!questionKeyList.length) {
            showToast('Dışa aktarılacak soru-cevap kaydı bulunmuyor.');
            return;
        }

        // Step 2: Build header row
        // Fixed columns + dynamic question columns (each question gets 2 sub-columns: Cevap, Durum)
        const fixedHeaders = ['Denetim ID', 'Tarih', 'Denetçi', 'Hat', 'İstasyon', 'Denetim Tipi', 'Genel Skor (%)'];
        const allHeaders = [...fixedHeaders];
        const colWidths = [
            { wch: 20 }, // Denetim ID
            { wch: 12 }, // Tarih
            { wch: 20 }, // Denetçi
            { wch: 10 }, // Hat
            { wch: 20 }, // İstasyon
            { wch: 24 }, // Denetim Tipi
            { wch: 14 }  // Genel Skor
        ];

        questionKeyList.forEach((qInfo, idx) => {
            const shortLabel = (qInfo.categoryName + ' - ' + qInfo.questionText).substring(0, 50);
            allHeaders.push(shortLabel + ' [Cevap]');
            allHeaders.push(shortLabel + ' [Durum]');
            colWidths.push({ wch: 22 });
            colWidths.push({ wch: 14 });
        });

        // Step 3: Build data rows — ONE ROW PER AUDIT
        const dataRows = [];
        audits.forEach(audit => {
            const metrics = buildAuditDetailMetrics(audit);
            const overallScore = getAuditDisplayScore(audit);
            const dateStr = audit.date ? new Date(audit.date).toLocaleDateString('tr-TR') : 'N/A';
            const type = (appData.auditTypes || []).find(t => String(t.id) === String(audit.auditTypeId));
            const typeName = type ? (type.name || type.title) : (audit.title || 'Genel Denetim');

            // Map this audit's answers by question key for fast lookup
            const answerMap = {};
            (metrics.rows || []).forEach(row => {
                const key = (row.ans?.questionId || '') + '||' + (row.questionText || '').substring(0, 60);
                answerMap[key] = row;
            });

            // Fixed columns
            const row = {};
            row['Denetim ID'] = audit.id || '';
            row['Tarih'] = dateStr;
            row['Denetçi'] = getAuditorDisplayName(audit.auditorName) || '';
            row['Hat'] = audit.line || '';
            row['İstasyon'] = audit.station || '';
            row['Denetim Tipi'] = typeName;
            row['Genel Skor (%)'] = overallScore.toFixed(1) + '%';

            // Dynamic question columns
            questionKeyList.forEach(qInfo => {
                const shortLabel = (qInfo.categoryName + ' - ' + qInfo.questionText).substring(0, 50);
                const matched = answerMap[qInfo.key];
                if (matched) {
                    let val = matched.displayScore;
                    if (val === undefined || val === null) {
                        val = matched.ans?.score !== undefined ? String(matched.ans.score) : '-';
                    }
                    row[shortLabel + ' [Cevap]'] = val;
                    row[shortLabel + ' [Durum]'] = matched.isNonconformity ? 'Uygunsuz' : 'Uygun';
                } else {
                    row[shortLabel + ' [Cevap]'] = '-';
                    row[shortLabel + ' [Durum]'] = '-';
                }
            });

            dataRows.push(row);
        });

        // Step 4: Create worksheet using the ordered headers
        const ws = XLSX.utils.json_to_sheet(dataRows, { header: allHeaders });
        ws['!cols'] = colWidths;

        // Step 5: Create workbook, add sheet and save
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Soru Cevap Detayları");
        XLSX.writeFile(wb, 'Metro_Istanbul_Detayli_Soru_Cevap_Raporu.xlsx');
        showToast('Detaylı soru-cevap Excel raporu başarıyla indirildi!');
    } catch (err) {
        console.error('Detailed Excel export error:', err);
        showToast('Excel dışa aktarma hatası!');
    }
}

function exportAuditsToExcel() {
    try {
        const audits = getFilteredAudits();
        if (!audits.length) {
            showToast('Dışa aktarılacak denetim kaydı bulunmuyor.');
            return;
        }

        const data = audits.map(audit => {
            const metrics = buildAuditDetailMetrics(audit);
            const overallScore = getAuditDisplayScore(audit);
            const dateStr = audit.date ? new Date(audit.date).toLocaleDateString('tr-TR') : 'N/A';
            
            const type = (appData.auditTypes || []).find(t => String(t.id) === String(audit.auditTypeId));
            const typeName = type ? (type.name || type.title) : (audit.title || 'Genel Denetim');
            
            const answers = metrics.rows || [];
            const conformantCount = answers.filter(r => !r.isNonconformity).length;
            const nonConformantCount = answers.filter(r => r.isNonconformity).length;
            
            const statusText = overallScore > 80 ? 'Tamamlandı' : (overallScore > 50 ? 'İnceleniyor' : 'Kritik');

            return {
                'Denetim ID': audit.id || '',
                'Tarih': dateStr,
                'Denetçi': getAuditorDisplayName(audit.auditorName) || '',
                'Hat': audit.line || '',
                'İstasyon': audit.station || '',
                'Denetim Tipi': typeName,
                'Skor (%)': overallScore.toFixed(1) + '%',
                'Toplam Soru': answers.length,
                'Uygun Soru Sayısı': conformantCount,
                'Uygunsuz Soru Sayısı': nonConformantCount,
                'Durum': statusText
            };
        });

        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(data);
        
        // Auto column width
        ws['!cols'] = [
            { wch: 18 }, // Denetim ID
            { wch: 12 }, // Tarih
            { wch: 20 }, // Denetçi
            { wch: 10 }, // Hat
            { wch: 20 }, // İstasyon
            { wch: 24 }, // Denetim Tipi
            { wch: 12 }, // Skor (%)
            { wch: 14 }, // Toplam Soru
            { wch: 18 }, // Uygun Soru
            { wch: 20 }, // Uygunsuz Soru
            { wch: 14 }  // Durum
        ];

        // Create workbook and add sheet
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Denetimler");

        // Save file
        XLSX.writeFile(wb, `Metro_Istanbul_Tek_Satir_Denetimler_Raporu.xlsx`);
        showToast('Excel raporu başarıyla indirildi!');
    } catch (err) {
        console.error('Excel export error:', err);
        showToast('Excel dışa aktarma hatası!');
    }
}

function generateMonthlyPerformanceReport() {
    try {
        const audits = getFilteredAudits();
        if (!audits.length) {
            showToast('Dışa aktarılacak denetim kaydı bulunmuyor.');
            return;
        }

        // Group audits by Year-Month and Line
        const groups = {};
        audits.forEach(audit => {
            if (!audit.date) return;
            const d = new Date(audit.date);
            const keyMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const keyLine = audit.line || 'Bilinmeyen';
            const groupKey = `${keyMonth} | ${keyLine}`;

            if (!groups[groupKey]) {
                groups[groupKey] = {
                    month: keyMonth,
                    line: keyLine,
                    audits: []
                };
            }
            groups[groupKey].audits.push(audit);
        });

        // Month Names Map
        const monthNames = {
            '01': 'Ocak', '02': 'Şubat', '03': 'Mart', '04': 'Nisan', '05': 'Mayıs', '06': 'Haziran',
            '07': 'Temmuz', '08': 'Ağustos', '09': 'Eylül', '10': 'Ekim', '11': 'Kasım', '12': 'Aralık'
        };

        const data = Object.values(groups).map(g => {
            const scores = g.audits.map(a => getAuditDisplayScore(a));
            const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
            const minScore = Math.min(...scores);
            const maxScore = Math.max(...scores);
            
            // Total NC count
            let totalNC = 0;
            g.audits.forEach(a => {
                const metrics = buildAuditDetailMetrics(a);
                totalNC += (metrics.rows || []).filter(r => r.isNonconformity).length;
            });

            const [year, monthPart] = g.month.split('-');
            const monthText = `${monthNames[monthPart]} ${year}`;

            return {
                'Ay / Dönem': monthText,
                'Hat': g.line,
                'Yapılan Denetim Sayısı': g.audits.length,
                'Ortalama Skor (%)': avgScore.toFixed(1) + '%',
                'En Düşük Skor (%)': minScore.toFixed(1) + '%',
                'En Yüksek Skor (%)': maxScore.toFixed(1) + '%',
                'Toplam Tespit Edilen Uygunsuzluk': totalNC
            };
        }).sort((a, b) => b['Ay / Dönem'].localeCompare(a['Ay / Dönem'], 'tr'));

        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(data);
        
        // Auto column width
        ws['!cols'] = [
            { wch: 18 }, // Ay / Dönem
            { wch: 10 }, // Hat
            { wch: 22 }, // Yapılan Denetim Sayısı
            { wch: 18 }, // Ortalama Skor
            { wch: 18 }, // En Düşük Skor
            { wch: 18 }, // En Yüksek Skor
            { wch: 32 }  // Toplam Tespit Edilen Uygunsuzluk
        ];

        // Create workbook and add worksheet
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Aylık Performans Özeti");

        // Save file
        XLSX.writeFile(wb, `Metro_Istanbul_Aylik_Performans_Ozeti.xlsx`);
        showToast('Aylık performans raporu başarıyla indirildi!');
    } catch (err) {
        console.error('Monthly report export error:', err);
        showToast('Aylık performans raporu dışa aktarma hatası!');
    }
}

function generateCriticalNCReport() {
    try {
        const ncs = getFilteredNCs();
        // Filter by open/unresolved NCs
        const openNcs = ncs.filter(nc => {
            let isUnresolved = nc.status === 'open' || nc.status === 'overdue' || (!nc.isClosed && nc.status !== 'completed');
            return isUnresolved;
        });

        if (!openNcs.length) {
            showToast('Sistemde açık veya kritik uygunsuzluk kaydı bulunmuyor.');
            return;
        }

        // Open a new printable window
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showToast('Tarayıcınızın pop-up engelleyicisini kapatıp tekrar deneyin.');
            return;
        }

        let rowsHtml = '';
        openNcs.forEach(nc => {
            const audit = getAccessibleAuditById(nc.auditId) || {};
            const line = audit.line || nc.line || 'N/A';
            const station = audit.station || nc.station || 'N/A';
            const dateStr = nc.detectionDate || nc.date || audit.date ? new Date(nc.detectionDate || nc.date || audit.date).toLocaleDateString('tr-TR') : 'N/A';
            const dueDateStr = nc.dueDate ? new Date(nc.dueDate).toLocaleDateString('tr-TR') : 'N/A';
            
            // Calculate remaining days
            let remainingText = '-';
            if (nc.dueDate) {
                const diffTime = new Date(nc.dueDate) - new Date();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays < 0) {
                    remainingText = `<span style="color: #ef4444; font-weight: 700;">Gecikmiş (${Math.abs(diffDays)} Gün)</span>`;
                } else {
                    remainingText = `${diffDays} Gün`;
                }
            }

            rowsHtml += `
                <tr>
                    <td style="font-weight: 700; color: #1e293b;">${nc.id ? nc.id.substring(0, 8) : 'N/A'}</td>
                    <td>${dateStr}</td>
                    <td>${nc.category || 'Genel'}</td>
                    <td style="max-width: 250px; font-size: 0.72rem;">${nc.questionText || nc.detail || 'Soru detayı bulunamadı.'}</td>
                    <td>${line} - ${station}</td>
                    <td><span style="background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.65rem;">Kritik</span></td>
                    <td>${dueDateStr}</td>
                    <td>${remainingText}</td>
                </tr>
            `;
        });

        const printHtml = `
            <!DOCTYPE html>
            <html lang="tr">
            <head>
                <meta charset="UTF-8">
                <title>Metro İstanbul - Kritik Uygunsuzluk Bulguları Raporu</title>
                <style>
                    body {
                        font-family: 'Inter', -apple-system, sans-serif;
                        color: #1e293b;
                        padding: 2rem;
                        background: #fff;
                    }
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 2px solid #e2e8f0;
                        padding-bottom: 1rem;
                        margin-bottom: 2rem;
                    }
                    .logo-title {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    }
                    .logo-icon {
                        background: linear-gradient(135deg, #ef4444, #dc2626);
                        color: #fff;
                        width: 40px;
                        height: 40px;
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: 800;
                        font-size: 1.25rem;
                    }
                    .title h1 {
                        font-size: 1.4rem;
                        font-weight: 800;
                        margin: 0;
                        color: #0f172a;
                    }
                    .title p {
                        font-size: 0.75rem;
                        color: #64748b;
                        margin: 4px 0 0 0;
                    }
                    .meta-info {
                        text-align: right;
                        font-size: 0.75rem;
                        color: #64748b;
                        line-height: 1.5;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 1rem;
                    }
                    th {
                        background: #f8fafc;
                        color: #475569;
                        font-weight: 700;
                        font-size: 0.72rem;
                        text-transform: uppercase;
                        padding: 10px 12px;
                        border-bottom: 2px solid #cbd5e1;
                        text-align: left;
                    }
                    td {
                        padding: 10px 12px;
                        border-bottom: 1px solid #e2e8f0;
                        font-size: 0.75rem;
                        color: #334155;
                        vertical-align: middle;
                    }
                    tr:nth-child(even) {
                        background: #f8fafc;
                    }
                    @media print {
                        body {
                            padding: 0;
                        }
                        .no-print {
                            display: none;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="logo-title">
                        <div class="logo-icon">M</div>
                        <div class="title">
                            <h1>Kritik Uygunsuzluk ve Bulgular Raporu</h1>
                            <p>Metro İstanbul Denetim ve Gözetim Raporlama Sistemi</p>
                        </div>
                    </div>
                    <div class="meta-info">
                        <strong>Rapor Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')}<br>
                        <strong>Bulgu Sayısı:</strong> ${openNcs.length}<br>
                        <strong>Durum:</strong> Kapatılmamış / Açık
                    </div>
                </div>
                
                <table style="width: 100%;">
                    <thead>
                        <tr>
                            <th>Bulgu No</th>
                            <th>Tespit Tarihi</th>
                            <th>Kategori</th>
                            <th>Açıklama / Soru</th>
                            <th>Hat / İstasyon</th>
                            <th>Önem Derecesi</th>
                            <th>Hedef Kapanış</th>
                            <th>Kalan Süre</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
                
                <div class="no-print" style="margin-top: 2rem; display: flex; justify-content: center;">
                    <button onclick="window.print()" style="background: #ef4444; color: white; padding: 10px 20px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 0.85rem; box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);">Yazdır veya PDF Kaydet</button>
                </div>

                <script>
                    window.onload = function() {
                        setTimeout(function() {
                            window.print();
                        }, 500);
                    };
                </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(printHtml);
        printWindow.document.close();
        showToast('Kritik uygunsuzluk raporu yazdırma ekranı açıldı.');
    } catch (err) {
        console.error('NC Report error:', err);
        showToast('Rapor oluşturulurken hata oluştu!');
    }
}

function redirectToComparisonAnalysis() {
    switchView('stats-view');
    showToast('Analiz ve istatistikler sayfasına yönlendirildiniz.');
}

function toggleStatsFilters() {
    const el = document.getElementById('stats-filters');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function openDashboardStatCard(card) {
    const ncFilter = card?.dataset?.ncFilter;
    const dashboardView = card?.dataset?.dashboardView;

    if (ncFilter) {
        redirectToNCWithFilter(ncFilter);
        return;
    }

    if (dashboardView) {
        switchView(dashboardView);
    }
}

function handleDashboardStatCardKey(event, card) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDashboardStatCard(card);
}

function redirectToNCWithFilter(status) {
    switchView('nc-management-view');
    ncCurrentPage = 1;
    ncCurrentFilter = status;

    const statusSelect = document.getElementById('filter-nc-status');
    if (statusSelect) setMultiSelectValues(statusSelect, []);

    const targetButton = Array.from(document.querySelectorAll('#nc-filter-tabs .nc-filter-btn'))
        .find(button => (button.textContent || '').trim().startsWith(status));

    if (targetButton) {
        filterNCs(status, targetButton);
    } else {
        renderNCs(status);
    }

    if (typeof syncCustomSelects === 'function') syncCustomSelects();
}

function normalizeDashboardStatLayout() {
    const cards = [
        { valueId: 'stat-avg-score', badgeId: 'stat-total-audits' },
        { valueId: 'stat-delayed-nc' },
        { valueId: 'stat-control-nc' },
        { valueId: 'stat-closure-rate', badgeId: 'stat-closed-nc' },
        { valueId: 'stat-ontime-rate', badgeId: 'stat-ontime-count' }
    ];

    cards.forEach(({ valueId, badgeId }) => {
        const value = document.getElementById(valueId);
        const card = value?.closest('.stat-card');
        if (!card) return;

        card.classList.add('dashboard-stat-card');
        value.classList.add('dashboard-stat-value');
        card.querySelector('h3')?.classList.add('dashboard-stat-title');

        let footer = card.querySelector('.dashboard-stat-footer');
        if (!footer) {
            footer = document.createElement('div');
            footer.className = 'dashboard-stat-footer';
            card.appendChild(footer);
        }

        const directTrend = Array.from(card.children)
            .find(element => element.classList.contains('stat-trend'));
        if (directTrend) footer.prepend(directTrend);

        if (badgeId) {
            const badge = document.getElementById(badgeId);
            if (badge) {
                badge.classList.add('dashboard-stat-badge');
                footer.appendChild(badge);
            }
        }
    });
}

function updateStats() {
    normalizeDashboardStatLayout();

    // Basic Dashboard Stats using SaaS Control Hub Filters
    const { audits, ncs } = getFilteredDashboardData();

    const totalAudits = audits.length;
    const avgScore = totalAudits > 0 ? audits.reduce((sum, a) => sum + (a.score || 0), 0) / totalAudits : 0;
    
    const openNCLen = ncs.filter(nc => !isNcClosed(nc)).length; // all non-closed ones
    const delayedNCLen = ncs.filter(isNcOverdue).length;
    const controlNCLen = ncs.filter(isNcWaitingControl).length;
    const closedNCLen = ncs.filter(isNcClosed).length;
    const totalNCLen = ncs.length;
    const closureRate = totalNCLen > 0 ? (closedNCLen / totalNCLen) * 100 : 0;

    if (document.getElementById('stat-total-audits')) document.getElementById('stat-total-audits').innerText = totalAudits + ' Adet';
    if (document.getElementById('stat-avg-score')) document.getElementById('stat-avg-score').innerText = '%' + Math.round(avgScore);
    
    if (document.getElementById('stat-open-nc')) document.getElementById('stat-open-nc').innerText = openNCLen;
    if (document.getElementById('stat-delayed-nc')) document.getElementById('stat-delayed-nc').innerText = delayedNCLen;
    if (document.getElementById('stat-control-nc')) document.getElementById('stat-control-nc').innerText = controlNCLen;
    if (document.getElementById('stat-closed-nc')) document.getElementById('stat-closed-nc').innerText = closedNCLen + ' Adet';
    if (document.getElementById('stat-closure-rate')) document.getElementById('stat-closure-rate').innerText = '%' + Math.round(closureRate);

    // On-time closure performance
    const closedNCs = ncs.filter(isNcClosed);
    const ontimeCount = closedNCs.filter(nc => {
        if (!nc.dueDate) return true; // no deadline = on-time
        const closedDate = nc.closedAt || nc.closureDate || nc.updatedAt;
        if (!closedDate) return true;
        return new Date(closedDate) <= new Date(nc.dueDate);
    }).length;
    const ontimeRate = closedNCs.length > 0 ? (ontimeCount / closedNCs.length) * 100 : 0;
    if (document.getElementById('stat-ontime-count')) document.getElementById('stat-ontime-count').innerText = ontimeCount + ' / ' + closedNCs.length;
    if (document.getElementById('stat-ontime-rate')) document.getElementById('stat-ontime-rate').innerText = '%' + Math.round(ontimeRate);

    // Advanced Stats View (Kurumsal Analiz)
    renderAdvancedStats();
}

function statsToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value.seconds) return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function statsMean(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function statsMedian(values) {
    const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!clean.length) return 0;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function statsStandardDeviation(values) {
    const clean = values.filter(Number.isFinite);
    if (clean.length < 2) return 0;
    const average = statsMean(clean);
    return Math.sqrt(clean.reduce((sum, value) => sum + ((value - average) ** 2), 0) / clean.length);
}

function statsSetText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function statsAuditDate(audit) {
    return statsToDate(audit?.date || audit?.completedAt || audit?.createdAt);
}

function statsNcDate(nc, auditLookup) {
    return statsToDate(
        nc?.detectionDate || nc?.createdAt || nc?.date ||
        auditLookup.get(String(nc?.auditId))?.date
    );
}

function getProfessionalStatsData() {
    const typeFilters = getMultiSelectValues('filter-stats-type');
    const lineFilters = getMultiSelectValues('filter-stats-line');
    const stationFilters = getMultiSelectValues('filter-stats-station');
    const userFilters = getMultiSelectValues('filter-stats-user');
    const yearFilters = getMultiSelectValues('filter-stats-year');
    const monthFilters = getMultiSelectValues('filter-stats-month');

    let audits = [...getFilteredAudits()];
    let ncs = [...getFilteredNCs()];
    const auditLookup = new Map(audits.map(audit => [String(audit.id), audit]));

    if (typeFilters.length) {
        audits = audits.filter(audit => typeFilters.some(type => filterByAuditType([audit], type).length));
        ncs = ncs.filter(nc => typeFilters.some(type => filterByAuditType([nc], type, getNonconformityTypeValues).length));
    }
    if (lineFilters.length) {
        audits = audits.filter(audit => lineFilters.includes(audit.line));
        ncs = ncs.filter(nc => lineFilters.includes(auditLookup.get(String(nc.auditId))?.line || nc.line));
    }
    if (stationFilters.length) {
        audits = audits.filter(audit => stationFilters.includes(audit.station));
        ncs = ncs.filter(nc => stationFilters.includes(auditLookup.get(String(nc.auditId))?.station || nc.station));
    }
    if (userFilters.length) {
        audits = audits.filter(audit => userFilters.some(f => normalizeTurkish(f) === normalizeTurkish(audit.auditorName)));
        ncs = ncs.filter(nc => userFilters.some(f => normalizeTurkish(f) === normalizeTurkish(nc.auditorName || auditLookup.get(String(nc.auditId))?.auditorName)));
    }
    // Apply Unified Date Filters: Year
    const uYears = unifiedDateFilters.stats.years;
    if (uYears.length) {
        audits = audits.filter(audit => {
            const date = statsAuditDate(audit);
            return date && uYears.includes(String(date.getFullYear()));
        });
        ncs = ncs.filter(nc => {
            const date = statsNcDate(nc, auditLookup);
            return date && uYears.includes(String(date.getFullYear()));
        });
    }

    // Apply Unified Date Filters: Month
    const uMonths = unifiedDateFilters.stats.months;
    if (uMonths.length) {
        audits = audits.filter(audit => {
            const date = statsAuditDate(audit);
            return date && uMonths.includes(String(date.getMonth() + 1));
        });
        ncs = ncs.filter(nc => {
            const date = statsNcDate(nc, auditLookup);
            return date && uMonths.includes(String(date.getMonth() + 1));
        });
    }

    // Apply Unified Date Filters: Week
    const uWeeks = unifiedDateFilters.stats.weeks;
    if (uWeeks.length) {
        audits = audits.filter(audit => {
            const date = statsAuditDate(audit);
            return date && uWeeks.includes(getISOWeekNumber(date).toString());
        });
        ncs = ncs.filter(nc => {
            const date = statsNcDate(nc, auditLookup);
            return date && uWeeks.includes(getISOWeekNumber(date).toString());
        });
    }

    // Apply Unified Date Filters: Day
    const uDays = unifiedDateFilters.stats.days;
    if (uDays.length) {
        audits = audits.filter(audit => {
            const date = statsAuditDate(audit);
            return date && uDays.includes(getLocalDateString(date));
        });
        ncs = ncs.filter(nc => {
            const date = statsNcDate(nc, auditLookup);
            return date && uDays.includes(getLocalDateString(date));
        });
    }

    return {
        audits,
        ncs,
        auditLookup,
        filters: { 
            typeFilters, 
            lineFilters, 
            stationFilters, 
            userFilters, 
            yearFilters: uYears, 
            monthFilters: uMonths 
        }
    };
}

function statsChartTheme() {
    const light = document.body.classList.contains('light-mode');
    return {
        text: light ? '#0f172a' : '#e2e8f0',
        dim: light ? '#334155' : '#aebed1',
        grid: light ? 'rgba(51,65,85,0.18)' : 'rgba(148,163,184,0.14)',
        blue: light ? '#1d4ed8' : '#60a5fa',
        cyan: light ? '#0e7490' : '#22d3ee',
        orange: light ? '#c2410c' : '#fb923c',
        red: light ? '#dc2626' : '#f87171',
        labelBg: light ? 'rgba(15,23,42,0.96)' : 'rgba(2,6,23,0.94)',
        labelBorder: light ? '#475569' : '#64748b',
        tooltipBg: light ? 'rgba(15,23,42,0.97)' : 'rgba(2,6,23,0.97)'
    };
}

function statsFormatChartValue(value, type = 'count') {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    if (type === 'percentage') {
        const rounded = Math.round(numericValue * 10) / 10;
        return `%${rounded.toLocaleString('tr-TR', {
            minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
            maximumFractionDigits: 1
        })}`;
    }
    if (type === 'decimal') {
        return numericValue.toLocaleString('tr-TR', {
            minimumFractionDigits: Number.isInteger(numericValue) ? 0 : 2,
            maximumFractionDigits: 2
        });
    }
    return Math.round(numericValue).toLocaleString('tr-TR');
}

function statsCreateChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return null;
    window.professionalStatsCharts = window.professionalStatsCharts || {};
    if (window.professionalStatsCharts[id]) window.professionalStatsCharts[id].destroy();
    const context = canvas.getContext('2d');
    if (!context) return null;
    const noDataPlugin = {
        id: `statsNoData-${id}`,
        afterDraw(chart) {
            const values = chart.data.datasets.flatMap(dataset => dataset.data || []);
            if (values.some(value => Number(value) !== 0)) return;
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            ctx.save();
            ctx.fillStyle = statsChartTheme().dim;
            ctx.font = '700 12px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Seçili filtrelerde grafik verisi bulunamadı', (chartArea.left + chartArea.right) / 2, (chartArea.top + chartArea.bottom) / 2);
            ctx.restore();
        }
    };
    config.plugins = [...(config.plugins || []), noDataPlugin];
    window.professionalStatsCharts[id] = new Chart(context, config);
    return window.professionalStatsCharts[id];
}

function statsBaseOptions({ indexAxis, stacked = false, percentage = false } = {}) {
    const theme = statsChartTheme();
    return {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis,
        layout: { padding: { top: 24, right: indexAxis === 'y' ? 42 : 14 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'bottom',
                align: 'center',
                labels: {
                    color: theme.text,
                    usePointStyle: true,
                    boxWidth: 9,
                    padding: 16,
                    font: { size: 11, weight: '800' }
                }
            },
            tooltip: {
                padding: 10,
                backgroundColor: theme.tooltipBg,
                titleColor: '#ffffff',
                bodyColor: '#f8fafc',
                borderColor: theme.labelBorder,
                borderWidth: 1,
                titleFont: { weight: '800' },
                bodySpacing: 5,
                callbacks: {
                    label(context) {
                        const label = context.dataset.label ? `${context.dataset.label}: ` : '';
                        return `${label}${statsFormatChartValue(context.raw, context.dataset.statsValueType)}`;
                    }
                }
            },
            datalabels: {
                display: context => {
                    const value = Number(context.dataset.data?.[context.dataIndex]);
                    if (context.dataset.statsShowLabels === false || (!context.dataset.statsShowZero && value === 0)) return false;
                    if (context.dataset.statsLabelLastOnly) return context.dataIndex === context.dataset.data.length - 1;
                    const every = Math.max(1, Number(context.dataset.statsLabelEvery) || 1);
                    return context.dataIndex % every === 0 || context.dataIndex === context.dataset.data.length - 1;
                },
                formatter: (value, context) => `${statsFormatChartValue(value, context.dataset.statsValueType)}${context.dataset.statsLabelSuffix || ''}`,
                color: context => context.dataset.statsLabelColor || '#ffffff',
                backgroundColor: context => context.dataset.statsLabelBackground || theme.labelBg,
                borderColor: context => context.dataset.statsLabelBorder || theme.labelBorder,
                borderWidth: 1,
                borderRadius: 6,
                padding: { top: 4, right: 6, bottom: 4, left: 6 },
                font: { size: 10, weight: '900' },
                anchor: context => context.dataset.statsLabelAnchor || (context.dataset.statsLabelInside ? 'center' : 'end'),
                align: context => {
                    if (context.dataset.statsLabelAlign) return context.dataset.statsLabelAlign;
                    if (context.dataset.statsLabelInside) return 'center';
                    if ((context.dataset.type || context.chart.config.type) === 'line') return 'top';
                    return indexAxis === 'y' ? 'right' : 'top';
                },
                offset: context => context.dataset.statsLabelOffset ?? 3,
                clamp: true
            }
        },
        scales: {
            x: {
                stacked,
                beginAtZero: indexAxis === 'y',
                suggestedMax: percentage && indexAxis === 'y' ? 100 : undefined,
                max: percentage && indexAxis === 'y' ? 100 : undefined,
                grid: { display: indexAxis === 'y', color: theme.grid },
                ticks: {
                    color: theme.dim,
                    font: { size: 10, weight: '750' },
                    callback: percentage && indexAxis === 'y' ? value => statsFormatChartValue(value, 'percentage') : undefined
                }
            },
            y: {
                stacked,
                beginAtZero: true,
                suggestedMax: percentage && indexAxis !== 'y' ? 100 : undefined,
                max: percentage && indexAxis !== 'y' ? 100 : undefined,
                grid: { display: indexAxis !== 'y', color: theme.grid },
                ticks: {
                    color: theme.dim,
                    font: { size: 10, weight: '750' },
                    callback: percentage && indexAxis !== 'y' ? value => statsFormatChartValue(value, 'percentage') : undefined
                }
            }
        }
    };
}

function statsPercentChange(current, previous) {
    if (!previous) return current ? null : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
}

function statsRenderDelta(id, current, previous, { points = false, inverse = false } = {}) {
    const element = document.getElementById(id);
    if (!element) return;
    const delta = points ? current - previous : statsPercentChange(current, previous);
    element.classList.remove('stats-delta-positive', 'stats-delta-negative', 'stats-delta-neutral');
    if (delta === null) {
        element.textContent = 'Önceki dönemde kayıt yok';
        element.classList.add('stats-delta-neutral');
        return;
    }
    const rounded = Math.abs(delta) < 0.05 ? 0 : delta;
    const direction = rounded > 0 ? '▲' : (rounded < 0 ? '▼' : '•');
    element.textContent = `${direction} ${Math.abs(rounded).toFixed(1)}${points ? ' puan' : '%'}`;
    const favorable = inverse ? rounded < 0 : rounded > 0;
    element.classList.add(rounded === 0 ? 'stats-delta-neutral' : (favorable ? 'stats-delta-positive' : 'stats-delta-negative'));
}

function renderProfessionalStatsKpis(audits, ncs) {
    const scores = audits.map(getAuditDisplayScore);
    const average = statsMean(scores);
    const median = statsMedian(scores);
    const passScore = Number(appData.settings?.passScore ?? DEFAULT_SYSTEM_SETTINGS.passScore ?? 80);
    const passRate = audits.length ? (scores.filter(score => score >= passScore).length / audits.length) * 100 : 0;
    const closed = ncs.filter(isNcClosed).length;
    const overdue = ncs.filter(isNcOverdue).length;
    const active = ncs.filter(nc => !isNcClosed(nc)).length;
    const closureRate = ncs.length ? (closed / ncs.length) * 100 : 0;
    const overdueRate = active ? (overdue / active) * 100 : 0;

    statsSetText('stats-kpi-audits', audits.length.toLocaleString('tr-TR'));
    statsSetText('stats-kpi-average', statsFormatChartValue(average, 'percentage'));
    statsSetText('stats-kpi-median', statsFormatChartValue(median, 'percentage'));
    statsSetText('stats-kpi-pass-rate', statsFormatChartValue(passRate, 'percentage'));
    statsSetText('stats-kpi-nc-density', audits.length ? (ncs.length / audits.length).toFixed(2) : '0.00');
    statsSetText('stats-kpi-closure-rate', statsFormatChartValue(closureRate, 'percentage'));
    statsSetText('stats-kpi-overdue-rate', statsFormatChartValue(overdueRate, 'percentage'));
    statsSetText('stats-kpi-volatility', statsStandardDeviation(scores).toFixed(1));
    statsSetText('stats-kpi-pass-note', `%${passScore} başarı eşiği`);
    statsSetText('stats-kpi-closure-note', `${closed} / ${ncs.length} aksiyon kapalı`);
    statsSetText('stats-kpi-overdue-note', `${overdue} geciken, ${active} aktif aksiyon`);
}

function renderProfessionalPeriodComparison(audits, ncs, auditLookup) {
    const dates = [
        ...audits.map(statsAuditDate),
        ...ncs.map(nc => statsNcDate(nc, auditLookup))
    ].filter(Boolean);
    const anchor = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : new Date();
    const currentEnd = new Date(anchor);
    currentEnd.setHours(23, 59, 59, 999);
    const currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() - 29);
    currentStart.setHours(0, 0, 0, 0);
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - 29);
    previousStart.setHours(0, 0, 0, 0);

    const inRange = (date, start, end) => date && date >= start && date <= end;
    const currentAudits = audits.filter(audit => inRange(statsAuditDate(audit), currentStart, currentEnd));
    const previousAudits = audits.filter(audit => inRange(statsAuditDate(audit), previousStart, previousEnd));
    const currentNcs = ncs.filter(nc => inRange(statsNcDate(nc, auditLookup), currentStart, currentEnd));
    const previousNcs = ncs.filter(nc => inRange(statsNcDate(nc, auditLookup), previousStart, previousEnd));
    const currentScore = statsMean(currentAudits.map(getAuditDisplayScore));
    const previousScore = statsMean(previousAudits.map(getAuditDisplayScore));
    const currentClosure = currentNcs.length ? (currentNcs.filter(isNcClosed).length / currentNcs.length) * 100 : 0;
    const previousClosure = previousNcs.length ? (previousNcs.filter(isNcClosed).length / previousNcs.length) * 100 : 0;

    statsSetText('stats-period-label', `${currentStart.toLocaleDateString('tr-TR')} - ${currentEnd.toLocaleDateString('tr-TR')}`);
    statsSetText('stats-compare-audits', currentAudits.length.toLocaleString('tr-TR'));
    statsSetText('stats-compare-score', statsFormatChartValue(currentScore, 'percentage'));
    statsSetText('stats-compare-nc', currentNcs.length.toLocaleString('tr-TR'));
    statsSetText('stats-compare-closure', statsFormatChartValue(currentClosure, 'percentage'));
    statsRenderDelta('stats-compare-audits-delta', currentAudits.length, previousAudits.length);
    statsRenderDelta('stats-compare-score-delta', currentScore, previousScore, { points: true });
    statsRenderDelta('stats-compare-nc-delta', currentNcs.length, previousNcs.length, { inverse: true });
    statsRenderDelta('stats-compare-closure-delta', currentClosure, previousClosure, { points: true });

    return { currentScore, previousScore, currentAudits, previousAudits, currentNcs, previousNcs };
}

function renderProfessionalTrendChart(audits) {
    const grouped = new Map();
    audits.forEach(audit => {
        const date = statsAuditDate(audit);
        if (!date) return;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(getAuditDisplayScore(audit));
    });
    const keys = [...grouped.keys()].sort().slice(-18);
    const averages = keys.map(key => statsMean(grouped.get(key)));
    const moving = averages.map((_, index) => statsMean(averages.slice(Math.max(0, index - 2), index + 1)));
    const counts = keys.map(key => grouped.get(key).length);
    const labels = keys.map(key => {
        const [year, month] = key.split('-');
        return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });
    });
    const scrollContainer = document.getElementById('stats-trend-scroll');
    const canvasWrap = document.getElementById('stats-trend-canvas-wrap');
    const visiblePeriods = 7;
    if (canvasWrap) {
        const viewportWidth = scrollContainer?.clientWidth || scrollContainer?.parentElement?.clientWidth || 760;
        const chartWidth = Math.max(viewportWidth, Math.ceil(viewportWidth * Math.max(keys.length, visiblePeriods) / visiblePeriods));
        canvasWrap.style.width = `${chartWidth}px`;
    }

    const options = statsBaseOptions();
    options.layout.padding = { top: 26, right: 12, bottom: 0, left: 2 };
    options.plugins.legend.position = 'top';
    options.plugins.legend.align = 'center';
    options.scales.x.grid.display = false;
    options.scales.x.ticks.autoSkip = false;
    options.scales.x.ticks.maxRotation = 0;
    options.scales.y.max = 100;
    options.scales.y.title = { display: true, text: 'Performans (%)', color: statsChartTheme().dim, font: { size: 10, weight: '800' } };
    options.scales.y.ticks.callback = value => statsFormatChartValue(value, 'percentage');
    options.scales.y1 = {
        position: 'right',
        beginAtZero: true,
        max: Math.max(1, ...counts) * 1.2,
        grid: { display: false },
        title: { display: true, text: 'Denetim Hacmi (adet)', color: statsChartTheme().blue, font: { size: 10, weight: '800' } },
        ticks: { color: statsChartTheme().blue, precision: 0, stepSize: 1, font: { size: 10, weight: '800' } }
    };
    statsCreateChart('stats-trend-chart', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'bar', label: 'Denetim Hacmi (adet)', data: counts, yAxisID: 'y1', statsValueType: 'count', statsLabelInside: true, statsLabelAnchor: 'center', statsLabelAlign: 'center', statsLabelOffset: 0, order: 3, backgroundColor: 'rgba(37,99,235,0.68)', borderColor: '#60a5fa', borderWidth: 1.5, borderRadius: 7, barPercentage: 0.72, categoryPercentage: 0.82 },
                { type: 'line', label: 'Aylık Ortalama', data: averages, yAxisID: 'y', statsValueType: 'percentage', order: 1, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', pointBackgroundColor: '#8b5cf6', pointBorderColor: '#ffffff', pointBorderWidth: 1.5, pointRadius: 3.5, pointHoverRadius: 5, borderWidth: 2.5, tension: 0.34, fill: false },
                { type: 'line', label: 'Son 3 Ayın Ortalaması', data: moving, yAxisID: 'y', statsValueType: 'percentage', statsLabelLastOnly: true, statsLabelAlign: 'bottom', statsLabelOffset: 5, order: 0, borderColor: statsChartTheme().cyan, backgroundColor: statsChartTheme().cyan, borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, tension: 0.3 }
            ]
        },
        options
    });

    if (scrollContainer && keys.length > visiblePeriods) {
        requestAnimationFrame(() => {
            scrollContainer.scrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
        });
    }
}

function statsNcLine(nc, auditLookup) {
    return auditLookup.get(String(nc.auditId))?.line || nc.line || 'Diğer';
}

function statsNcStation(nc, auditLookup) {
    return auditLookup.get(String(nc.auditId))?.station || nc.station || 'Belirtilmedi';
}

function statsSetScrollableChartHeight(scrollId, wrapId, rowCount, rowHeight = 50, minHeight = 330) {
    const scrollContainer = document.getElementById(scrollId);
    const canvasWrap = document.getElementById(wrapId);
    if (canvasWrap) {
        canvasWrap.style.height = `${Math.max(minHeight, rowCount * rowHeight + 88)}px`;
    }
    if (scrollContainer) {
        requestAnimationFrame(() => {
            scrollContainer.scrollTop = 0;
        });
    }
}

function statsWrapAxisLabel(value, maxLineLength = 24) {
    const words = String(value || 'Belirtilmedi').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length <= maxLineLength || !currentLine) {
            currentLine = candidate;
            return;
        }
        lines.push(currentLine);
        currentLine = word;
    });
    if (currentLine) lines.push(currentLine);

    if (lines.length <= 2) return lines;
    const secondLine = lines.slice(1).join(' ');
    return [lines[0], `${secondLine.slice(0, maxLineLength - 1).trimEnd()}…`];
}

function statsContrastTextColor(backgroundColor) {
    const hex = String(backgroundColor || '').trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
    const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
    const linear = channels.map(channel => channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
    const luminance = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
    const whiteContrast = 1.05 / (luminance + 0.05);
    const darkContrast = (luminance + 0.05) / 0.07;
    return darkContrast >= whiteContrast ? '#0f172a' : '#ffffff';
}

function statsColoredPillStyle(backgroundColor) {
    return `background:${backgroundColor};color:${statsContrastTextColor(backgroundColor)};`;
}

function statsLineLogoHtml(line) {
    const lineName = String(line || 'Diğer');
    const color = appData.lineColors[lineName] || '#64748b';
    return `<span class="stats-line-logo" style="--stats-line-color:${color};--stats-line-text:${statsContrastTextColor(color)};" title="${escapeAttr(lineName)} hattı" aria-label="${escapeAttr(lineName)} hattı">${escapeAttr(lineName)}</span>`;
}

function statsLineLogoPlugin(id, rows, metaFormatter) {
    return {
        id: `statsLineLogo-${id}`,
        afterDraw(chart) {
            const yScale = chart.scales?.y;
            const chartArea = chart.chartArea;
            if (!yScale || !chartArea || !rows.length) return;

            const theme = statsChartTheme();
            const ctx = chart.ctx;
            const logoX = Math.max(18, chartArea.left - 76);
            ctx.save();

            rows.forEach((row, index) => {
                const lineName = String(row.line || 'Diğer');
                const color = appData.lineColors[lineName] || '#64748b';
                const y = yScale.getPixelForValue(index);
                if (!Number.isFinite(y)) return;

                ctx.beginPath();
                ctx.arc(logoX, y, 14, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = document.body.classList.contains('light-mode') ? '#ffffff' : '#cbd5e1';
                ctx.stroke();

                ctx.fillStyle = statsContrastTextColor(color);
                ctx.font = `900 ${lineName.length > 3 ? 8 : 10}px Inter`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(lineName, logoX, y + 0.5, 24);

                const meta = typeof metaFormatter === 'function' ? metaFormatter(row) : '';
                if (meta) {
                    ctx.fillStyle = theme.text;
                    ctx.font = '800 10px Inter';
                    ctx.textAlign = 'left';
                    ctx.fillText(meta, logoX + 22, y, 58);
                }
            });

            ctx.restore();
        }
    };
}

function renderProfessionalLinePerformance(audits, ncs, auditLookup) {
    const groups = new Map();
    audits.forEach(audit => {
        const line = audit.line || 'Diğer';
        if (!groups.has(line)) groups.set(line, { scores: [], auditCount: 0, ncCount: 0 });
        const group = groups.get(line);
        group.scores.push(getAuditDisplayScore(audit));
        group.auditCount++;
    });
    ncs.forEach(nc => {
        const line = statsNcLine(nc, auditLookup);
        if (!groups.has(line)) groups.set(line, { scores: [], auditCount: 0, ncCount: 0 });
        groups.get(line).ncCount++;
    });
    const rows = [...groups.entries()].map(([line, group]) => ({
        line,
        average: statsMean(group.scores),
        density: group.auditCount ? group.ncCount / group.auditCount : 0,
        count: group.auditCount
    })).sort((a, b) => b.count - a.count).slice(0, 12);
    statsSetScrollableChartHeight('stats-line-performance-scroll', 'stats-line-performance-canvas-wrap', rows.length, 48);
    const options = statsBaseOptions({ indexAxis: 'y', percentage: true });
    options.scales.x.max = 100;
    options.scales.x.ticks.callback = value => statsFormatChartValue(value, 'percentage');
    options.scales.x.title = { display: true, text: 'Ortalama Puan (%)', color: statsChartTheme().dim, font: { size: 10, weight: '800' } };
    options.scales.x1 = {
        position: 'top',
        beginAtZero: true,
        grid: { display: false },
        title: { display: true, text: 'Uygunsuzluk / Denetim', color: statsChartTheme().red, font: { size: 10, weight: '800' } },
        ticks: { color: statsChartTheme().red, font: { size: 10, weight: '800' } }
    };
    options.scales.y.grid.display = false;
    options.scales.y.ticks = { display: false };
    options.scales.y.afterFit = scale => { scale.width = 112; };
    options.layout.padding = { top: 10, right: 48, bottom: 0, left: 0 };
    options.plugins.legend.align = 'center';
    options.plugins.tooltip.callbacks.title = items => rows[items[0]?.dataIndex]?.line || '';
    statsCreateChart('stats-line-performance-chart', {
        type: 'bar',
        plugins: [statsLineLogoPlugin('performance', rows, row => `${row.count} denetim`)],
        data: {
            labels: rows.map(row => row.line),
            datasets: [
                { label: 'Ortalama Puan', data: rows.map(row => row.average), xAxisID: 'x', statsValueType: 'percentage', statsLabelInside: true, statsLabelAnchor: 'end', statsLabelAlign: 'start', backgroundColor: rows.map(row => appData.lineColors[row.line] || '#64748b'), borderRadius: 7, barThickness: 15 },
                { type: 'line', label: 'Uygunsuzluk / Denetim', data: rows.map(row => row.density), xAxisID: 'x1', statsValueType: 'decimal', statsShowZero: true, statsLabelAlign: 'top', statsLabelOffset: 5, borderColor: statsChartTheme().red, backgroundColor: statsChartTheme().red, pointRadius: 4, pointHoverRadius: 5, borderWidth: 2, tension: 0.25 }
            ]
        },
        options
    });
}

function renderProfessionalNcStatus(ncs) {
    const values = [
        ncs.filter(isNcOpen).length,
        ncs.filter(isNcOverdue).length,
        ncs.filter(isNcWaitingControl).length,
        ncs.filter(isNcClosed).length
    ];
    const theme = statsChartTheme();
    const options = statsBaseOptions();
    
    // Hide the legend because category labels are displayed on the X axis
    options.plugins.legend.display = false;
    
    // Configure datalabels to show counts cleanly on top of the bars
    options.plugins.datalabels.color = theme.text;
    options.plugins.datalabels.backgroundColor = 'transparent';
    options.plugins.datalabels.borderColor = 'transparent';
    options.plugins.datalabels.borderWidth = 0;
    options.plugins.datalabels.font = { weight: '900', size: 10 };
    options.plugins.datalabels.formatter = (value) => value > 0 ? `${value.toLocaleString('tr-TR')} adet` : '';
    options.plugins.datalabels.anchor = 'end';
    options.plugins.datalabels.align = 'top';
    options.plugins.datalabels.offset = 2;
    
    // Configure tooltip to match standard formats and include percentages
    options.plugins.tooltip.callbacks.label = (context) => {
        const total = context.dataset.data.reduce((sum, item) => sum + Number(item || 0), 0);
        const percentage = total ? (Number(context.raw) / total) * 100 : 0;
        return ` ${context.label}: ${statsFormatChartValue(percentage, 'percentage')} (${statsFormatChartValue(context.raw, 'count')} adet)`;
    };
    
    // Standard scales for the vertical bar chart
    options.scales.x.grid = { display: false };
    options.scales.x.ticks = { color: theme.text, font: { weight: '800', size: 10 } };
    
    options.scales.y.beginAtZero = true;
    options.scales.y.ticks = { color: theme.dim, precision: 0, font: { weight: '800', size: 10 } };
    options.scales.y.grid = { color: theme.grid };

    statsCreateChart('stats-nc-status-chart', {
        type: 'bar',
        data: {
            labels: ['Açık', 'Geciken', 'Kontrol', 'Kapalı'],
            datasets: [{
                data: values,
                backgroundColor: ['#3b82f6', '#e11d48', '#f59e0b', '#10b981'],
                borderRadius: 6,
                barThickness: 28,
                statsValueType: 'count',
                statsShowZero: false
            }]
        },
        options
    });
}

function getProfessionalCategoryRows(audits) {
    const groups = new Map();
    audits.forEach(audit => {
        buildAuditDetailMetrics(audit).rows.forEach(row => {
            const category = row.categoryName || 'Genel';
            if (!groups.has(category)) groups.set(category, { scores: [], nonconformities: 0 });
            const group = groups.get(category);
            group.scores.push(row.percent);
            if (row.isNonconformity) group.nonconformities++;
        });
    });
    return [...groups.entries()].map(([category, group]) => ({
        category,
        average: statsMean(group.scores),
        riskRate: group.scores.length ? (group.nonconformities / group.scores.length) * 100 : 0,
        count: group.scores.length
    })).sort((a, b) => a.average - b.average);
}

function renderProfessionalCategoryChart(audits) {
    const rows = getProfessionalCategoryRows(audits).slice(0, 12);
    const scrollContainer = document.getElementById('stats-category-scroll');
    const canvasWrap = document.getElementById('stats-category-canvas-wrap');
    if (canvasWrap) {
        canvasWrap.style.height = `${Math.max(330, rows.length * 54 + 74)}px`;
    }

    const options = statsBaseOptions({ indexAxis: 'y', percentage: true });
    options.scales.x.max = 100;
    options.scales.x.ticks.stepSize = 20;
    options.scales.x.ticks.callback = value => statsFormatChartValue(value, 'percentage');
    options.scales.x.title = {
        display: true,
        text: 'Oran (%)',
        color: statsChartTheme().dim,
        font: { size: 10, weight: '800' }
    };
    options.scales.y.grid.display = false;
    options.scales.y.ticks = {
        color: statsChartTheme().text,
        padding: 8,
        font: { size: 10, weight: '700', lineHeight: 1.25 }
    };
    options.layout.padding = { top: 8, right: 52, bottom: 0, left: 4 };
    options.plugins.legend.position = 'top';
    options.plugins.legend.align = 'center';
    options.plugins.tooltip.callbacks.title = items => rows[items[0]?.dataIndex]?.category || '';
    options.plugins.tooltip.callbacks.afterBody = items => {
        const row = rows[items[0]?.dataIndex];
        return row ? `Değerlendirilen cevap: ${row.count.toLocaleString('tr-TR')}` : '';
    };
    statsCreateChart('stats-category-chart', {
        type: 'bar',
        data: {
            labels: rows.map(row => statsWrapAxisLabel(row.category)),
            datasets: [
                {
                    label: 'Başarı Oranı',
                    data: rows.map(row => row.average),
                    statsValueType: 'percentage',
                    statsLabelInside: true,
                    statsLabelAnchor: 'end',
                    statsLabelAlign: 'start',
                    statsLabelOffset: 2,
                    backgroundColor: rows.map(row => getHeatmapColor(row.average)),
                    borderRadius: 7,
                    barThickness: 15
                },
                {
                    label: 'Risk (Uygunsuz Cevap)',
                    data: rows.map(row => row.riskRate),
                    statsValueType: 'percentage',
                    statsShowZero: true,
                    statsLabelAnchor: 'end',
                    statsLabelAlign: 'right',
                    statsLabelOffset: 4,
                    backgroundColor: 'rgba(225,29,72,0.48)',
                    borderColor: '#e11d48',
                    borderWidth: 1,
                    borderRadius: 7,
                    barThickness: 15
                }
            ]
        },
        options
    });

    if (scrollContainer) {
        requestAnimationFrame(() => {
            scrollContainer.scrollTop = 0;
        });
    }
}

function closeScoreDistributionModal() {
    const modal = document.getElementById('score-distribution-modal');
    if (modal) modal.remove();
}

function openScoreDistributionModal(binLabel, audits) {
    closeScoreDistributionModal();

    const modalDiv = document.createElement('div');
    modalDiv.id = 'score-distribution-modal';
    modalDiv.className = 'modal-overlay';
    modalDiv.style.display = 'flex';
    modalDiv.style.position = 'fixed';
    modalDiv.style.top = '0';
    modalDiv.style.left = '0';
    modalDiv.style.width = '100vw';
    modalDiv.style.height = '100vh';
    modalDiv.style.backgroundColor = 'rgba(15, 23, 42, 0.6)';
    modalDiv.style.backdropFilter = 'blur(4px)';
    modalDiv.style.zIndex = '9999';
    modalDiv.style.alignItems = 'center';
    modalDiv.style.justifyContent = 'center';

    const sortedAudits = [...audits].sort((a, b) => {
        const scoreA = getAuditDisplayScore(a);
        const scoreB = getAuditDisplayScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        const dateA = statsAuditDate(a) || new Date(0);
        const dateB = statsAuditDate(b) || new Date(0);
        return dateB.getTime() - dateA.getTime();
    });

    let listHtml = '';
    if (sortedAudits.length === 0) {
        listHtml = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem; font-weight: 700;">Bu puan aralığında herhangi bir denetim kaydı bulunmuyor.</div>';
    } else {
        listHtml = `
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 2px solid var(--border-main); font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">
                            <th style="padding: 0.5rem 0.5rem 0.5rem 0;">İstasyon</th>
                            <th style="padding: 0.5rem;">Hat</th>
                            <th style="padding: 0.5rem;">Denetçi</th>
                            <th style="padding: 0.5rem;">Tarih</th>
                            <th style="padding: 0.5rem 0 0.5rem 0.5rem; text-align: right;">Puan</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedAudits.map(audit => {
                            const score = getAuditDisplayScore(audit);
                            const date = statsAuditDate(audit);
                            const dateStr = date ? date.toLocaleDateString('tr-TR') : '-';
                            const color = appData.lineColors?.[audit.line] || '#64748b';
                            const scoreColor = getHeatmapColor(score);
                            return `
                                <tr style="border-bottom: 1px solid var(--border-main); font-size: 0.85rem; color: var(--text-primary); cursor: pointer;" onclick="closeScoreDistributionModal(); openAuditModal('${jsArg(audit.id)}')">
                                    <td style="padding: 0.75rem 0.5rem 0.75rem 0; font-weight: 700; color: var(--primary);">${escapeAttr(audit.station || 'Belirtilmedi')}</td>
                                    <td style="padding: 0.75rem 0.5rem;">
                                        <span class="people-line-logo" style="background:${escapeAttr(color)};">${escapeAttr(audit.line || '-')}</span>
                                    </td>
                                    <td style="padding: 0.75rem 0.5rem; color: var(--text-secondary);">${escapeAttr(audit.auditorName || '-')}</td>
                                    <td style="padding: 0.75rem 0.5rem; color: var(--text-secondary);">${escapeAttr(dateStr)}</td>
                                    <td style="padding: 0.75rem 0 0.75rem 0.5rem; text-align: right; font-weight: 800; color: ${scoreColor};">%${score.toFixed(0)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    modalDiv.innerHTML = `
        <div class="modal-content" style="max-width: 650px; width: 90%; padding: 1.5rem; border-radius: 20px; background: var(--bg-card); border: 1px solid var(--border-main); box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 1rem;">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-main); padding-bottom: 0.75rem;">
                <div>
                    <h3 style="margin: 0; font-size: 1.2rem; font-weight: 800; color: var(--text-primary);">${binLabel} Başarı Bandındaki İstasyonlar</h3>
                    <p style="margin: 0.2rem 0 0 0; font-size: 0.75rem; color: var(--text-secondary);">Detaylar için istasyon satırına tıklayabilirsiniz.</p>
                </div>
                <i class="fas fa-times close-modal" onclick="closeScoreDistributionModal()" style="cursor: pointer; color: var(--text-secondary); font-size: 1.2rem;"></i>
            </div>
            <div class="modal-body" style="overflow-y: visible;">
                ${listHtml}
            </div>
        </div>
    `;

    document.body.appendChild(modalDiv);

    modalDiv.addEventListener('click', (e) => {
        if (e.target === modalDiv) {
            closeScoreDistributionModal();
        }
    });
}

function renderProfessionalScoreDistribution(audits) {
    const bins = [
        { label: '0-49', min: 0, max: 49.999, color: '#e11d48' },
        { label: '50-59', min: 50, max: 59.999, color: '#f97316' },
        { label: '60-69', min: 60, max: 69.999, color: '#f59e0b' },
        { label: '70-79', min: 70, max: 79.999, color: '#eab308' },
        { label: '80-89', min: 80, max: 89.999, color: '#22c55e' },
        { label: '90-100', min: 90, max: 100, color: '#10b981' }
    ];
    const scores = audits.map(getAuditDisplayScore);
    const options = statsBaseOptions();
    options.layout.padding = { top: 34, right: 12, bottom: 0, left: 4 };
    options.plugins.legend.display = false;
    options.scales.x.grid.display = false;
    options.scales.x.title = { display: true, text: 'Puan Aralığı', color: statsChartTheme().dim, font: { size: 10, weight: '800' } };
    options.scales.y.ticks.precision = 0;
    options.scales.y.title = { display: true, text: 'Denetim Adedi', color: statsChartTheme().dim, font: { size: 10, weight: '800' } };
    
    // Add click handler to open the modal with station details
    options.onClick = (event, elements) => {
        if (elements && elements.length > 0) {
            const index = elements[0].index;
            const bin = bins[index];
            const matchingAudits = audits.filter(audit => {
                const score = getAuditDisplayScore(audit);
                return score >= bin.min && score <= bin.max;
            });
            openScoreDistributionModal(bin.label, matchingAudits);
        }
    };

    // Change cursor style to pointer on hover over bars
    options.onHover = (event, elements) => {
        if (event && event.native && event.native.target) {
            event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        }
    };

    statsCreateChart('stats-score-distribution-chart', {
        type: 'bar',
        data: {
            labels: bins.map(bin => bin.label),
            datasets: [{
                label: 'Denetim',
                data: bins.map(bin => scores.filter(score => score >= bin.min && score <= bin.max).length),
                statsValueType: 'count',
                statsLabelAnchor: 'end',
                statsLabelAlign: 'top',
                statsLabelOffset: 4,
                backgroundColor: bins.map(bin => bin.color),
                borderColor: bins.map(bin => bin.color),
                borderWidth: 1.5,
                borderRadius: 7
            }]
        },
        options
    });
}

function renderProfessionalAuditorChart(audits) {
    const groups = new Map();
    audits.forEach(audit => {
        const auditor = audit.auditorName || 'Belirtilmedi';
        if (!groups.has(auditor)) groups.set(auditor, []);
        groups.get(auditor).push(getAuditDisplayScore(audit));
    });
    const rows = [...groups.entries()].map(([auditor, scores]) => {
        const user = getAuditorUserObject(auditor);
        let title = '';
        let lines = '';
        if (user) {
            title = user.title || getRbacRoleDisplayName(user) || 'Saha Denetçisi';
            if (hasGlobalScope(user)) {
                lines = 'Tüm Hatlar';
            } else {
                const lList = Array.isArray(user.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
                lines = lList.length ? lList.join(', ') : 'Yetki Tanımlı Hat Yok';
            }
        } else {
            title = 'Denetçi';
            lines = 'Hat Tanımlanmamış';
        }
        return {
            auditor: getAuditorDisplayName(auditor),
            average: statsMean(scores),
            count: scores.length,
            title,
            lines
        };
    }).sort((a, b) => b.count - a.count).slice(0, 10);

    statsSetScrollableChartHeight('stats-auditor-scroll', 'stats-auditor-canvas-wrap', rows.length, 68);
    const options = statsBaseOptions({ indexAxis: 'y', percentage: true });
    options.scales.x.max = 100;
    options.scales.x.title = { display: true, text: 'Ortalama Puan (%)', color: statsChartTheme().dim, font: { size: 10, weight: '800' } };
    options.scales.x1 = {
        position: 'top',
        beginAtZero: true,
        suggestedMax: Math.max(1, ...rows.map(row => row.count)) * 1.18,
        grid: { display: false },
        title: { display: true, text: 'Denetim Adedi', color: statsChartTheme().cyan, font: { size: 10, weight: '800' } },
        ticks: { color: statsChartTheme().cyan, precision: 0, stepSize: 1, font: { size: 10, weight: '800' } }
    };
    options.scales.y.grid.display = false;
    options.scales.y.ticks = { autoSkip: false, color: statsChartTheme().text, padding: 8, font: { size: 10, weight: '750', lineHeight: 1.2 } };
    options.layout.padding = { top: 10, right: 58, bottom: 0, left: 4 };
    options.plugins.legend.align = 'center';
    options.plugins.tooltip.callbacks.title = items => rows[items[0]?.dataIndex]?.auditor || '';
    options.plugins.tooltip.callbacks.afterTitle = items => {
        const row = rows[items[0]?.dataIndex];
        if (!row) return '';
        return `Ünvan: ${row.title}\nYetkili Hatlar: ${row.lines}`;
    };

    statsCreateChart('stats-auditor-chart', {
        type: 'bar',
        data: {
            labels: rows.map(row => {
                let subLabel = `${row.title} (${row.lines})`;
                if (subLabel.length > 30) {
                    subLabel = subLabel.slice(0, 27) + '...';
                }
                return [
                    row.auditor,
                    subLabel,
                    `${row.count} denetim`
                ];
            }),
            datasets: [
                { label: 'Ortalama Puan', data: rows.map(row => row.average), xAxisID: 'x', statsValueType: 'percentage', statsLabelInside: true, statsLabelAnchor: 'end', statsLabelAlign: 'start', backgroundColor: '#8b5cf6', borderRadius: 7, barThickness: 15 },
                { type: 'line', label: 'Denetim Adedi', data: rows.map(row => row.count), xAxisID: 'x1', statsValueType: 'count', statsLabelSuffix: ' adet', statsShowZero: true, statsLabelAlign: 'top', statsLabelOffset: 5, borderColor: statsChartTheme().cyan, backgroundColor: statsChartTheme().cyan, pointRadius: 5, pointHoverRadius: 6, pointBorderColor: '#ffffff', pointBorderWidth: 1.5, borderWidth: 2 }
            ]
        },
        options
    });
}

function renderProfessionalLineNcChart(ncs, auditLookup) {
    const groups = new Map();
    ncs.forEach(nc => {
        const line = statsNcLine(nc, auditLookup);
        if (!groups.has(line)) groups.set(line, { open: 0, overdue: 0, control: 0, closed: 0 });
        const group = groups.get(line);
        if (isNcClosed(nc)) group.closed++;
        else if (isNcWaitingControl(nc)) group.control++;
        else if (isNcOverdue(nc)) group.overdue++;
        else group.open++;
    });
    const rows = [...groups.entries()].map(([line, counts]) => ({ line, ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) }))
        .sort((a, b) => b.total - a.total).slice(0, 12);
    statsSetScrollableChartHeight('stats-line-nc-scroll', 'stats-line-nc-canvas-wrap', rows.length, 48);
    const options = statsBaseOptions({ indexAxis: 'y', stacked: true });
    options.scales.x.stacked = true;
    options.scales.x.ticks.precision = 0;
    options.scales.x.title = { display: true, text: 'Aksiyon Adedi', color: statsChartTheme().dim, font: { size: 10, weight: '800' } };
    options.scales.y.stacked = true;
    options.scales.y.grid.display = false;
    options.scales.y.ticks = { display: false };
    options.scales.y.afterFit = scale => { scale.width = 112; };
    options.layout.padding = { top: 8, right: 16, bottom: 0, left: 0 };
    options.plugins.legend.align = 'center';
    options.plugins.tooltip.callbacks.title = items => rows[items[0]?.dataIndex]?.line || '';
    statsCreateChart('stats-line-nc-chart', {
        type: 'bar',
        plugins: [statsLineLogoPlugin('nc-status', rows, row => `${row.total} aksiyon`)],
        data: {
            labels: rows.map(row => row.line),
            datasets: [
                { label: 'Açık', data: rows.map(row => row.open), statsValueType: 'count', statsLabelInside: true, backgroundColor: '#3b82f6', borderRadius: 4 },
                { label: 'Geciken', data: rows.map(row => row.overdue), statsValueType: 'count', statsLabelInside: true, backgroundColor: '#e11d48', borderRadius: 4 },
                { label: 'Kontrol', data: rows.map(row => row.control), statsValueType: 'count', statsLabelInside: true, backgroundColor: '#f59e0b', borderRadius: 4 },
                { label: 'Kapalı', data: rows.map(row => row.closed), statsValueType: 'count', statsLabelInside: true, backgroundColor: '#10b981', borderRadius: 4 }
            ]
        },
        options
    });
}

function statsPlanMatchesAudit(plan, audit, assignedUser) {
    const auditDate = statsAuditDate(audit);
    const start = statsToDate(plan.startDate);
    const due = statsToDate(plan.dueDate);
    if (!auditDate || (start && auditDate < start) || (due && auditDate > new Date(due.getTime() + 86400000))) return false;
    const targetLine = plan.targetLine || plan.lineId || plan.line;
    if (targetLine && audit.line && String(targetLine) !== String(audit.line)) return false;
    const targetStations = Array.isArray(plan.targetStations) ? plan.targetStations : [plan.stationId || plan.station].filter(Boolean);
    if (targetStations.length && audit.station && !targetStations.includes(audit.station)) return false;
    const userKeys = [assignedUser?.id, assignedUser?.name, assignedUser?.username, plan.assignedTitle].filter(Boolean).map(normalizeText);
    const auditKeys = [audit.auditorId, audit.userId, audit.auditorName].filter(Boolean).map(normalizeText);
    return !userKeys.length || auditKeys.some(key => userKeys.includes(key));
}

function renderProfessionalPlanChart(audits, filters) {
    let plans = [...(appData.plans || [])];
    if (filters.typeFilters.length) plans = plans.filter(plan => filters.typeFilters.includes(String(plan.auditTypeId || plan.auditType)));
    if (filters.lineFilters.length) plans = plans.filter(plan => filters.lineFilters.includes(plan.targetLine || plan.lineId || plan.line));
    if (filters.stationFilters.length) {
        plans = plans.filter(plan => {
            const stations = Array.isArray(plan.targetStations) ? plan.targetStations : [plan.stationId || plan.station].filter(Boolean);
            return stations.some(station => filters.stationFilters.includes(station));
        });
    }
    if (filters.userFilters.length) {
        plans = plans.filter(plan => {
            const user = (appData.users || []).find(item => String(item.id) === String(plan.assignedUserId));
            return filters.userFilters.includes(user?.name) || filters.userFilters.includes(user?.username) || filters.userFilters.includes(plan.assignedTitle);
        });
    }
    if (filters.yearFilters.length) {
        plans = plans.filter(plan => {
            const date = statsToDate(plan.startDate || plan.dueDate);
            return date && filters.yearFilters.includes(String(date.getFullYear()));
        });
    }
    if (filters.monthFilters.length) {
        plans = plans.filter(plan => {
            const date = statsToDate(plan.startDate || plan.dueDate);
            return date && filters.monthFilters.includes(String(date.getMonth() + 1));
        });
    }
    const groups = new Map();
    plans.forEach(plan => {
        const user = (appData.users || []).find(item => String(item.id) === String(plan.assignedUserId));
        const label = user?.name || user?.username || plan.assignedTitle || 'Atanmamış';
        if (!groups.has(label)) groups.set(label, { planned: 0, matched: 0 });
        const group = groups.get(label);
        group.planned++;
        if (audits.some(audit => statsPlanMatchesAudit(plan, audit, user))) group.matched++;
    });
    const rows = [...groups.entries()].map(([label, values]) => ({ label, ...values })).sort((a, b) => b.planned - a.planned).slice(0, 10);
    statsSetScrollableChartHeight('stats-plan-actual-scroll', 'stats-plan-actual-canvas-wrap', rows.length, 48);
    const options = statsBaseOptions({ indexAxis: 'y' });
    options.scales.x.ticks.precision = 0;
    options.scales.x.title = { display: true, text: 'Denetim Adedi', color: statsChartTheme().dim, font: { size: 10, weight: '800' } };
    options.scales.y.grid.display = false;
    options.scales.y.ticks = { autoSkip: false, color: statsChartTheme().text, padding: 8, font: { size: 10, weight: '750', lineHeight: 1.2 } };
    options.plugins.legend.align = 'center';
    options.plugins.tooltip.callbacks.title = items => rows[items[0]?.dataIndex]?.label || '';
    statsCreateChart('stats-plan-actual-chart', {
        type: 'bar',
        data: {
            labels: rows.map(row => statsWrapAxisLabel(row.label)),
            datasets: [
                { label: 'Planlanan', data: rows.map(row => row.planned), statsValueType: 'count', statsLabelInside: true, backgroundColor: 'rgba(139,92,246,0.72)', borderColor: '#8b5cf6', borderWidth: 1, borderRadius: 6 },
                { label: 'Gerçekleşen', data: rows.map(row => row.matched), statsValueType: 'count', statsLabelInside: true, backgroundColor: '#10b981', borderRadius: 6 }
            ]
        },
        options
    });
}

function renderProfessionalStationTable(audits, ncs, auditLookup) {
    const body = document.getElementById('stats-station-ranking-body');
    if (!body) return;
    const groups = new Map();
    audits.forEach(audit => {
        const key = `${audit.line || 'Diğer'}||${audit.station || 'Belirtilmedi'}`;
        if (!groups.has(key)) groups.set(key, { line: audit.line || 'Diğer', station: audit.station || 'Belirtilmedi', scores: [], audits: 0, ncs: [] });
        const group = groups.get(key);
        group.scores.push(getAuditDisplayScore(audit));
        group.audits++;
    });
    ncs.forEach(nc => {
        const line = statsNcLine(nc, auditLookup);
        const station = statsNcStation(nc, auditLookup);
        const key = `${line}||${station}`;
        if (!groups.has(key)) groups.set(key, { line, station, scores: [], audits: 0, ncs: [] });
        groups.get(key).ncs.push(nc);
    });
    const rows = [...groups.values()].map(group => ({
        ...group,
        average: statsMean(group.scores),
        median: statsMedian(group.scores),
        density: group.audits ? group.ncs.length / group.audits : 0,
        closure: group.ncs.length ? (group.ncs.filter(isNcClosed).length / group.ncs.length) * 100 : 0
    })).filter(row => row.audits).sort((a, b) => b.average - a.average);
    body.innerHTML = rows.length ? rows.map(row => `
        <tr>
            <td><div class="stats-table-primary">${statsLineLogoHtml(row.line)}<span>${escapeAttr(row.station)}</span></div></td>
            <td class="stats-numeric-cell"><span class="stats-value-pill stats-value-pill--count">${row.audits}</span></td>
            <td class="stats-numeric-cell"><span class="stats-score-pill" style="${statsColoredPillStyle(getHeatmapColor(row.average))}">${statsFormatChartValue(row.average, 'percentage')}</span></td>
            <td class="stats-numeric-cell"><span class="stats-value-pill stats-value-pill--neutral">${statsFormatChartValue(row.median, 'percentage')}</span></td>
            <td class="stats-numeric-cell"><span class="stats-value-pill stats-value-pill--density">${Number(row.density.toFixed(2)).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</span></td>
            <td class="stats-numeric-cell"><span class="stats-value-pill stats-value-pill--success">${statsFormatChartValue(row.closure, 'percentage')}</span></td>
        </tr>
    `).join('') : '<tr><td colspan="6" class="stats-empty-cell">Seçili filtrelerde istasyon verisi bulunamadı.</td></tr>';
}

function getProfessionalQuestionRows(audits) {
    const groups = new Map();
    audits.forEach(audit => {
        buildAuditDetailMetrics(audit).rows.forEach(row => {
            const key = `${row.categoryName}||${row.questionText}`;
            if (!groups.has(key)) groups.set(key, { question: row.questionText, category: row.categoryName, scores: [], failures: 0 });
            const group = groups.get(key);
            group.scores.push(row.percent);
            if (row.isNonconformity) group.failures++;
        });
    });
    return [...groups.values()].map(group => ({
        ...group,
        average: statsMean(group.scores),
        riskRate: group.scores.length ? (group.failures / group.scores.length) * 100 : 0
    })).sort((a, b) => b.riskRate - a.riskRate || b.failures - a.failures);
}

function renderProfessionalQuestionTable(audits) {
    const body = document.getElementById('stats-question-risk-body');
    if (!body) return;
    const rows = getProfessionalQuestionRows(audits);
    body.innerHTML = rows.length ? rows.map(row => `
        <tr>
            <td title="${escapeAttr(row.question)}">${escapeAttr(row.question.length > 72 ? `${row.question.slice(0, 72)}...` : row.question)}</td>
            <td>${escapeAttr(row.category)}</td>
            <td class="stats-numeric-cell"><span class="stats-value-pill stats-value-pill--count">${row.scores.length}</span></td>
            <td class="stats-numeric-cell"><span class="stats-risk-pill" style="${statsColoredPillStyle(row.riskRate >= 50 ? '#e11d48' : (row.riskRate >= 25 ? '#f97316' : '#10b981'))}">${statsFormatChartValue(row.riskRate, 'percentage')}</span></td>
            <td class="stats-numeric-cell"><span class="stats-score-pill" style="${statsColoredPillStyle(getHeatmapColor(row.average))}">${statsFormatChartValue(row.average, 'percentage')}</span></td>
        </tr>
    `).join('') : '<tr><td colspan="5" class="stats-empty-cell">Soru bazlı analiz için cevap verisi bulunamadı.</td></tr>';
}

function renderProfessionalHeatmap(audits) {
    const head = document.getElementById('stats-line-category-head');
    const body = document.getElementById('stats-line-category-body');
    if (!head || !body) return;
    const categoryRows = getProfessionalCategoryRows(audits);
    const categories = categoryRows.sort((a, b) => b.count - a.count).slice(0, 10).map(row => row.category);
    const lines = [...new Set(audits.map(audit => audit.line || 'Diğer'))].sort((a, b) => a.localeCompare(b, 'tr'));
    const matrix = new Map();
    audits.forEach(audit => {
        const line = audit.line || 'Diğer';
        buildAuditDetailMetrics(audit).rows.forEach(row => {
            const key = `${line}||${row.categoryName}`;
            if (!matrix.has(key)) matrix.set(key, []);
            matrix.get(key).push(row.percent);
        });
    });
    head.innerHTML = `<tr><th>Hat</th>${categories.map(category => `<th title="${escapeAttr(category)}">${escapeAttr(category.length > 18 ? `${category.slice(0, 18)}...` : category)}</th>`).join('')}<th>Genel</th></tr>`;
    body.innerHTML = lines.length && categories.length ? lines.map(line => {
        const lineScores = [];
        const cells = categories.map(category => {
            const scores = matrix.get(`${line}||${category}`) || [];
            lineScores.push(...scores);
            const cellColor = getHeatmapColor(statsMean(scores));
            return `<td>${scores.length ? `<span class="stats-heat-cell" style="${statsColoredPillStyle(cellColor)}">%${statsMean(scores).toFixed(0)}</span>` : '-'}</td>`;
        }).join('');
        const overall = statsMean(lineScores);
        return `<tr><td><div class="stats-table-primary stats-table-primary--logo">${statsLineLogoHtml(line)}</div></td>${cells}<td>${lineScores.length ? `<span class="stats-score-pill" style="${statsColoredPillStyle(getHeatmapColor(overall))}">${statsFormatChartValue(overall, 'percentage')}</span>` : '-'}</td></tr>`;
    }).join('') : `<tr><td colspan="${categories.length + 2}" class="stats-empty-cell">Isı matrisi için kategori cevapları bulunamadı.</td></tr>`;
}

function renderProfessionalInsights(audits, ncs, auditLookup, comparison) {
    const container = document.getElementById('stats-insights-list');
    if (!container) return;
    const lineGroups = new Map();
    audits.forEach(audit => {
        const line = audit.line || 'Diğer';
        if (!lineGroups.has(line)) lineGroups.set(line, []);
        lineGroups.get(line).push(getAuditDisplayScore(audit));
    });
    const lines = [...lineGroups.entries()].map(([line, scores]) => ({ line, average: statsMean(scores), count: scores.length })).filter(row => row.count >= 2);
    const bestLine = [...lines].sort((a, b) => b.average - a.average)[0];
    
    // Calculate most improved station
    let mostImprovedStation = null;
    const stationDeltas = [];
    if (comparison && comparison.currentAudits && comparison.previousAudits) {
        const stationCurrentScores = new Map();
        comparison.currentAudits.forEach(audit => {
            const station = audit.station;
            if (!station) return;
            if (!stationCurrentScores.has(station)) stationCurrentScores.set(station, []);
            stationCurrentScores.get(station).push(getAuditDisplayScore(audit));
        });

        const stationPreviousScores = new Map();
        comparison.previousAudits.forEach(audit => {
            const station = audit.station;
            if (!station) return;
            if (!stationPreviousScores.has(station)) stationPreviousScores.set(station, []);
            stationPreviousScores.get(station).push(getAuditDisplayScore(audit));
        });

        stationCurrentScores.forEach((currScores, station) => {
            if (stationPreviousScores.has(station)) {
                const prevScores = stationPreviousScores.get(station);
                const currAvg = statsMean(currScores);
                const prevAvg = statsMean(prevScores);
                const delta = currAvg - prevAvg;
                if (delta > 0) {
                    stationDeltas.push({ station, currAvg, prevAvg, delta });
                }
            }
        });
    }

    // Fallback: If no delta found using 30-day periods, use chronological split of all audits per station
    if (stationDeltas.length === 0 && audits.length) {
        const stationAllAudits = new Map();
        audits.forEach(audit => {
            const station = audit.station;
            if (!station) return;
            if (!stationAllAudits.has(station)) stationAllAudits.set(station, []);
            stationAllAudits.get(station).push(audit);
        });

        stationAllAudits.forEach((stationAudits, station) => {
            if (stationAudits.length >= 2) {
                const sortedAudits = [...stationAudits].sort((a, b) => {
                    const dateA = statsAuditDate(a) || new Date(0);
                    const dateB = statsAuditDate(b) || new Date(0);
                    return dateA.getTime() - dateB.getTime();
                });
                const half = Math.ceil(sortedAudits.length / 2);
                const olderAudits = sortedAudits.slice(0, half);
                const newerAudits = sortedAudits.slice(half);
                if (olderAudits.length && newerAudits.length) {
                    const prevAvg = statsMean(olderAudits.map(getAuditDisplayScore));
                    const currAvg = statsMean(newerAudits.map(getAuditDisplayScore));
                    const delta = currAvg - prevAvg;
                    if (delta > 0) {
                        stationDeltas.push({ station, currAvg, prevAvg, delta });
                    }
                }
            }
        });
    }

    if (stationDeltas.length) {
        stationDeltas.sort((a, b) => b.delta - a.delta);
        mostImprovedStation = stationDeltas[0];
    }

    const categories = getProfessionalCategoryRows(audits);
    const weakestCategory = categories[0];
    const overdue = ncs.filter(isNcOverdue).length;
    const scoreDelta = comparison.currentScore - comparison.previousScore;
    const items = [
        bestLine && { icon: 'fa-trophy', color: '#10b981', title: 'En güçlü hat', text: `${bestLine.line}, ${bestLine.count} denetimde ${statsFormatChartValue(bestLine.average, 'percentage')} ortalama puana sahip.` },
        mostImprovedStation && { icon: 'fa-circle-arrow-up', color: '#10b981', title: 'En çok yükselen istasyon', text: `${mostImprovedStation.station} istasyonu, ortalama performansını önceki döneme göre ${mostImprovedStation.delta.toFixed(1)} puan artırarak %${mostImprovedStation.currAvg.toFixed(0)} seviyesine ulaştırdı.` },
        weakestCategory && { icon: 'fa-magnifying-glass-chart', color: '#f97316', title: 'Gelişim önceliği', text: `${weakestCategory.category} kategorisi ${statsFormatChartValue(weakestCategory.average, 'percentage')} ile en düşük cevap bazlı ortalamaya sahip.` },
        { icon: 'fa-arrow-trend-up', color: scoreDelta >= 0 ? '#10b981' : '#e11d48', title: 'Dönemsel yön', text: `Son 30 günlük ortalama önceki döneme göre ${scoreDelta >= 0 ? 'yükseldi' : 'geriledi'} (${Math.abs(scoreDelta).toFixed(1)} puan).` },
        { icon: 'fa-clock-rotate-left', color: overdue ? '#e11d48' : '#10b981', title: 'Gecikme sinyali', text: overdue ? `${overdue} aksiyon gecikmiş durumda; öncelikli takip gerektiriyor.` : 'Seçili kapsamda gecikmiş aksiyon bulunmuyor.' }
    ].filter(Boolean);
    container.innerHTML = items.map(item => `
        <div class="stats-insight-item" style="--insight-color:${item.color}">
            <span class="stats-insight-icon"><i class="fas ${item.icon}"></i></span>
            <div><strong>${item.title}</strong><p>${escapeAttr(item.text)}</p></div>
        </div>
    `).join('');
}

function renderProfessionalDataQuality(audits, ncs) {
    const container = document.getElementById('stats-data-quality');
    if (!container) return;
    const withAnswers = audits.filter(audit => Array.isArray(audit.answers) && audit.answers.length).length;
    const withDate = audits.filter(audit => statsAuditDate(audit)).length;
    const linkedNcs = ncs.filter(nc => nc.auditId).length;
    const answerCoverage = audits.length ? (withAnswers / audits.length) * 100 : 0;
    const dateCoverage = audits.length ? (withDate / audits.length) * 100 : 0;
    const linkCoverage = ncs.length ? (linkedNcs / ncs.length) * 100 : 0;
    const items = [
        { label: 'Soru-cevap kapsamı', value: answerCoverage, text: `${withAnswers} / ${audits.length} denetimde ayrıntılı cevap var.` },
        { label: 'Tarih bütünlüğü', value: dateCoverage, text: `${withDate} / ${audits.length} denetimin tarihi analiz edilebilir.` },
        { label: 'Uygunsuzluk-denetim bağlantısı', value: linkCoverage, text: `${linkedNcs} / ${ncs.length} uygunsuzluk bir denetime bağlı.` }
    ];
    container.innerHTML = items.map(item => {
        const color = item.value >= 85 ? '#10b981' : (item.value >= 60 ? '#f59e0b' : '#e11d48');
        return `<div class="stats-quality-item" style="--insight-color:${color}"><span class="stats-quality-icon"><i class="fas fa-shield-halved"></i></span><div><strong>${item.label}: ${statsFormatChartValue(item.value, 'percentage')}</strong><p>${item.text}</p></div></div>`;
    }).join('');
}

function renderProfessionalStats() {
    const { audits, ncs, auditLookup, filters } = getProfessionalStatsData();
    const recordDates = [...audits.map(statsAuditDate), ...ncs.map(nc => statsNcDate(nc, auditLookup))].filter(Boolean);
    const latest = recordDates.length ? new Date(Math.max(...recordDates.map(date => date.getTime()))) : null;
    const filterCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);

    statsSetText('stats-data-scope', (audits.length + ncs.length).toLocaleString('tr-TR'));
    statsSetText('stats-last-record', latest ? `Son kayıt ${latest.toLocaleDateString('tr-TR')}` : 'Kayıt yok');
    statsSetText(
        'stats-analysis-summary',
        `${audits.length} denetim ve ${ncs.length} uygunsuzluk ${filterCount ? `${filterCount} aktif filtreyle` : 'tüm erişilebilir kapsamda'} analiz ediliyor.`
    );

    renderProfessionalStatsKpis(audits, ncs);
    const comparison = renderProfessionalPeriodComparison(audits, ncs, auditLookup);
    renderProfessionalTrendChart(audits);
    renderProfessionalNcStatus(ncs);
    renderProfessionalLinePerformance(audits, ncs, auditLookup);
    renderProfessionalScoreDistribution(audits);
    renderProfessionalCategoryChart(audits);
    renderProfessionalAuditorChart(audits);
    renderProfessionalLineNcChart(ncs, auditLookup);
    renderProfessionalPlanChart(audits, filters);
    renderProfessionalStationTable(audits, ncs, auditLookup);
    renderProfessionalQuestionTable(audits);
    renderProfessionalHeatmap(audits);
    renderProfessionalInsights(audits, ncs, auditLookup, comparison);
    renderProfessionalDataQuality(audits, ncs);
}

function renderAdvancedStats() {
    renderProfessionalStats();
    return;
    const typeFilters = getMultiSelectValues('filter-stats-type');
    const lineFilters = getMultiSelectValues('filter-stats-line');
    const stationFilters = getMultiSelectValues('filter-stats-station');
    const userFilters = getMultiSelectValues('filter-stats-user');
    const yearFilters = getMultiSelectValues('filter-stats-year');
    const monthFilters = getMultiSelectValues('filter-stats-month');

    let filteredAudits = getFilteredAudits();
    let filteredNCs = getFilteredNCs();
    const auditLookup = new Map(filteredAudits.map(a => [String(a.id), a]));

    // 1. Audit Type Filter (multi)
    if (typeFilters.length) {
        filteredAudits = filteredAudits.filter(a => typeFilters.some(typeVal => filterByAuditType([a], typeVal).length > 0));
        filteredNCs = filteredNCs.filter(n => typeFilters.some(typeVal => filterByAuditType([n], typeVal, getNonconformityTypeValues).length > 0));
    }

    // 2. Line Filter (multi)
    if (lineFilters.length) {
        filteredAudits = filteredAudits.filter(a => lineFilters.includes(a.line));
        filteredNCs = filteredNCs.filter(n => (lineFilters.includes(auditLookup.get(String(n.auditId))?.line) || lineFilters.includes(n.line)));
    }

    // 3. Station Filter (multi)
    if (stationFilters.length) {
        filteredAudits = filteredAudits.filter(a => stationFilters.includes(a.station));
        filteredNCs = filteredNCs.filter(n => (stationFilters.includes(auditLookup.get(String(n.auditId))?.station) || stationFilters.includes(n.station)));
    }

    // 4. Auditor Filter (multi)
    if (userFilters.length) {
        filteredAudits = filteredAudits.filter(a => userFilters.some(f => normalizeTurkish(f) === normalizeTurkish(a.auditorName)));
        filteredNCs = filteredNCs.filter(n => userFilters.some(f => normalizeTurkish(f) === normalizeTurkish(n.auditorName)));
    }

    // 5. Year Filter (multi)
    if (yearFilters.length) {
        filteredAudits = filteredAudits.filter(a => yearFilters.includes(new Date(a.date).getFullYear().toString()));
        filteredNCs = filteredNCs.filter(n => {
            const auditDate = auditLookup.get(String(n.auditId))?.date;
            const ncDate = n.detectionDate || n.createdAt || n.date || auditDate;
            return yearFilters.includes(new Date(ncDate).getFullYear().toString());
        });
    }

    // 6. Month Filter (multi)
    if (monthFilters.length) {
        filteredAudits = filteredAudits.filter(a => monthFilters.includes((new Date(a.date).getMonth() + 1).toString()));
        filteredNCs = filteredNCs.filter(n => {
            const auditDate = auditLookup.get(String(n.auditId))?.date;
            const ncDate = n.detectionDate || n.createdAt || n.date || auditDate;
            return monthFilters.includes((new Date(ncDate).getMonth() + 1).toString());
        });
    }

    // Metric Calculations
    const totalAudits = filteredAudits.length;
    const avgScore = totalAudits > 0 ? filteredAudits.reduce((s, a) => s + a.score, 0) / totalAudits : 0;
    const openNC = filteredNCs.filter(isNcOpen).length;
    const overdueNC = filteredNCs.filter(isNcOverdue).length;
    const completedNC = filteredNCs.filter(isNcClosed).length;

    // Update Metric Cards
    if (document.getElementById('stats-avg-score')) document.getElementById('stats-avg-score').innerText = avgScore.toFixed(1);
    if (document.getElementById('stats-total-audits')) document.getElementById('stats-total-audits').innerText = totalAudits;
    if (document.getElementById('stats-open-nc')) document.getElementById('stats-open-nc').innerText = openNC;
    if (document.getElementById('stats-overdue-nc')) document.getElementById('stats-overdue-nc').innerText = overdueNC;
    if (document.getElementById('stats-completed-nc')) document.getElementById('stats-completed-nc').innerText = completedNC;
    const overdueCard = document.getElementById('stats-overdue-nc')?.closest('.stat-card');
    const isStationType = typeFilters.some(type => isStationAuditTypeId(type));
    if (overdueCard) overdueCard.style.display = isStationType ? 'none' : '';
    const categorySection = document.getElementById('categoryChartStats')?.closest('.data-section');
    const lineMatrixSection = document.getElementById('line-matrix-head')?.closest('.data-section');
    const stationMatrixSection = document.getElementById('station-matrix-head')?.closest('.data-section');
    [categorySection, lineMatrixSection, stationMatrixSection].forEach(section => {
        if (section) section.style.display = isStationType ? 'none' : '';
    });

    const firstType = typeFilters.length ? typeFilters[0] : 'all';

    // Render Charts
    renderTrendChart(filteredAudits);
    renderLineDistChart(filteredAudits);
    if (!isStationType) renderCategoryStatsChart(filteredAudits);
    renderNCStatusChart(filteredNCs, firstType);

    // Lists
    renderNCPriorityAreas(filteredNCs);

    // Timeliness
    renderTimelinessChart(filteredAudits, appData.plans);

    // Role Comparison
    renderRoleComparisonChart(filteredAudits);

    // Matrices
    renderLineMatrix(filteredAudits);
    renderStatsStationMatrix(filteredAudits, firstType);
}

function renderLineMatrix(audits) {
    const head = document.getElementById('line-matrix-head');
    const body = document.getElementById('line-matrix-body');
    if (!head || !body) return;

    const categories = getProfessionalCategoryRows(audits)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map(item => item.category);
    const lines = [...new Set(audits.map(a => a.line))].sort();

    // Head
    head.innerHTML = `<tr><th style="text-align: left; padding: 12px;">HAT</th>${categories.map(c => `<th style="font-size: 0.65rem;">${c.toUpperCase()}</th>`).join('')}<th style="font-size: 0.65rem;">GENEL</th></tr>`;

    // Body
    body.innerHTML = '';
    lines.forEach(line => {
        const color = appData.lineColors[line] || '#64748b';
        const row = document.createElement('tr');
        row.style.borderTop = '1px solid var(--glass-border)';
        
        let cells = `
            <td style="padding: 12px; font-weight: 700; font-size: 0.8rem; color: var(--text-primary);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: ${color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; font-weight: 800;">${line.substring(0,2)}</div>
                    ${line}
                </div>
            </td>`;
        
        const lineCategoryScores = new Map();
        audits.filter(audit => audit.line === line).forEach(audit => {
            buildAuditDetailMetrics(audit).rows.forEach(metric => {
                if (!lineCategoryScores.has(metric.categoryName)) lineCategoryScores.set(metric.categoryName, []);
                lineCategoryScores.get(metric.categoryName).push(metric.percent);
            });
        });
        const lineScores = [];
        categories.forEach(cat => {
            const scores = lineCategoryScores.get(cat) || [];
            const catScore = statsMean(scores);
            lineScores.push(...scores);
            cells += `<td style="text-align: center;">${scores.length ? `<div style="background: ${getHeatmapColor(catScore)}; color: white; padding: 4px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">%${catScore.toFixed(0)}</div>` : '-'}</td>`;
        });
        
        const avg = statsMean(lineScores);
        cells += `<td style="text-align: center; font-weight: 800; color: var(--primary);">%${avg.toFixed(1)}</td>`;
        
        row.innerHTML = cells;
        body.appendChild(row);
    });
}

function renderStatsStationMatrix(audits, typeFilter = 'general') {
    const head = document.getElementById('station-matrix-head');
    const body = document.getElementById('station-matrix-body');
    if (!head || !body) return;

    const categories = isStationAuditTypeId(typeFilter)
        ? ['Açık', 'Kapalı']
        : ['Kategori 1', 'Kategori 2', 'Kategori 3', 'Kategori 4', 'Kategori 5'];
    const stations = [...new Set(audits.map(a => a.station))].sort().slice(0, 15); // Show top 15 for readability

    // Head
    head.innerHTML = `<tr><th style="text-align: left; padding: 12px;">İSTASYON</th>${categories.map(c => `<th style="font-size: 0.65rem;">${c.toUpperCase()}</th>`).join('')}<th style="font-size: 0.65rem;">GENEL</th></tr>`;

    // Body
    body.innerHTML = '';
    if (!stations.length) {
        body.innerHTML = `<tr><td colspan="${categories.length + 2}" style="padding: 1rem; text-align: center; color: var(--text-dim);">Seçili filtrelere uygun veri yok.</td></tr>`;
        return;
    }
    stations.forEach(st => {
        const stAudits = audits.filter(a => a.station === st);
        const row = document.createElement('tr');
        row.style.borderTop = '1px solid var(--glass-border)';
        
        let cells = `<td style="padding: 12px; font-weight: 600; font-size: 0.75rem; color: var(--text-secondary);">${st}</td>`;
        
        const avg = stAudits.length ? stAudits.reduce((sum, a) => sum + (Number(a.score) || 0), 0) / stAudits.length : 0;
        categories.forEach(() => {
            const catScore = avg;
            cells += `<td style="text-align: center;"><div style="background: ${getHeatmapColor(catScore)}; color: white; padding: 4px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">%${catScore.toFixed(0)}</div></td>`;
        });
        
        cells += `<td style="text-align: center; font-weight: 800; color: var(--primary);">%${avg.toFixed(1)}</td>`;
        
        row.innerHTML = cells;
        body.appendChild(row);
    });
}

function getHeatmapColor(score) {
    if (score >= 90) return '#16a34a'; // Koyu Canli Yesil
    if (score >= 80) return '#22c55e'; // Canli Yesil
    if (score >= 70) return '#fbbf24'; // Sari
    if (score >= 50) return '#f59e0b'; // Turuncu
    return '#dc2626'; // Koyu kirmizi, beyaz metinle daha yuksek kontrast
}

function renderTrendChart(audits) {
    const canvas = document.getElementById('performanceChartStats');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Group by month
    const monthlyScores = {};
    const monthOrder = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    
    audits.forEach(a => {
        const date = new Date(a.date || a.detectionDate);
        if (isNaN(date.getTime())) return;
        const month = date.toLocaleString('tr-TR', { month: 'short' }).replace('.', '');
        if (!monthlyScores[month]) monthlyScores[month] = [];
        monthlyScores[month].push(a.score);
    });

    // Sort labels chronologically
    const labels = Object.keys(monthlyScores).sort((a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b));
    if (labels.length === 0) {
        if (window.trendChartStats instanceof Chart) window.trendChartStats.destroy();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }
    const data = labels.map(m => monthlyScores[m].reduce((s, v) => s + v, 0) / monthlyScores[m].length);

    if (window.trendChartStats instanceof Chart) window.trendChartStats.destroy();
    window.trendChartStats = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ortalama Denetim Puanı',
                data: data,
                backgroundColor: '#8b5cf6',
                borderRadius: 8,
                borderWidth: 0
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            layout: {
                padding: { top: 30, bottom: 10 }
            },
            plugins: { 
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    formatter: (value) => value.toFixed(1),
                    font: { weight: '900', size: 13 },
                    color: 'var(--text-primary)'
                }
            },
            scales: { 
                y: { beginAtZero: true, max: 120, display: false },
                x: { 
                    grid: { display: false },
                    ticks: { font: { weight: '700' } }
                }
            }
        }
    });
}

function renderLineDistChart(audits) {
    const canvas = document.getElementById('lineDistChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const lineCounts = {};
    audits.forEach(a => {
        if (a.line) lineCounts[a.line] = (lineCounts[a.line] || 0) + 1;
    });

    const labels = Object.keys(lineCounts).sort();
    if (labels.length === 0) {
        if (window.lineDistChartStats instanceof Chart) window.lineDistChartStats.destroy();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (window.lineDistChartStats instanceof Chart) window.lineDistChartStats.destroy();
    
    // Custom plugin to draw line logos
    const lineLogoPlugin = {
        id: 'lineLogoPlugin',
        afterDraw: (chart) => {
            const { ctx, scales: { x, y } } = chart;
            ctx.save();
            x.ticks.forEach((tick, index) => {
                const lineName = labels[index];
                const color = appData.lineColors[lineName] || '#64748b';
                const xPos = x.getPixelForTick(index);
                const yPos = y.bottom + 25;

                // Draw circle
                ctx.beginPath();
                ctx.arc(xPos, yPos, 10, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();

                // Draw Text inside circle (optional, let's keep it simple with just circle or letter)
                ctx.fillStyle = 'white';
                ctx.font = 'bold 8px Inter';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(lineName.substring(0, 2), xPos, yPos);
            });
            ctx.restore();
        }
    };

    window.lineDistChartStats = new Chart(ctx, {
        type: 'bar',
        plugins: [lineLogoPlugin],
        data: {
            labels: labels,
            datasets: [{
                data: labels.map(l => lineCounts[l]),
                backgroundColor: labels.map(l => appData.lineColors[l] || '#64748b'),
                borderRadius: 8,
                barThickness: 25
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            layout: {
                padding: { top: 30, bottom: 40 } // Increased bottom padding for logos
            },
            plugins: { 
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    font: { weight: '900', size: 13 },
                    color: (ctx) => ctx.dataset.backgroundColor[ctx.dataIndex]
                }
            },
            scales: { 
                y: { 
                    beginAtZero: true, 
                    display: false,
                    suggestedMax: Math.max(...Object.values(lineCounts)) * 1.3
                },
                x: { 
                    grid: { display: false },
                    ticks: {
                        display: false // Hide text ticks, we use logos
                    } 
                }
            }
        }
    });
}

function renderCategoryStatsChart(audits) {
    const canvas = document.getElementById('categoryChartStats');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const categories = ['Kategori 1', 'Kategori 2', 'Kategori 3', 'Kategori 4', 'Kategori 5'];
    if (!audits.length) {
        if (window.categoryStatsChart instanceof Chart) window.categoryStatsChart.destroy();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }
    const avgScore = audits.reduce((sum, audit) => sum + (Number(audit.score) || 0), 0) / audits.length;
    const data = categories.map(() => avgScore);

    if (window.categoryStatsChart instanceof Chart) window.categoryStatsChart.destroy();
    window.categoryStatsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: categories,
            datasets: [{
                data: data,
                backgroundColor: '#3b82f6',
                borderRadius: 8,
                barThickness: 40
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            layout: {
                padding: { top: 30, bottom: 10 }
            },
            plugins: { 
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    formatter: (value) => value.toFixed(1),
                    font: { weight: '900', size: 13 },
                    color: 'var(--text-primary)'
                }
            },
            scales: { 
                y: { beginAtZero: true, max: 125, display: false },
                x: { 
                    grid: { display: false },
                    ticks: { font: { weight: '700' } }
                }
            }
        }
    });
}

function renderNCStatusChart(ncs, typeFilter = 'all') {
    const canvas = document.getElementById('ncStatusChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const open = ncs.filter(n => n.status === 'open' || n.status === 'inProgress').length;
    const overdue = ncs.filter(n => n.status === 'overdue').length;
    const completed = ncs.filter(n => n.status === 'completed').length;
    const isStation = isStationAuditTypeId(typeFilter);
    const labels = isStation ? ['Açık', 'Kapalı'] : ['Açık', 'Gecikmiş', 'Tamamlandı'];
    const vals = isStation ? [open + overdue, completed] : [open, overdue, completed];
    const colors = isStation ? ['#3b82f6', '#10b981'] : ['#3b82f6', '#f59e0b', '#10b981'];
    if (vals.every(v => v === 0)) {
        if (window.ncStatusChartStats instanceof Chart) window.ncStatusChartStats.destroy();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (window.ncStatusChartStats instanceof Chart) window.ncStatusChartStats.destroy();
    window.ncStatusChartStats = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: vals,
                backgroundColor: colors,
                borderRadius: 8,
                barThickness: 60
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            layout: {
                padding: { top: 30, bottom: 10 }
            },
            plugins: { 
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    font: { weight: '900', size: 14 },
                    color: (ctx) => ctx.dataset.backgroundColor[ctx.dataIndex]
                }
            },
            scales: { 
                y: { 
                    beginAtZero: true, 
                    display: false,
                    suggestedMax: Math.max(...vals) * 1.4
                },
                x: { 
                    grid: { display: false },
                    ticks: { font: { weight: '700' } }
                }
            }
        }
    });
}

function renderTimelinessChart(audits, plans) {
    const canvas = document.getElementById('timelinessChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const plannedData = {};
    const realizedData = {};

    // Group Realized Audits by Auditor
    audits.forEach(a => {
        const name = a.auditorName || 'Bilinmiyor';
        realizedData[name] = (realizedData[name] || 0) + 1;
        plannedData[name] = (plannedData[name] || 0) + 1;
    });

    // Get all unique auditor names
    const labels = [...new Set([...Object.keys(plannedData), ...Object.keys(realizedData)])].sort();

    if (labels.length === 0) {
        if (window.timelinessChartStats instanceof Chart) window.timelinessChartStats.destroy();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (window.timelinessChartStats instanceof Chart) window.timelinessChartStats.destroy();
    window.timelinessChartStats = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Planlanan',
                    data: labels.map(l => plannedData[l] || 0),
                    backgroundColor: 'rgba(139, 92, 246, 0.4)',
                    borderColor: '#8b5cf6',
                    borderWidth: 1,
                    borderRadius: 4,
                    barThickness: 20
                },
                {
                    label: 'Gerçekleşen',
                    data: labels.map(l => realizedData[l] || 0),
                    backgroundColor: '#10b981',
                    borderRadius: 4,
                    barThickness: 20
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 30, bottom: 10 } },
            plugins: {
                legend: { 
                    display: true, 
                    position: 'bottom',
                    labels: { font: { size: 10, weight: 'bold' } }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 2,
                    font: { weight: '900', size: 11 },
                    formatter: (value) => value > 0 ? value : ''
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    display: false, 
                    suggestedMax: Math.max(...labels.map(l => Math.max(plannedData[l] || 0, realizedData[l] || 0))) * 1.4 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { 
                        font: { weight: '700', size: 10 },
                        autoSkip: false
                    } 
                }
            }
        }
    });
}


function renderNCPriorityAreas(ncs) {
    const container = document.getElementById('nc-priority-list');
    if (!container) return;
    container.innerHTML = '';

    const catCounts = {};
    ncs.forEach(n => {
        catCounts[n.category] = (catCounts[n.category] || 0) + 1;
    });

    Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]).slice(0, 5).forEach(cat => {
        const count = catCounts[cat];
        const div = document.createElement('div');
        div.style.background = 'var(--bg-input)';
        div.style.padding = '12px 1rem';
        div.style.borderRadius = '12px';
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-size: 0.8rem; font-weight: 700;">${cat}</span>
                <span style="font-size: 0.8rem; color: #ef4444; font-weight: 800;">${count} Adet</span>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(0,0,0,0.05); border-radius: 3px; overflow: hidden;">
                <div style="width: ${Math.min(100, (count / ncs.length) * 300)}%; height: 100%; background: #ef4444;"></div>
            </div>
        `;
        container.appendChild(div);
    });
}

function renderRecentTable() {
    const tbody = document.querySelector('#recent-audits-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const dashboardTypeFilter = document.getElementById('dashboard-filter-type')?.value || 'all';
    const audits = filterByAuditType(getFilteredAudits(), dashboardTypeFilter);
    audits.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5).forEach(audit => {
        tbody.appendChild(createAuditRow(audit, { hideActionColumn: true }));
    });
}

function getAuditStatusKey(audit) {
    const score = getAuditDisplayScore(audit);
    if (score > 80) return 'completed';
    if (score > 50) return 'review';
    return 'critical';
}

function getAuditMonthValue(audit) {
    if (!audit || !audit.date) return '';
    const date = new Date(audit.date);
    if (Number.isNaN(date.getTime())) return '';
    return String(date.getMonth() + 1);
}

function getAuditYearValue(audit) {
    if (!audit || !audit.date) return '';
    const date = new Date(audit.date);
    if (Number.isNaN(date.getTime())) return '';
    return String(date.getFullYear());
}

function renderAllAuditsTable() {
    const tbody = document.querySelector('#all-audits-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterLines = getMultiSelectValues('audit-filter-line');
    const filterStations = getMultiSelectValues('audit-filter-station');
    const filterUsers = getMultiSelectValues('audit-filter-user');
    const filterStatuses = getMultiSelectValues('audit-filter-status');
    const filterTypes = getMultiSelectValues('audit-filter-type');

    let audits = getFilteredAudits();

    // Type filter (multi)
    if (filterTypes.length) {
        audits = audits.filter(a => filterTypes.some(typeVal => filterByAuditType([a], typeVal).length > 0));
    }

    // Apply Unified Date Filters
    const uYears = unifiedDateFilters.audits.years || [];
    const uMonths = unifiedDateFilters.audits.months || [];
    const uWeeks = unifiedDateFilters.audits.weeks || [];
    const uDays = unifiedDateFilters.audits.days || [];

    if (uYears.length) {
        audits = audits.filter(a => {
            const date = a.date ? new Date(a.date) : null;
            return date && uYears.includes(date.getFullYear().toString());
        });
    }
    if (uMonths.length) {
        audits = audits.filter(a => {
            const date = a.date ? new Date(a.date) : null;
            return date && uMonths.includes((date.getMonth() + 1).toString());
        });
    }
    if (uWeeks.length) {
        audits = audits.filter(a => {
            const date = a.date ? new Date(a.date) : null;
            return date && uWeeks.includes(getISOWeekNumber(date).toString());
        });
    }
    if (uDays.length) {
        audits = audits.filter(a => {
            const date = a.date ? new Date(a.date) : null;
            return date && uDays.includes(getLocalDateString(a.date));
        });
    }
    if (filterLines.length) {
        audits = audits.filter(a => filterLines.includes(a.line));
    }
    if (filterStations.length) {
        audits = audits.filter(a => filterStations.includes(a.station));
    }
    if (filterUsers.length) {
        audits = audits.filter(a => filterUsers.some(f => normalizeTurkish(f) === normalizeTurkish(a.auditorName)));
    }
    if (filterStatuses.length) {
        audits = audits.filter(a => filterStatuses.includes(getAuditStatusKey(a)));
    }

    if (auditScoreSortDirection) {
        audits.sort((a, b) => {
            const scoreA = getAuditDisplayScore(a);
            const scoreB = getAuditDisplayScore(b);
            return auditScoreSortDirection === 'desc' ? scoreB - scoreA : scoreA - scoreB;
        });
        updateDateSortHeader('audit-score-sort-header', 'audit-score-sort-icon', auditScoreSortDirection);
        resetSortHeader('audit-date-sort-header', 'audit-date-sort-icon');
    } else {
        if (!auditDateSortDirection) auditDateSortDirection = 'desc';
        sortRecordsByDate(audits, auditDateSortDirection, getAuditListDate);
        updateDateSortHeader('audit-date-sort-header', 'audit-date-sort-icon', auditDateSortDirection);
        resetSortHeader('audit-score-sort-header', 'audit-score-sort-icon');
    }

    const totalPages = Math.ceil(audits.length / ITEMS_PER_PAGE);
    if (auditsCurrentPage > totalPages) {
        auditsCurrentPage = Math.max(1, totalPages);
    }

    if (!audits.length) {
        tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: var(--text-dim); padding: 2rem; font-weight: 600;">Seçilen filtrelere uygun denetim kaydı bulunamadı.</td></tr>`;
        syncAuditSelectionUI();
        renderTablePagination('all-audits-table-pagination', 1, 0, 'changeAuditsPage');
        return;
    }

    const startIdx = (auditsCurrentPage - 1) * ITEMS_PER_PAGE;
    const paginatedAudits = audits.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    paginatedAudits.forEach(audit => {
        const tr = createAuditRow(audit, { showDelete: true });
        const selectTd = document.createElement('td');
        selectTd.className = 'audit-select-cell';
        selectTd.innerHTML = `<input type="checkbox" class="audit-row-select" data-audit-id="${audit.id}" ${appData.selectedAuditIds.has(audit.id) ? 'checked' : ''} onchange="toggleAuditSelection(this)">`;
        const idTd = document.createElement('td');
        idTd.className = 'audit-id-cell';
        idTd.innerText = audit.id?.substring(0, 8) || 'N/A';
        tr.insertBefore(idTd, tr.firstChild);
        tr.insertBefore(selectTd, tr.firstChild);
        tbody.appendChild(tr);
    });
    syncAuditSelectionUI();
    // Sayfalama butonlarını çiz
    renderTablePagination('all-audits-table-pagination', auditsCurrentPage, totalPages, 'changeAuditsPage');
}

function getAuditConformityCounts(audit = {}) {
    let conformities = 0;
    let nonConformities = 0;
    const answers = Array.isArray(audit.answers) ? audit.answers : [];
    answers.forEach(ans => {
        if (ans.isOutOfScope === true) return;
        const scored = scoreAuditAnswer(audit, ans);
        if (scored.isOutOfScope) return;
        if (scored.isNonconformity) {
            nonConformities++;
        } else {
            conformities++;
        }
    });
    return { conformities, nonConformities };
}

function createAuditRow(audit, options = {}) {
    const tr = document.createElement('tr');
    const showDelete = options.showDelete === true;
    const hideActionColumn = options.hideActionColumn === true;
    const dateObj = new Date(audit.date);
    const date = dateObj.toLocaleDateString('tr-TR');
    const time = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const auditTypeStr = audit.auditType || audit.type || '-';
    const displayScore = getAuditDisplayScore(audit);
    const statusColor = displayScore > 80 ? '#10b981' : (displayScore > 50 ? '#f59e0b' : '#ef4444');
    const statusText = displayScore > 80 ? 'Tamamlandı' : (displayScore > 50 ? 'İnceleniyor' : 'Kritik');
    const statusKey = displayScore > 80 ? 'completed' : (displayScore > 50 ? 'review' : 'critical');
    const lineColor = appData.lineColors[audit.line] || '#64748b';
    tr.className = `audit-table-row audit-table-row--${statusKey}`;

    const typeColor = getAuditTypeColor(audit.auditTypeId || (appData.auditTypes || []).find(t => (t.title || t.name) === auditTypeStr)?.id);
    const typeBadgeHtml = `<span class="status-badge" style="background: ${typeColor}15; color: ${typeColor}; border: 1px solid ${typeColor}40; font-weight: 700;">${auditTypeStr}</span>`;

    const { conformities, nonConformities } = getAuditConformityCounts(audit);
    const weekNum = getISOWeekNumber(dateObj);

    tr.innerHTML = `
        <td class="audit-date-cell">${date}</td>
        <td class="audit-week-cell" style="text-align:center; font-size:0.8rem; color:var(--text-dim); font-weight:600;">${weekNum}. Hf</td>
        <td class="audit-time-cell"><span>${time}</span></td>
        <td class="audit-type-cell">${typeBadgeHtml}</td>
        <td class="audit-line-cell" style="text-align:center;">
            <div class="line-logo" style="background: ${lineColor}; margin: 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; font-size: 0.54rem; border-radius: 50%; color: #fff; font-weight: 900;">${audit.line}</div>
        </td>
        <td class="audit-station-cell">
            <div>${audit.station}</div>
        </td>
        <td class="audit-user-cell">${escapeAttr(getAuditorDisplayName(audit.auditorName))}</td>
        <td class="audit-findings-cell" style="text-align:center; white-space:nowrap; font-size:0.8rem; font-weight:700;">
            <span style="color:#10b981;">${conformities}</span>
            <span style="color:var(--text-dim); font-weight:500; margin:0 3px;">/</span>
            <span style="color:#ef4444;">${nonConformities}</span>
        </td>
        <td class="audit-score-cell"><strong style="color: ${statusColor};">${displayScore.toFixed(1)}</strong></td>
        <td class="audit-status-cell"><span class="status-badge" style="background: ${statusColor}22; color: ${statusColor}; border-color: ${statusColor};">${statusText}</span></td>
        ${!hideActionColumn ? `
        <td class="audit-actions-cell">
            <div class="audit-row-actions">
                ${showDelete ? `<button class="btn-outline" title="Sil" aria-label="Sil" style="padding: 0.25rem 0.6rem; font-size: 0.7rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.4); background: transparent; border-radius: 6px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.1)'" onmouseout="this.style.background='transparent'" onclick="deleteAudit('${audit.id}')"><i class="fas fa-trash-alt"></i> Sil</button>` : ''}
            </div>
        </td>
        ` : ''}
    `;
    tr.addEventListener('click', event => {
        if (event.target.closest('button, input, a, select, textarea')) return;
        openAuditModal(audit.id);
    });
    return tr;
}

async function deleteAudit(id) {
    if (!confirm('Bu denetim kaydını ve bağlı uygunsuzluk kayıtlarını silmek istediğinize emin misiniz?')) return;
    try {
        const relatedNCs = await db.collection('nonconformities').where('auditId', '==', id).get();
        const batch = db.batch();
        relatedNCs.forEach(doc => batch.delete(doc.ref));
        batch.delete(db.collection('audits').doc(id));
        await batch.commit();

        appData.selectedAuditIds.delete(id);
        syncAuditSelectionUI();
        showToast('Denetim başarıyla silindi.');
    } catch (err) {
        console.error('Delete audit error:', err);
        showToast('Hata oluştu!');
    }
}

function openAuditModal(id) {
    console.log('Opening audit modal for ID:', id);
    currentAuditId = id; 
    const audit = getAccessibleAuditById(id);
    if (!audit) {
        console.error('Audit not found for ID:', id);
        showToast('Bu denetime erisim yetkiniz bulunmuyor.');
        return;
        showToast('Kayıt bulunamadı!');
        return;
    }

    try {
        const modal = document.getElementById('audit-modal');
        const body = document.getElementById('modal-body');
        const title = document.getElementById('modal-title');
        if (!modal || !body || !title) return;
        modal.classList.remove('nc-detail-modal');
        title.innerText = 'Denetim Raporu';
        configureAuditModalFooter({ showReport: true, reportLabel: 'Rapor Al' });

        const auditDate = audit.date ? new Date(audit.date) : new Date(NaN);
        const modalWeekNum = isNaN(auditDate.getTime()) ? '-' : getISOWeekNumber(auditDate);
        const modalWeekText = modalWeekNum !== '-' ? ` (${modalWeekNum}. Hafta)` : '';
        const dateOnly = isNaN(auditDate.getTime()) ? '-' : auditDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) + modalWeekText;
        const timeOnly = isNaN(auditDate.getTime()) ? '-' : auditDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const startedDate = audit.startedAt ? new Date(audit.startedAt) : null;
        const completedDate = audit.completedAt ? new Date(audit.completedAt) : null;
        const startedTimeStr = startedDate && !isNaN(startedDate.getTime()) ? startedDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : null;
        const completedTimeStr = completedDate && !isNaN(completedDate.getTime()) ? completedDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : null;
        let durationMinutes = null;
        if (startedDate && completedDate && !isNaN(startedDate.getTime()) && !isNaN(completedDate.getTime())) {
            durationMinutes = Math.round((completedDate - startedDate) / 1000 / 60);
        }

        const metrics = buildAuditDetailMetrics(audit);
        const overallScore = clampAuditPercent(metrics.overallPercent);
        const categoryAverageScore = clampAuditPercent(metrics.categoryAveragePercent);
        const scoreColor = overallScore >= 85 ? '#16A34A' : (overallScore >= 70 ? '#EA580C' : '#E11D48');

        // Dynamic Categories & Scores from 'answers' (Mobile parity)
        let categories = ['Ayıklama', 'Düzen', 'Temizlik', 'Standartlaştırma', 'Disiplin'];
        let questions = [
            'Çalışma alanında gereksiz malzeme, ekipman veya araç gereç var mı?',
            'Kullanılmayan veya bozuk ekipmanlar alandan uzaklaştırılmış mı?',
            'Tüm malzemelerin tanımlanmış bir yeri var mı ve etiketli mi?',
            'Acil durum ekipmanlarına erişim engellenmiş mi?',
            'Zemin, duvarlar, panolar ve ekipmanlar temiz mi?'
        ];
        let scores = [0, 0, 0, 0, 0];

        if (metrics.rows.length > 0) {
            categories = metrics.rows.map(row => row.categoryName);
            questions = audit.answers.map(ans => {
                const q = resolveAuditAnswerQuestion(audit, ans);
                return q.questionText || 'Soru detayı bulunamadı';
            });
            scores = metrics.rows.map(row => row.rawScore);
        } else if (Array.isArray(audit.scores)) {
            scores = audit.scores.map(s => Number(s) || 0);
        }

        const auditNcEntries = categories.map((cat, index) => {
            const row = metrics.rows[index];
            const ans = row?.ans || ((audit.answers && Array.isArray(audit.answers)) ? audit.answers[index] : null);
            const score = scores[index];
            const isNonconformity = row
                ? row.isNonconformity
                : ((ans && ans.isNonconformity !== undefined) ? ans.isNonconformity === true : score <= 3);
            return {
                isNonconformity,
                nc: isNonconformity ? findNcForAuditAnswer(audit, ans, cat, questions[index]) : null
            };
        }).filter(item => item.isNonconformity);
        const allAuditNcsResolved = auditNcEntries.length > 0 &&
            auditNcEntries.every(item => item.nc && isNcClosed(item.nc));
        const ncSectionTitle = allAuditNcsResolved
            ? '\u00c7\u00d6Z\u00dcLEN UYGUNSUZLUKLAR'
            : 'TESP\u0130T ED\u0130LEN UYGUNSUZLUKLAR';
        const ncSectionColor = allAuditNcsResolved ? '#16A34A' : '#E11D48';

        let html = `
            <div style="padding: 20px; background: var(--bg-main);">
                <!-- Header Score Card (3-column layout: Score on left, Info in center, horizontal chart on right) -->
                <div style="width: 100%; background: linear-gradient(135deg, #001F3F, #003366); border-radius: 32px; padding: 24px; color: white; margin-bottom: 20px; box-shadow: 0 10px 25px rgba(0,31,63,0.15);">
                    <div style="display: grid; grid-template-columns: auto 1fr 2.2fr; gap: 24px; align-items: center;">
                        <!-- Column 1: Overall Score Badge (Large, on the left, standing alone) -->
                        <div style="width: 85px; height: 85px; border: 4px solid ${scoreColor}; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); flex-shrink: 0;">
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: 900;">%${Math.round(overallScore)}</div>
                                <div style="font-size: 0.5rem; opacity: 0.7; font-weight: 900; letter-spacing: 1px;">TOPLAM</div>
                            </div>
                        </div>

                        <!-- Column 2: Audit Details -->
                        <div>
                            <h2 style="margin: 0; font-size: 1.25rem; font-weight: 900; letter-spacing: 0.5px; line-height: 1.2;">${toTurkishUpperCase(audit.station || 'Bilinmiyor')}</h2>
                            <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                                <!-- Line Logo -->
                                <div title="${audit.line || '-'}" style="min-width: 34px; height: 24px; padding: 0 8px; border-radius: 999px; background: ${(appData.lineColors && audit.line) ? (appData.lineColors[audit.line] || '#64748b') : '#64748b'}; color: white; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 900; flex-shrink: 0;">${audit.line || '-'}</div>
                            </div>
                            <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <div style="padding: 6px 12px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 0.7rem; font-weight: 800; display: flex; align-items: center; gap: 6px;" title="Kullanıcı">
                                    <i class="fas fa-user" style="opacity: 0.7;"></i> ${escapeAttr(getAuditorDisplayName(audit.auditorName || 'Bilinmiyor'))}
                                </div>
                                <div style="padding: 6px 12px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 0.7rem; font-weight: 800; display: flex; align-items: center; gap: 6px;" title="Tarih">
                                    <i class="far fa-calendar-alt" style="opacity: 0.7;"></i> ${dateOnly}
                                </div>
                                ${startedTimeStr ? `
                                <div style="padding: 6px 12px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 0.7rem; font-weight: 800; display: flex; align-items: center; gap: 6px;" title="Başlangıç Saati">
                                    <i class="fas fa-play" style="opacity: 0.7; font-size: 0.6rem;"></i> Başlangıç: ${startedTimeStr}
                                </div>` : ''}
                                ${completedTimeStr ? `
                                <div style="padding: 6px 12px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 0.7rem; font-weight: 800; display: flex; align-items: center; gap: 6px;" title="Bitiş Saati">
                                    <i class="fas fa-stop" style="opacity: 0.7; font-size: 0.6rem;"></i> Bitiş: ${completedTimeStr} ${durationMinutes !== null ? `(${durationMinutes} dk)` : ''}
                                </div>` : `
                                <div style="padding: 6px 12px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 0.7rem; font-weight: 800; display: flex; align-items: center; gap: 6px;" title="Saat">
                                    <i class="far fa-clock" style="opacity: 0.7;"></i> ${timeOnly}
                                </div>`}
                            </div>
                        </div>

                        <!-- Column 3: Success Chart Container (Horizontal Bar Chart) -->
                        <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; padding: 16px; display: flex; flex-direction: column; justify-content: center; height: 180px; align-self: stretch; position: relative;">
                            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                                <div style="width: 3px; height: 10px; background: #3b82f6; border-radius: 1px;"></div>
                                <span style="font-size: 0.65rem; font-weight: 900; color: #ffffff; letter-spacing: 0.5px; text-transform: uppercase;">KATEGORİ BAZLI BAŞARI (%)</span>
                            </div>
                            <div style="flex: 1; position: relative; height: 140px; width: 100%; min-width: 0;">
                                <canvas id="auditDetailBarChart"></canvas>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- UYGUNSUZLUKLAR Section -->
                ${scores.some((sVal, idx) => {
                    const row = metrics.rows[idx];
                    const ans = row?.ans || ((audit.answers && Array.isArray(audit.answers)) ? audit.answers[idx] : null);
                    return row ? row.isNonconformity : ((ans && ans.isNonconformity !== undefined) ? (ans.isNonconformity === true) : (sVal <= 3));
                }) ? `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <div style="width: 4px; height: 14px; background: ${ncSectionColor}; border-radius: 2px;"></div>
                        <h4 style="margin: 0; font-size: 0.75rem; font-weight: 900; color: ${ncSectionColor}; letter-spacing: 1px;">${ncSectionTitle}</h4>
                    </div>
                    ${categories.map((cat, i) => {
            const sVal = scores[i];
            const row = metrics.rows[i];
            const ans = row?.ans || ((audit.answers && Array.isArray(audit.answers)) ? audit.answers[i] : null);
            const isNC = row ? row.isNonconformity : ((ans && ans.isNonconformity !== undefined) ? (ans.isNonconformity === true) : (sVal <= 3));
            const displayScore = row ? row.displayScore : sVal;
            if (!isNC) return '';
            
            const nc = findNcForAuditAnswer(audit, ans, cat, questions[i]);
            const isResolved = nc && isNcClosed(nc);
            const cardStatusColor = isResolved ? '#16A34A' : '#E11D48';

            const comment = ans ? [ (ans.comment || ans.detail || '').trim(), ...(Array.isArray(ans.additionalComments) ? ans.additionalComments : []) ].filter(Boolean).join('<br/><br/>') : '';

            return `
                        <div onclick="goToNCFromAudit('${audit.id}', '${cat}', '${nc ? nc.id : ''}')" class="audit-nc-card${isResolved ? ' is-resolved' : ''}">
                            <div style="width: 36px; height: 36px; background: ${isResolved ? '#f0fdf4' : '#fff1f2'}; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: ${cardStatusColor}; flex-shrink: 0;">
                                <i class="fas ${isResolved ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
                            </div>
                            <div style="flex: 1;">
                                <div style="display: flex; justify-content: space-between;">
                                    <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 800; margin-bottom: 2px;">${cat.toUpperCase()}</div>
                                    ${isResolved
                                        ? `<span style="padding: 3px 8px; border-radius: 999px; background: #dcfce7; color: #15803d; font-size: 0.62rem; font-weight: 900;">\u00c7\u00d6Z\u00dcLD\u00dc</span>`
                                        : '<i class="fas fa-arrow-right" style="font-size: 0.7rem; color: #94a3b8;"></i>'}
                                </div>
                                <div class="audit-nc-title">${questions[i] || '-'}</div>
                                ${comment ? `<div class="audit-nc-comment"><strong>Açıklama:</strong> ${comment}</div>` : ''}
                                ${isResolved && nc.closureComment ? `<div class="audit-nc-resolution"><strong>\u00c7\u00f6z\u00fcm:</strong> ${escapeAttr(nc.closureComment)}</div>` : ''}
                                <div style="margin-top: 8px;">
                                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                        <div style="padding: 2px 8px; background: ${cardStatusColor}; border-radius: 4px; color: white; font-size: 0.65rem; font-weight: 900;">${isResolved ? '\u00c7\u00d6Z\u00dcLD\u00dc' : `PUAN: ${displayScore}`}</div>
                                        <div style="font-size: 0.65rem; color: #94a3b8; font-weight: 600;"><i class="fas fa-camera"></i> Detaylara Git</div>
                                    </div>
                                    
                                    <!-- Embedded Mini Gallery -->
                                    ${(() => {
                                        if (nc && nc.auditorPhotoPaths && nc.auditorPhotoPaths.length > 0) {
                                            return `
                                                <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px;">
                                                     ${nc.auditorPhotoPaths.slice(0, 3).map(p => {
                                                         const resolved = resolveImagePath(p);
                                                         return `
                                                             <img src="${resolved}" class="audit-nc-thumb" onclick="openImagePreview('${resolved}'); event.stopPropagation();" title="Görseli büyük aç">
                                                         `;
                                                     }).join('')}
                                                    ${nc.auditorPhotoPaths.length > 3 ? `<div style="width: 40px; height: 40px; border-radius: 6px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: #64748b; font-weight: 700;">+${nc.auditorPhotoPaths.length - 3}</div>` : ''}
                                                </div>
                                            `;
                                        }
                                        return '';
                                    })()}
                                </div>
                            </div>
                        </div>
                        `;
        }).join('')}
                </div>
                ` : ''}

                <!-- DENETİM DETAYLARI Section -->
                <div style="margin-top: 10px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <div style="width: 4px; height: 14px; background: #64748b; border-radius: 2px;"></div>
                        <h4 style="margin: 0; font-size: 0.75rem; font-weight: 900; color: #64748b; letter-spacing: 1px;">DENETİM SORU DÖKÜMÜ</h4>
                    </div>
                    ${(() => {
                        const groupedQuestions = {};
                        categories.forEach((cat, i) => {
                            const catKey = cat.trim().toUpperCase();
                            if (!groupedQuestions[catKey]) {
                                groupedQuestions[catKey] = [];
                            }
                            const sVal = scores[i];
                            const row = metrics.rows[i];
                            const ans = row?.ans || ((audit.answers && Array.isArray(audit.answers)) ? audit.answers[i] : null);
                            const isNC = row ? row.isNonconformity : ((ans && ans.isNonconformity !== undefined) ? (ans.isNonconformity === true) : (sVal <= 3));
                            const scorePercent = row ? row.percent : clampAuditPercent(sVal * 20);
                            const displayScore = row ? row.displayScore : sVal;
                            const color = isNC ? '#E11D48' : (scorePercent >= 80 ? '#16A34A' : '#EA580C');
                            const ansComment = ans ? [ (ans.comment || ans.detail || '').trim(), ...(Array.isArray(ans.additionalComments) ? ans.additionalComments : []) ].filter(Boolean).join('<br/><br/>') : '';
                            const ansPhotos = ans ? collectAuditAnswerPhotoPaths(audit, ans) : [];

                            groupedQuestions[catKey].push({
                                originalIndex: i,
                                questionText: questions[i] || '-',
                                displayScore,
                                color,
                                ansComment,
                                ansPhotos
                            });
                        });

                        return Object.keys(groupedQuestions).map(catName => {
                            const listItems = groupedQuestions[catName].map((qObj, index) => {
                                const questionNumber = index + 1;
                                return `
                                            <div class="audit-question-row">
                                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                                    <div style="flex: 1; padding-right: 12px;">
                                                        <div class="audit-question-text"><strong>${questionNumber}.</strong> ${qObj.questionText}</div>
                                                    </div>
                                                    <div style="width: 28px; height: 28px; border-radius: 8px; background: ${qObj.color}15; color: ${qObj.color}; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.75rem; flex-shrink: 0;">
                                                        ${qObj.displayScore}
                                                    </div>
                                                </div>
                                                ${qObj.ansComment ? `<div class="audit-question-comment"><strong>Açıklama:</strong> ${qObj.ansComment}</div>` : ''}
                                                ${qObj.ansPhotos.length > 0 ? `
                                                    <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
                                                        ${qObj.ansPhotos.map(p => {
                                                            const r = resolveImagePath(p);
                                                            if (r) {
                                                                return '<div style="width:48px;height:48px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;display:flex;align-items:center;justify-content:center;" onclick="openImagePreview(\'' + r + '\')"><img src="' + r + '" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentElement.style.display=\'none\'"></div>';
                                                            }
                                                            return '<div data-audit-photo-path="' + encodeURIComponent(p) + '" style="width:48px;height:48px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;background:#f8fafc;"></div>';
                                                        }).join('')}
                                                    </div>
                                                ` : ''}
                                            </div>
                                `;
                            }).join('');

                            // Kategoriye özel ikon ve renk konfigürasyonu
                            const catIcons = {
                                'SINIFLANDIRMA': { icon: 'fa-filter', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
                                'SIRALAMA': { icon: 'fa-sort-amount-down', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
                                'SİLME': { icon: 'fa-broom', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
                                'SILME': { icon: 'fa-broom', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
                                'STANDARTLAŞTIRMA': { icon: 'fa-check-double', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
                                'STANDARTLASTIRMA': { icon: 'fa-check-double', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
                                'SAHİPLENME': { icon: 'fa-shield-alt', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
                                'SAHIPLENME': { icon: 'fa-shield-alt', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
                                'AYIKLAMA': { icon: 'fa-filter', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
                                'DÜZEN': { icon: 'fa-sort-amount-down', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
                                'DUZEN': { icon: 'fa-sort-amount-down', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
                                'TEMİZLİK': { icon: 'fa-broom', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
                                'TEMIZLIK': { icon: 'fa-broom', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
                                'DİSİPLİN': { icon: 'fa-shield-alt', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
                                'DISIPLIN': { icon: 'fa-shield-alt', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' }
                            };

                            const catIndex = Object.keys(groupedQuestions).indexOf(catName);
                            const catUpper = toTurkishUpperCase(catName).trim();
                            let config = { icon: 'fa-folder', color: '#64748b', bg: 'rgba(100, 116, 139, 0.08)' };

                            if (catUpper.includes('AYI') || catUpper.includes('SINIF') || catUpper.includes('AY') || catUpper.includes('AYÝ')) {
                                config = catIcons['AYIKLAMA'] || catIcons['SINIFLANDIRMA'];
                            } else if (catUpper.includes('DÜZ') || catUpper.includes('SIRAL') || catUpper.includes('DZ') || catUpper.includes('DUZ') || catUpper.includes('DÝZ')) {
                                config = catIcons['DÜZEN'] || catIcons['SIRALAMA'];
                            } else if (catUpper.includes('TEMİZ') || catUpper.includes('TEMIZ') || catUpper.includes('SİL') || catUpper.includes('SIL') || catUpper.includes('SL') || catUpper.includes('SÝL')) {
                                config = catIcons['TEMİZLİK'] || catIcons['SİLME'];
                            } else if (catUpper.includes('STAND') || catUpper.includes('STAN')) {
                                config = catIcons['STANDARTLAŞTIRMA'];
                            } else if (catUpper.includes('DİS') || catUpper.includes('DIS') || catUpper.includes('SAH') || catUpper.includes('SAHÝ')) {
                                config = catIcons['DİSİPLİN'] || catIcons['SAHİPLENME'];
                            } else {
                                // List sırasına göre index fallback (0->Mavi, 1->Yeşil, 2->Turuncu, 3->Mor, 4->Pembe)
                                const fallbackConfigs = [
                                    catIcons['AYIKLAMA'] || catIcons['SINIFLANDIRMA'],
                                    catIcons['DÜZEN'] || catIcons['SIRALAMA'],
                                    catIcons['TEMİZLİK'] || catIcons['SİLME'],
                                    catIcons['STANDARTLAŞTIRMA'],
                                    catIcons['DİSİPLİN'] || catIcons['SAHİPLENME']
                                ];
                                if (catIndex >= 0 && catIndex < fallbackConfigs.length) {
                                    config = fallbackConfigs[catIndex];
                                } else {
                                    // Fallback loop
                                    for (const key in catIcons) {
                                        if (catUpper.includes(key)) {
                                            config = catIcons[key];
                                            break;
                                        }
                                    }
                                }
                            }

                            const typeObj = getAuditTypeForAudit(audit) || {};
                            const catObj = (typeObj.categories || []).find(c => String(c.id) === String(catName) || String(c.name).toUpperCase() === String(catName).toUpperCase());
                            const weightStr = catObj && catObj.weight !== undefined ? ` (Ağırlık: ${catObj.weight})` : '';
                            return `
                                <div class="audit-question-category-group" style="margin-bottom: 10px;">
                                    <div style="background: linear-gradient(90deg, ${config.bg}, transparent); border-left: 4px solid ${config.color}; padding: 6px 12px; font-size: 0.72rem; font-weight: 900; color: ${config.color}; letter-spacing: 0.8px; border-radius: 0 8px 8px 0; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                                        <i class="fas ${config.icon}" style="font-size: 0.8rem; color: ${config.color};"></i>
                                        <span>${catName}${weightStr}</span>
                                    </div>
                                    <div class="audit-question-card">
                                        ${listItems}
                                    </div>
                                </div>
                            `;
                        }).join('');
                    })()}
                </div>
            </div>
        `;

        body.innerHTML = html;
        modal.style.display = 'flex';

        setTimeout(() => {
            body.querySelectorAll('[data-audit-photo-path]').forEach(async (slot) => {
                const rawPath = decodeURIComponent(slot.getAttribute('data-audit-photo-path') || '');
                const url = await resolveImagePathAsync(rawPath);
                if (!url) return;
                slot.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain;cursor:pointer;" onclick="openImagePreview('${url}')" onerror="this.parentElement.style.display='none'">`;
            });
        }, 50);

        setTimeout(() => {
            const barCanvas = document.getElementById('auditDetailBarChart');
            if (barCanvas) {
                // Group scores by category for the chart (Parity: only 5 bars)
                const groupData = {};
                // User preferred categories (All Uppercase)
                const chartCats = ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME', 'AYIKLAMA', 'DÜZEN', 'TEMİZLİK', 'DİSİPLİN'];
                chartCats.forEach(c => groupData[c] = []);

                categories.forEach((cat, idx) => {
                    let catUpper = cat.toUpperCase().trim();
                    
                    // Unified mapping to User Preferred Terms
                    if (catUpper.includes('AYIKLA') || catUpper.includes('SINIF')) catUpper = 'SINIFLANDIRMA';
                    if (catUpper.includes('DÜZEN') || catUpper.includes('SIRALA')) catUpper = 'SIRALAMA';
                    if (catUpper.includes('TEMİZ') || catUpper.includes('SİLME')) catUpper = 'SİLME';
                    if (catUpper.includes('STANDART')) catUpper = 'STANDARTLAŞTIRMA';
                    if (catUpper.includes('SAHİP') || catUpper.includes('DİSİP')) catUpper = 'SAHİPLENME';

                    const mainCat = chartCats.find(c => catUpper.includes(c)) || catUpper;

                    if (!groupData[mainCat]) groupData[mainCat] = [];
                    groupData[mainCat].push(scores[idx]);
                });

                let finalLabels = Object.keys(groupData).filter(k => groupData[k].length > 0 && ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME'].includes(k));
                let finalScores = finalLabels.map(k => {
                    const sum = groupData[k].reduce((a, b) => a + b, 0);
                    return (sum / groupData[k].length) * 20; // Avg score * 20 to get %
                });
                if (metrics.categoryAverages.length) {
                    finalLabels = metrics.categoryAverages.map(item => item.categoryName || item.category || 'Genel');
                    finalScores = metrics.categoryAverages.map(item => clampAuditPercent(item.avgPercent));
                }

                const barCtx = barCanvas.getContext('2d');
                new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: finalLabels,
                        datasets: [{
                            data: finalScores,
                            backgroundColor: finalScores.map(val => {
                                return val >= 80 ? '#15803d' : (val >= 60 ? '#f59e0b' : '#ef4444');
                            }),
                            borderRadius: 6,
                            barThickness: 18
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { 
                            legend: { display: false },
                            datalabels: {
                                anchor: 'end',
                                align: 'start',
                                offset: 4,
                                formatter: (val) => '%' + Math.round(val),
                                font: { weight: 'bold', size: 10 },
                                color: '#ffffff'
                            }
                        },
                        scales: {
                            x: {
                                display: false,
                                beginAtZero: true,
                                max: 100
                            },
                            y: {
                                ticks: { 
                                    font: { size: 10, weight: 'bold' },
                                    color: '#ffffff'
                                },
                                grid: { display: false }
                            }
                        }
                    },
                    plugins: [ChartDataLabels]
                });
            }
        }, 200);

    } catch (err) {
        console.error('Audit modal error:', err);
        showToast('Görünüm hazırlanırken bir hata oluştu.');
    }
}

function goToNCFromAudit(auditId, category, ncId) {
    let nc = null;
    if (ncId) {
        nc = appData.nonconformities.find(n => String(n.id) === String(ncId));
    }
    if (!nc) {
        nc = appData.nonconformities.find(n => String(n.auditId) === String(auditId) && n.category === category);
    }
    if (nc) {
        // Close the current audit modal first to avoid ID/Z-index confusion, then open NC
        parentAuditIdForNC = null;
        closeAuditModal();
        setTimeout(() => {
            inspectNC(nc.id, auditId);
        }, 100);
    } else {
        showToast('Bu kategori için detaylı uygunsuzluk kaydı bulunamadı.');
    }
}

function closeAuditModal() {
    if (parentAuditIdForNC) {
        const tempId = parentAuditIdForNC;
        parentAuditIdForNC = null;
        openAuditModal(tempId);
    } else {
        const modal = document.getElementById('audit-modal');
        modal.style.display = 'none';
        modal.classList.remove('nc-detail-modal');
        configureAuditModalFooter({ showReport: true, reportLabel: 'Rapor Al' });
    }
}

function configureAuditModalFooter({
    showReport = true,
    reportLabel = 'Rapor Al',
    reportAction = null
} = {}) {
    const reportBtn = document.getElementById('modal-report-btn');
    if (!reportBtn) return;
    reportBtn.style.display = showReport ? 'inline-flex' : 'none';
    reportBtn.innerHTML = `<i class="fas fa-file-pdf"></i> ${reportLabel}`;
    reportBtn.onclick = reportAction || (() => downloadAuditReport(currentAuditId));
}

// Mobil pdf_service.dart ile birebir uyumlu PDF renkleri ve yardımcıları
const AUDIT_PDF_COLORS = {
    blueGrey900: [38, 50, 56],
    blue700: [25, 118, 210],
    blueGrey200: [176, 190, 197],
    green700: [56, 142, 60],
    orange700: [245, 124, 0],
    red700: [211, 47, 47],
    red800: [198, 40, 40],
    green800: [46, 125, 50],
    grey50: [250, 250, 250],
    grey400: [189, 189, 189],
    grey600: [117, 117, 117],
    grey700: [97, 97, 97],
    black: [0, 0, 0],
    chartGreen: [76, 175, 80],
    chartOrange: [255, 152, 0],
    chartRed: [244, 67, 54]
};

let _auditPdfFontCache = null;
let _auditPdfFontName = 'helvetica';

function auditPdfStr(value) {
    return String(value ?? '').normalize('NFC');
}

function toTurkishUpperCase(value) {
    if (!value) return '';
    let valStr = String(value);
    valStr = valStr.replace(/kozyata1/ig, 'Kozyatağı');
    
    return valStr
        .replace(/i/g, 'İ')
        .replace(/ı/g, 'I')
        .toLocaleUpperCase('tr-TR');
}

function getAuditPdfFontUrl(fileName) {
    const pageBase = window.location.href.split('#')[0].split('?')[0].replace(/[^/]+$/, '');
    return pageBase + 'fonts/' + fileName;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function setAuditPdfFont(doc, style) {
    doc.setFont(_auditPdfFontName, style || 'normal');
}

function auditPdfText(doc, text, x, y, options) {
    const payload = Array.isArray(text) ? text.map(auditPdfStr) : auditPdfStr(text);
    doc.text(payload, x, y, options);
}

function normalizeAuditPhotoPaths(ans) {
    if (!ans) return [];
    const photos = Array.isArray(ans.photos)
        ? ans.photos.map(photo => typeof photo === 'string' ? photo : (photo?.url || photo?.path)).filter(Boolean)
        : [];
    const raw = ans.photoPaths || ans.auditorPhotoPaths || ans.images;
    const paths = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
    return [...new Set([...photos, ...paths].filter(Boolean))];
}

function resolveAuditAnswerQuestion(audit, ans) {
    if (!ans) return { categoryName: 'Genel', questionText: 'Soru detayı bulunamadı', orderIndex: 0 };
    if (ans.questionText || ans.categoryName) {
        return {
            id: ans.questionId,
            categoryId: ans.categoryId || ans.groupId || '',
            categoryName: ans.categoryName || 'Genel',
            questionText: ans.questionText || ans.question || ans.title || ans.questionId || 'Soru detayı bulunamadı',
            orderIndex: Number(ans.orderIndex) || 0
        };
    }

    const auditType = (appData.auditTypes || []).find(type => String(type.id) === String(audit?.auditTypeId));
    for (const category of (auditType?.categories || [])) {
        const question = (category.questions || []).find(q => String(q.id) === String(ans.questionId));
        if (question) {
            return {
                id: question.id,
                categoryId: category.id,
                categoryName: category.name || category.title || 'Genel',
                questionText: question.text || question.questionText || question.title || ans.questionId,
                orderIndex: Number(question.orderIndex) || 0
            };
        }
    }

    const q = (appData.questions || []).find(item => String(item.id) === String(ans.questionId));
    return {
        id: ans.questionId,
        categoryId: q?.categoryId || q?.groupId || '',
        categoryName: q?.categoryName || 'Genel',
        questionText: q?.questionText || q?.text || q?.title || ans.questionId || 'Soru detayı bulunamadı',
        orderIndex: Number(q?.orderIndex) || 0
    };
}

function clampAuditPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
}

function getAuditTypeForAudit(audit = {}) {
    return (appData.auditTypes || []).find(type => String(type.id) === String(audit.auditTypeId)) || null;
}

function getAuditAnswerPrimaryValue(ans = {}) {
    if (ans.value !== undefined) return ans.value;
    if (ans.answer !== undefined) return ans.answer;
    if (ans.selectedAnswer !== undefined) return ans.selectedAnswer;
    if (ans.selectedValue !== undefined) return ans.selectedValue;
    if (ans.result !== undefined) return ans.result;
    return undefined;
}

function auditAnswerValueToken(value) {
    if (value === true || value === false) return value;
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    const text = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
    if (['true', 'evet', 'yes', 'uygun', 'olumlu', '1'].includes(text)) return true;
    if (['false', 'hayir', 'hay\u0131r', 'no', 'uygunsuz', 'olumsuz', '0'].includes(text)) return false;
    return null;
}

function isBooleanAuditAnswer(audit = {}, ans = {}) {
    // 1. Check if ans.answerType or ans.type is explicitly boolean, yes-no, or evet-hayir
    const ansType = String(ans.answerType || ans.type || '').toLowerCase();
    if (ansType.includes('bool') || ansType.includes('yes-no') || ansType.includes('evet') || ansType.includes('hayır') || ansType.includes('hayir')) {
        return true;
    }

    // 2. Custom robust normalization to support all locales/browsers and bypass combining dot i problems
    const normalize = (str) => {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .replace(/i̇/g, 'i') // combining dot i
            .replace(/ı/g, 'i') // Turkish dotless ı
            .replace(/ş/g, 's')
            .replace(/ğ/g, 'g')
            .replace(/ç/g, 'c')
            .replace(/ö/g, 'o')
            .replace(/ü/g, 'u');
    };

    const auditType = getAuditTypeForAudit(audit);
    const allowed = (auditType?.allowedAnswerTypes || []).map(t => String(t).toLowerCase());
    if (allowed.some(t => t.includes('bool') || t.includes('yes-no'))) {
        return true;
    }

    const textToSearch = [
        audit.auditTypeId,
        audit.auditType,
        auditType?.id,
        auditType?.title,
        auditType?.name,
        auditType?.scoringStrategy
    ].filter(Boolean).map(normalize).join(' ');

    if (textToSearch.includes('istasyon') || 
        textToSearch.includes('station') || 
        textToSearch.includes('bool') || 
        textToSearch.includes('yes') || 
        textToSearch.includes('evet') ||
        textToSearch.includes('hayir') ||
        textToSearch.includes('hayır')) {
        return true;
    }

    // 3. Fallback: check if the answer value is a boolean or string representing one
    const primary = getAuditAnswerPrimaryValue(ans);
    if (typeof primary === 'boolean') {
        return true;
    }
    const primaryStr = normalize(String(primary));
    if (['evet', 'hayir', 'yes', 'no', 'true', 'false'].includes(primaryStr)) {
        return true;
    }

    return false;
}

function scoreAuditAnswer(audit = {}, ans = {}) {
    if (ans.isOutOfScope === true) {
        return {
            rawScore: -1,
            percent: 100,
            displayScore: 'K.D.',
            isNonconformity: false,
            isOutOfScope: true
        };
    }

    if (isBooleanAuditAnswer(audit, ans)) {
        const primary = getAuditAnswerPrimaryValue(ans);
        let token = auditAnswerValueToken(primary);
        if (token === null) token = auditAnswerValueToken(ans.score);
        const positive = token === true || (token === null && Number(ans.score) > 0);
        const percent = positive ? 100 : 0;
        return {
            rawScore: positive ? 1 : 0,
            percent,
            displayScore: positive ? 'Evet' : 'Hay\u0131r',
            isNonconformity: ans.isNonconformity === true || !positive
        };
    }

    const primary = getAuditAnswerPrimaryValue(ans);
    const raw = Number(ans.score ?? primary ?? 0);
    const score = Number.isFinite(raw) ? Math.max(0, Math.min(5, raw)) : 0;
    
    const percent = clampAuditPercent(mapScore6ToPercent(score));
    
    return {
        rawScore: score,
        percent,
        displayScore: Number.isInteger(score) ? String(score) : score.toFixed(1),
        isNonconformity: ans.isNonconformity === true || (score >= 0 && score <= 3)
    };
}

function buildAuditDetailMetrics(audit = {}) {
    const answers = Array.isArray(audit.answers) ? audit.answers : [];
    if (!answers.length) {
        const legacyScore = clampAuditPercent(Number(audit.score) || 0);
        return { rows: [], categoryAverages: [], overallPercent: legacyScore, categoryAveragePercent: legacyScore };
    }

    const rows = answers.map((ans, index) => {
        const question = resolveAuditAnswerQuestion(audit, ans);
        const scored = scoreAuditAnswer(audit, ans);
        return {
            ans,
            index,
            question,
            categoryName: question.categoryName || 'Genel',
            questionText: question.questionText || 'Soru detayi bulunamadi',
            ...scored
        };
    });

    const categoryMap = new Map();
    rows.forEach(row => {
        if (row.isOutOfScope) return; // Exclude KD from average calculation!
        if (!categoryMap.has(row.categoryName)) categoryMap.set(row.categoryName, []);
        categoryMap.get(row.categoryName).push(row.percent);
    });

    const categoryAverages = Array.from(categoryMap.entries()).map(([categoryName, values]) => {
        const category = findCategoryByNameOrId(audit, categoryName);
        const weight = category && category.weight !== undefined ? Number(category.weight) : 1.0;
        return {
            categoryName,
            category: categoryName,
            count: values.length,
            weight,
            avgPercent: values.reduce((sum, value) => sum + value, 0) / values.length
        };
    });

    const activeRows = rows.filter(r => !r.isOutOfScope);
    const overallPercent = activeRows.length
        ? activeRows.reduce((sum, row) => sum + row.percent, 0) / activeRows.length
        : 100.0;

    let weightedTotal = 0;
    let totalWeight = 0;
    categoryAverages.forEach(cat => {
        weightedTotal += cat.avgPercent * cat.weight;
        totalWeight += cat.weight;
    });

    const categoryAveragePercent = totalWeight > 0 ? weightedTotal / totalWeight : overallPercent;

    return { rows, categoryAverages, overallPercent, categoryAveragePercent };
}

function getAuditDisplayScore(audit = {}) {
    return clampAuditPercent(buildAuditDetailMetrics(audit).categoryAveragePercent);
}

function groupAuditAnswersByCategory(audit, answers) {
    const sections = [];
    const sectionByName = new Map();
    (answers || []).forEach((ans, index) => {
        const question = resolveAuditAnswerQuestion(audit, ans);
        const categoryName = question.categoryName || 'Genel';
        if (!sectionByName.has(categoryName)) {
            const section = { categoryName, items: [] };
            sectionByName.set(categoryName, section);
            sections.push(section);
        }
        sectionByName.get(categoryName).items.push({ ans, question, index });
    });
    return sections;
}

function toAuditPdfDate(dateValue) {
    if (!dateValue) return new Date();
    if (typeof dateValue.toDate === 'function') return dateValue.toDate();
    if (dateValue.seconds) return new Date(dateValue.seconds * 1000);
    const d = new Date(dateValue);
    return isNaN(d.getTime()) ? new Date() : d;
}

function formatAuditPdfDate(dateValue) {
    const d = toAuditPdfDate(dateValue);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function formatAuditPdfDateTime(dateValue) {
    const d = toAuditPdfDate(dateValue);
    return `${formatAuditPdfDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function drawAuditPdfRoundedRect(doc, x, y, w, h, rx, ry, style) {
    if (typeof doc.roundedRect === 'function') {
        doc.roundedRect(x, y, w, h, rx, ry, style);
    } else {
        doc.rect(x, y, w, h, style);
    }
}

function getAuditPdfFileName(audit) {
    const d = toAuditPdfDate(audit.date);
    const datePart = `${String(d.getDate()).padStart(2, '0')}_${String(d.getMonth() + 1).padStart(2, '0')}_${d.getFullYear()}`;
    return `${audit.line || 'Hat'}_${audit.station || 'Istasyon'}_${datePart}_Denetim_Raporu.pdf`.replace(/ /g, '_');
}

function getAuditScoreBadgeColor(score) {
    const s = Number(score) || 0;
    if (s >= 85) return AUDIT_PDF_COLORS.green700;
    if (s >= 70) return AUDIT_PDF_COLORS.orange700;
    return AUDIT_PDF_COLORS.red700;
}

function getAuditChartBarColor(avgPercent) {
    if (avgPercent >= 80) return AUDIT_PDF_COLORS.chartGreen;
    if (avgPercent >= 60) return AUDIT_PDF_COLORS.chartOrange;
    return AUDIT_PDF_COLORS.chartRed;
}

function buildAuditCategoryChartData(audit) {
    return buildAuditDetailMetrics(audit).categoryAverages
        .map(item => ({ category: item.categoryName || item.category || 'Genel', avgPercent: clampAuditPercent(item.avgPercent) }));
}

async function fetchAuditPdfFontBuffer(fileName, remoteUrl) {
    const localUrl = getAuditPdfFontUrl(fileName);
    try {
        const localResp = await fetch(localUrl);
        if (localResp.ok) return localResp.arrayBuffer();
    } catch (e) {
        console.warn('Yerel font okunamadı:', localUrl, e);
    }
    const remoteResp = await fetch(remoteUrl);
    if (!remoteResp.ok) throw new Error(`${fileName} indirilemedi (${remoteResp.status})`);
    return remoteResp.arrayBuffer();
}

async function ensureAuditPdfFonts(doc) {
    try {
        if (!_auditPdfFontCache) {
            const [regularBuf, boldBuf] = await Promise.all([
                fetchAuditPdfFontBuffer(
                    'DejaVuSans.ttf',
                    'https://raw.githubusercontent.com/dompdf/dompdf/master/lib/fonts/DejaVuSans.ttf'
                ),
                fetchAuditPdfFontBuffer(
                    'DejaVuSans-Bold.ttf',
                    'https://raw.githubusercontent.com/dompdf/dompdf/master/lib/fonts/DejaVuSans-Bold.ttf'
                )
            ]);
            _auditPdfFontCache = {
                regular: arrayBufferToBase64(regularBuf),
                bold: arrayBufferToBase64(boldBuf)
            };
        }
        doc.addFileToVFS('DejaVuSans.ttf', _auditPdfFontCache.regular);
        doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
        doc.addFileToVFS('DejaVuSans-Bold.ttf', _auditPdfFontCache.bold);
        doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
        _auditPdfFontName = 'DejaVuSans';
    } catch (err) {
        console.warn('PDF fontları yüklenemedi, varsayılan font kullanılacak:', err);
        _auditPdfFontName = 'helvetica';
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function loadAuditPdfImage(url) {
    if (!url) return null;

    try {
        const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (resp.ok) {
            const blob = await resp.blob();
            if (blob.size > 0) {
                const dataUrl = await blobToDataUrl(blob);
                return { dataUrl, aspect: 1 };
            }
        }
    } catch (e) {
        console.warn('PDF image fetch failed, trying Image element:', url, e);
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const maxW = 400;
                const scale = img.width > maxW ? maxW / img.width : 1;
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), aspect: canvas.width / canvas.height });
            } catch (err) {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

async function loadAuditPhotosForAnswer(audit, ans) {
    const loaded = [];
    const photoGroups = [
        { type: 'detection', paths: collectAuditAnswerPhotoPaths(audit, ans) },
        { type: 'closure', paths: collectAuditAnswerClosurePhotoPaths(audit, ans) }
    ];
    const loadedPaths = new Set();

    for (const group of photoGroups) {
        for (const p of group.paths) {
            if (loadedPaths.has(p)) continue;
            loadedPaths.add(p);
            const url = await resolveImagePathAsync(p);
            if (url) {
                const img = await loadAuditPdfImage(url);
                if (img) loaded.push({ ...img, type: group.type });
            }
        }
    }
    return loaded;
}

function setAuditPdfRgb(doc, rgb) {
    const c = rgb || AUDIT_PDF_COLORS.black;
    doc.setTextColor(c[0], c[1], c[2]);
}

function setAuditPdfFill(doc, rgb) {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function auditPdfEnsureSpace(doc, y, needed, top = 20) {
    if (y + needed > 277) {
        doc.addPage();
        return top;
    }
    return y;
}


function drawAuditPdfCategoryChart(doc, audit, y) {
    const margin = 15;
    const pageW = 210;
    const contentW = pageW - margin * 2;
    const chartData = buildAuditCategoryChartData(audit);
    if (!chartData || chartData.length === 0) return y;

    y = auditPdfEnsureSpace(doc, y, 30);
    
    // Premium Corporate Header Box
    const headerH = 7;
    doc.setFillColor(11, 42, 74);
    drawAuditPdfRoundedRect(doc, margin, y, contentW, headerH, 1, 1, 'F');
    
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(8);
    setAuditPdfRgb(doc, [255, 255, 255]);
    auditPdfText(doc, 'KATEGORİ BAŞARI ÖZETİ', pageW / 2, y + 5, { align: 'center' });
    y += headerH;

    // 3-Column Grid setup
    const cols = 3;
    const colW = contentW / cols;
    const itemH = 9;
    const paddingX = 4;
    
    const rows = Math.ceil(chartData.length / cols);
    const boxH = rows * itemH + 4;
    
    // Main Body Box
    doc.setFillColor(252, 253, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.rect(margin, y, contentW, boxH, 'FD');
    
    let currentY = y + 3;
    
    for (let i = 0; i < chartData.length; i++) {
        const item = chartData[i];
        const row = Math.floor(i / cols);
        const col = i % cols;
        
        const startX = margin + (col * colW) + paddingX;
        const startY = currentY + (row * itemH);
        
        // Category Name
        setAuditPdfFont(doc, 'bold');
        doc.setFontSize(6.5);
        setAuditPdfRgb(doc, [51, 65, 85]);
        const catName = item.category.length > 21 ? item.category.substring(0, 19) + '..' : item.category;
        auditPdfText(doc, catName, startX, startY + 3.5);
        
        // Percentage Text (Right aligned within the column)
        setAuditPdfRgb(doc, [15, 23, 42]);
        const scoreText = `%${Math.round(item.avgPercent)}`;
        const scoreW = doc.getTextWidth(scoreText);
        auditPdfText(doc, scoreText, startX + colW - paddingX * 2 - scoreW, startY + 3.5);
        
        // Micro Progress Bar
        const barY = startY + 5.5;
        const maxBarW = colW - paddingX * 2;
        const actualBarW = Math.max(0.5, (item.avgPercent / 100) * maxBarW);
        const barColor = getAuditChartBarColor(item.avgPercent);
        
        // Bar Background Track
        doc.setFillColor(241, 245, 249);
        drawAuditPdfRoundedRect(doc, startX, barY, maxBarW, 1.5, 0.75, 0.75, 'F');
        
        // Bar Fill
        doc.setFillColor(barColor[0], barColor[1], barColor[2]);
        drawAuditPdfRoundedRect(doc, startX, barY, actualBarW, 1.5, 0.75, 0.75, 'F');
    }
    
    // Elegant Vertical Separators
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    for (let c = 1; c < cols; c++) {
        doc.line(margin + c * colW, y + 2, margin + c * colW, y + boxH - 2);
    }
    
    return y + boxH + 4;
}

function getAuditPdfResolutionData(audit, ans, questionText, loadedPhotos, categoryName = '') {
    const nc = findNcForAuditAnswer(audit, ans, categoryName, questionText);
    const photos = (loadedPhotos || []).filter(photo => photo && photo.dataUrl);
    return {
        nc,
        isResolved: Boolean(nc && isNcClosed(nc)),
        closureNote: String(nc?.closureComment || '').trim(),
        detectionPhotos: photos.filter(photo => photo.type !== 'closure'),
        closurePhotos: photos.filter(photo => photo.type === 'closure')
    };
}

function estimateAuditQuestionBlockHeight(doc, audit, ans, questionText, loadedPhotos) {
    const contentW = 180;
    const scoredAnswer = ans ? scoreAuditAnswer(audit, ans) : null;
    const scoreLabel = scoredAnswer ? scoredAnswer.displayScore : '0';
    const comment = ans ? [ (ans.comment || ans.detail || '').trim(), ...(Array.isArray(ans.additionalComments) ? ans.additionalComments : []) ].filter(Boolean).join('\n\n') : '';
    const noteText = String(comment).trim();
    const resolution = getAuditPdfResolutionData(audit, ans, questionText, loadedPhotos);
    const is5S = String(audit?.auditType || '').toUpperCase().includes('5S');
    const resolvedText = resolution.isResolved ? ' - \u00c7\u00d6Z\u00dcLD\u00dc' : '';
    const headerPrefix = is5S
        ? `(${scoreLabel} Puan${resolvedText})`
        : `[${resolution.isResolved ? '\u00c7\u00d6Z\u00dcLD\u00dc' : 'HAYIR'}]`;

    doc.setFontSize(7.5);
    const headerLines = doc.splitTextToSize(auditPdfStr(`Soru #X ${headerPrefix}: ${questionText}`), contentW - 6);
    const headerH = 2 + headerLines.length * 3.5;

    let bodyH = 0;
    if (noteText) {
        doc.setFontSize(7);
        const noteLines = doc.splitTextToSize(auditPdfStr(`Not: ${noteText}`), contentW - 6);
        bodyH += 1 + noteLines.length * 3.5 + 1;
    }

    if (resolution.detectionPhotos.length > 0) {
        bodyH += 6 + Math.ceil(resolution.detectionPhotos.length / 4) * 20;
    }

    const questionH = headerH + bodyH + (bodyH > 0 ? 3 : 2);
    return questionH + 2;
}

function drawAuditPdfQuestionBlock(doc, audit, index, ans, categoryName, questionText, loadedPhotos, y) {
    const margin = 15;
    const pageW = 210;
    const contentW = pageW - margin * 2;
    const scoredAnswer = ans ? scoreAuditAnswer(audit, ans) : null;
    const isNc = scoredAnswer ? scoredAnswer.isNonconformity : false;
    const scoreLabel = scoredAnswer ? scoredAnswer.displayScore : '0';
    const comment = ans ? [ (ans.comment || ans.detail || '').trim(), ...(Array.isArray(ans.additionalComments) ? ans.additionalComments : []) ].filter(Boolean).join('\n\n') : '';
    const noteText = String(comment).trim();
    const resolution = getAuditPdfResolutionData(audit, ans, questionText, loadedPhotos, categoryName);
    const statusColorRgb = resolution.isResolved ? [34, 197, 94] : (isNc ? [227, 30, 36] : [34, 197, 94]);

    const is5S = String(audit?.auditType || '').toUpperCase().includes('5S');
    const statusStr = resolution.isResolved ? '\u00c7\u00d6Z\u00dcLD\u00dc' : (isNc ? 'HAYIR' : 'EVET');
    const headerPrefix = is5S
        ? `(${scoreLabel} Puan${resolution.isResolved ? ' - \u00c7\u00d6Z\u00dcLD\u00dc' : ''})`
        : `[${statusStr}]`;
    const fullHeader = auditPdfStr(`Soru #${index + 1} ${headerPrefix}: ${questionText}`);

    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(7.5);
    const headerLines = doc.splitTextToSize(fullHeader, contentW - 6);
    const headerH = 2 + headerLines.length * 3.5;

    let bodyH = 0;
    let noteLines = [];
    if (noteText) {
        setAuditPdfFont(doc, 'normal');
        doc.setFontSize(7);
        noteLines = doc.splitTextToSize(auditPdfStr(`Not: ${noteText}`), contentW - 6);
        bodyH += 1 + noteLines.length * 3.5 + 1;
    }
    if (resolution.detectionPhotos.length > 0) {
        bodyH += 6 + Math.ceil(resolution.detectionPhotos.length / 4) * 20;
    }

    let closureLines = [];
    if (resolution.closureNote) {
        setAuditPdfFont(doc, 'normal');
        doc.setFontSize(7.5);
        closureLines = doc.splitTextToSize(
            auditPdfStr(`\u00c7\u00f6z\u00fcm A\u00e7\u0131klamas\u0131: ${resolution.closureNote}`),
            contentW - 12
        );
    }
    const hasResolution = resolution.isResolved || resolution.closureNote || resolution.closurePhotos.length > 0;
    let resolutionH = 0;
    if (hasResolution) {
        resolutionH = 12 + (closureLines.length > 0 ? closureLines.length * 4 + 3 : 0);
        if (resolution.closurePhotos.length > 0) {
            resolutionH += 6 + Math.ceil(resolution.closurePhotos.length / 2) * 47;
        }
        resolutionH += 3;
    }

    const questionH = headerH + bodyH + (bodyH > 0 ? 3 : 2);
    y = auditPdfEnsureSpace(doc, y, questionH + 4);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.setFillColor(252, 253, 255);
    doc.rect(margin, y, contentW, questionH, 'FD');
    doc.setFillColor(statusColorRgb[0], statusColorRgb[1], statusColorRgb[2]);
    doc.rect(margin, y, 1.5, questionH, 'F');

    let currentY = y + 4;
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(7.5);
    setAuditPdfRgb(doc, resolution.isResolved || !isNc ? [22, 101, 52] : [153, 27, 27]);
    auditPdfText(doc, headerLines, margin + 4, currentY);
    currentY += headerH - 2;

    if (bodyH > 0) {
        doc.setDrawColor(241, 245, 249);
        doc.line(margin + 2, currentY, pageW - margin - 2, currentY);
        currentY += 3;
    }

    if (noteText) {
        setAuditPdfFont(doc, 'normal');
        doc.setFontSize(7);
        setAuditPdfRgb(doc, [51, 65, 85]);
        auditPdfText(doc, noteLines, margin + 4, currentY);
        currentY += noteLines.length * 3.5 + 2;
    }

    if (resolution.detectionPhotos.length > 0) {
        setAuditPdfFont(doc, 'bold');
        doc.setFontSize(6.8);
        setAuditPdfRgb(doc, [37, 99, 235]);
        auditPdfText(doc, 'TESP\u0130T FOTO\u011eRAFLARI', margin + 4, currentY + 3);
        currentY += 6;

        resolution.detectionPhotos.forEach((photo, photoIndex) => {
            const row = Math.floor(photoIndex / 4);
            const column = photoIndex % 4;
            const imgX = margin + 4 + column * 40;
            const imgY = currentY + row * 20;
            try {
                doc.addImage(photo.dataUrl, 'JPEG', imgX, imgY, 38, 18);
                doc.setDrawColor(147, 197, 253);
                doc.rect(imgX, imgY, 38, 18);
            } catch (e) {}
        });
    }

    currentY = y + questionH;
    if (hasResolution) {
        currentY = auditPdfEnsureSpace(doc, currentY + 3, resolutionH + 2, 16);
        doc.setFillColor(240, 253, 244);
        doc.setDrawColor(134, 239, 172);
        doc.setLineWidth(0.35);
        doc.roundedRect(margin + 3, currentY, contentW - 6, resolutionH, 2, 2, 'FD');

        let resolutionY = currentY + 6;
        setAuditPdfFont(doc, 'bold');
        doc.setFontSize(9);
        setAuditPdfRgb(doc, [21, 128, 61]);
        auditPdfText(doc, '\u00c7\u00d6Z\u00dcM VE KAPANI\u015e', margin + 6, resolutionY);
        resolutionY += 6;

        if (closureLines.length > 0) {
            setAuditPdfFont(doc, 'normal');
            doc.setFontSize(7.5);
            setAuditPdfRgb(doc, [22, 101, 52]);
            auditPdfText(doc, closureLines, margin + 6, resolutionY);
            resolutionY += closureLines.length * 4 + 3;
        } else if (resolution.isResolved && resolution.closurePhotos.length === 0) {
            setAuditPdfFont(doc, 'normal');
            doc.setFontSize(7.5);
            setAuditPdfRgb(doc, [22, 101, 52]);
            auditPdfText(doc, 'Durum: \u00c7\u00f6z\u00fcld\u00fc', margin + 6, resolutionY);
            resolutionY += 5;
        }

        if (resolution.closurePhotos.length > 0) {
            setAuditPdfFont(doc, 'bold');
            doc.setFontSize(7.5);
            setAuditPdfRgb(doc, [21, 128, 61]);
            auditPdfText(doc, '\u00c7\u00d6Z\u00dcM FOTO\u011eRAFLARI', margin + 6, resolutionY + 3);
            resolutionY += 6;

            resolution.closurePhotos.forEach((photo, photoIndex) => {
                const row = Math.floor(photoIndex / 2);
                const column = photoIndex % 2;
                const imgX = margin + 6 + column * 86;
                const imgY = resolutionY + row * 47;
                try {
                    doc.addImage(photo.dataUrl, 'JPEG', imgX, imgY, 78, 42);
                    doc.setDrawColor(74, 222, 128);
                    doc.rect(imgX, imgY, 78, 42);
                    setAuditPdfFont(doc, 'bold');
                    doc.setFontSize(6);
                    setAuditPdfRgb(doc, [21, 128, 61]);
                    auditPdfText(doc, `\u00c7\u00f6z\u00fcm ${photoIndex + 1}`, imgX + 39, imgY + 45, { align: 'center' });
                } catch (e) {}
            });
        }
        currentY += resolutionH;
    }

    return currentY + 2;
}

function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : [100, 116, 139];
}

async function renderAuditDetailsToPdf(doc, audit, imageCache) {
    let y = 20;
    const margin = 15;
    const pageW = 210;

    // Corporate Header Top
    doc.setFillColor(227, 30, 36); // Corporate Red Accent Top
    doc.rect(0, 0, 210, 3, 'F');

    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(18);
    setAuditPdfRgb(doc, [11, 42, 74]); // Corporate Dark Blue
    auditPdfText(doc, 'DENETİM RAPORU', margin, y);
    
    setAuditPdfFont(doc, 'normal');
    doc.setFontSize(8);
    const auditPdfWeekNum = audit.date ? getISOWeekNumber(new Date(audit.date)) : '-';
    const auditPdfWeekText = auditPdfWeekNum !== '-' ? ` (${auditPdfWeekNum}. Hafta)` : '';
    auditPdfText(doc, 'Rapor Tarihi: ' + formatAuditPdfDate(audit.date) + auditPdfWeekText, pageW - margin, y, { align: 'right' });
    doc.setDrawColor(227, 30, 36); // Red underline
    doc.setLineWidth(0.5);
    doc.line(margin, y + 3, margin + 75, y + 3);
    
    y += 12;

    y = drawAuditPdfHero(doc, audit, y);
    y = drawAuditPdfCategoryChart(doc, audit, y);

    y += 4;
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(12);
    setAuditPdfRgb(doc, [11, 42, 74]);
    y = auditPdfEnsureSpace(doc, y, 12);
    auditPdfText(doc, 'DETAYLI BULGU VE DEĞERLENDİRMELER', margin, y);
    y += 2;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 4;

    let resolvedTypeId = audit.auditTypeId;
    if (!resolvedTypeId && typeof appData !== 'undefined' && appData.auditTypes) {
        const fallbackType = appData.auditTypes.find(t => (t.title || t.name) === audit.auditType);
        if (fallbackType) resolvedTypeId = fallbackType.id;
    }
    const typeColorHex = getAuditTypeColor(resolvedTypeId);
    const typeColorRgb = hexToRgb(typeColorHex);

    const answers = (audit.answers && Array.isArray(audit.answers) && audit.answers.length > 0) ? audit.answers : null;
    if (answers) {
        for (const section of groupAuditAnswersByCategory(audit, answers)) {
            // Predict space for header AND the first question
            let firstBlockH = 30;
            if (section.items && section.items.length > 0) {
                const firstAns = section.items[0].ans;
                const firstQText = section.items[0].question.questionText || '';
                const cacheKey = firstAns.questionId || 'idx_' + section.items[0].index;
                const loadedPhotos = imageCache[cacheKey] || [];
                firstBlockH = estimateAuditQuestionBlockHeight(doc, audit, firstAns, firstQText, loadedPhotos);
            }
            
            y += 3;
            y = auditPdfEnsureSpace(doc, y, 11 + firstBlockH);
            
            // Highlighted Category Header using Audit Type Color
            doc.setFillColor(typeColorRgb[0], typeColorRgb[1], typeColorRgb[2]);
            doc.rect(margin, y - 5, pageW - margin * 2, 10, 'F');
            doc.setFillColor(227, 30, 36);
            doc.rect(margin, y - 5, 2.5, 10, 'F');
            
            setAuditPdfFont(doc, 'bold');
            doc.setFontSize(9.5);
            setAuditPdfRgb(doc, [255, 255, 255]);
            auditPdfText(doc, toTurkishUpperCase(section.categoryName || 'Genel'), margin + 5, y + 1.5);
            y += 8;

            for (const item of section.items) {
                const ans = item.ans;
                const categoryName = item.question.categoryName || section.categoryName || 'Genel';
                const questionText = item.question.questionText || 'Soru detayı bulunamadı';
                const cacheKey = ans.questionId || 'idx_' + item.index;
                const loadedPhotos = imageCache[cacheKey] || [];
                const blockH = estimateAuditQuestionBlockHeight(doc, audit, ans, questionText, loadedPhotos);
                y = auditPdfEnsureSpace(doc, y, blockH);
                y = drawAuditPdfQuestionBlock(doc, audit, item.index, ans, categoryName, questionText, loadedPhotos, y);
            }
        }
    }

    // Corporate Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(6);
        setAuditPdfFont(doc, 'normal');
        setAuditPdfRgb(doc, [148, 163, 184]);
        auditPdfText(doc, 'Bu belge elektronik denetim sistemi tarafından otomatik olarak üretilmiştir.', 105, 292, { align: 'center' });
    }
}

function drawAuditPdfHero(doc, audit, y) {
    const margin = 15;
    const pageW = 210;
    const heroRight = pageW - margin - 4; // Fix overflow, added 4mm right padding
    const hasTimestamps = audit.startedAt && audit.completedAt;
    const heroH = hasTimestamps ? 46 : 38;
    const score = getAuditDisplayScore(audit);
    const badgeColor = getAuditScoreBadgeColor(score);
    const lineLabel = (audit.line && audit.line.length > 3) ? audit.line.substring(0, 3) : (audit.line || '');

    const resolvedTypeId = audit.auditTypeId || (typeof appData !== 'undefined' && appData.auditTypes && appData.auditTypes.find(t => (t.title || t.name) === audit.auditType)?.id);
    const typeColorHex = getAuditTypeColor(resolvedTypeId);
    const typeColorRgb = hexToRgb(typeColorHex);

    // Corporate Color for Hero Box
    setAuditPdfFill(doc, [11, 42, 74]);
    drawAuditPdfRoundedRect(doc, margin, y, pageW - margin * 2, heroH, 2, 2, 'F');

    const circleX = margin + 4;
    const circleY = y + 6;
    const circleSize = 20;
    setAuditPdfFill(doc, AUDIT_PDF_COLORS.blue700);
    doc.circle(circleX + circleSize / 2, circleY + circleSize / 2, circleSize / 2, 'F');
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(11);
    setAuditPdfRgb(doc, [255, 255, 255]);
    auditPdfText(doc, lineLabel, circleX + circleSize / 2, circleY + circleSize / 2 + 1.5, { align: 'center' });

    const infoX = circleX + circleSize + 8;
    const badgeW = 38;
    const badgeX = heroRight - badgeW;
    let infoY = y + 10;
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(14);
    setAuditPdfRgb(doc, [255, 255, 255]);
    const stationLines = doc.splitTextToSize(
        toTurkishUpperCase(audit.station || '-'),
        Math.max(40, badgeX - infoX - 6)
    );
    auditPdfText(doc, stationLines, infoX, infoY);
    infoY += Math.max(0, (stationLines.length - 1) * 5);

    setAuditPdfFont(doc, 'normal');
    doc.setFontSize(8);
    setAuditPdfRgb(doc, [203, 213, 225]);
    infoY += 5;
    auditPdfText(doc, `Denetim ID: ${String(audit.id).replace(/AUD/g, 'DNT')}`, infoX, infoY);
    infoY += 4;
    if (audit.startedAt && audit.completedAt) {
        const startStr = formatAuditPdfDateTime(audit.startedAt);
        const endStr = formatAuditPdfDateTime(audit.completedAt);
        const diffMs = new Date(audit.completedAt) - new Date(audit.startedAt);
        const diffMin = Math.round(diffMs / 1000 / 60);
        auditPdfText(doc, `Başlangıç: ${startStr}`, infoX, infoY);
        infoY += 4;
        auditPdfText(doc, `Bitiş: ${endStr} (${diffMin} dk)`, infoX, infoY);
        infoY += 4;
    } else {
        auditPdfText(doc, `Tarih: ${formatAuditPdfDateTime(audit.date)}`, infoX, infoY);
        infoY += 4;
    }
    auditPdfText(doc, `Denetçi: ${getAuditorDisplayName(audit.auditorName) || '-'}`, infoX, infoY);

    const badgeH = 20;
    const badgeY = y + 5;
    const badgeCenterX = badgeX + badgeW / 2;
    setAuditPdfFill(doc, badgeColor);
    drawAuditPdfRoundedRect(doc, badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(6.5);
    setAuditPdfRgb(doc, [255, 255, 255]);
    auditPdfText(doc, 'GENEL BAŞARI ENDEKSİ', badgeCenterX, badgeY + 5.5, { align: 'center' });
    doc.setFontSize(15);
    auditPdfText(doc, `%${score.toFixed(1)}`, badgeCenterX, badgeY + 14.5, { align: 'center' });

    const auditTypeText = auditPdfStr(audit.auditType || 'Genel Denetim');
    const typeGap = 3;
    const typeBoxH = 8;
    const typeY = badgeY + badgeH + typeGap;
    
    // Type specific color for Audit Type badge
    setAuditPdfFill(doc, typeColorRgb);
    drawAuditPdfRoundedRect(doc, badgeX, typeY, badgeW, typeBoxH, 2, 2, 'F');
    setAuditPdfFont(doc, 'bold');
    doc.setFontSize(7);
    setAuditPdfRgb(doc, [255, 255, 255]);
    auditPdfText(doc, auditTypeText, badgeCenterX, typeY + 5.2, { align: 'center' });

    setAuditPdfRgb(doc, AUDIT_PDF_COLORS.black);
    return y + heroH + 4;
}

async function downloadAuditReport(id) {
    const auditId = id || currentAuditId;
    console.log('Generating PDF for ID:', auditId);
    const audit = getAccessibleAuditById(auditId);

    if (!audit) {
        console.error('Audit not found for PDF generation:', auditId);
        showToast('Hata: Denetim kaydı bulunamadı.');
        return;
    }

    try {
        showToast('PDF Raporu hazırlanıyor...');

        const { jsPDF } = window.jspdf;
        if (!jsPDF) throw new Error('jsPDF library not loaded');

        const answers = (audit.answers && Array.isArray(audit.answers) && audit.answers.length > 0)
            ? audit.answers
            : null;

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        await ensureAuditPdfFonts(doc);

        const imageCache = {};
        if (answers) {
            try {
                await Promise.all(answers.map(async (ans, ansIdx) => {
                    imageCache[ans.questionId || `idx_${ansIdx}`] = await loadAuditPhotosForAnswer(audit, ans);
                }));
            } catch (imgErr) {
                console.warn('PDF fotoğraf ön yükleme atlandı:', imgErr);
            }
        }

        await renderAuditDetailsToPdf(doc, audit, imageCache);
        doc.save(getAuditPdfFileName(audit));
        showToast('PDF başarıyla indirildi.');
    } catch (err) {
        console.error('PDF generation error:', err);
        showToast(`PDF oluşturulurken hata: ${err && err.message ? err.message : 'bilinmeyen hata'}`);
    }
}

function safePdfValue(value, fallback = '-') {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
}

async function handleBulkPdfOutput(doc, fileName, title, action) {
    if (action === 'download') {
        doc.save(fileName);
        showToast('PDF indirildi.');
        return;
    }

    const blob = doc.output('blob');
    const file = new File([blob], fileName, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        try {
            await navigator.share({
                title,
                text: title,
                files: [file]
            });
            showToast('PDF paylaşım ekranına gönderildi.');
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            console.warn('PDF share failed, falling back to download:', err);
        }
    }

    if (action === 'auto') {
        doc.save(fileName);
        showToast('Paylaşım desteklenmediği için PDF indirildi.');
        return;
    }

    showToast('Bu tarayıcı dosya paylaşımını desteklemiyor. İndir butonunu kullanın.');
}

function addBulkPdfTitle(doc, title, subtitle) {
    const margin = 14;
    const pageW = 210;
    
    doc.setFillColor(15, 23, 42);
    drawAuditPdfRoundedRect(doc, margin, 15, pageW - margin * 2, 20, 2, 2, 'F');
    
    doc.setFillColor(227, 30, 36);
    drawAuditPdfRoundedRect(doc, margin, 15, 3, 20, 2, 0, 'F');
    
    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(toTurkishUpperCase(title), margin + 8, 23);
    
    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(toTurkishUpperCase(subtitle), margin + 8, 30);
    
    doc.setFontSize(7);
    doc.text(toTurkishUpperCase(new Date().toLocaleDateString('tr-TR')), pageW - margin - 15, 30, { align: 'right' });
}

async function generateBulkAuditPDFs(action = 'download') {
    const selectedAudits = Array.from(appData.selectedAuditIds)
        .map(id => getAccessibleAuditById(id))
        .filter(Boolean);

    if (selectedAudits.length === 0) {
        showToast('PDF için en az bir denetim kaydı seçin.');
        return;
    }

    try {
        showToast('Toplu denetim PDF hazırlanıyor...');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        await ensureAuditPdfFonts(doc);

        if (selectedAudits.length > 1) {
            addBulkPdfTitle(doc, 'Toplu Denetim Kayıtları Raporu', `${selectedAudits.length} kayıt seçildi`);

            doc.autoTable({
                startY: 42,
                head: [['ID', 'TARİH', 'TİP', 'HAT', 'İSTASYON', 'DENETÇİ', 'PUAN']],
                body: selectedAudits.map(a => [
                    toTurkishUpperCase(safePdfValue(a.id)),
                    a.date ? toTurkishUpperCase(new Date(a.date).toLocaleDateString('tr-TR')) : '-',
                    toTurkishUpperCase(safePdfValue(a.auditType)),
                    toTurkishUpperCase(safePdfValue(a.line)),
                    toTurkishUpperCase(a.station || '-'),
                    toTurkishUpperCase(safePdfValue(getAuditorDisplayName(a.auditorName))),
                    Number(a.score || 0).toFixed(1)
                ]),
                styles: { font: 'DejaVuSans', fontStyle: 'normal', fontSize: 8.5, cellPadding: 4, valign: 'middle', textColor: [51, 65, 85] },
                headStyles: { font: 'DejaVuSans', fontStyle: 'bold', fillColor: [15, 23, 42], textColor: [255, 255, 255] },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                didParseCell: function(data) {
                    if (data.section === 'body' && data.column.index === 6) {
                        const score = parseFloat(data.cell.raw);
                        const color = getAuditScoreBadgeColor(score);
                        data.cell.styles.textColor = color;
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fontSize = 10; // Make score bigger
                        data.cell.text = [`%${score.toFixed(1)}`];
                    }
                    if (data.section === 'body' && data.column.index === 3) {
                        data.cell.text = '';
                    }
                },
                didDrawCell: function(data) {
                    if (data.section === 'body' && data.column.index === 3) {
                        const lineLabel = data.cell.raw || '';
                        if (lineLabel && lineLabel !== '-') {
                            const shortLabel = lineLabel.length > 3 ? lineLabel.substring(0,3) : lineLabel;
                            const lineColorHex = (typeof appData !== 'undefined' && appData.lineColors && appData.lineColors[lineLabel]) ? appData.lineColors[lineLabel] : '#0f172a';
                            const rgb = hexToRgb(lineColorHex);
                            const radius = 3.5;
                            const cx = data.cell.x + data.cell.width / 2;
                            const cy = data.cell.y + data.cell.height / 2;
                            
                            doc.setFillColor(rgb[0], rgb[1], rgb[2]);
                            doc.circle(cx, cy, radius, 'F');
                            
                            doc.setFont('DejaVuSans', 'bold');
                            doc.setFontSize(6);
                            doc.setTextColor(255, 255, 255);
                            doc.text(shortLabel, cx, cy, { align: 'center', baseline: 'middle' });
                        }
                    }
                }
            });
        }

        for (let i = 0; i < selectedAudits.length; i++) {
            const audit = selectedAudits[i];
            if (selectedAudits.length > 1 || i > 0) {
                doc.addPage();
            }
            const answers = (audit.answers && Array.isArray(audit.answers) && audit.answers.length > 0) ? audit.answers : null;
            const imageCache = {};
            if (answers) {
                try {
                    await Promise.all(answers.map(async (ans, ansIdx) => {
                        imageCache[ans.questionId || "idx_" + ansIdx] = await loadAuditPhotosForAnswer(audit, ans);
                    }));
                } catch (imgErr) {
                    console.warn('PDF fotoğraf ön yükleme atlandı:', imgErr);
                }
            }
            await renderAuditDetailsToPdf(doc, audit, imageCache);
        }



        let outputFileName = `Toplu_Denetim_Raporu_${selectedAudits.length}_kayit.pdf`;
        if (selectedAudits.length === 1) {
            outputFileName = getAuditPdfFileName(selectedAudits[0]);
        }
        await handleBulkPdfOutput(doc, outputFileName, 'Toplu Denetim Kayıtları Raporu', action);
    } catch (err) {
        console.error('Bulk audit PDF error:', err);
        showToast(`Toplu PDF oluşturulamadı: ${err && err.message ? err.message : 'bilinmeyen hata'}`);
    }
}

function shareBulkAuditPDFs() {
    return generateBulkAuditPDFs('download');
}

function downloadBulkAuditPDFs() {
    return generateBulkAuditPDFs('download');
}

async function generateBulkNCPDFs(action = 'download') {
    const selectedNCs = Array.from(appData.selectedNCIds)
        .map(id => getFilteredNCs().find(n => String(n.id) === String(id)))
        .filter(Boolean);

    if (selectedNCs.length === 0) {
        showToast('PDF için en az bir uygunsuzluk kaydı seçin.');
        return;
    }

    try {
        showToast('Toplu uygunsuzluk PDF hazırlanıyor...');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        await ensureAuditPdfFonts(doc);

        if (selectedNCs.length > 1) {
            addBulkPdfTitle(doc, 'Toplu Uygunsuzluk Takibi Raporu', `${selectedNCs.length} kayıt seçildi`);

            doc.autoTable({
                startY: 42,
                head: [['ID', 'TARİH', 'TİP', 'HAT', 'İSTASYON', 'KATEGORİ', 'DURUM', 'KULLANICI']],
                body: selectedNCs.map(nc => {
                    const audit = getAccessibleAuditById(nc.auditId) || {};
                    return [
                        toTurkishUpperCase(safePdfValue(String(nc.id).substring(0, 6))),
                        nc.detectionDate || nc.date ? toTurkishUpperCase(new Date(nc.detectionDate || nc.date).toLocaleDateString('tr-TR')) : '-',
                        toTurkishUpperCase(safePdfValue(audit.auditType || nc.auditType || '-')),
                        toTurkishUpperCase(safePdfValue(audit.line || nc.line)),
                        toTurkishUpperCase(audit.station || nc.station || '-'),
                        toTurkishUpperCase(safePdfValue(nc.category)),
                        normalizeNcStatus(nc.status) === 'closed' ? 'KAPALI' : 'AÇIK',
                        toTurkishUpperCase(safePdfValue(getNcResponsibleTitle(nc, audit)))
                    ];
                }),
                styles: { font: 'DejaVuSans', fontStyle: 'normal', fontSize: 7.5, cellPadding: 2, valign: 'middle', textColor: [51, 65, 85], overflow: 'linebreak' },
                headStyles: { font: 'DejaVuSans', fontStyle: 'bold', fillColor: [127, 29, 29], textColor: [255, 255, 255], fontSize: 7.5 },
                columnStyles: {
                    0: { cellWidth: 14 },
                    1: { cellWidth: 18 },
                    2: { cellWidth: 25 },
                    3: { cellWidth: 12, halign: 'center' },
                    4: { cellWidth: 30 },
                    5: { cellWidth: 'auto' },
                    6: { cellWidth: 16, halign: 'center' },
                    7: { cellWidth: 35 }
                },
                alternateRowStyles: { fillColor: [254, 242, 242] },
                didParseCell: function(data) {
                    if (data.section === 'body' && data.column.index === 6) {
                        const statusStr = data.cell.raw;
                        if (statusStr === 'AÇIK') {
                            data.cell.styles.textColor = [227, 30, 36];
                            data.cell.styles.fontStyle = 'bold';
                        } else if (statusStr === 'KAPALI') {
                            data.cell.styles.textColor = [34, 197, 94];
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                    if (data.section === 'body' && data.column.index === 3) {
                        data.cell.text = '';
                    }
                },
                didDrawCell: function(data) {
                    if (data.section === 'body' && data.column.index === 3) {
                        const lineLabel = data.cell.raw || '';
                        if (lineLabel && lineLabel !== '-') {
                            const shortLabel = lineLabel.length > 3 ? lineLabel.substring(0,3) : lineLabel;
                            const lineColorHex = (typeof appData !== 'undefined' && appData.lineColors && appData.lineColors[lineLabel]) ? appData.lineColors[lineLabel] : '#0f172a';
                            const rgb = hexToRgb(lineColorHex);
                            const radius = 3.5;
                            const cx = data.cell.x + data.cell.width / 2;
                            const cy = data.cell.y + data.cell.height / 2;
                            
                            doc.setFillColor(rgb[0], rgb[1], rgb[2]);
                            doc.circle(cx, cy, radius, 'F');
                            
                            doc.setFont('DejaVuSans', 'bold');
                            doc.setFontSize(6);
                            doc.setTextColor(255, 255, 255);
                            doc.text(shortLabel, cx, cy, { align: 'center', baseline: 'middle' });
                        }
                    }
                }
            });
        }

        const imageCache = {};
        for (let i = 0; i < selectedNCs.length; i++) {
            const nc = selectedNCs[i];
            imageCache[nc.id] = await loadNCPhotosForPdf(nc);
        }

        for (let index = 0; index < selectedNCs.length; index++) {
            const nc = selectedNCs[index];
            const audit = getAccessibleAuditById(nc.auditId) || {};
            if (selectedNCs.length > 1 || index > 0) {
                doc.addPage();
            }
            await renderNCDetailsToPdf(doc, nc, audit, imageCache, 20, selectedNCs.length > 1, index + 1, selectedNCs.length);
        }

        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(6);
            setAuditPdfFont(doc, 'normal');
            setAuditPdfRgb(doc, [148, 163, 184]);
            auditPdfText(doc, 'Bu belge elektronik denetim sistemi tarafindan otomatik olarak uretilmistir.', 105, 292, { align: 'center' });
        }

        let outputFileName = `Toplu_Uygunsuzluk_Raporu_${selectedNCs.length}_kayit.pdf`;
        if (selectedNCs.length === 1) {
            const nc = selectedNCs[0];
            const audit = getAccessibleAuditById(nc.auditId) || {};
            const d = toAuditPdfDate(nc.detectionDate || nc.date || audit.date);
            const datePart = `${String(d.getDate()).padStart(2, '0')}_${String(d.getMonth() + 1).padStart(2, '0')}_${d.getFullYear()}`;
            outputFileName = `${audit.line || nc.line || 'Hat'}_${audit.station || nc.station || 'Istasyon'}_${datePart}_Uygunsuzluk_Raporu.pdf`.replace(/ /g, '_');
        }
        await handleBulkPdfOutput(doc, outputFileName, 'Toplu Uygunsuzluk Takibi Raporu', action);
    } catch (err) {
        console.error('Bulk NC PDF error:', err);
        showToast(`Toplu PDF oluşturulamadı: ${err && err.message ? err.message : 'bilinmeyen hata'}`);
    }
}

function shareBulkNCPDFs() {
    return generateBulkNCPDFs('download');
}

function downloadBulkNCPDFs() {
    return generateBulkNCPDFs('download');
}

function openAddUserModal(userId) {
    if (!hasPermission('user_add_edit')) {
        showToast('Personel ekleme / düzenleme yetkiniz yok.');
        return;
    }
    try {
        initPersonnelRoleSelect();
        populatePersonnelPickers();
        resetPersonnelForm();
        const isEdit = Boolean(userId);
        setPersonnelPasswordFieldMode(isEdit);
        const user = isEdit ? (appData.users || []).find(u => String(u.id) === String(userId)) : null;
        if (isEdit && !user) {
            showToast('Kullanıcı bulunamadı.');
            return;
        }

        document.getElementById('user-modal-title').innerText = isEdit ? 'Personeli Düzenle' : 'Yeni Personel Ekle';
        const submitBtn = document.getElementById('personnel-submit-btn');
        if (submitBtn) submitBtn.textContent = isEdit ? 'Değişiklikleri Kaydet' : 'Personeli Sisteme Kaydet';

        if (user) {
            const { firstName, lastName } = splitPersonName(user);
            document.getElementById('edit-user-id').value = user.id;
            document.getElementById('personnel-first-name').value = firstName;
            document.getElementById('personnel-last-name').value = lastName;
            document.getElementById('new-user-email').value = user.email || '';
            document.getElementById('new-user-pass').value = '********';
            document.getElementById('new-user-pass').required = false;
            document.getElementById('personnel-role-id').value = inferRbacRoleId(user);
            const titleInput = document.getElementById('personnel-title');
            if (titleInput) titleInput.value = user.title || '';
            personnelSelectedLines = Array.isArray(user.authorizedLines) ? [...user.authorizedLines] : [];
            renderPersonnelTags();
            updatePersonnelScopeUI();
        }

        document.getElementById('user-modal').style.display = 'flex';
    } catch (err) {
        console.error('Personel modalı açılırken hata:', err);
        showToast('Form açılamadı.');
    }
}

function closeUserModal() {
    document.getElementById('user-modal').style.display = 'none';
}

function editUser(id) {
    openAddUserModal(id);
}

async function processNewUser(event) {
    if (event) event.preventDefault();

    const editId = document.getElementById('edit-user-id').value;
    const firstName = document.getElementById('personnel-first-name').value.trim();
    const lastName = document.getElementById('personnel-last-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-pass').value;
    const roleId = document.getElementById('personnel-role-id').value;
    const titleVal = document.getElementById('personnel-title')?.value.trim() || '';

    if (!email) {
        showToast('Lütfen e-posta adresini girin.');
        return;
    }
    if (!roleId) {
        showToast('Lütfen bir sistem rolü seçin.');
        return;
    }

    const selectedRole = getRbacRoleById(roleId);
    if (!selectedRole) {
        showToast('Geçersiz rol seçimi.');
        return;
    }

    const isGlobalScope = selectedRole.isGlobal;
    if (!isGlobalScope && personnelSelectedLines.length === 0) {
        showToast('Bu rol için en az bir hat seçiniz.');
        return;
    }

    const normalizedEmail = email.includes('@') ? email.trim() : '';
    if (!normalizedEmail) {
        showToast('Geçerli bir Firebase e-posta adresi girin.');
        return;
    }
    if (!editId && !password) {
        showToast('Yeni personel için Firebase şifresi girin.');
        return;
    }
    if (password && password !== '********' && password.length < 6) {
        showToast('Firebase şifresi en az 6 karakter olmalıdır.');
        return;
    }

    const existingUser = editId ? (appData.users || []).find(u => String(u.id) === String(editId)) : null;
    const username = email.includes('@') ? email.split('@')[0] : email;
    const displayName = `${firstName} ${lastName}`.trim() ||
        (existingUser && existingUser.name) ||
        username.split('.').map(s => s.charAt(0).toUpperCase() + (s.slice(1) || '')).join(' ');

    const userData = {
        firstName,
        lastName,
        username,
        email: normalizedEmail || (existingUser?.email || ''),
        name: displayName,
        roleId,
        roleName: selectedRole.name,
        title: titleVal || selectedRole.name,
        role: getLegacyRoleFromRbac(roleId),
        scopeType: isGlobalScope ? 'global' : 'restricted',
        isGlobalScope,
        authorizedLines: isGlobalScope ? [] : [...personnelSelectedLines],
        authorizedStations: [],
        updatedAt: new Date().toISOString()
    };

    const submitBtn = document.getElementById('personnel-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    try {
        if (editId) {
            const wantsFirebaseAuth = password && password !== '********';
            if (wantsFirebaseAuth) {
                const firebaseUid = await ensureFirebaseAuthUser(normalizedEmail, password);
                userData.id = firebaseUid;
                userData.firebaseUid = firebaseUid;
                await db.collection('users').doc(firebaseUid).set(userData, { merge: true });
                if (editId !== firebaseUid) {
                    await db.collection('users').doc(editId).delete();
                }
                showToast('Personel ve Firebase hesabı güncellendi.');
            } else {
                userData.id = editId;
                await db.collection('users').doc(editId).update(userData);
                showToast('Personel başarıyla güncellendi.');
            }
        } else {
            const firebaseUid = await ensureFirebaseAuthUser(normalizedEmail, password);
            userData.id = firebaseUid;
            userData.firebaseUid = firebaseUid;
            await db.collection('users').doc(firebaseUid).set({
                ...userData,
                createdAt: new Date().toISOString()
            }, { merge: true });
            showToast('Firebase hesabı ve personel profili oluşturuldu.');
        }
        closeUserModal();
        renderPeople();
    } catch (err) {
        console.error('Personel kayıt hatası:', err);
        showToast('Hata: ' + (err.message || 'İşlem başarısız!'));
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function deleteUser(id) {
    if (!hasPermission('user_delete')) {
        showToast('Personel silme yetkiniz yok.');
        return;
    }
    if (confirm('Bu kullanıcıyı silmek istediğinize emin misiniz?')) {
        db.collection('users').doc(id).delete()
            .then(() => showToast('Kullanıcı silindi.'))
            .catch(err => {
                console.error('Delete User Error:', err);
                showToast('Hata oluştu!');
            });
    }
}

// Eski renderPermissions silindi, yukarıdaki drawSecurityMatrix kullanılacak.

function renderStationMatrix() {
    const container = document.getElementById('performance-matrix-container');
    if (!container) return;
    container.innerHTML = '';

    const { audits } = getFilteredDashboardData();
    if (!audits.length) {
        container.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--text-dim);font-weight:700;">Seçili filtrelere uygun denetim verisi bulunamadı.</div>`;
        return;
    }

    // Group audits by type
    const auditsByType = {};
    audits.forEach(audit => {
        const typeObj = getAuditTypeForAudit(audit);
        const typeName = typeObj?.name || typeObj?.title || audit.auditType || audit.type || 'Diğer';
        if (!auditsByType[typeName]) auditsByType[typeName] = [];
        auditsByType[typeName].push(audit);
    });

    let htmlContent = '';

    for (const [typeName, typeAudits] of Object.entries(auditsByType)) {
        const categories = [];
        
        typeAudits.forEach(a => {
            const metrics = buildAuditDetailMetrics(a);
            if (metrics.categoryAverages.length) {
                metrics.categoryAverages.forEach(item => {
                    const cName = item.categoryName || item.category || 'Genel';
                    if (!categories.includes(cName)) categories.push(cName);
                });
                return;
            }
            
            const aType = getAuditTypeForAudit(a);
            (aType?.categories || []).forEach(cat => {
                const cName = cat.name || cat.title || 'Genel';
                if (!categories.includes(cName)) categories.push(cName);
            });
        });

        const visibleCategories = categories.length ? categories : ['Kategori'];
        const typeIndex = Object.keys(auditsByType).indexOf(typeName);
        const premiumColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
        const typeColor = premiumColors[typeIndex % premiumColors.length];
        const needsScroll = typeAudits.length > 5;
        const scrollStyles = needsScroll ? 'max-height: 195px; overflow-y: auto;' : '';

        htmlContent += `
            <div style="margin-bottom: 1.5rem; background: transparent !important; border-left: 4px solid ${typeColor}; border-radius: 12px; overflow: hidden; box-shadow: none !important; width: fit-content; max-width: 100%;">
                ${typeName === 'Diğer' ? '' : `
                <div style="display: flex; align-items: center; padding: 0.6rem 1rem; background: linear-gradient(90deg, ${typeColor}15 0%, transparent 100%); border-bottom: 1px solid var(--border-main);">
                    <h4 style="margin: 0; color: var(--text-primary); font-size: 0.85rem; font-weight: 800; display: flex; align-items: center; gap: 8px;">
                        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${typeColor}; box-shadow: 0 0 6px ${typeColor}80;"></span>
                        ${escapeAttr(typeName)}
                    </h4>
                </div>
                `}
                <div style="overflow-x: auto; ${scrollStyles} padding: 0 1rem 0.5rem 1rem;" class="custom-scrollbar">
                <table style="width: max-content; border-collapse: collapse; font-size: 0.72rem; text-align: center;">
                    <thead>
                        <tr>
                            <th style="position: sticky; top: 0; background: var(--bg-body); z-index: 2; text-align:center; padding: 10px 8px 6px 8px; border-bottom: 2px solid var(--primary); color: var(--text-primary); font-weight: 800; white-space: nowrap; text-transform: uppercase;">HAT</th>
                            <th style="position: sticky; top: 0; background: var(--bg-body); z-index: 2; text-align:left; padding: 10px 8px 6px 8px; border-bottom: 2px solid var(--primary); color: var(--text-primary); font-weight: 800; white-space: nowrap; text-transform: uppercase;">İSTASYON</th>
                            ${visibleCategories.map(c => `<th style="position: sticky; top: 0; background: var(--bg-body); z-index: 2; padding: 10px 6px 6px 6px; border-bottom: 2px solid var(--primary); color: var(--text-primary); font-weight: 800; white-space: normal; line-height: 1.1; word-wrap: break-word; text-align: center; text-transform: uppercase;" title="${escapeAttr(c)}">${escapeAttr(c)}</th>`).join('')}
                            <th style="position: sticky; top: 0; background: var(--bg-body); z-index: 2; padding: 10px 8px 6px 8px; border-bottom: 2px solid var(--primary); color: var(--text-primary); font-weight: 900; white-space: nowrap; text-align: center; text-transform: uppercase;">SKOR</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        typeAudits.forEach(a => {
            const metrics = buildAuditDetailMetrics(a);
            const categoryMap = new Map(
                (metrics.categoryAverages || []).map(item => [item.categoryName || item.category || 'Genel', clampAuditPercent(item.avgPercent)])
            );
            const fallbackScores = Array.isArray(a.scores) ? a.scores.map(v => clampAuditPercent(Number(v) * 20)) : [];
            const overallScore = metrics.categoryAverages.length
                ? clampAuditPercent(metrics.overallPercent)
                : clampAuditPercent(Number(a.score) || 0);
            
            const line = a.line || '-';
            const station = a.station || '-';
            const lineColor = appData.lineColors[line] || '#64748b';

            htmlContent += `
                <tr style="border-bottom: 1px solid rgba(148, 163, 184, 0.1); transition: background 0.2s;" onmouseover="this.style.backgroundColor='rgba(59, 130, 246, 0.05)'" onmouseout="this.style.backgroundColor='transparent'">
                    <td style="text-align:center; padding: 4px 8px; vertical-align: middle;">
                        <div class="line-logo" style="background: ${lineColor}; margin: 0 auto; width: 22px; height: 22px; font-size: 0.52rem; border-radius: 50%; color: #fff; font-weight: 900; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${line}</div>
                    </td>
                    <td style="text-align:left; padding: 4px 8px; vertical-align: middle;">
                        <span style="font-weight: 750; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; display: inline-block;" title="${escapeAttr(station)}">${escapeAttr(station)}</span>
                    </td>
                    ${visibleCategories.map((c, index) => {
                        const score = categoryMap.has(c) ? categoryMap.get(c) : fallbackScores[index];
                        if (score === undefined || score === null || Number.isNaN(Number(score))) {
                            return '<td style="padding: 4px 6px; color: var(--text-dim); font-weight: 600; vertical-align: middle;">-</td>';
                        }
                        const percent = clampAuditPercent(Number(score));
                        return `<td style="padding: 4px 6px; text-align: center; vertical-align: middle;"><div style="background:${getHeatmapColor(percent)};color:white;padding:2px 4px;border-radius:4px;font-size:0.68rem;font-weight:800;display:inline-block;min-width: 26px;text-align:center;">%${percent.toFixed(0)}</div></td>`;
                    }).join('')}
                    <td style="padding: 4px 8px; text-align: center; vertical-align: middle;">
                        <strong style="color: ${overallScore > 80 ? '#16a34a' : (overallScore > 50 ? '#f59e0b' : '#ef4444')}; font-size: 0.8rem; font-weight: 900;">%${overallScore.toFixed(0)}</strong>
                    </td>
                </tr>
            `;
        });

        htmlContent += `
                    </tbody>
                </table>
                </div>
            </div>
        `;
    }

    container.innerHTML = htmlContent;
}

function updateCharts(data) {
    const chartDefaults = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
        }
    };

    const { audits: filteredAudits, ncs: filteredNCs } = getFilteredDashboardData();

    // Dashboard - Trend (Last 6 months)
    const perfCtx = document.getElementById('performanceChart')?.getContext('2d');
    if (perfCtx && filteredAudits.length > 0) {
        if (performanceChart) performanceChart.destroy();

        // Group audits by year and month for correct chronological sorting
        const monthlyGroups = {};
        filteredAudits.forEach(a => {
            const d = new Date(a.date);
            if (isNaN(d.getTime())) return;
            const year = d.getFullYear();
            const monthNum = String(d.getMonth() + 1).padStart(2, '0');
            const key = `${year}-${monthNum}`;
            if (!monthlyGroups[key]) {
                monthlyGroups[key] = {
                    label: d.toLocaleString('tr-TR', { month: 'short' }),
                    scores: []
                };
            }
            monthlyGroups[key].scores.push(a.score);
        });

        // Sort keys chronologically
        const sortedKeys = Object.keys(monthlyGroups).sort();
        const labels = sortedKeys.map(k => monthlyGroups[k].label);
        const values = sortedKeys.map(k => {
            const scores = monthlyGroups[k].scores;
            const avg = scores.reduce((sum, val) => sum + val, 0) / scores.length;
            return Number(avg.toFixed(1));
        });

        const gradient = perfCtx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');

        const isLight = document.body.classList.contains('light-mode');

        performanceChart = new Chart(perfCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    borderColor: '#8b5cf6',
                    fill: true,
                    backgroundColor: gradient,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 25, left: 10, right: 10, bottom: 5 }
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        offset: 4,
                        font: { weight: 'bold', size: 10 },
                        color: isLight ? '#1e293b' : '#f1f5f9',
                        formatter: (value) => `%${value}`
                    }
                },
                scales: {
                    y: {
                        grid: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8' },
                        suggestedMax: 100
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    // Dashboard - Category Performance
    const catCtx = document.getElementById('categoryChart')?.getContext('2d');
    if (catCtx && filteredAudits.length > 0) {
        if (categoryChart) categoryChart.destroy();

        const categoryMap = {};
        const categoryTypes = {};
        filteredAudits.forEach(audit => {
            const typeObj = getAuditTypeForAudit(audit) || {};
            const auditTypeName = typeObj.name || audit.auditType || audit.type || 'Diğer';
            const metrics = buildAuditDetailMetrics(audit);
            if (metrics.categoryAverages && metrics.categoryAverages.length > 0) {
                metrics.categoryAverages.forEach(catAvg => {
                    const name = catAvg.categoryName || 'Genel';
                    if (!categoryMap[name]) categoryMap[name] = [];
                    categoryMap[name].push(catAvg.avgPercent);
                    categoryTypes[name] = auditTypeName;
                });
            } else {
                // Fallback for legacy audits without answer-level breakdown
                const categories = ['Sınıflandırma', 'Sıralama', 'Silme', 'Standartlaştırma', 'Sahiplenme'];
                const score = Number(audit.score) || 0;
                categories.forEach(name => {
                    if (!categoryMap[name]) categoryMap[name] = [];
                    categoryMap[name].push(score);
                    categoryTypes[name] = '5S Denetimi';
                });
            }
        });

        let labels = Object.keys(categoryMap);
        if (labels.length === 0) {
            labels = ['Sınıflandırma', 'Sıralama', 'Silme', 'Standartlaştırma', 'Sahiplenme'];
            labels.forEach(name => {
                categoryMap[name] = [80];
                categoryTypes[name] = '5S Denetimi';
            });
        }

        const values = labels.map(name => {
            const avgs = categoryMap[name];
            const avg = avgs.reduce((sum, val) => sum + val, 0) / avgs.length;
            return Number(avg.toFixed(1));
        });

        const typeColors = {
            '5S Denetimi': '#f43f5e',
            'ISO 9001': '#06b6d4',
            'İSG': '#f59e0b',
            'Diğer': '#8b5cf6'
        };
        const defaultColors = ['#f43f5e', '#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#6366f1'];
        let colorIdx = 0;
        const bgColors = labels.map(name => {
            const tName = categoryTypes[name] || 'Diğer';
            if (!typeColors[tName]) {
                typeColors[tName] = defaultColors[colorIdx % defaultColors.length];
                colorIdx++;
            }
            return typeColors[tName];
        });

        const isLight = document.body.classList.contains('light-mode');

        categoryChart = new Chart(catCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Başarı Oranı (%)',
                    data: values,
                    backgroundColor: bgColors,
                    borderRadius: 6,
                    borderWidth: 0
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 10, left: 10, right: 40, bottom: 10 }
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end',
                        align: 'end',
                        offset: 4,
                        clip: false,
                        font: { weight: 'bold', size: 10 },
                        color: isLight ? '#1e293b' : '#f1f5f9',
                        formatter: (value) => `%${value}`
                    }
                },
                scales: {
                    x: {
                        grid: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: (value) => `%${value}`
                        },
                        suggestedMax: 115,
                        beginAtZero: true
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 10 } }
                    }
                }
            }
        });
    } else {
        if (categoryChart) categoryChart.destroy();
    }

    // Dashboard - Auditor Performance Horizontal List
    const auditorListContainer = document.getElementById('auditor-horizontal-list');
    if (auditorListContainer) {
        if (auditorChart) auditorChart.destroy(); // in case it existed before

        const auditorStats = {};
        
        filteredAudits.forEach(a => {
            const name = a.auditorName || 'Bilinmeyen';
            if (!auditorStats[name]) {
                auditorStats[name] = { count: 0 };
            }
            auditorStats[name].count++;
        });

        const sortedAuditors = Object.keys(auditorStats).map(name => {
            const user = getAuditorUserObject(name);
            let title = '';
            let lines = '';
            if (user) {
                title = user.title || getRbacRoleDisplayName(user) || 'Saha Denetçisi';
                if (hasGlobalScope(user)) {
                    lines = 'Tüm Hatlar';
                } else {
                    const lList = Array.isArray(user.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
                    lines = lList.length ? lList.join(', ') : 'Yetki Tanımlı Hat Yok';
                }
            } else {
                title = 'Denetçi';
                lines = 'Hat Tanımlanmamış';
            }
            return {
                name: getAuditorDisplayName(name),
                count: auditorStats[name].count,
                title,
                lines
            };
        }).sort((a, b) => b.count - a.count); // Sort descending by count

        auditorListContainer.innerHTML = sortedAuditors.length === 0 
            ? '<div style="color: var(--text-dim); padding: 1rem;">Veri bulunamadı.</div>' 
            : sortedAuditors.map((item, idx) => {
                const isPremium = idx < 3;
                
                return `
                    <div style="background: var(--bg-card); border: 1px solid ${isPremium ? 'rgba(255, 215, 0, 0.4)' : 'var(--border-main)'}; border-radius: 8px; padding: 0.5rem 0.6rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-main)'" onmouseout="this.style.background='var(--bg-card)'">
                        <div style="display: flex; align-items: center; gap: 0.6rem; overflow: hidden; flex: 1;">
                            <div style="width: 24px; height: 24px; border-radius: 50%; background: ${isPremium ? 'rgba(255, 215, 0, 0.15)' : 'var(--bg-main)'}; color: ${isPremium ? '#FFD700' : 'var(--text-secondary)'}; display: flex; justify-content: center; align-items: center; font-size: 0.7rem; font-weight: 800; flex-shrink: 0;">
                                ${idx + 1}
                            </div>
                            <div style="display: flex; flex-direction: column; overflow: hidden; flex: 1; min-width: 0; line-height: 1.15;">
                                <div style="font-size: 0.70rem; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeAttr(item.name)}">${escapeAttr(item.name)}</div>
                                <div style="font-size: 0.62rem; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;" title="${escapeAttr(item.title)}">${escapeAttr(item.title)}</div>
                                <div style="font-size: 0.58rem; color: var(--text-secondary); opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;" title="${escapeAttr(item.lines)}">${escapeAttr(item.lines)}</div>
                            </div>
                        </div>
                        <div style="font-size: 0.8rem; font-weight: 900; color: var(--primary); background: var(--bg-main); padding: 0.2rem 0.45rem; border-radius: 6px; flex-shrink: 0;">
                            ${item.count}
                        </div>
                    </div>
                `;
            }).join('');
    }

    // Stats - Monthly Trend
    const statsTrendCtx = document.getElementById('statsTrendChart')?.getContext('2d');
    if (statsTrendCtx && filteredAudits.length > 0) {
        if (statsTrendChart) statsTrendChart.destroy();

        const monthlyData = {};
        filteredAudits.forEach(a => {
            const month = new Date(a.date).toLocaleString('tr-TR', { month: 'short' });
            if (!monthlyData[month]) monthlyData[month] = [];
            monthlyData[month].push(a.score);
        });

        const labels = Object.keys(monthlyData).reverse();
        const values = labels.map(l => monthlyData[l].reduce((a, b) => a + b, 0) / monthlyData[l].length);

        statsTrendChart = new Chart(statsTrendCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Denetim Puanı',
                    data: values,
                    borderColor: '#06b6d4',
                    tension: 0.4,
                    borderWidth: 3
                }]
            },
            options: chartDefaults
        });
    }

    // Stats - Line Distribution
    const lineDistCtx = document.getElementById('statsLineDistChart')?.getContext('2d');
    if (lineDistCtx && filteredAudits.length > 0) {
        if (statsLineDistChart) statsLineDistChart.destroy();

        const lineCounts = {};
        filteredAudits.forEach(a => {
            lineCounts[a.line] = (lineCounts[a.line] || 0) + 1;
        });

        statsLineDistChart = new Chart(lineDistCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(lineCounts),
                datasets: [{
                    data: Object.values(lineCounts),
                    backgroundColor: '#8b5cf6',
                    borderRadius: 8
                }]
            },
            options: chartDefaults
        });
    }

    // Stats - NC Status (Stacked Bar per Line)
    const ncStatusCtx = document.getElementById('statsNcStatusChart')?.getContext('2d');
    if (ncStatusCtx && filteredNCs.length > 0) {
        if (statsNcStatusChart) statsNcStatusChart.destroy();

        const lineNCs = {}; // { 'M1A': { open: 0, closed: 0 } }
        filteredNCs.forEach(nc => {
            const line = nc.line || 'Diğer';
            if (!lineNCs[line]) lineNCs[line] = { open: 0, closed: 0 };
            if (nc.status === 'completed') lineNCs[line].closed++;
            else lineNCs[line].open++;
        });

        const labels = Object.keys(lineNCs);
        statsNcStatusChart = new Chart(ncStatusCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Açık', data: labels.map(l => lineNCs[l].open), backgroundColor: '#ef4444' },
                    { label: 'Tamamlanan', data: labels.map(l => lineNCs[l].closed), backgroundColor: '#10b981' }
                ]
            },
            options: { ...chartDefaults, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { display: true, labels: { color: '#94a3b8' } } } }
        });
    }

    // Stats - Category Success
    const catSuccessCtx = document.getElementById('statsCategorySuccessChart')?.getContext('2d');
    if (catSuccessCtx) {
        if (statsCategorySuccessChart) statsCategorySuccessChart.destroy();
        statsCategorySuccessChart = new Chart(catSuccessCtx, {
            type: 'radar',
            data: {
                labels: ['Kategori 1', 'Kategori 2', 'Kategori 3', 'Kategori 4', 'Kategori 5'],
                datasets: [{
                    label: 'Başarı %',
                    data: [85, 70, 92, 80, 75],
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    borderWidth: 2
                }]
            },
            options: {
                ...chartDefaults,
                plugins: { legend: { display: false } },
                scales: {
                    r: {
                        angleLines: { color: 'rgba(255,255,255,0.1)' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        pointLabels: { color: '#94a3b8', font: { size: 10 } },
                        ticks: { display: false }
                    }
                }
            }
        });
    }
}

// Dynamic Reporting Engine
let dynamicChartInstance;

function generateDynamicReport() {
    const metric = document.getElementById('stats-metric').value;
    const group = document.getElementById('stats-group').value;
    const type = document.getElementById('stats-type').value;

    const { labels, values, title, tableData } = getReportData(metric, group);

    // Show container and update title
    const container = document.getElementById('dynamic-result-container');
    if (container) container.style.display = 'block';

    document.getElementById('dynamic-report-title').innerText = title;

    const chartWrap = document.querySelector('#dynamic-result-container .chart-container');
    const tableWrap = document.getElementById('dynamic-table-container');

    if (type === 'table') {
        renderDynamicTable(tableData);
        if (chartWrap) chartWrap.style.display = 'none';
        if (tableWrap) tableWrap.style.display = 'block';
    } else {
        renderDynamicChart(labels, values, type, title);
        if (chartWrap) chartWrap.style.display = 'block';
        if (tableWrap) tableWrap.style.display = 'none';
    }
}

function getReportData(metric, group) {
    let data = {};
    let title = '';
    const audits = getFilteredAudits();
    const nonconformities = getFilteredNCs();

    // Grouping & Data Logic
    audits.forEach(audit => {
        let key = audit[group] || 'Diğer';

        if (group === 'month') {
            key = new Date(audit.date).toLocaleString('tr-TR', { month: 'long' });
        } else if (group === 'auditor') {
            key = audit.auditorName;
        }

        data[key] = data[key] || [];

        // Metric Logic
        if (metric === 'audit_count' || metric === 'audits') {
            data[key].push(1);
        } else if (metric === 'scores' || metric === 'line_ranking') {
            data[key].push(audit.score);
        } else if (metric === 'audit_types') {
            const type = audit.id.startsWith('AUD-2') ? 'Planlı' : 'Plansız';
            data[type] = data[type] || [];
            data[type].push(1);
        } else if (metric.startsWith('nc_')) {
            const lineNCs = nonconformities.filter(n => n.line === audit.line);
            if (metric === 'nc_count') data[key].push(lineNCs.length);
            else if (metric === 'nc_open') data[key].push(lineNCs.filter(n => n.status === 'open').length);
            else if (metric === 'nc_overdue') data[key].push(lineNCs.filter(n => n.status === 'overdue').length);
            else if (metric === 'nc_completed') data[key].push(lineNCs.filter(n => n.status === 'completed').length);
        } else if (metric === 'station_count') {
            const lineStations = appData.stations[audit.line] || [];
            data[key] = data[key] || [];
            if (!data[key].includes(audit.station)) {
                data[key].push(audit.station);
            }
        } else if (metric === 'category_perf' || metric === 'success_matrix') {
            if (audit.answers && Array.isArray(audit.answers)) {
                audit.answers.forEach(ans => {
                    const q = resolveAuditAnswerQuestion(audit, ans);
                    let c = (q ? q.categoryName : 'DİĞER').toUpperCase();
                    
                    // Unified Mapping to User Preferred Terms
                    if (c.includes('AYIKLA') || c.includes('SINIF')) c = 'SINIFLANDIRMA';
                    if (c.includes('DÜZEN') || c.includes('SIRALA')) c = 'SIRALAMA';
                    if (c.includes('TEMİZ') || c.includes('SİLME')) c = 'SİLME';
                    if (c.includes('STANDART')) c = 'STANDARTLAŞTIRMA';
                    if (c.includes('SAHİP') || c.includes('DİSİP')) c = 'SAHİPLENME';

                    data[c] = data[c] || [];
                    data[c].push(Number(ans.score) * 20); // Normalize to 100%
                });
            } else {
                const cats = ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME'];
                cats.forEach((c, i) => {
                    data[c] = data[c] || [];
                    data[c].push(audit.scores ? Number(audit.scores[i]) * 20 : Number(audit.score));
                });
            }
        } else if (metric === 'auditor_perf') {
            data[audit.auditorName] = data[audit.auditorName] || [];
            data[audit.auditorName].push(audit.score);
        }
    });

    // Special handling for success_matrix to always use table
    if (metric === 'success_matrix') {
        const labels = Object.keys(data).filter(k => ['Ayıklama', 'Düzen', 'Temizlik', 'Standart.', 'Disiplin'].includes(k));
        const values = labels.map(k => (data[k].reduce((a, b) => a + b, 0) / data[k].length).toFixed(1));
        return {
            labels, values,
            title: 'KURUMSAL BAŞARI MATRİSİ',
            tableData: labels.map((l, i) => ({ label: l, value: values[i] }))
        };
    }

    const labels = Object.keys(data);
    const values = labels.map(k => {
        if (['audits', 'audit_count', 'station_count', 'audit_types', 'nc_count', 'nc_open', 'nc_overdue', 'nc_completed'].includes(metric)) {
            if (metric === 'station_count') return data[k].length;
            return data[k].reduce((a, b) => a + b, 0);
        }
        return (data[k].reduce((a, b) => a + b, 0) / (data[k].length || 1)).toFixed(1);
    });

    const metricNames = {
        audits: 'Denetim Sayısı', audit_count: 'Toplam Denetim', station_count: 'İstasyon Sayısı',
        scores: 'Ortalama Başarı (%)', audit_types: 'Denetim Tipi',
        nc_count: 'Toplam Hata', nc_open: 'Açık Hatalar', nc_overdue: 'Gecikmiş Hatalar',
        nc_completed: 'Tamamlanan Hatalar', category_perf: 'Kategori Başarı',
        auditor_perf: 'Denetçi Başarısı', line_ranking: 'Sıralama Puanı'
    };

    title = `${metricNames[metric] || metric.toUpperCase()} - ${group.toUpperCase()} ANALİZİ`;

    return {
        labels,
        values,
        title,
        tableData: labels.map((l, i) => ({ label: l, value: values[i] }))
    };
}

// Register DataLabels plugin globally
Chart.register(ChartDataLabels);

function renderDynamicChart(labels, values, type, title) {
    const ctx = document.getElementById('dynamicChart').getContext('2d');
    if (dynamicChartInstance) dynamicChartInstance.destroy();

    const defaultColors = ['#8b5cf6', '#06b6d4', '#f43f5e', '#f59e0b', '#10b981', '#6366f1', '#ec4899'];

    // Map labels to line colors if they are line names
    const chartColors = labels.map((label, i) => {
        return appData.lineColors[label] || defaultColors[i % defaultColors.length];
    });

    const isLight = document.body.classList.contains('light-mode');
    const labelColor = isLight ? '#475569' : '#cbd5e1';
    const gridColor = isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)';
    const isPercentage = title.toLowerCase().includes('puan') || title.toLowerCase().includes('başarı') || title.toLowerCase().includes('%');

    dynamicChartInstance = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: title,
                data: values,
                backgroundColor: type === 'pie' || type === 'radar'
                    ? chartColors.map(c => c + '66')
                    : (type === 'bar' ? chartColors.map(c => c + '99') : chartColors[0] + '44'),
                borderColor: type === 'line' ? chartColors[0] : chartColors,
                borderWidth: 2,
                borderRadius: type === 'bar' ? 8 : 0,
                fill: type === 'radar' || type === 'line'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 20 },
            plugins: {
                legend: { display: type === 'pie' || type === 'radar', labels: { color: labelColor, font: { weight: '600' } } },
                datalabels: {
                    color: document.body.classList.contains('light-mode') ? chartColors[0] : '#ffffff',
                    anchor: 'end',
                    align: 'top',
                    offset: 5,
                    font: { weight: 'bold', size: 11 },
                    formatter: (value) => isPercentage ? value + '%' : value,
                    display: (context) => context.dataset.data[context.dataIndex] > 0
                }
            },
            scales: type !== 'pie' && type !== 'radar' ? {
                y: {
                    beginAtZero: true,
                    grace: '15%',
                    grid: { color: gridColor },
                    ticks: { display: false }
                },
                x: { grid: { display: false }, ticks: { color: labelColor, font: { size: 9 } } }
            } : {}
        }
    });
}

function renderDynamicTable(tableData) {
    const head = document.getElementById('dynamic-table-head');
    const body = document.querySelector('#dynamic-table tbody');
    const group = document.getElementById('stats-group').value;

    head.innerHTML = '<th>Grup / Detay</th><th>Değer</th><th>İlerleme</th>';
    body.innerHTML = '';

    tableData.forEach(item => {
        const tr = document.createElement('tr');
        const progress = Math.min(100, parseFloat(item.value) || 0);
        const isLine = group === 'line' && appData.lineColors[item.label];
        const logoHtml = isLine ? `<div class="line-logo" style="background: ${appData.lineColors[item.label]}; margin-right: 10px;">${item.label}</div>` : '';

        tr.innerHTML = `
            <td style="font-weight: 600; vertical-align: middle;">
                <div style="display: flex; align-items: center;">
                    ${logoHtml}
                    <span>${item.label}</span>
                </div>
            </td>
            <td style="font-weight: 800; color: var(--primary);">${item.value}</td>
            <td style="width: 200px;">
                <div style="width: 100%; height: 6px; background: var(--bg-input); border-radius: 10px; overflow: hidden;">
                    <div style="width: ${progress}%; height: 100%; background: linear-gradient(to right, var(--primary), var(--secondary));"></div>
                </div>
            </td>
        `;
        body.appendChild(tr);
    });
}

function exportCurrentStats() {
    showToast('Rapor dışa aktarılıyor...');
}

let savedReports = [];

function addReportToDashboard() {
    const metric = document.getElementById('stats-metric').value;
    const group = document.getElementById('stats-group').value;
    const type = document.getElementById('stats-type').value;

    const reportId = 'report-' + Date.now();
    const { labels, values, title, tableData } = getReportData(metric, group);

    const reportObj = { id: reportId, metric, group, type, labels, values, title, tableData };
    savedReports.push(reportObj);

    const grid = document.getElementById('saved-reports-grid');
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.id = `card-${reportId}`;
    card.style.animation = 'fadeIn 0.5s ease forwards';

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3 style="font-size: 0.9rem; color: var(--text-primary);">${title}</h3>
            <i class="fas fa-times" onclick="removeReport('${reportId}')" style="cursor: pointer; color: var(--text-secondary); padding: 5px;"></i>
        </div>
        <div class="chart-container" style="height: 250px; background: transparent; border: none; padding: 0;">
            ${type === 'table' ? '<div class="table-wrapper-small"></div>' : `<canvas id="canvas-${reportId}"></canvas>`}
        </div>
    `;

    grid.appendChild(card);

    if (type === 'table') {
        const tableWrapper = card.querySelector('.table-wrapper-small');
        renderSmallTable(tableWrapper, tableData);
    } else {
        renderSavedChart(reportId, labels, values, type, title);
    }
}

function renderSavedChart(id, labels, values, type, title) {
    const ctx = document.getElementById(`canvas-${id}`).getContext('2d');
    const defaultColors = ['#8b5cf6', '#06b6d4', '#f43f5e', '#f59e0b', '#10b981', '#6366f1', '#ec4899'];
    const isLight = document.body.classList.contains('light-mode');
    const labelColor = isLight ? '#475569' : '#cbd5e1';

    // Map labels to line colors if they are line names
    const chartColors = labels.map((label, i) => {
        return appData.lineColors[label] || defaultColors[i % defaultColors.length];
    });

    new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: title,
                data: values,
                backgroundColor: type === 'pie' || type === 'radar'
                    ? chartColors.map(c => c + '66')
                    : (type === 'bar' ? chartColors.map(c => c + '99') : chartColors[0] + '44'),
                borderColor: type === 'line' ? chartColors[0] : chartColors,
                borderWidth: 2,
                borderRadius: type === 'bar' ? 8 : 0,
                fill: type === 'radar' || type === 'line'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 15 },
            plugins: {
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    font: { weight: 'bold', size: 11 },
                    display: (context) => context.dataset.data[context.dataIndex] > 0
                }
            },
            scales: type !== 'pie' && type !== 'radar' ? {
                y: {
                    beginAtZero: true,
                    grace: '15%',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { display: false }
                },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 9 } } }
            } : {}
        }
    });
}

function renderSmallTable(container, data) {
    container.innerHTML = `
        <table style="width: 100%; font-size: 0.8rem;">
            <thead><tr><th>Grup</th><th>Değer</th></tr></thead>
            <tbody>
                ${data.slice(0, 5).map(item => `<tr><td>${item.label}</td><td>${item.value}</td></tr>`).join('')}
            </tbody>
        </table>
    `;
}

function removeReport(id) {
    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();
    savedReports = savedReports.filter(r => r.id !== id);
}

// Settings & Theme Logic
function getSystemSettings() {
    return { ...DEFAULT_SYSTEM_SETTINGS, ...(appData.settings || {}) };
}

function setSettingValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
        el.checked = Boolean(value);
    } else {
        el.value = value ?? '';
    }
}

function getSettingValue(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return Number(el.value || fallback || 0);
    return el.value;
}

function renderSettings() {
    const settings = getSystemSettings();
    const localDarkMode = localStorage.getItem('darkMode');
    const darkMode = localDarkMode !== null ? (localDarkMode === 'true') : (settings.themePreferenceSaved ? Boolean(settings.darkMode) : true);
    
    // Auto-fix: if global settings in Firestore is false, but default is true, and the admin logs in, update DB to true
    if (settings.darkMode === false && hasPermission('settings')) {
        db.collection('system_config').doc('settings').set({
            darkMode: true,
            themePreferenceSaved: true
        }, { merge: true }).then(() => {
            console.log('Global dark mode database setting auto-corrected to true');
        }).catch(err => {
            console.error('Failed to auto-correct global dark mode setting:', err);
        });
    }

    setSettingValue('settings-dark-mode', darkMode);
    document.body.classList.toggle('light-mode', !darkMode);
    updateThemeIcon();
    setSettingValue('setting-auto-sync', settings.autoSync);
    setSettingValue('setting-org-name', settings.orgName);
    setSettingValue('setting-panel-title', settings.panelTitle);
    setSettingValue('setting-language', settings.language);
    setSettingValue('setting-pass-score', settings.passScore);
    setSettingValue('setting-critical-threshold', settings.criticalThreshold);
    setSettingValue('setting-audit-period', settings.auditPeriod);
    setSettingValue('setting-signature-required', settings.signatureRequired);
    setSettingValue('setting-nc-close-days', settings.ncCloseDays);
    setSettingValue('setting-nc-warning-days', settings.ncWarningDays);
    setSettingValue('setting-nc-approval-required', settings.ncApprovalRequired);
    setSettingValue('setting-reopen-rejected', settings.reopenRejected);
    setSettingValue('setting-report-format', settings.reportFormat);
    setSettingValue('setting-report-footer', settings.reportFooter);
    setSettingValue('setting-report-logo', settings.reportLogo);
    setSettingValue('setting-report-evidence', settings.reportEvidence);
    setSettingValue('setting-overdue-alerts', settings.overdueAlerts);
    setSettingValue('setting-plan-reminders', settings.planReminders);
    setSettingValue('setting-reminder-time', settings.reminderTime);
    setSettingValue('setting-offline-cache', settings.offlineCache);
    setSettingValue('setting-retention-months', settings.retentionMonths);
}

function collectSystemSettings() {
    return {
        darkMode: getSettingValue('settings-dark-mode', false),
        themePreferenceSaved: true,
        autoSync: getSettingValue('setting-auto-sync', true),
        orgName: getSettingValue('setting-org-name', 'Metro İstanbul').trim(),
        panelTitle: getSettingValue('setting-panel-title', 'Denetim Sistemi').trim(),
        language: getSettingValue('setting-language', 'tr'),
        passScore: Math.min(100, Math.max(0, getSettingValue('setting-pass-score', 80))),
        criticalThreshold: Math.min(10, Math.max(1, getSettingValue('setting-critical-threshold', 3))),
        auditPeriod: getSettingValue('setting-audit-period', 'monthly'),
        signatureRequired: getSettingValue('setting-signature-required', false),
        ncCloseDays: Math.min(365, Math.max(1, getSettingValue('setting-nc-close-days', 15))),
        ncWarningDays: Math.min(30, Math.max(0, getSettingValue('setting-nc-warning-days', 3))),
        ncApprovalRequired: getSettingValue('setting-nc-approval-required', true),
        reopenRejected: getSettingValue('setting-reopen-rejected', true),
        reportFormat: getSettingValue('setting-report-format', 'pdf'),
        reportFooter: getSettingValue('setting-report-footer', 'Metro İstanbul Denetim Sistemi').trim(),
        reportLogo: getSettingValue('setting-report-logo', true),
        reportEvidence: getSettingValue('setting-report-evidence', true),
        overdueAlerts: getSettingValue('setting-overdue-alerts', true),
        planReminders: getSettingValue('setting-plan-reminders', true),
        reminderTime: getSettingValue('setting-reminder-time', '09:00'),
        offlineCache: getSettingValue('setting-offline-cache', true),
        retentionMonths: Math.min(120, Math.max(1, getSettingValue('setting-retention-months', 36))),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || currentUser?.username || currentUser?.name || 'system'
    };
}

// ── Settings Page Handlers ──

function loadSettingsPage() {
    const s = appData.settings || {};
    // Dark mode
    const dmEl = document.getElementById('settings-dark-mode');
    if (dmEl) dmEl.checked = !document.body.classList.contains('light-mode');
    // Compact sidebar
    const csEl = document.getElementById('settings-compact-sidebar');
    if (csEl) csEl.checked = document.querySelector('.sidebar')?.classList.contains('compact') || false;
    // Default page
    const dpEl = document.getElementById('settings-default-page');
    if (dpEl) dpEl.value = localStorage.getItem('defaultPage') || 'dashboard-view';
    // Low score threshold
    const lsEl = document.getElementById('settings-low-score');
    if (lsEl) lsEl.value = localStorage.getItem('lowScoreThreshold') || '60';
    // Planning year
    const pyEl = document.getElementById('settings-planning-year');
    if (pyEl) pyEl.value = localStorage.getItem('planningYear') || '2026';
    // Hakkında stats
    const taEl = document.getElementById('settings-total-audits');
    if (taEl) taEl.textContent = (getFilteredAudits() || []).length;
    const tpEl = document.getElementById('settings-total-people');
    if (tpEl) tpEl.textContent = (appData.users || []).length;
    const dsEl = document.getElementById('settings-data-size');
    if (dsEl) {
        try {
            const bytes = new Blob([JSON.stringify(appData)]).size;
            dsEl.textContent = bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
        } catch(e) { dsEl.textContent = '-'; }
    }
}

function handleSettingsDarkMode(el) {
    const isDark = el.checked;
    if (isDark) {
        document.body.classList.remove('light-mode');
        localStorage.setItem('darkMode', 'true');
        showToast('Karanlık mod aktif');
    } else {
        document.body.classList.add('light-mode');
        localStorage.setItem('darkMode', 'false');
        showToast('Aydınlık mod aktif');
    }
    
    // Save globally if user has settings permission
    if (hasPermission('settings')) {
        db.collection('system_config').doc('settings').set({
            darkMode: isDark,
            themePreferenceSaved: true
        }, { merge: true }).catch(err => {
            console.error('Global theme save error:', err);
        });
    }
    
    setTimeout(() => { renderAll(); }, 100);
}

function handleCompactSidebar(el) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    if (el.checked) {
        sidebar.classList.add('compact');
        localStorage.setItem('compactSidebar', 'true');
    } else {
        sidebar.classList.remove('compact');
        localStorage.setItem('compactSidebar', 'false');
    }
    updateSidebarToggleIcon(el.checked);
}

function toggleSidebarCompact() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const isCompactNow = sidebar.classList.toggle('compact');
    localStorage.setItem('compactSidebar', isCompactNow ? 'true' : 'false');
    
    // Sync settings checkbox if present
    const csEl = document.getElementById('settings-compact-sidebar');
    if (csEl) csEl.checked = isCompactNow;
    
    updateSidebarToggleIcon(isCompactNow);
}

function updateSidebarToggleIcon(isCompact) {
    const icon = document.getElementById('sidebar-toggle-icon');
    if (!icon) return;
    if (isCompact) {
        icon.className = 'fas fa-chevron-right'; // Points right to expand
    } else {
        icon.className = 'fas fa-chevron-left'; // Points left to collapse
    }
}

function handleDefaultPage(el) {
    localStorage.setItem('defaultPage', el.value);
    showToast('Varsayılan sayfa kaydedildi');
}

function handleLowScoreThreshold(el) {
    localStorage.setItem('lowScoreThreshold', el.value);
    showToast('Düşük skor eşiği: %' + el.value);
}

function handlePlanningYear(el) {
    localStorage.setItem('planningYear', el.value);
    showToast('Planlama başlangıç yılı: ' + el.value);
}

function exportAllDataJSON() {
    const payload = {
        exportedAt: new Date().toISOString(),
        settings: appData.settings || {},
        lines: appData.lines || [],
        lineColors: appData.lineColors || {},
        stations: appData.stations || {},
        users: appData.users || [],
        audits: hasGlobalScope(currentUser) ? (appData.audits || []) : getFilteredAudits(),
        nonconformities: hasGlobalScope(currentUser) ? (appData.nonconformities || []) : getFilteredNCs(),
        plans: appData.plans || [],
        questionGroups: appData.questionGroups || [],
        questions: appData.questions || [],
        auditTypes: appData.auditTypes || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `denetim_sistemi_yedek_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Tüm veri JSON olarak indirildi.');
}

function importAllDataJSON(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!confirm('Bu işlem mevcut tüm verilerin üzerine yazacaktır. Devam edilsin mi?')) return;
            // Restore fields
            if (data.lines) appData.lines = data.lines;
            if (data.lineColors) appData.lineColors = data.lineColors;
            if (data.stations) appData.stations = data.stations;
            if (data.users) appData.users = data.users;
            if (data.audits) appData.audits = data.audits;
            if (data.nonconformities) appData.nonconformities = data.nonconformities;
            if (data.plans) appData.plans = data.plans;
            if (data.questionGroups) appData.questionGroups = data.questionGroups;
            if (data.questions) appData.questions = data.questions;
            if (data.auditTypes) appData.auditTypes = data.auditTypes;
            if (data.settings) appData.settings = data.settings;
            saveData();
            renderAll();
            loadSettingsPage();
            showToast('Veri başarıyla içe aktarıldı! Sayfa yenileniyor...');
            setTimeout(() => location.reload(), 1500);
        } catch(err) {
            console.error('Import error:', err);
            showToast('JSON dosyası okunamadı!');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

function clearAllData() {
    if (!confirm('DİKKAT: Tüm denetim, personel, soru ve ayar verileri silinecektir.\n\nBu işlem GERİ ALINAMAZ!\n\nDevam etmek istiyor musunuz?')) return;
    if (!confirm('Son onay: Gerçekten TÜM VERİLERİ silmek istiyor musunuz?')) return;
    appData.audits = [];
    appData.users = [];
    appData.nonconformities = [];
    appData.plans = [];
    appData.questionGroups = [];
    appData.questions = [];
    appData.auditTypes = [];
    saveData();
    showToast('Tüm veriler silindi. Sayfa yenileniyor...');
    setTimeout(() => location.reload(), 1500);
}

// Keep legacy toggleDarkMode for backward compat
function toggleDarkMode() {
    const isDark = !document.body.classList.contains('light-mode');
    const nextDark = !isDark;
    if (nextDark) {
        document.body.classList.remove('light-mode');
        localStorage.setItem('darkMode', 'true');
    } else {
        document.body.classList.add('light-mode');
        localStorage.setItem('darkMode', 'false');
    }
    const dmEl = document.getElementById('settings-dark-mode');
    if (dmEl) dmEl.checked = nextDark;
    updateThemeIcon();
    
    // Save globally if user has settings permission
    if (hasPermission('settings')) {
        db.collection('system_config').doc('settings').set({
            darkMode: nextDark,
            themePreferenceSaved: true
        }, { merge: true }).catch(err => {
            console.error('Global theme save error:', err);
        });
    }

    setTimeout(() => { renderAll(); }, 100);
}

function updateThemeIcon() {
    const icon = document.getElementById('theme-toggle-icon');
    if (!icon) return;
    const isDark = !document.body.classList.contains('light-mode');
    if (isDark) {
        icon.className = 'fas fa-sun';
        icon.parentElement.title = 'Aydınlık Moda Geç';
    } else {
        icon.className = 'fas fa-moon';
        icon.parentElement.title = 'Karanlık Moda Geç';
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type && type !== 'success') {
        toast.classList.add(type);
    }

    let iconClass = 'fa-check-circle';
    if (type === 'warning') {
        iconClass = 'fa-exclamation-triangle';
    } else if (type === 'error') {
        iconClass = 'fa-times-circle';
    } else if (type === 'info') {
        iconClass = 'fa-info-circle';
    }

    toast.innerHTML = `<i class="fas ${iconClass}"></i> ${message}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    const duration = type === 'success' ? 3000 : 4500;
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Ensure reports are only generated when requested
document.addEventListener('DOMContentLoaded', () => {
    // Removed automatic generateDynamicReport call to keep dashboard clean
});




function renderLinesLegacy() {
    // Obsolete first implementation. Overridden by renderLines below.
}

// ─── FIREBASE LINES/STATIONS SYNC ───



function openAddLineModal() {
    document.getElementById('line-modal-title').textContent = 'Yeni Hat Tanımla';
    document.getElementById('line-edit-old-name').value = '';
    document.getElementById('line-name-input').value = '';
    document.getElementById('line-color-input').value = '#2196F3';
    document.getElementById('line-color-hex').value = '#2196F3';
    document.getElementById('line-name-input').disabled = false;
    document.getElementById('line-modal').style.display = 'flex';

    // Sync color picker <-> hex input
    document.getElementById('line-color-input').oninput = function() {
        document.getElementById('line-color-hex').value = this.value;
    };
    document.getElementById('line-color-hex').oninput = function() {
        if (/^#[0-9A-Fa-f]{6}$/.test(this.value)) {
            document.getElementById('line-color-input').value = this.value;
        }
    };
}

function openEditLineModal(lineName) {
    const color = appData.lineColors[lineName] || '#2196F3';
    document.getElementById('line-modal-title').textContent = `"${lineName}" Hattını Düzenle`;
    document.getElementById('line-edit-old-name').value = lineName;
    document.getElementById('line-name-input').value = lineName;
    document.getElementById('line-name-input').disabled = true;
    document.getElementById('line-color-input').value = color;
    document.getElementById('line-color-hex').value = color;
    document.getElementById('line-modal').style.display = 'flex';

    document.getElementById('line-color-input').oninput = function() {
        document.getElementById('line-color-hex').value = this.value;
    };
    document.getElementById('line-color-hex').oninput = function() {
        if (/^#[0-9A-Fa-f]{6}$/.test(this.value)) {
            document.getElementById('line-color-input').value = this.value;
        }
    };
}

function closeLineModal() {
    document.getElementById('line-modal').style.display = 'none';
}

async function processLineSave() {
    const oldName = document.getElementById('line-edit-old-name').value;
    const lineName = document.getElementById('line-name-input').value.trim().toUpperCase();
    let color = document.getElementById('line-color-hex').value.trim();

    if (!lineName) {
        showToast('Lütfen hat adını giriniz.');
        return;
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        color = document.getElementById('line-color-input').value;
    }

    if (oldName) {
        // Edit mode: update color
        appData.lineColors[oldName] = color;
        showToast(`"${oldName}" hattının rengi güncellendi.`);
    } else {
        // Add mode
        if (appData.lineColors[lineName]) {
            showToast(`"${lineName}" hattı zaten mevcut!`);
            return;
        }
        appData.lineColors[lineName] = color;
        appData.lines.push(lineName);
        appData.stations[lineName] = [];
        if (!appData.stationNumbers) appData.stationNumbers = {};
        appData.stationNumbers[lineName] = {};
        showToast(`"${lineName}" hattı başarıyla eklendi!`);
    }

    await saveLinesStationsToFirebase();
    closeLineModal();
}

async function removeLineFromFirebase(lineName) {
    if (!confirm(`"${lineName}" hattını ve tüm istasyonlarını silmek istediğinize emin misiniz?`)) return;

    delete appData.lineColors[lineName];
    appData.lines = (appData.lines || []).filter(line => {
        const value = typeof line === 'string' ? line : String(line?.id || line?.name || '');
        return value !== lineName;
    });
    delete appData.stations[lineName];
    if (appData.stationNumbers) delete appData.stationNumbers[lineName];

    await saveLinesStationsToFirebase();
    showToast(`"${lineName}" hattı silindi.`);
}

function closeStationModal() {
    document.getElementById('station-modal').style.display = 'none';
}

function viewStationsLegacy(lineName) {
    // Obsolete first implementation. Overridden by viewStations below.
}

// Final override: route all future question-bank operations through AuditType.categories.







// Final question add overrides: this file has legacy duplicates above.


// Final audit type selector override: active end-of-file copy.

// Final audit type selector override: active end-of-file copy.

// Final audit type selector override.



// New audit data model: AuditType -> Category -> Question.
// Legacy question groups are kept only as a temporary compatibility source.
const AUDIT_MODEL_VERSION = 2;

function toStableId(prefix, text) {
    const slug = String(text || prefix)
        .toLocaleLowerCase('tr-TR')
        .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${prefix}-${slug || Date.now()}`;
}

function normalizeAuditModelQuestion(question = {}, category = {}, auditType = {}) {
    const id = question.id || toStableId('question', question.text || question.questionText || question.title);
    const type = question.type || question.answerType || ((auditType.allowedAnswerTypes || []).includes('boolean') ? 'yes-no' : '5s-score');
    return {
        ...question,
        id,
        text: question.text || question.questionText || question.title || '',
        questionText: question.questionText || question.text || question.title || '',
        type,
        answerType: type === 'yes-no' ? 'boolean' : (question.answerType || 'scale'),
        auditTypeId: question.auditTypeId || auditType.id,
        categoryId: question.categoryId || category.id,
        categoryName: question.categoryName || category.name || 'Genel',
        groupId: question.groupId || category.id,
        orderIndex: Number(question.orderIndex) || 0,
        isActive: question.isActive !== false,
        isDeleted: question.isDeleted === true
    };
}

function normalizeAuditModelCategory(category = {}, auditType = {}) {
    const id = category.id || toStableId('category', category.name || category.title);
    const normalized = {
        ...category,
        id,
        auditTypeId: category.auditTypeId || auditType.id,
        name: category.name || category.title || 'Kategori',
        orderIndex: Number(category.orderIndex) || 0,
        isActive: category.isActive !== false,
        isDeleted: category.isDeleted === true
    };
    normalized.questions = (category.questions || [])
        .map(question => normalizeAuditModelQuestion(question, normalized, auditType))
        .filter(question => !question.isDeleted);
    return normalized;
}


function hasAuditTypeCategories() {
    return (appData.auditTypes || []).some(type => Array.isArray(type.categories) && type.categories.length);
}

function deriveCompatibilityCollectionsFromAuditTypes() {
    if (!hasAuditTypeCategories()) return;
    const groups = [];
    const questions = [];

    (appData.auditTypes || []).forEach(type => {
        (type.categories || []).forEach((category, categoryIndex) => {
            groups.push({
                id: category.id,
                auditTypeId: type.id,
                name: category.name,
                title: category.name,
                icon: category.icon || 'fa-layer-group',
                orderIndex: category.orderIndex ?? categoryIndex,
                isActive: category.isActive !== false,
                isDeleted: category.isDeleted === true,
                isCompatibilityCategory: true,
                weight: category.weight !== undefined ? Number(category.weight) : 1.0
            });
            (category.questions || []).forEach((question, questionIndex) => {
                questions.push(normalizeQuestionBankQuestion({
                    ...question,
                    auditTypeId: type.id,
                    groupId: category.id,
                    categoryId: category.id,
                    categoryName: category.name,
                    questionText: question.text || question.questionText,
                    answerType: question.answerType || (question.type === 'yes-no' ? 'boolean' : 'scale'),
                    orderIndex: question.orderIndex ?? questionIndex
                }));
            });
        });
    });

    appData.questionGroups = groups;
    appData.questions = questions;
    if (!appData.selectedAuditTypeId && appData.auditTypes.length) appData.selectedAuditTypeId = appData.auditTypes[0].id;
    if (!appData.selectedGroupId && groups.length) appData.selectedGroupId = groups[0].id;
}

function buildCategoriesFromLegacyGroups(auditTypeId) {
    const legacyGroups = (appData.legacyQuestionGroups || appData.questionGroups || [])
        .filter(group => !group.isDeleted && String(group.auditTypeId || auditTypeId) === String(auditTypeId))
        .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
    const legacyQuestions = appData.legacyQuestions || appData.questions || [];

    return legacyGroups.map((group, groupIndex) => normalizeAuditModelCategory({
        id: group.id,
        auditTypeId,
        name: group.name || group.title || 'Kategori',
        icon: group.icon,
        orderIndex: group.orderIndex ?? groupIndex,
        questions: legacyQuestions
            .filter(question => String(question.groupId) === String(group.id) && !question.isDeleted)
            .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0))
            .map(question => ({
                ...question,
                text: question.text || question.questionText || question.title,
                type: question.type || (question.answerType === 'boolean' ? 'yes-no' : '5s-score')
            }))
    }, { id: auditTypeId, allowedAnswerTypes: [] }));
}

async function migrateOldQuestionGroupsToAuditTypes() {
    if (window.__auditModelMigrationRunning) return;
    if (!Array.isArray(appData.auditTypes) || appData.auditTypes.length === 0) return;
    if (!(appData.legacyQuestionGroups || []).length || !(appData.legacyQuestions || []).length) return;

    window.__auditModelMigrationRunning = true;
    try {
        for (const type of appData.auditTypes) {
            if ((type.categories || []).filter(c => !c.isDeleted).length) continue;
            const categories = buildCategoriesFromLegacyGroups(type.id);
            if (!categories.length) continue;

            await db.collection('auditTypes').doc(type.id).set({
                ...type,
                name: type.name || type.title,
                defaultAnswerValue: type.defaultAnswerValue ?? (isStationAuditTypeId(type.id) ? true : 5),
                categories,
                modelVersion: AUDIT_MODEL_VERSION,
                migratedFromQuestionGroupsAt: new Date().toISOString()
            }, { merge: true });
            type.categories = categories;
            type.modelVersion = AUDIT_MODEL_VERSION;
        }
        deriveCompatibilityCollectionsFromAuditTypes();
        renderQuestionGroups();
        if (appData.selectedGroupId) renderQuestions(appData.selectedGroupId);
    } catch (err) {
        console.error('Audit model migration error:', err);
    } finally {
        window.__auditModelMigrationRunning = false;
    }
}

function getQuestionsForAuditType(auditTypeId) {
    const type = (appData.auditTypes || []).find(item => String(item.id) === String(auditTypeId));
    if (!type?.categories?.length) return [];
    return type.categories.flatMap(category => (category.questions || []).map(question => normalizeQuestionBankQuestion({
        ...question,
        auditTypeId: type.id,
        groupId: category.id,
        categoryId: category.id,
        categoryName: category.name,
        questionText: question.text || question.questionText,
        answerType: question.answerType || (question.type === 'yes-no' ? 'boolean' : 'scale')
    }))).filter(question => !question.isDeleted && question.isActive !== false);
}



// Dashboard/NC counters: count only real, active nonconformity records.
function getActiveNonconformities() {
    const auditsLoaded = appData.auditsLoaded === true;
    const auditIds = new Set((appData.audits || []).map(a => String(a.id)));

    return (appData.nonconformities || []).filter(nc => {
        if (!nc) return false;
        if (nc.isDeleted === true || nc.deleted === true || nc.deletedAt) return false;
        if (nc.isDemo === true || nc.isMock === true || nc.mock === true || nc.sample === true) return false;

        const id = String(nc.id || '').toLocaleLowerCase('tr-TR');
        if (id.startsWith('mock') || id.startsWith('demo') || id.startsWith('sample')) return false;

        const auditId = nc.auditId ? String(nc.auditId) : '';
        if (!auditId) return false;
        if (!auditsLoaded) return false;
        return auditIds.has(auditId);
    });
}

function normalizeNcStatus(status) {
    const key = String(status || '').trim().toLocaleLowerCase('tr-TR');
    if (['completed', 'closed', 'kapalı', 'kapali', 'kapatıldı', 'kapatildi', 'tamamlandı', 'tamamlandi'].includes(key)) return 'completed';
    if (['overdue', 'geciken', 'gecikmiş', 'gecikmis'].includes(key)) return 'overdue';
    if (['waitingcontrol', 'waiting_control', 'kontrol', 'kontrol bekliyor', 'beklemede', 'onay bekliyor'].includes(key)) return 'waitingControl';
    if (['open', 'inprogress', 'in_progress', 'açık', 'acik', 'devam ediyor'].includes(key)) return 'open';
    return key || 'unknown';
}

function isNcClosed(nc) {
    return normalizeNcStatus(nc?.status) === 'completed';
}

function isNcWaitingControl(nc) {
    return normalizeNcStatus(nc?.status) === 'waitingControl';
}

function isNcOverdue(nc) {
    if (normalizeNcStatus(nc?.status) === 'overdue') return true;
    if (!nc?.dueDate || isNcClosed(nc) || isNcWaitingControl(nc)) return false;
    const dueDate = new Date(nc.dueDate);
    if (Number.isNaN(dueDate.getTime())) return false;
    return dueDate < new Date();
}

function isNcOpen(nc) {
    return normalizeNcStatus(nc?.status) === 'open' && !isNcOverdue(nc);
}

function closeCustomStationModal() {
    const modal = document.getElementById('custom-station-modal');
    if (modal) modal.remove();
}

function openStationFormModal(lineName, oldName = '', oldNo = 1, callback) {
    closeCustomStationModal();
    
    const color = appData.lineColors?.[lineName] || '#2563eb';
    const isEdit = oldName !== '';
    
    // Retrieve NFC data
    const nfcKey = `${lineName}_${oldName}`;
    const nfcData = (appData.stationNfcs && appData.stationNfcs[nfcKey]) || { uid: '' };
    const oldNfcUid = nfcData.uid || '';
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'custom-station-modal';
    modalDiv.className = 'modal-overlay station-form-modal';
    modalDiv.style.display = 'flex';
    
    // Generate options for station numbers 1 to 99
    let optionsHtml = '';
    for (let i = 1; i <= 99; i++) {
        optionsHtml += `<option value="${i}" ${i === oldNo ? 'selected' : ''}>${i}</option>`;
    }
    
    modalDiv.innerHTML = `
        <div class="modal-content station-form-dialog" style="max-width: 400px; padding: 0; border-radius: 20px;">
            <div class="modal-header station-form-header" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border-main);">
                <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--primary);">${isEdit ? 'İstasyonu Düzenle' : 'Yeni İstasyon Ekle'}</h3>
                <i class="fas fa-times close-modal" onclick="closeCustomStationModal()" style="cursor: pointer; color: var(--text-secondary); font-size: 1.1rem;"></i>
            </div>
            <div class="modal-body station-form-body" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <div class="station-form-line-context" style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.25rem;">
                    <div class="line-logo" style="background:${escapeAttr(color)}; margin: 0; width: 28px; height: 28px; font-size: 0.65rem;">${escapeAttr(lineName)}</div>
                    <span style="font-weight: 800; color: var(--text-primary); font-size: 0.9rem;">${escapeAttr(lineName)} Hattı</span>
                </div>
                
                <div class="input-group">
                    <label style="display: block; font-size: 0.72rem; font-weight: 800; color: var(--text-secondary); margin-bottom: 0.45rem; text-transform: uppercase; letter-spacing: 0.8px;">İstasyon Numarası</label>
                    <select id="station-form-no" 
                            style="width: 100%; padding: 11px 14px; border-radius: 10px; border: 1px solid var(--border-main); background: var(--bg-input); color: var(--text-primary); font-size: 0.95rem; font-weight: 700; box-sizing: border-box;">
                        ${optionsHtml}
                    </select>
                </div>
                
                <div class="input-group">
                    <label style="display: block; font-size: 0.72rem; font-weight: 800; color: var(--text-secondary); margin-bottom: 0.45rem; text-transform: uppercase; letter-spacing: 0.8px;">İstasyon Adı</label>
                    <input type="text" id="station-form-name" placeholder="Örn: Üsküdar" value="${escapeAttr(oldName)}" 
                           style="width: 100%; padding: 11px 14px; border-radius: 10px; border: 1px solid var(--border-main); background: var(--bg-input); color: var(--text-primary); font-size: 0.95rem; font-weight: 700; box-sizing: border-box;">
                </div>

                <div class="input-group">
                    <label style="display: block; font-size: 0.72rem; font-weight: 800; color: var(--text-secondary); margin-bottom: 0.45rem; text-transform: uppercase; letter-spacing: 0.8px;">NFC Kart Uid (Kart ID)</label>
                    <input type="text" id="station-form-nfc-uid" placeholder="Örn: 04:A2:F3:8A:25:60:80" value="${escapeAttr(oldNfcUid)}" 
                           style="width: 100%; padding: 11px 14px; border-radius: 10px; border: 1px solid var(--border-main); background: var(--bg-input); color: var(--text-primary); font-size: 0.95rem; font-weight: 700; box-sizing: border-box;">
                </div>
            </div>
            <div class="modal-footer station-form-footer" style="padding: 1.25rem 1.5rem; border-top: 1px solid var(--border-main); display: flex; justify-content: flex-end; gap: 0.75rem; background: var(--bg-input); border-bottom-left-radius: 20px; border-bottom-right-radius: 20px;">
                <button class="btn-secondary" onclick="closeCustomStationModal()" style="height: 36px; padding: 0 1.25rem; font-size: 0.8rem; font-weight: 700; border-radius: 8px;">Vazgeç</button>
                <button class="btn-primary" id="station-form-submit-btn" style="height: 36px; padding: 0 1.25rem; font-size: 0.8rem; font-weight: 700; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;">
                    <i class="fas fa-save"></i> Kaydet
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalDiv);
    
    // Focus on the name input
    const nameInput = document.getElementById('station-form-name');
    if (nameInput) nameInput.focus();
    
    // Submit button handler
    document.getElementById('station-form-submit-btn').onclick = () => {
        const noVal = parseInt(document.getElementById('station-form-no').value, 10);
        const nameVal = document.getElementById('station-form-name').value.trim();
        const nfcUidVal = document.getElementById('station-form-nfc-uid').value.trim();
        
        if (Number.isNaN(noVal) || noVal < 1) {
            showToast('Lütfen geçerli bir istasyon numarası giriniz.');
            return;
        }
        if (!nameVal) {
            showToast('Lütfen istasyon adı giriniz.');
            return;
        }
        
        callback(nameVal, noVal, nfcUidVal);
        closeCustomStationModal();
    };
}

function addStationToLine(lineName) {
    if (!appData.stations[lineName]) appData.stations[lineName] = [];
    appData.stations[lineName] = appData.stations[lineName].map(getLineStationName).filter(Boolean);
    
    // Suggest the next number in sequence
    let nextNo = 1;
    const stationNums = appData.stationNumbers?.[lineName] || {};
    const numbers = Object.values(stationNums);
    if (numbers.length > 0) {
        nextNo = Math.max(...numbers) + 1;
    }

    openStationFormModal(lineName, '', nextNo, (name, no, nfcUid) => {
        if (appData.stations[lineName].includes(name)) {
            showToast(`"${name}" istasyonu zaten mevcut!`);
            return;
        }

        if (!appData.stationNumbers) appData.stationNumbers = {};
        if (!appData.stationNumbers[lineName]) appData.stationNumbers[lineName] = {};

        appData.stations[lineName].push(name);
        appData.stationNumbers[lineName][name] = no;

        // Save NFC data
        if (!appData.stationNfcs) appData.stationNfcs = {};
        appData.stationNfcs[`${lineName}_${name}`] = { uid: nfcUid };

        saveLinesStationsToFirebase();
        showToast(`"${name}" istasyonu "${lineName}" hattına eklendi.`);
        viewStations(lineName);
    });
}

async function editStationInLine(lineName, stationName) {
    if (!appData.stations[lineName]) return;
    appData.stations[lineName] = appData.stations[lineName].map(getLineStationName).filter(Boolean);
    
    const currentNo = appData.stationNumbers?.[lineName]?.[stationName] ?? 1;

    openStationFormModal(lineName, stationName, currentNo, async (name, no, nfcUid) => {
        // Remove old name
        appData.stations[lineName] = appData.stations[lineName].filter(s => s !== stationName);
        if (appData.stationNumbers && appData.stationNumbers[lineName]) {
            delete appData.stationNumbers[lineName][stationName];
        } else {
            if (!appData.stationNumbers) appData.stationNumbers = {};
            if (!appData.stationNumbers[lineName]) appData.stationNumbers[lineName] = {};
        }

        // Remove old NFC & Location data
        const oldLocation = appData.stationLocations?.[`${lineName}_${stationName}`];
        if (appData.stationNfcs) {
            delete appData.stationNfcs[`${lineName}_${stationName}`];
        } else {
            appData.stationNfcs = {};
        }
        if (appData.stationLocations) {
            delete appData.stationLocations[`${lineName}_${stationName}`];
        } else {
            appData.stationLocations = {};
        }

        // Add new name
        if (!appData.stations[lineName].includes(name)) {
            appData.stations[lineName].push(name);
        }
        appData.stationNumbers[lineName][name] = no;

        // Add new NFC & Location data
        appData.stationNfcs[`${lineName}_${name}`] = { uid: nfcUid };
        if (oldLocation) {
            appData.stationLocations[`${lineName}_${name}`] = oldLocation;
        }

        await saveLinesStationsToFirebase();
        showToast(`"${stationName}" istasyonu güncellendi.`);
        viewStations(lineName);

        // If the station name has changed, migrate existing records in Firestore
        if (name !== stationName) {
            console.log(`Station name changed from ${stationName} to ${name}. Migrating records...`);
            const collectionsToMigrate = ['audits', 'nonconformities', 'plans'];
            for (const colName of collectionsToMigrate) {
                try {
                    const snapshot = await db.collection(colName)
                         .where('line', '==', lineName)
                        .where('station', '==', stationName)
                        .get();
                    for (const doc of snapshot.docs) {
                        await db.collection(colName).doc(doc.id).update({
                            station: name
                        });
                        console.log(`Updated ${colName} doc ${doc.id} station to ${name}`);
                    }
                } catch (e) {
                    console.error(`Error migrating ${colName} to new station name:`, e);
                }
            }
        }
    });
}

async function removeStationFromFirebase(lineName, stationName) {
    if (!confirm(`"${stationName}" istasyonunu silmek istediğinize emin misiniz?`)) return;

    if (appData.stations[lineName]) {
        appData.stations[lineName] = appData.stations[lineName].map(getLineStationName).filter(Boolean);
        appData.stations[lineName] = appData.stations[lineName].filter(s => s !== stationName);
        if (appData.stationNumbers && appData.stationNumbers[lineName]) {
            delete appData.stationNumbers[lineName][stationName];
        }
        if (appData.stationNfcs) {
            delete appData.stationNfcs[`${lineName}_${stationName}`];
        }
        if (appData.stationLocations) {
            delete appData.stationLocations[`${lineName}_${stationName}`];
        }
        await saveLinesStationsToFirebase();
        showToast(`"${stationName}" istasyonu silindi.`);
        viewStations(lineName);
    }
}

// User management logic is handled in the earlier section of the file.

function handleGlobalSearch(e) {
    if (e.key === 'Enter') {
        const q = e.target.value;
        if (q) {
            switchView('nc-management-view');
            const searchInput = document.getElementById('nc-search-input');
            if (searchInput) {
                searchInput.value = q;
                renderNCs();
            }
        }
    }
}

function handleClosePhotoSelect(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Limit to 3 files total
    const remainingSlots = 3 - selectedClosePhotos.length;
    if (remainingSlots <= 0) {
        showToast('En fazla 3 adet kanıt fotoğrafı ekleyebilirsiniz.');
        return;
    }

    const filesToAdd = files.slice(0, remainingSlots);
    selectedClosePhotos = selectedClosePhotos.concat(filesToAdd);

    renderClosePhotoPreviews();
}

function removeClosePhoto(index) {
    selectedClosePhotos.splice(index, 1);
    renderClosePhotoPreviews();
    
    // Also reset input so that the same files can be re-selected if deleted
    const input = document.getElementById('nc-photo-input');
    if (input) input.value = '';
}

function renderClosePhotoPreviews() {
    const previewsContainer = document.getElementById('nc-photo-previews');
    if (!previewsContainer) return;

    previewsContainer.innerHTML = selectedClosePhotos.map((file, index) => {
        const localUrl = URL.createObjectURL(file);
        return `
            <div class="nc-photo-preview-item" style="position: relative; width: 68px; height: 68px; border-radius: 8px; border: 1px solid var(--border-main); overflow: hidden; background: var(--bg-input);">
                <img src="${localUrl}" style="width: 100%; height: 100%; object-fit: cover;" alt="Önizleme">
                <button type="button" onclick="removeClosePhoto(${index})" style="position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(239, 68, 68, 0.85); border: none; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#ef4444'" onmouseout="this.style.background='rgba(239, 68, 68, 0.85)'">
                    <i class="fas fa-times" style="font-size: 0.6rem;"></i>
                </button>
            </div>
        `;
    }).join('');

    const btn = document.getElementById('nc-photo-btn');
    if (btn) {
        if (selectedClosePhotos.length > 0) {
            btn.innerHTML = `<i class="fas fa-check-circle" style="color: #10b981; font-size: 1.5rem; margin-bottom: 0.5rem;"></i><span style="font-size: 0.8rem; font-weight: 600; color: #10b981;">Fotoğraf Eklendi (${selectedClosePhotos.length}/3)</span>`;
            btn.style.borderColor = '#10b981';
            btn.style.background = 'rgba(16, 185, 129, 0.05)';
        } else {
            btn.innerHTML = '<i class="fas fa-camera" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i><span style="font-size: 0.8rem; font-weight: 600;">Kanıt Fotoğrafı Ekle</span>';
            btn.style.borderColor = '';
            btn.style.background = '';
        }
    }
}

// ─── QUESTION BANK MANAGEMENT ───


function dedupeVisibleQuestionGroups(groups) {
    const selectedType = getQuestionBankAuditType(appData.selectedAuditTypeId);
    const is5SType = String(selectedType.title || selectedType.name || '').toLocaleUpperCase('tr-TR').includes('5S');
    const seen = new Set();
    const required5SCategories = ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME'];
    const hasAll5SCategories = required5SCategories.every(category =>
        groups.some(group =>
            (String(group.id || '').startsWith('5s-group-') || String(group.id || '').startsWith('virtual-5s-')) &&
            String(group.name || group.title || '').toLocaleUpperCase('tr-TR') === category
        )
    );

    return groups
        .slice()
        .sort((a, b) => getQuestionCountForGroup(b.id) - getQuestionCountForGroup(a.id))
        .filter(group => {
        const name = String(group.name || group.title || '').trim();
        const upperName = name.toLocaleUpperCase('tr-TR');
        const isMigrated5SCategory = String(group.id || '').startsWith('5s-group-') || String(group.id || '').startsWith('virtual-5s-');

        if (is5SType && hasAll5SCategories && upperName.includes('5S') && !isMigrated5SCategory) {
            return false;
        }

        const key = is5SType ? upperName : String(group.id || upperName);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    })
        .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
}

function getQuestionCountForGroup(groupId) {
    return (appData.questions || []).filter(q => String(q.groupId) === String(groupId) && !q.isDeleted).length;
}

function buildVisibleQuestionGroups(groups) {
    const selectedType = getQuestionBankAuditType(appData.selectedAuditTypeId);
    const is5SType = String(selectedType.title || selectedType.name || '').toLocaleUpperCase('tr-TR').includes('5S');
    if (!is5SType) return dedupeVisibleQuestionGroups(groups);

    const sourceGroup = groups.find(group => {
        const name = String(group.name || group.title || '').toLocaleUpperCase('tr-TR');
        const questions = getQuestionsForGroup(group.id);
        const categories = [...new Set(questions.map(q => q.categoryName || 'Genel'))];
        return name.includes('5S') && questions.length >= 30 && categories.length > 1;
    });

    if (!sourceGroup) return dedupeVisibleQuestionGroups(groups);

    const required5SCategories = ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME'];
    const splitGroups = required5SCategories.map((categoryName, index) => ({
        ...sourceGroup,
        id: `virtual-5s-${sourceGroup.id}-${index}`,
        sourceGroupId: sourceGroup.id,
        virtualCategoryName: categoryName,
        name: categoryName,
        title: categoryName,
        icon: {
            'SINIFLANDIRMA': 'fa-boxes-stacked',
            'SIRALAMA': 'fa-list-check',
            'SİLME': 'fa-broom',
            'STANDARTLAŞTIRMA': 'fa-clipboard-list',
            'SAHİPLENME': 'fa-handshake'
        }[categoryName] || 'fa-folder-open',
        orderIndex: index
    }));

    const nonSourceGroups = groups.filter(group => String(group.id) !== String(sourceGroup.id));
    return dedupeVisibleQuestionGroups([...splitGroups, ...nonSourceGroups]);
}


function parseVirtual5SGroupId(groupId) {
    const text = String(groupId || '');
    if (!text.startsWith('virtual-5s-')) return null;
    const parts = text.split('-');
    const index = Number(parts[parts.length - 1]);
    const sourceGroupId = parts.slice(2, -1).join('-');
    const categories = ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME'];
    return { sourceGroupId, categoryName: categories[index] };
}


// Modals
function openAddGroupModal() {
    document.getElementById('new-group-name').value = '';
    document.getElementById('new-group-icon').value = 'fa-clipboard-check';
    document.getElementById('group-modal').style.display = 'flex';
}

function closeGroupModal() {
    document.getElementById('group-modal').style.display = 'none';
}


function closeQuestionModal() {
    document.getElementById('question-modal').style.display = 'none';
}

// Processing


async function deleteQuestionGroup(id) {
    if(!confirm('Bu soru grubunu silmek istediğinize emin misiniz? (İçindeki tüm sorular da silinecektir)')) return;
    
    try {
        // Soft delete embedded category in auditTypes
        const auditTypeId = await deleteEmbeddedAuditTypeCategory(id);
        
        // Delete group from compatibility collections
        await db.collection('question_groups').doc(id).delete();
        await db.collection('auditQuestionGroups').doc(id).delete();
        
        // Delete nested questions
        const nested = (appData.questions || []).filter(q => q.groupId === id);
        for(let q of nested) {
            await db.collection('questions').doc(q.id).delete();
            await db.collection('auditQuestions').doc(q.id).delete();
        }
        
        if (appData.selectedGroupId === id) {
            appData.selectedGroupId = null;
            document.getElementById('selected-group-questions').style.display = 'none';
        }
        
        // Refresh local data & render
        deriveCompatibilityCollectionsFromAuditTypes();
        renderQuestionGroups();
        
        showToast('Grup silindi.');

        if (auditTypeId) {
            checkAndWarnCategoryWeights(auditTypeId);
        }
    } catch (err) {
        console.error('Delete group error:', err);
        showToast('Hata oluştu!');
    }
}

async function deleteQuestion(id) {
    if(!confirm('Bu soruyu silmek istediğinize emin misiniz?')) return;
    try {
        await deleteEmbeddedAuditTypeQuestion(id);
        await db.collection('questions').doc(id).delete();
        await db.collection('auditQuestions').doc(id).delete();
        deriveCompatibilityCollectionsFromAuditTypes();
        renderQuestionGroups();
        if (appData.selectedGroupId) renderQuestions(appData.selectedGroupId);
        showToast('Soru silindi.');
    } catch (err) {
        console.error('Delete question error:', err);
        showToast('Hata oluştu!');
    }
}

function renderRoleComparisonChart(audits) {
    const canvas = document.getElementById('roleComparisonChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!audits.length) {
        if (window.roleComparisonChartStats instanceof Chart) window.roleComparisonChartStats.destroy();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    // We filter for a specific station if selected, otherwise show an example
    const lineFilters = getMultiSelectValues('filter-stats-line');
    const stationFilters = getMultiSelectValues('filter-stats-station');
    
    let targetStation = stationFilters.length ? stationFilters[0] : 'all';
    if (targetStation === 'all' && audits.length) {
        // Find a station that has audits or fallback
        targetStation = audits[0].station;
    }

    const roles = RBAC_ROLES.map(role => role.name);
    const roleScores = {};

    roles.forEach(r => {
        const rAudits = audits.filter(a => a.station === targetStation && (a.auditorRole === r || a.role === r));
        if (rAudits.length > 0) {
            roleScores[r] = rAudits.reduce((s, v) => s + (Number(v.score) || 0), 0) / rAudits.length;
        }
    });
    const visibleRoles = roles.filter(r => roleScores[r] != null);
    if (!visibleRoles.length) {
        if (window.roleComparisonChartStats instanceof Chart) window.roleComparisonChartStats.destroy();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (window.roleComparisonChartStats instanceof Chart) window.roleComparisonChartStats.destroy();
    window.roleComparisonChartStats = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: visibleRoles,
            datasets: [{
                data: visibleRoles.map(r => roleScores[r]),
                backgroundColor: visibleRoles.map((_, index) => ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#06b6d4', '#ef4444'][index % 6]),
                borderRadius: 8,
                barThickness: 50
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 30, bottom: 10 } },
            plugins: {
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    formatter: (value) => value.toFixed(1),
                    font: { weight: '900', size: 13 },
                    color: (ctx) => ctx.dataset.backgroundColor[ctx.dataIndex]
                }
            },
            scales: {
                y: { beginAtZero: true, max: 120, display: false },
                x: { grid: { display: false }, ticks: { font: { weight: '700', size: 10 } } }
            }
        }
    });
}
// Removed duplicate seedDefaultGeneralQuestions

// Final web-panel overrides restored from the agreed admin UI state.
function getUserDisplayName(user) {
    return user.name || user.fullName || user.displayName || user.username || (user.email || 'Personel').split('@')[0];
}

function getUserUsername(user) {
    return user.username || (user.email ? user.email.split('@')[0] : '') || getUserDisplayName(user);
}

// Turkish character normalization for locale-insensitive matching
function normalizeTurkish(str) {
    if (!str) return '';
    return str
        .replace(/ı/g, 'i').replace(/İ/g, 'I')
        .replace(/ş/g, 's').replace(/Ş/g, 'S')
        .replace(/ç/g, 'c').replace(/Ç/g, 'C')
        .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
        .replace(/ü/g, 'u').replace(/Ü/g, 'U')
        .replace(/ö/g, 'o').replace(/Ö/g, 'O')
        .toLowerCase().trim();
}

function getAuditorDisplayName(auditorName) {
    if (!auditorName || auditorName === 'Bilinmeyen' || auditorName === 'Bilinmiyor') return auditorName;
    const searchName = normalizeTurkish(auditorName);
    const user = (appData.users || []).find(u => {
        const username = normalizeTurkish(u.username || '');
        const name = normalizeTurkish(u.name || '');
        const fullName = normalizeTurkish(u.fullName || '');
        const emailPrefix = u.email ? normalizeTurkish(u.email.split('@')[0] || '') : '';
        const searchPrefix = searchName.split('@')[0];
        
        return username === searchName || 
               name === searchName || 
               fullName === searchName ||
               (emailPrefix && emailPrefix === searchPrefix);
    });
    return user ? getUserDisplayName(user) : auditorName;
}

function getAuditorUserObject(auditorName) {
    if (!auditorName || auditorName === 'Bilinmeyen' || auditorName === 'Bilinmiyor') return null;
    const searchName = normalizeTurkish(auditorName);
    return (appData.users || []).find(u => {
        const username = normalizeTurkish(u.username || '');
        const name = normalizeTurkish(u.name || '');
        const fullName = normalizeTurkish(u.fullName || '');
        const emailPrefix = u.email ? normalizeTurkish(u.email.split('@')[0] || '') : '';
        const searchPrefix = searchName.split('@')[0];
        
        return username === searchName || 
               name === searchName || 
               fullName === searchName ||
               (emailPrefix && emailPrefix === searchPrefix);
    });
}

function getUserAuthorityValue(user) {
    if (user?.roleId) return user.roleId;
    return inferRbacRoleId(user) || 'Field_Auditor';
}

function getUserAuthorityLabel(user) {
    return getRbacRoleDisplayName(user);
}

function escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function jsArg(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function parseAnnouncementDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateTimeLocalValue(value) {
    const date = parseAnnouncementDate(value) || new Date();
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatAnnouncementDate(value) {
    const date = parseAnnouncementDate(value);
    if (!date) return '-';
    return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeAnnouncement(raw = {}) {
    const targetLines = Array.isArray(raw.targetLines)
        ? raw.targetLines.map(item => String(item).trim()).filter(Boolean)
        : Array.isArray(raw.lines)
            ? raw.lines.map(item => String(item).trim()).filter(Boolean)
            : [];

    return {
        ...raw,
        title: raw.title || 'Duyuru',
        message: raw.message || raw.body || '',
        targetLines: [...new Set(targetLines)],
        isActive: raw.isActive !== false
    };
}


function isAnnouncementExpired(announcement) {
    const end = parseAnnouncementDate(announcement?.endAt);
    return Boolean(end && end.getTime() <= Date.now());
}


function isAnnouncementsViewVisible() {
    const view = document.getElementById('announcements-view');
    return Boolean(view && view.style.display !== 'none');
}

function refreshAnnouncementStatuses() {
    cleanupExpiredAnnouncements();
    if (isAnnouncementsViewVisible()) {
        renderAnnouncements();
    }
}

function initAnnouncementAutoRefresh() {
    if (window.__announcementAutoRefreshTimer) return;
    window.__announcementAutoRefreshTimer = setInterval(refreshAnnouncementStatuses, 5000);
}


function populateAnnouncementLinePicker() {
    const picker = document.getElementById('announcement-line-picker');
    if (!picker) return;
    const allLines = Array.isArray(appData.lines) && appData.lines.length ? appData.lines : Object.keys(appData.lineColors || {});
    const available = allLines.filter(line => !announcementSelectedLines.includes(line));
    picker.innerHTML = '<option value="">Hat seçip ekleyin...</option>' +
        available.map(line => `<option value="${escapeAttr(line)}">${escapeAttr(line)}</option>`).join('');
    picker.disabled = document.getElementById('announcement-all-lines-input')?.checked === true;
}

function renderAnnouncementTags() {
    const tags = document.getElementById('announcement-lines-tags');
    if (!tags) return;
    tags.innerHTML = announcementSelectedLines.map(line =>
        `<span class="personnel-tag"><span>${escapeAttr(line)}</span><button type="button" onclick="removeAnnouncementLine('${jsArg(line)}')" aria-label="Kaldır">×</button></span>`
    ).join('');
    populateAnnouncementLinePicker();
}

function addAnnouncementLineFromPicker(selectEl) {
    const value = selectEl?.value;
    if (value && !announcementSelectedLines.includes(value)) {
        announcementSelectedLines.push(value);
        renderAnnouncementTags();
    }
    if (selectEl) selectEl.value = '';
}

function removeAnnouncementLine(line) {
    announcementSelectedLines = announcementSelectedLines.filter(item => item !== line);
    renderAnnouncementTags();
}

function toggleAnnouncementLineScope() {
    const allLines = document.getElementById('announcement-all-lines-input')?.checked === true;
    if (allLines) announcementSelectedLines = [];
    renderAnnouncementTags();
}


function closeAnnouncementModal() {
    const modal = document.getElementById('announcement-modal');
    if (modal) modal.style.display = 'none';
}


function deleteAnnouncement(id) {
    if (!hasPermission('announcement_mgmt')) {
        showToast('Duyuru silme yetkiniz yok.');
        return;
    }
    if (!confirm('Bu duyuruyu silmek istediğinize emin misiniz?')) return;
    db.collection('announcements').doc(id).delete()
        .then(() => showToast('Duyuru silindi.'))
        .catch(err => {
            console.error('Announcement delete error:', err);
            showToast('Duyuru silinemedi.');
        });
}

function getAnnouncementStatus(announcement) {
    const now = Date.now();
    const start = parseAnnouncementDate(announcement?.startAt)?.getTime() || 0;
    const end = parseAnnouncementDate(announcement?.endAt)?.getTime() || 0;

    if (end && end <= now) return { label: 'Süresi Doldu', color: '#ef4444', icon: 'fa-clock-rotate-left' };
    if (!announcement?.isActive) {
        return { label: 'Pasif', color: '#64748b', icon: 'fa-pause-circle' };
    }
    if (start > now) return { label: 'Planlandı', color: '#f59e0b', icon: 'fa-calendar-alt' };
    return { label: 'Aktif', color: '#10b981', icon: 'fa-circle-check' };
}

function cleanupExpiredAnnouncements() {
    if (!hasPermission('announcement_mgmt') || window.__announcementCleanupRunning) return;
    const expired = (appData.announcements || []).filter(item => item?.isActive !== false && isAnnouncementExpired(item));
    if (!expired.length) return;

    window.__announcementCleanupRunning = true;
    Promise.allSettled(expired.map(item => db.collection('announcements').doc(item.id).set({
        isActive: false,
        updatedAt: new Date(),
        updatedBy: currentUser?.id || currentUser?.email || '',
        autoDeactivatedAt: new Date()
    }, { merge: true }))).finally(() => {
        window.__announcementCleanupRunning = false;
    });
}


function openAnnouncementModal(id) {
    if (!hasPermission('announcement_mgmt')) {
        showToast('Duyuru yönetimi yetkiniz yok.');
        return;
    }

    const announcement = id
        ? (appData.announcements || []).find(item => String(item.id) === String(id))
        : null;

    document.getElementById('announcement-edit-id').value = announcement?.id || '';
    document.getElementById('announcement-modal-title').textContent = announcement ? 'Duyuruyu Düzenle' : 'Yeni Duyuru';
    document.getElementById('announcement-title-input').value = announcement?.title || '';
    document.getElementById('announcement-message-input').value = announcement?.message || '';
    document.getElementById('announcement-active-input').value = announcement?.isActive === false ? 'false' : 'true';

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    document.getElementById('announcement-start-input').value = toDateTimeLocalValue(announcement?.startAt || now);
    document.getElementById('announcement-end-input').value = toDateTimeLocalValue(announcement?.endAt || tomorrow);

    announcementSelectedLines = announcement?.targetLines?.length ? [...announcement.targetLines] : [];
    document.getElementById('announcement-all-lines-input').checked = Boolean(announcement && announcementSelectedLines.length === 0);
    renderAnnouncementTags();

    document.getElementById('announcement-modal').style.display = 'flex';
}

async function processAnnouncement(event) {
    if (event) event.preventDefault();
    if (!hasPermission('announcement_mgmt')) {
        showToast('Duyuru kaydetme yetkiniz yok.');
        return;
    }

    const editId = document.getElementById('announcement-edit-id')?.value || '';
    const title = document.getElementById('announcement-title-input')?.value.trim();
    const message = document.getElementById('announcement-message-input')?.value.trim();
    const startValue = document.getElementById('announcement-start-input')?.value;
    const endValue = document.getElementById('announcement-end-input')?.value;
    const existingAnnouncement = editId
        ? (appData.announcements || []).find(item => String(item.id) === String(editId))
        : null;
    const isActive = existingAnnouncement
        ? existingAnnouncement.isActive !== false
        : document.getElementById('announcement-active-input')?.value !== 'false';
    const allLines = document.getElementById('announcement-all-lines-input')?.checked === true;
    const targetLines = allLines ? [] : [...announcementSelectedLines];

    if (!title || !message) {
        showToast('Başlık ve duyuru metni zorunludur.');
        return;
    }
    if (!allLines && targetLines.length === 0) {
        showToast('En az bir hat seçin veya tüm hatları işaretleyin.');
        return;
    }

    const startAt = new Date(startValue);
    const endAt = new Date(endValue);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        showToast('Geçerli başlangıç ve bitiş zamanı girin.');
        return;
    }
    if (endAt <= startAt) {
        showToast('Bitiş zamanı başlangıçtan sonra olmalıdır.');
        return;
    }

    const payload = {
        title,
        message,
        targetLines,
        startAt,
        endAt,
        isActive,
        updatedAt: new Date(),
        updatedBy: currentUser?.id || currentUser?.email || ''
    };

    const submitBtn = document.getElementById('announcement-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    try {
        if (editId) {
            await db.collection('announcements').doc(editId).set(payload, { merge: true });
            showToast('Duyuru güncellendi.');
        } else {
            await db.collection('announcements').add({
                ...payload,
                createdAt: new Date(),
                createdBy: currentUser?.id || currentUser?.email || ''
            });
            showToast('Duyuru oluşturuldu.');
        }
        closeAnnouncementModal();
    } catch (err) {
        console.error('Announcement save error:', err);
        showToast('Duyuru kaydedilemedi.');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function toggleAnnouncementStatus(id, nextActive) {
    if (!hasPermission('announcement_mgmt')) {
        showToast('Duyuru durumu güncelleme yetkiniz yok.');
        return;
    }

    const announcement = (appData.announcements || []).find(item => String(item.id) === String(id));
    if (!announcement) {
        showToast('Duyuru bulunamadı.');
        return;
    }

    if (nextActive && isAnnouncementExpired(announcement)) {
        showToast('Süresi dolan duyuruyu aktifleştirmek için önce bitiş tarihini güncelleyin.');
        return;
    }

    try {
        await db.collection('announcements').doc(id).set({
            isActive: nextActive,
            updatedAt: new Date(),
            updatedBy: currentUser?.id || currentUser?.email || '',
            autoDeactivatedAt: nextActive ? null : (announcement.autoDeactivatedAt || null)
        }, { merge: true });
        showToast(nextActive ? 'Duyuru aktif edildi.' : 'Duyuru pasife alındı.');
    } catch (err) {
        console.error('Announcement status toggle error:', err);
        showToast('Duyuru durumu güncellenemedi.');
    }
}

function getAnnouncementStatusKey(announcement) {
    if (isAnnouncementExpired(announcement)) return 'expired';
    if (announcement?.isActive === false) return 'inactive';
    const start = parseAnnouncementDate(announcement?.startAt)?.getTime() || 0;
    return start > Date.now() ? 'scheduled' : 'active';
}

function renderAnnouncements() {
    const container = document.getElementById('announcements-list');
    if (!container) return;

    const announcements = (appData.announcements || []).map(normalizeAnnouncement);
    const statusCounts = { active: 0, scheduled: 0, inactive: 0, expired: 0 };
    announcements.forEach(item => {
        statusCounts[getAnnouncementStatusKey(item)] += 1;
    });

    const summaryValues = {
        'announcement-total-count': announcements.length,
        'announcement-active-count': statusCounts.active,
        'announcement-scheduled-count': statusCounts.scheduled,
        'announcement-inactive-count': statusCounts.inactive,
        'announcement-expired-count': statusCounts.expired
    };
    Object.entries(summaryValues).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });

    const query = (document.getElementById('announcement-search-input')?.value || '')
        .toLocaleLowerCase('tr-TR')
        .trim();
    const statusFilter = document.getElementById('announcement-status-filter')?.value || 'all';
    const visibleAnnouncements = announcements.filter(announcement => {
        const statusKey = getAnnouncementStatusKey(announcement);
        const matchesStatus = statusFilter === 'all' || statusKey === statusFilter;
        const searchableText = [
            announcement.title,
            announcement.message,
            ...(announcement.targetLines || []),
            getAnnouncementStatus(announcement).label
        ].join(' ').toLocaleLowerCase('tr-TR');
        return matchesStatus && (!query || searchableText.includes(query));
    });

    const resultCount = document.getElementById('announcement-result-count');
    if (resultCount) {
        resultCount.textContent = `${visibleAnnouncements.length} / ${announcements.length} kayıt`;
    }

    if (!visibleAnnouncements.length) {
        container.innerHTML = `
            <tr style="border: none;">
                <td colspan="6" style="padding: 0; border: none;">
                    <div class="announcement-empty-state">
                        <span><i class="fas ${announcements.length ? 'fa-magnifying-glass' : 'fa-bullhorn'}"></i></span>
                        <h3>${announcements.length ? 'Eşleşen duyuru bulunamadı' : 'Henüz duyuru oluşturulmadı'}</h3>
                        <p>${announcements.length ? 'Arama metnini veya durum filtresini değiştirin.' : 'Yeni Duyuru butonuyla ilk kaydı oluşturabilirsiniz.'}</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = visibleAnnouncements.map(announcement => {
        const status = getAnnouncementStatus(announcement);
        const statusKey = getAnnouncementStatusKey(announcement);
        const expired = statusKey === 'expired';
        const lines = announcement.targetLines?.length ? announcement.targetLines : [];
        const visibleLines = lines.slice(0, 8);
        const extraLineCount = Math.max(0, lines.length - visibleLines.length);
        const linesHtml = lines.length
            ? `
                <div class="announcement-line-list">
                    ${visibleLines.map(line => `
                        <span class="announcement-line-logo" style="--announcement-line-color:${escapeAttr(appData.lineColors?.[line] || '#64748b')};">${escapeAttr(line)}</span>
                    `).join('')}
                    ${extraLineCount ? `<span class="announcement-more-lines">+${extraLineCount}</span>` : ''}
                </div>
            `
            : '<span class="announcement-all-lines"><i class="fas fa-earth-europe"></i> Tüm Hatlar</span>';
        const nextActive = announcement.isActive === false;
        const toggleLabel = nextActive ? 'Aktif Yap' : 'Pasif Yap';
        const toggleIcon = nextActive ? 'fa-toggle-on' : 'fa-toggle-off';
        const toggleDisabled = expired && nextActive;

        return `
            <tr style="border-bottom: 1px solid var(--border-main); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.01)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px 16px; vertical-align: middle;">
                    <span class="announcement-status-badge" style="--announcement-status-color:${status.color};">
                        <i class="fas ${status.icon}"></i> ${escapeAttr(status.label)}
                    </span>
                </td>
                <td style="padding: 12px 16px; vertical-align: middle; font-weight: 800; font-size: 0.82rem; color: var(--text-primary);">
                    ${escapeAttr(announcement.title)}
                </td>
                <td style="padding: 12px 16px; vertical-align: middle; font-size: 0.76rem; color: var(--text-secondary); max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeAttr(announcement.message)}">
                    ${escapeAttr(announcement.message)}
                </td>
                <td style="padding: 12px 16px; vertical-align: middle;">
                    ${linesHtml}
                </td>
                <td style="padding: 12px 16px; vertical-align: middle; font-size: 0.72rem; color: var(--text-dim); line-height: 1.4;">
                    <div style="display: flex; align-items: center; gap: 4px;"><i class="fas fa-play" style="font-size:0.6rem; color: var(--primary);"></i> <span>${formatAnnouncementDate(announcement.startAt)}</span></div>
                    <div style="display: flex; align-items: center; gap: 4px; margin-top: 2px;"><i class="fas fa-flag-checkered" style="font-size:0.6rem; color: #ef4444;"></i> <span>${formatAnnouncementDate(announcement.endAt)}</span></div>
                </td>
                <td style="padding: 12px 16px; vertical-align: middle; text-align: center;">
                    <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: center;">
                        <button class="btn-outline" style="height: 30px; padding: 0 8px; font-size: 0.7rem; border-color: ${toggleDisabled ? 'rgba(255,255,255,0.1)' : 'var(--primary)'}; color: ${toggleDisabled ? 'var(--text-dim)' : 'var(--primary)'}; background: transparent; cursor: pointer; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"
                            onclick="toggleAnnouncementStatus('${jsArg(announcement.id)}', ${nextActive})"
                            title="${toggleDisabled ? 'Süresi dolan duyuruyu aktifleştirmek için önce bitiş tarihini güncelleyin.' : toggleLabel}"
                            ${toggleDisabled ? 'disabled' : ''}>
                            <i class="fas ${toggleIcon}"></i><span>${toggleLabel}</span>
                        </button>
                        <button class="btn-outline" style="height: 30px; padding: 0 8px; font-size: 0.7rem; border-color: #10b981; color: #10b981; background: transparent; cursor: pointer; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"
                            onclick="openAnnouncementModal('${jsArg(announcement.id)}')" title="Duyuruyu düzenle">
                            <i class="fas fa-pen"></i><span>Düzenle</span>
                        </button>
                        <button class="btn-outline" style="height: 30px; width: 30px; font-size: 0.7rem; border-color: rgba(239, 68, 68, 0.4); color: #ef4444; background: transparent; cursor: pointer; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;"
                            onclick="deleteAnnouncement('${jsArg(announcement.id)}')" title="Duyuruyu sil">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPeople() {
    const container = document.getElementById('people-list');
    if (!container) return;

    ensurePeopleFilters();
    const search = (document.getElementById('people-search')?.value || '').toLocaleLowerCase('tr-TR').trim();
    const usernameFilter = document.getElementById('people-username-filter')?.value || 'all';
    const roleFilter = document.getElementById('people-role-filter')?.value || 'all';
    const lineFilter = document.getElementById('people-line-filter')?.value || 'all';
    const users = (Array.isArray(appData.users) ? appData.users : [])
        .filter(user => {
            const name = getUserDisplayName(user);
            const username = getUserUsername(user);
            const authorityValue = getUserAuthorityValue(user);
            const authorityLabel = getUserAuthorityLabel(user);
            const title = user.title || '';
            const email = user.email || '';
            const lines = Array.isArray(user.authorizedLines) ? user.authorizedLines : [];
            const globalScope = hasGlobalScope(user);
            const matchesSearch = !search || `${name} ${username} ${authorityLabel} ${title} ${email}`.toLocaleLowerCase('tr-TR').includes(search);
            const matchesUsername = usernameFilter === 'all' || username === usernameFilter;
            const matchesRole = roleFilter === 'all' || authorityValue === roleFilter;
            const matchesLine = lineFilter === 'all' || globalScope || lines.includes(lineFilter);
            return matchesSearch && matchesUsername && matchesRole && matchesLine;
        })
        .sort((a, b) => getUserUsername(a).localeCompare(getUserUsername(b), 'tr'));

    if (!users.length) {
        container.innerHTML = `
            <div class="table-responsive">
                <table class="cms-table people-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main);">Kullanıcı Adı</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main);">Ad Soyad</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main);">Rol / Yetki</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main);">E-Posta / Ünvan</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main);">Yetkili Hatlar</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: center; width: 100px;">İşlemler</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td colspan="6" style="text-align:center; padding:2.5rem; color:var(--text-dim); font-weight:700; font-size:0.8rem;">Filtrelere uygun personel kaydı bulunmuyor.</td>
                        </tr>
                    </tbody>
                </table>
            </div>`;
        return;
    }

    const rowsHtml = users.map(user => {
        const name = getUserDisplayName(user);
        const username = getUserUsername(user);
        const authorityLabel = getRbacRoleDisplayName(user);
        const globalScope = hasGlobalScope(user);
        const lines = Array.isArray(user.authorizedLines) ? user.authorizedLines : [];
        const shownLines = lines.slice(0, 4);
        const lineLogos = globalScope
            ? '<span class="people-all-lines"><i class="fas fa-globe"></i> Tam Yetki</span>'
            : lines.length
            ? `${shownLines.map(line => `<span class="people-line-logo" style="background:${escapeAttr(appData.lineColors?.[line] || '#64748b')};">${escapeAttr(line)}</span>`).join('')}${lines.length > shownLines.length ? `<span class="people-more-lines">+${lines.length - shownLines.length}</span>` : ''}`
            : '<span class="people-all-lines"><i class="fas fa-route"></i> Alan tanımlı değil</span>';

        return `
            <tr class="people-row">
                <td style="font-weight:700; font-size:0.8rem; color:var(--text-primary); padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main);">${escapeAttr(username)}</td>
                <td style="font-weight:700; font-size:0.8rem; color:var(--text-secondary); padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main);">${escapeAttr(name || '-')}</td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main);"><span class="role" style="font-size:0.65rem; font-weight:800; padding:0.12rem 0.45rem; border-radius:999px; background:rgba(139, 92, 246, 0.08); color:var(--primary);">${escapeAttr(authorityLabel)}</span></td>
                <td style="font-size:0.75rem; color:var(--text-dim); padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main);">
                    <div style="font-weight:700; color: var(--text-secondary);">${escapeAttr(user.email || '-')}</div>
                    ${user.title ? `<div style="font-size:0.65rem; opacity:0.8; margin-top:2px; font-weight:500;">${escapeAttr(user.title)}</div>` : ''}
                </td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main);">${lineLogos}</td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align:center;">
                    <div style="display:flex; gap:0.4rem; justify-content:center; align-items:center;">
                        ${hasPermission('user_add_edit') ? `<button class="btn-outline" onclick="openAddUserModal('${jsArg(user.id)}')" title="Düzenle" style="width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; border-radius:6px; background:none; border:1px solid var(--border-main); color:var(--text-secondary); cursor:pointer; transition: all 0.2s;"><i class="fas fa-pen" style="font-size:0.7rem;"></i></button>` : ''}
                        ${hasPermission('user_delete') ? `<button class="btn-outline" onclick="deleteUser('${jsArg(user.id)}')" title="Sil" style="width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; border-radius:6px; background:none; border:1px solid rgba(239,68,68,0.2); color:#ef4444; cursor:pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.05)'" onmouseout="this.style.background='none'"><i class="fas fa-trash" style="font-size:0.7rem;"></i></button>` : ''}
                    </div>
                </td>
            </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="table-responsive">
            <table class="cms-table people-table" style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">Kullanıcı Adı</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">Ad Soyad</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">Rol / Yetki</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">E-Posta / Ünvan</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">Yetkili Hatlar</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: center; width: 100px;">İşlemler</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;
}

function ensurePeopleFilters() {
    const list = document.getElementById('people-list');
    if (!list) return;
    const usernames = [...new Set((appData.users || []).map(u => getUserUsername(u)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    const authorities = RBAC_ROLES.map(role => [role.id, role.name]);
    const existingUsername = document.getElementById('people-username-filter');
    if (existingUsername) {
        const currentValue = existingUsername.value;
        existingUsername.innerHTML = `<option value="all">Tüm Kullanıcılar</option>${usernames.map(username => `<option value="${escapeAttr(username)}">${escapeAttr(username)}</option>`).join('')}`;
        existingUsername.value = usernames.includes(currentValue) ? currentValue : 'all';
        const existingRole = document.getElementById('people-role-filter');
        if (existingRole) {
            const currentRole = existingRole.value;
            existingRole.innerHTML = `<option value="all">Tüm Yetkiler</option>${authorities.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeAttr(label)}</option>`).join('')}`;
            existingRole.value = authorities.some(([value]) => value === currentRole) ? currentRole : 'all';
        }
        return;
    }
    const filterPanel = document.createElement('div');
    filterPanel.id = 'people-filter-panel';
    filterPanel.className = 'people-filter-panel';
    filterPanel.innerHTML = `
        <div class="people-filter-field people-search-field">
            <label>Hızlı Ara</label>
            <div><i class="fas fa-search"></i><input id="people-search" type="text" placeholder="Kullanıcı, ad, e-posta veya yetki" oninput="renderPeople()"></div>
        </div>
        <div class="people-filter-field">
            <label>Kullanıcı Adı</label>
            <select id="people-username-filter" onchange="renderPeople()">
                <option value="all">Tüm Kullanıcılar</option>
                ${usernames.map(username => `<option value="${escapeAttr(username)}">${escapeAttr(username)}</option>`).join('')}
            </select>
        </div>
        <div class="people-filter-field">
            <label>Sistem Rolü</label>
            <select id="people-role-filter" onchange="renderPeople()">
                <option value="all">Tüm Roller</option>
                ${authorities.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeAttr(label)}</option>`).join('')}
            </select>
        </div>
        <div class="people-filter-field">
            <label>Hat</label>
            <select id="people-line-filter" onchange="renderPeople()">
                <option value="all">Tüm Hatlar</option>
                ${(appData.lines || []).map(line => `<option value="${escapeAttr(line)}">${escapeAttr(line)}</option>`).join('')}
            </select>
        </div>
        <button class="btn-secondary" onclick="clearPeopleFilters()"><i class="fas fa-rotate-left"></i> Temizle</button>
    `;
    list.parentElement.insertBefore(filterPanel, list);
}

function clearPeopleFilters() {
    const search = document.getElementById('people-search');
    const role = document.getElementById('people-role-filter');
    const line = document.getElementById('people-line-filter');
    const username = document.getElementById('people-username-filter');
    if (search) search.value = '';
    if (username) username.value = 'all';
    if (role) role.value = 'all';
    if (line) line.value = 'all';
    renderPeople();
}

// Question bank restored state: audit types + editable groups + boolean station seed.
const QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID = 'audit-type-istasyon-denetimi';
const QUESTION_BANK_SCALE_OPTIONS = {
    booleanAverage: {
        label: 'Evet / Hayır Uyum Skoru',
        summary: 'Her soru Evet=1, Hayır=0 olarak puanlanır. Genel skor Evet oranından hesaplanır.',
        allowedAnswerTypes: ['boolean'],
        config: { yesScore: 1, noScore: 0, nonconformityValue: false }
    },
    scaleAverage: {
        label: '1-5 Puan Skalası',
        summary: 'Her soru 1 ile 5 arasında puanlanır. Genel skor soru ortalamalarından hesaplanır.',
        allowedAnswerTypes: ['scale'],
        config: { scaleMin: 1, scaleMax: 5, nonconformityThreshold: 3 }
    },
    scale6Average: {
        label: '6\'lı Sistem Skalası (0-5 Puan)',
        summary: 'Her soru 0 ile 5 arasında puanlanır (%0, %25, %50, %80, %99, %100). Genel skor soru ortalamalarından hesaplanır.',
        allowedAnswerTypes: ['scale6'],
        config: { scaleMin: 0, scaleMax: 5, nonconformityThreshold: 3 }
    },
    mixedWeighted: {
        label: 'Karma Ağırlıklı Skala',
        summary: 'Farklı cevap tipleri ve ağırlıklarla skor hesaplar.',
        allowedAnswerTypes: ['scale', 'boolean', 'multiChoice', 'text', 'scale6'],
        config: { scaleMin: 1, scaleMax: 5, nonconformityThreshold: 3 }
    },
    none: {
        label: 'Skorsuz Form',
        summary: 'Skor hesaplanmaz, bilgi toplama formları için kullanılır.',
        allowedAnswerTypes: ['text', 'multiChoice'],
        config: {}
    }
};




function normalizeEvidenceAnswerValue(value) {
    if (value === true) return 'true';
    if (value === false) return 'false';
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.round(value));
    const normalized = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
    if (['true', 'yes', 'evet'].includes(normalized)) return 'true';
    if (['false', 'no', 'hayir', 'hayır'].includes(normalized)) return 'false';
    const numeric = Number(normalized.replace(',', '.'));
    if (Number.isFinite(numeric)) return String(Math.round(numeric));
    return normalized;
}

function getAuditEvidenceOptionDefinitions(strategy, config = {}) {
    const option = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    const allowedTypes = option.allowedAnswerTypes || [];
    const definitions = [];

    if (allowedTypes.includes('scale') || allowedTypes.includes('scale6')) {
        const min = Number(config.scaleMin ?? option.config?.scaleMin ?? 1);
        const max = Number(config.scaleMax ?? option.config?.scaleMax ?? 5);
        for (let value = min; value <= max; value++) {
            definitions.push({ value: String(value), label: String(value), hint: 'Puan' });
        }
    }

    if (allowedTypes.includes('boolean')) {
        definitions.push({ value: 'true', label: 'Evet', hint: 'Olumlu cevap' });
        definitions.push({ value: 'false', label: 'Hayır', hint: 'Olumsuz cevap' });
    }

    return definitions;
}

function getDefaultEvidenceRequiredValues(strategy, config = {}) {
    const option = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    const allowedTypes = option.allowedAnswerTypes || [];
    const defaults = [];

    if (allowedTypes.includes('scale') || allowedTypes.includes('scale6')) {
        const min = Number(config.scaleMin ?? option.config?.scaleMin ?? 1);
        const max = Number(config.scaleMax ?? option.config?.scaleMax ?? 5);
        const threshold = Number(config.nonconformityThreshold ?? option.config?.nonconformityThreshold ?? 3);
        for (let value = min; value <= max; value++) {
            if (value <= threshold) defaults.push(String(value));
        }
    }

    if (allowedTypes.includes('boolean')) defaults.push('false');
    return [...new Set(defaults)];
}

function normalizeAuditEvidenceRequiredValues(values, strategy, config = {}, evidenceRequired = true) {
    if (!evidenceRequired) return [];
    const validValues = new Set(getAuditEvidenceOptionDefinitions(strategy, config).map(option => option.value));
    const rawValues = Array.isArray(values) ? values : [];
    const normalized = rawValues
        .map(normalizeEvidenceAnswerValue)
        .filter(value => validValues.has(value));
    const unique = [...new Set(normalized)];
    return unique.length ? unique : getDefaultEvidenceRequiredValues(strategy, config);
}

function getAuditEvidenceRequiredValues(type = {}) {
    const strategy = type.scoringStrategy || 'scaleAverage';
    const config = type.config || QUESTION_BANK_SCALE_OPTIONS[strategy]?.config || {};
    return normalizeAuditEvidenceRequiredValues(
        type.evidenceRequiredValues || type.evidenceValues || type.requiredEvidenceAnswers,
        strategy,
        config,
        type.evidenceRequired !== false
    );
}

function formatAuditEvidenceRequiredValues(type = {}) {
    const values = getAuditEvidenceRequiredValues(type);
    const strategy = type.scoringStrategy || 'scaleAverage';
    const labelsByValue = new Map(getAuditEvidenceOptionDefinitions(strategy, type.config || {}).map(option => [option.value, option.label]));
    return values.map(value => labelsByValue.get(value) || value).join(', ');
}

function getAuditTypeEvidenceSelectionsFromModal() {
    return Array.from(document.querySelectorAll('#audit-type-evidence-answer-options input[type="checkbox"]:checked'))
        .map(input => input.value)
        .filter(Boolean);
}

function setAuditTypeEvidenceSelections(values, strategy, config = {}) {
    const selected = new Set(normalizeAuditEvidenceRequiredValues(values, strategy, config, true));
    document.querySelectorAll('#audit-type-evidence-answer-options input[type="checkbox"]').forEach(input => {
        input.checked = selected.has(input.value);
    });
}

function getAuditTypeCommentSelectionsFromModal() {
    return Array.from(document.querySelectorAll('#audit-type-comment-answer-options input[type="checkbox"]:checked'))
        .map(input => input.value)
        .filter(Boolean);
}

function setAuditTypeCommentSelections(values, strategy, config = {}) {
    // We can reuse normalizeAuditEvidenceRequiredValues since it just normalizes an array of values against strategy options
    const selected = new Set(normalizeAuditEvidenceRequiredValues(values, strategy, config, true));
    document.querySelectorAll('#audit-type-comment-answer-options input[type="checkbox"]').forEach(input => {
        input.checked = selected.has(input.value);
    });
}

function buildAuditTypeEvidenceOptionsHtml(strategy, evidenceRequired) {
    const option = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    const definitions = getAuditEvidenceOptionDefinitions(strategy, option.config || {});
    if (!evidenceRequired) {
        return '<div style="font-size:.78rem;color:var(--text-secondary);font-weight:700;">Kanıt fotoğrafı kapalı. Zorunlu cevap seçimi uygulanmaz.</div>';
    }
    if (!definitions.length) {
        return '<div style="font-size:.78rem;color:var(--text-secondary);font-weight:700;">Bu skala tipinde zorunlu fotoğraf cevabı seçilemez.</div>';
    }
    const defaults = new Set(getDefaultEvidenceRequiredValues(strategy, option.config || {}));
    return `
        <div id="audit-type-evidence-answer-options" style="display:flex;flex-wrap:wrap;gap:.5rem;">
            ${definitions.map(def => `
                <label style="height:36px;min-width:58px;padding:0 .75rem;border:1px solid var(--border-main);border-radius:8px;background:var(--bg-card);display:inline-flex;align-items:center;justify-content:center;gap:.4rem;cursor:pointer;font-weight:900;color:var(--text-primary);font-size:.82rem;">
                    <input type="checkbox" value="${escapeAttr(def.value)}" ${defaults.has(def.value) ? 'checked' : ''} style="width:14px;height:14px;accent-color:var(--primary);">
                    <span>${escapeAttr(def.label)}</span>
                </label>
            `).join('')}
        </div>
        <div style="font-size:.72rem;color:var(--text-dim);font-weight:700;margin-top:.45rem;">Seçilen cevap verildiğinde denetçi fotoğraf eklemeden denetimi bitiremez.</div>
    `;
}

function buildAuditTypeCommentOptionsHtml(strategy, commentRequired) {
    const option = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    const definitions = getAuditEvidenceOptionDefinitions(strategy, option.config || {});
    if (!commentRequired) {
        return '<div style="font-size:.78rem;color:var(--text-secondary);font-weight:700;">Açıklama alanı kapalı. Zorunlu cevap seçimi uygulanmaz.</div>';
    }
    if (!definitions.length) {
        return '<div style="font-size:.78rem;color:var(--text-secondary);font-weight:700;">Bu skala tipinde zorunlu açıklama cevabı seçilemez.</div>';
    }
    // Varsayılan olarak sadece kötü puanlıları (kanıt gibi) seçili yapabiliriz.
    const defaults = new Set(getDefaultEvidenceRequiredValues(strategy, option.config || {}));
    return `
        <div id="audit-type-comment-answer-options" style="display:flex;flex-wrap:wrap;gap:.5rem;">
            ${definitions.map(def => `
                <label style="height:36px;min-width:58px;padding:0 .75rem;border:1px solid var(--border-main);border-radius:8px;background:var(--bg-card);display:inline-flex;align-items:center;justify-content:center;gap:.4rem;cursor:pointer;font-weight:900;color:var(--text-primary);font-size:.82rem;">
                    <input type="checkbox" value="${escapeAttr(def.value)}" ${defaults.has(def.value) ? 'checked' : ''} style="width:14px;height:14px;accent-color:var(--primary);">
                    <span>${escapeAttr(def.label)}</span>
                </label>
            `).join('')}
        </div>
        <div style="font-size:.72rem;color:var(--text-dim);font-weight:700;margin-top:.45rem;">Seçilen cevap verildiğinde denetçi açıklama (not) girmeden denetimi bitiremez.</div>
    `;
}

const QUESTION_BANK_STATION_AUDIT_TYPE = {
    id: QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID,
    title: 'İSTASYON DENETİMİ',
    name: 'İSTASYON DENETİMİ',
    description: 'Evet/Hayır cevaplı istasyon denetimi. Evet=1, Hayır=0.',
    scoringStrategy: 'booleanAverage',
    allowedAnswerTypes: ['boolean'],
    config: QUESTION_BANK_SCALE_OPTIONS.booleanAverage.config,
    evidenceRequired: false,
    evidenceRule: 'nonconformity',
    evidenceRequiredValues: ['false'],
    isActive: true,
    isDeleted: false,
    orderIndex: 0
};

function ensureQuestionBankState() {
    appData.auditTypes = Array.isArray(appData.auditTypes) ? appData.auditTypes : [];
    appData.questionGroups = Array.isArray(appData.questionGroups) ? appData.questionGroups : [];
    appData.questions = Array.isArray(appData.questions) ? appData.questions : [];
    if (!appData.auditTypes.some(t => String(t.id) === QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID)) {
        appData.auditTypes.unshift({ ...QUESTION_BANK_STATION_AUDIT_TYPE });
    }
    if (!appData.selectedAuditTypeId) appData.selectedAuditTypeId = QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID;
}


function normalizeQuestionBankGroup(group) {
    const type = getQuestionBankAuditType(group.auditTypeId);
    const strategy = group.scoringStrategy || type.scoringStrategy || 'scaleAverage';
    const scale = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    return {
        ...group,
        id: group.id || `G-${Date.now()}`,
        auditTypeId: group.auditTypeId || appData.selectedAuditTypeId || QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID,
        name: group.name || group.title || 'Soru Grubu',
        title: group.title || group.name || 'Soru Grubu',
        icon: group.icon || 'fa-clipboard-check',
        scoringStrategy: strategy,
        allowedAnswerTypes: group.allowedAnswerTypes || scale.allowedAnswerTypes,
        config: group.config || scale.config,
        isActive: group.isActive !== false,
        isDeleted: group.isDeleted === true,
        orderIndex: Number(group.orderIndex) || 0
    };
}

function normalizeQuestionBankQuestion(question) {
    const type = getQuestionBankAuditType(question.auditTypeId);
    const isBoolean = (type.allowedAnswerTypes || []).includes('boolean') && !(type.allowedAnswerTypes || []).includes('scale') && !(type.allowedAnswerTypes || []).includes('scale6');
    const qAnswerType = question.answerType || (isBoolean ? 'boolean' : 'scale');
    const isQBoolean = qAnswerType === 'boolean';
    return {
        ...question,
        id: question.id || `Q-${Date.now()}`,
        auditTypeId: question.auditTypeId || type.id,
        groupId: question.groupId || 'g1',
        categoryName: question.categoryName || 'Genel',
        title: question.title || question.questionText || '',
        questionText: question.questionText || question.title || '',
        answerType: qAnswerType,
        maxScore: isQBoolean ? 1 : (Number(question.maxScore) || 5),
        options: isQBoolean ? [
            { label: 'Evet', value: true, score: 1 },
            { label: 'Hayır', value: false, score: 0, isNonconformity: true }
        ] : (question.options || []),
        scoringRule: isQBoolean ? { yesScore: 1, noScore: 0, nonconformityValue: false } : question.scoringRule,
        weight: Number(question.weight) || 1,
        isActive: question.isActive !== false,
        isDeleted: question.isDeleted === true,
        orderIndex: Number(question.orderIndex) || 0
    };
}

function getQuestionBankAuditType(id) {
    ensureQuestionBankState();
    const key = String(id || appData.selectedAuditTypeId || QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID);
    return appData.auditTypes.find(t => String(t.id) === key || String(t.title) === key || String(t.name) === key) || QUESTION_BANK_STATION_AUDIT_TYPE;
}

function getAuditScaleLabel(strategy) {
    return QUESTION_BANK_SCALE_OPTIONS[strategy]?.label || strategy || 'Skala';
}

function getAuditEvidenceLabel(type) {
    if (!type?.evidenceRequired) return 'Kanıt fotoğrafı: Zorunlu değil';
    const valuesLabel = formatAuditEvidenceRequiredValues(type);
    return valuesLabel ? `Kanıt fotoğrafı: ${valuesLabel}` : 'Kanıt fotoğrafı: Zorunlu';
}

function isEvidenceRequiredForAnswer(auditTypeId, answerValue) {
    const type = getQuestionBankAuditType(auditTypeId);
    if (!type.evidenceRequired) return false;
    const selectedValues = new Set(getAuditEvidenceRequiredValues(type));
    if (!selectedValues.size) return false;
    return selectedValues.has(normalizeEvidenceAnswerValue(answerValue));
}

function getAuditTypeColor(typeId, index = null) {
    const palette = ['#2563eb', '#10b981', '#7c3aed', '#f59e0b', '#06b6d4', '#ef4444', '#14b8a6', '#db2777', '#0f766e', '#9333ea', '#ea580c', '#0891b2', '#65a30d', '#be123c'];
    if (Number.isInteger(index)) return palette[index % palette.length];
    const key = String(typeId || 'default');
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash) + key.charCodeAt(i);
    return palette[Math.abs(hash) % palette.length];
}

function getAuditTypeIcon(type = {}) {
    const strategy = String(type.scoringStrategy || '');
    const name = String(type.title || type.name || '').toLocaleUpperCase('tr-TR');
    if (name.includes('ISTASYON') || name.includes('İSTASYON')) return 'fa-train-subway';
    if (name.includes('5S')) return 'fa-list-check';
    if (strategy === 'booleanAverage') return 'fa-toggle-on';
    if (strategy === 'none') return 'fa-file-lines';
    if (strategy === 'mixedWeighted') return 'fa-sliders';
    return 'fa-clipboard-check';
}


const originalInitRealtimeSyncForQuestionBank = initRealtimeSync;
initRealtimeSync = function initRealtimeSyncWithQuestionBank() {
    originalInitRealtimeSyncForQuestionBank();
    installQuestionBankRealtime();
};

function renderQuestionGroups() {
    ensureQuestionBankState();
    const container = document.getElementById('question-groups-container');
    if (!container) return;
    renderAuditTypes();
    container.innerHTML = '';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
    container.style.gap = '0.75rem';

    const groups = buildVisibleQuestionGroups((appData.questionGroups || [])
        .map(normalizeQuestionBankGroup)
        .filter(g => g.auditTypeId === appData.selectedAuditTypeId && g.isActive !== false && !g.isDeleted)
        .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)));

    if (!groups.length) {
        container.innerHTML = '<div class="people-empty" style="grid-column:1/-1;">Bu denetim tipine bağlı soru grubu yok.</div>';
        return;
    }

    groups.forEach(g => {
        const questionsInGroup = getQuestionsForGroup(g.id);
        const auditType = getQuestionBankAuditType(g.auditTypeId);
        const typeColor = getAuditTypeColor(g.auditTypeId);
        const groupScale = getAuditScaleLabel(g.scoringStrategy || auditType.scoringStrategy);
        const isSelected = appData.selectedGroupId === g.id;

        const card = document.createElement('div');
        card.className = 'stat-card question-group-card';
        card.style.cursor = 'pointer';
        card.style.transition = 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)';
        card.style.padding = '0.75rem 1rem';
        card.style.borderRadius = '14px';
        card.style.background = 'var(--bg-input)';
        card.style.border = isSelected ? `1px solid ${typeColor}` : `1px solid var(--border-main)`;
        card.style.borderLeft = `4px solid ${typeColor}`;
        card.style.boxShadow = isSelected ? `0 8px 24px ${typeColor}18` : 'none';
        
        card.onclick = () => {
            appData.selectedGroupId = g.id;
            renderQuestionGroups();
            renderQuestions(g.id);
        };
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem;gap:1rem;">
                <h3 style="margin:0;font-size:0.92rem;color:var(--text-primary);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${escapeAttr(g.name)}</h3>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <i class="fas fa-pen" style="color:var(--text-secondary);font-size:0.75rem;cursor:pointer;padding:4px;transition:0.2s;" onmouseover="this.style.color='${typeColor}'" onmouseout="this.style.color='var(--text-secondary)'" onclick="event.stopPropagation(); openEditQuestionGroupModal('${jsArg(g.id)}')" title="Düzenle"></i>
                    <i class="fas fa-trash" style="color:var(--text-secondary);font-size:0.75rem;cursor:pointer;padding:4px;transition:0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-secondary)'" onclick="event.stopPropagation(); deleteQuestionGroup('${jsArg(g.id)}')" title="Sil"></i>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                <span style="font-size:0.7rem;color:${typeColor};background:${typeColor}12;padding:0.18rem 0.5rem;border-radius:999px;font-weight:800;letter-spacing:0.3px;">${questionsInGroup.length} Soru</span>
                                <span style="font-size:0.7rem;color:var(--text-secondary);background:rgba(255,255,255,0.03);border:1px solid var(--border-main);padding:0.18rem 0.45rem;border-radius:999px;font-weight:700;">${escapeAttr(groupScale)}</span>
                                <span style="font-size:0.7rem;color:#10b981;background:rgba(16,185,129,0.08);padding:0.18rem 0.5rem;border-radius:999px;font-weight:800;letter-spacing:0.3px;">Ağırlık: ${g.weight !== undefined ? g.weight : '1.0'}</span>
                            </div>
        `;
        container.appendChild(card);
    });
}


function selectAuditType(id) {
    appData.selectedAuditTypeId = id;
    appData.selectedGroupId = null;
    renderQuestionGroups();
    const selected = document.getElementById('selected-group-questions');
    if (selected) selected.style.display = 'none';
}

function ensureAuditTypeModal() {
    if (document.getElementById('audit-type-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="audit-type-modal" class="modal-overlay" style="display:none;">
            <div class="modal-content" style="max-width:560px;">
                <div class="modal-header">
                    <h3 id="audit-type-modal-title">Yeni Denetim Tipi</h3>
                    <i class="fas fa-times close-modal" onclick="closeAuditTypeModal()" style="cursor:pointer;"></i>
                </div>
                <div class="modal-body" style="padding:1.5rem;">
                    <input type="hidden" id="audit-type-edit-id">
                    <div class="input-group" style="margin-bottom:1rem;">
                        <label style="display:block;font-size:.75rem;font-weight:800;color:var(--text-secondary);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:1px;">Denetim Tipi Adı</label>
                        <input type="text" id="audit-type-title-input" class="cms-input" placeholder="Örn: İş Güvenliği Denetimi">
                    </div>
                    <div class="input-group" style="margin-bottom:1rem;">
                        <label style="display:block;font-size:.75rem;font-weight:800;color:var(--text-secondary);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:1px;">Skala Tipi</label>
                        <select id="audit-type-scale-select" class="cms-input" onchange="updateAuditTypeScaleInfo()">
                            ${Object.entries(QUESTION_BANK_SCALE_OPTIONS).map(([value, opt]) => `<option value="${value}">${opt.label}</option>`).join('')}
                        </select>
                    </div>
                    <label class="settings-toggle-row" style="margin:0 0 1rem 0;padding:0.85rem 1rem;border:1px solid var(--border-main);border-radius:12px;background:var(--bg-input);display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
                        <div style="flex:1;margin:0;user-select:none;">
                            <strong style="display:block;color:var(--text-primary);font-size:.9rem;">Aktif</strong>
                            <small style="display:block;color:var(--text-secondary);font-weight:700;margin-top:.25rem;">Bu denetim tipini aktif veya pasif duruma getirir.</small>
                        </div>
                        <div class="switch"><input type="checkbox" id="audit-type-is-active"><span class="slider"></span></div>
                    </label>
                    <label class="settings-toggle-row" style="margin:0 0 1rem 0;padding:0.85rem 1rem;border:1px solid var(--border-main);border-radius:12px;background:var(--bg-input);display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
                        <div style="flex:1;margin:0;user-select:none;">
                            <strong style="display:block;color:var(--text-primary);font-size:.9rem;">Kanıt Fotoğrafı Zorunlu</strong>
                            <small style="display:block;color:var(--text-secondary);font-weight:700;margin-top:.25rem;">Aktifse seçtiğiniz cevaplarda fotoğraf istenir.</small>
                        </div>
                        <div class="switch"><input type="checkbox" id="audit-type-evidence-required" onchange="updateAuditTypeScaleInfo()"><span class="slider"></span></div>
                    </label>
                    <div id="audit-type-evidence-options" style="margin:0 0 1rem 0;padding:0.9rem 1rem;border:1px solid var(--border-main);border-radius:12px;background:var(--bg-input);"></div>
                    <label class="settings-toggle-row" style="margin:0 0 1rem 0;padding:0.85rem 1rem;border:1px solid var(--border-main);border-radius:12px;background:var(--bg-input);display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
                        <div style="flex:1;margin:0;user-select:none;">
                            <strong style="display:block;color:var(--text-primary);font-size:.9rem;">Açıklama Zorunlu</strong>
                            <small style="display:block;color:var(--text-secondary);font-weight:700;margin-top:.25rem;">Aktifse seçtiğiniz cevaplarda açıklama istenir.</small>
                        </div>
                        <div class="switch"><input type="checkbox" id="audit-type-comment-required" onchange="updateAuditTypeScaleInfo()"><span class="slider"></span></div>
                    </label>
                    <div id="audit-type-comment-options" style="margin:0 0 1rem 0;padding:0.9rem 1rem;border:1px solid var(--border-main);border-radius:12px;background:var(--bg-input);"></div>
                    <div id="audit-type-scale-info" style="background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.35);border-radius:14px;padding:1rem;color:var(--text-primary);line-height:1.45;"></div>
                </div>
                <div class="modal-footer" style="padding:1.25rem 1.5rem;border-top:1px solid var(--border-main);display:flex;justify-content:flex-end;gap:.75rem;">
                    <button class="btn-secondary" onclick="closeAuditTypeModal()">Vazgeç</button>
                    <button class="btn-primary" id="audit-type-save-btn" onclick="saveAuditTypeFromModal()"><i class="fas fa-plus"></i> Oluştur</button>
                </div>
            </div>
        </div>
    `);
}

function openAuditTypeModal() {
    ensureAuditTypeModal();
    document.getElementById('audit-type-modal-title').textContent = 'Yeni Denetim Tipi';
    document.getElementById('audit-type-edit-id').value = '';
    document.getElementById('audit-type-title-input').value = '';
    document.getElementById('audit-type-scale-select').value = 'scaleAverage';
    if (document.getElementById('audit-type-is-active')) {
        document.getElementById('audit-type-is-active').checked = true;
    }
    document.getElementById('audit-type-evidence-required').checked = true;
    document.getElementById('audit-type-evidence-required').disabled = false;
    document.getElementById('audit-type-comment-required').checked = true;
    document.getElementById('audit-type-comment-required').disabled = false;
    document.getElementById('audit-type-save-btn').innerHTML = '<i class="fas fa-plus"></i> Oluştur';
    updateAuditTypeScaleInfo();
    document.getElementById('audit-type-modal').style.display = 'flex';
}

function openEditAuditTypeModal(id) {
    const type = getQuestionBankAuditType(id);
    ensureAuditTypeModal();
    document.getElementById('audit-type-modal-title').textContent = 'Denetim Tipini Düzenle';
    document.getElementById('audit-type-edit-id').value = type.id;
    document.getElementById('audit-type-title-input').value = type.title || '';
    document.getElementById('audit-type-scale-select').value = type.scoringStrategy || 'scaleAverage';
    if (document.getElementById('audit-type-is-active')) {
        document.getElementById('audit-type-is-active').checked = type.isActive !== false;
    }
    document.getElementById('audit-type-evidence-required').checked = Boolean(type.evidenceRequired);
    document.getElementById('audit-type-evidence-required').disabled = false;
    document.getElementById('audit-type-comment-required').checked = Boolean(type.commentRequired);
    document.getElementById('audit-type-comment-required').disabled = false;
    document.getElementById('audit-type-save-btn').innerHTML = '<i class="fas fa-save"></i> Kaydet';
    updateAuditTypeScaleInfo();
    setAuditTypeEvidenceSelections(
        type.evidenceRequiredValues || type.evidenceValues || type.requiredEvidenceAnswers,
        type.scoringStrategy || 'scaleAverage',
        type.config || {}
    );
    setAuditTypeCommentSelections(
        type.commentRequiredValues || [],
        type.scoringStrategy || 'scaleAverage',
        type.config || {}
    );
    document.getElementById('audit-type-modal').style.display = 'flex';
}

function closeAuditTypeModal() {
    const modal = document.getElementById('audit-type-modal');
    if (modal) modal.style.display = 'none';
}

function updateAuditTypeScaleInfo() {
    const strategy = document.getElementById('audit-type-scale-select')?.value || 'scaleAverage';
    const evidenceRequired = Boolean(document.getElementById('audit-type-evidence-required')?.checked);
    const commentRequired = Boolean(document.getElementById('audit-type-comment-required')?.checked);
    const option = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    const info = document.getElementById('audit-type-scale-info');
    const evidenceOptions = document.getElementById('audit-type-evidence-options');
    const commentOptions = document.getElementById('audit-type-comment-options');

    if (evidenceOptions) {
        evidenceOptions.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.65rem;">
                <div style="font-size:.75rem;font-weight:900;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.8px;">Fotoğraf istenecek cevaplar</div>
                <div style="font-size:.7rem;font-weight:800;color:${evidenceRequired ? 'var(--primary)' : 'var(--text-dim)'};">${evidenceRequired ? 'Aktif' : 'Kapalı'}</div>
            </div>
            ${buildAuditTypeEvidenceOptionsHtml(strategy, evidenceRequired)}
        `;
    }
    if (commentOptions) {
        commentOptions.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.65rem;">
                <div style="font-size:.75rem;font-weight:900;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.8px;">Açıklama istenecek cevaplar</div>
                <div style="font-size:.7rem;font-weight:800;color:${commentRequired ? 'var(--primary)' : 'var(--text-dim)'};">${commentRequired ? 'Aktif' : 'Kapalı'}</div>
            </div>
            ${buildAuditTypeCommentOptionsHtml(strategy, commentRequired)}
        `;
    }

    if (!info) return;
    const evidenceText = evidenceRequired
        ? 'Kanıt fotoğrafı sadece yukarıda seçilen cevaplarda zorunlu olur.'
        : 'Kanıt fotoğrafı kapalıysa denetçi hiçbir cevap için fotoğraf eklemeye zorlanmaz.';
    const commentText = commentRequired
        ? 'Açıklama alanı yukarıda seçilen cevaplarda zorunlu olur.'
        : '';
    info.innerHTML = `<div style="display:flex;gap:.75rem;align-items:flex-start;"><i class="fas fa-circle-info" style="color:#3b82f6;margin-top:.15rem;"></i><div><div style="font-weight:900;margin-bottom:.25rem;">${escapeAttr(option.label)}</div><div style="font-size:.86rem;color:var(--text-secondary);">${escapeAttr(option.summary)}</div><div style="font-size:.75rem;color:var(--text-dim);margin-top:.5rem;">Cevap türleri: ${escapeAttr(option.allowedAnswerTypes.join(', '))}</div><div style="font-size:.75rem;color:var(--text-dim);margin-top:.35rem;">${escapeAttr(evidenceText)}</div><div style="font-size:.75rem;color:var(--text-dim);margin-top:.35rem;">${escapeAttr(commentText)}</div></div></div>`;
}

async function saveAuditTypeFromModal() {
    const editId = document.getElementById('audit-type-edit-id')?.value || '';
    const title = document.getElementById('audit-type-title-input')?.value.trim();
    const strategy = document.getElementById('audit-type-scale-select')?.value || 'scaleAverage';
    const evidenceRequired = Boolean(document.getElementById('audit-type-evidence-required')?.checked);
    const evidenceRequiredValues = evidenceRequired ? getAuditTypeEvidenceSelectionsFromModal() : [];
    const saveButton = document.getElementById('audit-type-save-btn');
    if (!title) {
        showToast('Lütfen denetim tipi adını giriniz.');
        return;
    }
    const id = editId || `AT-${Date.now()}`;
    const isStation = id === QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID;
    const finalStrategy = isStation ? 'booleanAverage' : strategy;
    const scale = QUESTION_BANK_SCALE_OPTIONS[finalStrategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    if (evidenceRequired && !evidenceRequiredValues.length) {
        showToast('Kanıt fotoğrafı için en az bir cevap seçiniz.');
        return;
    }
    const isActiveInput = document.getElementById('audit-type-is-active');
    const isActive = isActiveInput ? Boolean(isActiveInput.checked) : true;

    const payload = normalizeQuestionBankType({
        id,
        title,
        name: title,
        scoringStrategy: finalStrategy,
        allowedAnswerTypes: scale.allowedAnswerTypes,
        config: scale.config,
        defaultAnswerValue: (scale.allowedAnswerTypes || []).includes('boolean') && !(scale.allowedAnswerTypes || []).includes('scale') ? true : 5,
        categories: editId ? (getQuestionBankAuditType(id).categories || []) : [],
        evidenceRequired,
        evidenceRule: evidenceRequired ? 'selectedAnswers' : 'none',
        evidenceRequiredValues,
        isActive,
        isDeleted: false,
        orderIndex: editId ? (getQuestionBankAuditType(id).orderIndex || 0) : appData.auditTypes.length,
        updatedAt: new Date().toISOString()
    });
    try {
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kaydediliyor';
        }
        await db.collection('auditTypes').doc(id).set(payload, { merge: true });
        appData.selectedAuditTypeId = id;
        closeAuditTypeModal();
        renderQuestionGroups();
        showToast(editId ? 'Denetim tipi güncellendi.' : 'Denetim tipi oluşturuldu.');
    } catch (err) {
        console.error('Audit type save error:', err);
        showToast(`Denetim tipi kaydedilemedi: ${err && err.message ? err.message : 'bilinmeyen hata'}`);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.innerHTML = editId ? '<i class="fas fa-save"></i> Kaydet' : '<i class="fas fa-plus"></i> Oluştur';
        }
    }
}

async function deleteAuditType(id) {
    const activeTypes = (appData.auditTypes || []).filter(t => !t.isDeleted);
    if (activeTypes.length <= 1) {
        showToast('En az bir denetim tipi kalmalıdır.');
        return;
    }
    const type = getQuestionBankAuditType(id);
    if (!confirm(`"${type.title}" denetim tipini silmek istiyor musunuz?`)) return;
    await db.collection('auditTypes').doc(id).set({ isDeleted: true, isActive: false, deletedAt: new Date().toISOString() }, { merge: true });
    appData.auditTypes = appData.auditTypes.filter(t => String(t.id) !== String(id));
    appData.selectedAuditTypeId = appData.auditTypes[0]?.id || QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID;
    renderQuestionGroups();
    showToast('Denetim tipi silindi.');
}

async function toggleAuditTypeStatus(typeId, currentActive) {
    try {
        const nextActive = !currentActive;
        await db.collection('auditTypes').doc(typeId).set({
            isActive: nextActive,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        showToast(`Denetim tipi durumu ${nextActive ? 'Aktif' : 'Pasif'} olarak güncellendi.`);
    } catch (err) {
        console.error('Toggle audit type status error:', err);
        showToast('Hata oluştu!');
    }
}

function renderQuestions(groupId) {
    const container = document.getElementById('selected-group-questions');
    const tbody = document.getElementById('questions-table-body');
    const groupTitle = document.getElementById('selected-group-title');
    const groupStats = document.getElementById('selected-group-stats');
    if (!container || !tbody) return;
    const virtualGroup = parseVirtual5SGroupId(groupId);
    const group = virtualGroup
        ? { id: groupId, name: virtualGroup.categoryName, title: virtualGroup.categoryName }
        : (appData.questionGroups || []).find(g => String(g.id) === String(groupId));
    if (!group) return;
    container.style.display = 'block';
    if (groupTitle) groupTitle.innerText = group.name || group.title || 'Soru Grubu';
    const questions = getQuestionsForGroup(groupId).map(normalizeQuestionBankQuestion).sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    const categories = [...new Set(questions.map(q => q.categoryName || 'Genel'))];
    if (groupStats) groupStats.innerText = `Toplam ${questions.length} soru, ${categories.length} kategori listeleniyor.`;
    if (!questions.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-dim);font-weight:700;font-size:0.8rem;">Bu gruba ait soru bulunmamaktadır.</td></tr>';
        return;
    }
    tbody.innerHTML = categories.map(categoryName => {
        const categoryQuestions = questions.filter(q => (q.categoryName || 'Genel') === categoryName);
        const rows = categoryQuestions.map((q, index) => {
            const isScale6 = q.answerType === 'scale6' || q.type === 'scale6';
            const answerLabel = q.answerType === 'boolean' ? 'Evet / Hayır' : (isScale6 ? "6'lı Sistem (0-5 Puan)" : (q.answerType || q.maxScore || 'Skala'));
            let answerPreview = '';
            if (q.answerType === 'boolean') {
                answerPreview = '<div style="display:flex;gap:0.3rem;margin-top:0.25rem;"><span style="font-size:0.6rem;color:#10b981;background:rgba(16,185,129,0.08);padding:0.1rem 0.35rem;border-radius:4px;font-weight:800;">EVET = 1</span><span style="font-size:0.6rem;color:#ef4444;background:rgba(239,68,68,0.08);padding:0.1rem 0.35rem;border-radius:4px;font-weight:800;">HAYIR = 0</span></div>';
            } else if (isScale6) {
                answerPreview = '<div style="display:flex;flex-wrap:wrap;gap:0.2rem;margin-top:0.25rem;"><span style="font-size:0.55rem;color:var(--text-secondary);background:rgba(255,255,255,0.05);padding:0.05rem 0.25rem;border-radius:3px;font-weight:700;">0 = %0</span><span style="font-size:0.55rem;color:var(--text-secondary);background:rgba(255,255,255,0.05);padding:0.05rem 0.25rem;border-radius:3px;font-weight:700;">1 = %25</span><span style="font-size:0.55rem;color:var(--text-secondary);background:rgba(255,255,255,0.05);padding:0.05rem 0.25rem;border-radius:3px;font-weight:700;">2 = %50</span><span style="font-size:0.55rem;color:var(--text-secondary);background:rgba(255,255,255,0.05);padding:0.05rem 0.25rem;border-radius:3px;font-weight:700;">3 = %80</span><span style="font-size:0.55rem;color:var(--text-secondary);background:rgba(255,255,255,0.05);padding:0.05rem 0.25rem;border-radius:3px;font-weight:700;">4 = %99</span><span style="font-size:0.55rem;color:var(--text-secondary);background:rgba(255,255,255,0.05);padding:0.05rem 0.25rem;border-radius:3px;font-weight:700;">5 = %100</span></div>';
            }
            return `<tr>
                <td style="font-weight:800;font-size:0.75rem;color:var(--text-dim);text-align:center;padding:0.35rem 0.65rem !important;">${index + 1}</td>
                <td style="max-width:380px;white-space:normal;line-height:1.35;font-size:0.8rem;font-weight:700;color:var(--text-primary);padding:0.35rem 0.65rem !important;">${escapeAttr(q.questionText)}</td>
                <td style="padding:0.35rem 0.65rem !important;">
                    <span style="font-size:0.7rem;color:var(--text-secondary);background:rgba(255,255,255,0.03);border:1px solid var(--border-main);padding:0.15rem 0.5rem;border-radius:999px;font-weight:700;display:inline-block;letter-spacing:0.2px;">${escapeAttr(answerLabel)}</span>
                    ${answerPreview}
                </td>
                <td style="padding:0.35rem 0.65rem !important;">
                    <span onclick="toggleQuestionStatus('${jsArg(q.id)}', ${q.isActive !== false})" style="font-size:0.65rem;color:${q.isActive === false ? 'var(--text-dim)' : '#10b981'};background:${q.isActive === false ? 'rgba(255,255,255,0.05)' : 'rgba(16,185,129,0.08)'};padding:0.12rem 0.45rem;border-radius:999px;font-weight:900;letter-spacing:0.3px;display:inline-block;cursor:pointer;user-select:none;transition:0.15s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'" title="Durumu değiştirmek için tıklayın">${q.isActive === false ? 'PASİF' : 'AKTİF'}</span>
                </td>
                <td style="padding:0.35rem 0.65rem !important;">
                    <button style="background:none;border:none;padding:2px 6px;cursor:pointer;color:var(--primary);text-transform:uppercase;font-size:0.65rem;transition:0.2s;font-weight:900;letter-spacing:0.3px;margin-right:8px;" onmouseover="this.style.color='var(--primary-hover)'" onmouseout="this.style.color='var(--primary)'" onclick="openEditQuestionModal('${jsArg(q.id)}')" title="Düzenle">Düzenle</button>
                    <button style="background:none;border:none;padding:2px 6px;cursor:pointer;color:var(--text-secondary);text-transform:uppercase;font-size:0.65rem;transition:0.2s;font-weight:900;letter-spacing:0.3px;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-secondary)'" onclick="deleteQuestion('${jsArg(q.id)}')" title="Sil">Sil</button>
                </td>
            </tr>`;
        }).join('');
        return `
            <tr class="question-category-header">
                <td colspan="5" style="padding:0.4rem 0.75rem !important;background:linear-gradient(135deg, rgba(37,99,235,0.08), rgba(16,185,129,0.05)) !important;border-top:1px solid rgba(255,255,255,0.04) !important;border-bottom:1px solid rgba(255,255,255,0.04) !important;">
                    <div class="question-category-title" style="display:flex;align-items:center;justify-content:space-between;font-size:0.75rem;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;">
                        <span style="color:var(--primary);">${escapeAttr(categoryName)}</span>
                        <span style="font-size:0.65rem;color:var(--text-secondary);background:rgba(255,255,255,0.04);border:1px solid var(--border-main);padding:0.1rem 0.45rem;border-radius:999px;font-weight:700;text-transform:none;">${categoryQuestions.length} Soru</span>
                    </div>
                </td>
            </tr>
            ${rows}
        `;
    }).join('');
}

function openEditQuestionGroupModal(groupId) {
    const group = (appData.questionGroups || []).find(g => String(g.id) === String(groupId));
    if (!group) return showToast('Soru grubu bulunamadı.');
    ensureEditQuestionGroupModal();
    document.getElementById('edit-group-id').value = group.id;
    document.getElementById('edit-group-name').value = group.name || group.title || '';
    document.getElementById('edit-group-icon').value = group.icon || 'fa-clipboard-check';
    document.getElementById('edit-group-scale').value = group.scoringStrategy || getQuestionBankAuditType(group.auditTypeId).scoringStrategy || 'scaleAverage';
    
    const type = (appData.auditTypes || []).find(t => (t.categories || []).some(c => String(c.id) === String(groupId)));
    const category = type ? (type.categories || []).find(c => String(c.id) === String(groupId)) : null;
    const weight = category && category.weight !== undefined ? category.weight : 1.0;
    document.getElementById('edit-group-weight').value = weight;
    
    updateEditGroupScaleInfo();
    document.getElementById('edit-group-modal').style.display = 'flex';
}

function ensureEditQuestionGroupModal() {
    if (document.getElementById('edit-group-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="edit-group-modal" class="modal-overlay" style="display:none;">
            <div class="modal-content" style="max-width:560px;">
                <div class="modal-header"><h3>Soru Grubunu Düzenle</h3><i class="fas fa-times close-modal" onclick="closeEditQuestionGroupModal()" style="cursor:pointer;"></i></div>
                <div class="modal-body" style="padding:1.5rem;">
                    <input type="hidden" id="edit-group-id">
                    <div class="input-group" style="margin-bottom:1rem;"><label style="display:block;font-size:.75rem;font-weight:800;color:var(--text-secondary);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:1px;">Soru Grubu Adı</label><input type="text" id="edit-group-name" class="cms-input"></div>
                    <div class="input-group" style="margin-bottom:1rem;"><label style="display:block;font-size:.75rem;font-weight:800;color:var(--text-secondary);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:1px;">İkon</label><select id="edit-group-icon" class="cms-input"><option value="fa-clipboard-check">Denetim</option><option value="fa-folder-open">Klasör</option><option value="fa-shield-alt">Güvenlik</option><option value="fa-broom">Temizlik</option><option value="fa-train-subway">Peron</option><option value="fa-ticket-alt">Turnike</option></select></div>
                    <div class="input-group" style="margin-bottom:1rem;"><label style="display:block;font-size:.75rem;font-weight:800;color:var(--text-secondary);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:1px;">Kategori Ağırlığı</label><input type="number" id="edit-group-weight" class="cms-input" min="0" step="0.1" value="1.0"></div>
                    <div class="input-group" style="margin-bottom:1rem;"><label style="display:block;font-size:.75rem;font-weight:800;color:var(--text-secondary);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:1px;">Skala Tipi</label><select id="edit-group-scale" class="cms-input" onchange="updateEditGroupScaleInfo()">${Object.entries(QUESTION_BANK_SCALE_OPTIONS).map(([value, opt]) => `<option value="${value}">${opt.label}</option>`).join('')}</select></div>
                    <div id="edit-group-scale-info" style="background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.35);border-radius:14px;padding:1rem;color:var(--text-primary);line-height:1.45;"></div>
                </div>
                <div class="modal-footer" style="padding:1.25rem 1.5rem;border-top:1px solid var(--border-main);display:flex;justify-content:flex-end;gap:.75rem;"><button class="btn-secondary" onclick="closeEditQuestionGroupModal()">Vazgeç</button><button class="btn-primary" onclick="saveQuestionGroupEdit()"><i class="fas fa-save"></i> Kaydet</button></div>
            </div>
        </div>
    `);
}

function updateEditGroupScaleInfo() {
    const strategy = document.getElementById('edit-group-scale')?.value || 'scaleAverage';
    const option = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    const info = document.getElementById('edit-group-scale-info');
    if (info) info.innerHTML = `<strong>${escapeAttr(option.label)}</strong><div style="margin-top:.35rem;color:var(--text-secondary);font-size:.86rem;">${escapeAttr(option.summary)}</div>`;
}

function closeEditQuestionGroupModal() {
    const modal = document.getElementById('edit-group-modal');
    if (modal) modal.style.display = 'none';
}




async function seedStationBooleanQuestionBank() {
    const groups = [
        ['station-group-giris', 'İSTASYON GİRİŞİ', 'fa-door-open', ['İstasyon yönlendirmeleri usule uygun mu?', 'İşletmeyi engelleyebileceği bir yapısal durum var mı?', 'Asansör emreamadeliğe uygun mu?', 'Yürüyen merdiven emreamadeliğe uygun mu?', 'Çevre ve giriş temizliği uygun mu?', 'Totem / alınlık temizlik ve yapısal durumu uygun mu?']],
        ['station-group-konkors-turnike', 'KONKORS TURNİKE', 'fa-ticket-alt', ['İstasyon yönlendirmeleri usule uygun mu?', 'İşletmeyi engelleyebileceği bir yapısal durum var mı?', 'Asansör emreamadeliğe uygun mu?', 'Yürüyen merdiven emreamadeliğe uygun mu?', 'Çevre ve giriş temizliği uygun mu?', 'Turnikeler dijital/mekanik olarak çalışıyor mu?', 'Bölge aydınlatmaları çalışıyor mu?', 'Biletmatikler sorunsuz dolum yapıyor mu?']],
        ['station-group-peron', 'PERON', 'fa-train-subway', ['İstasyon yönlendirmeleri usule uygun mu?', 'İşletmeyi engelleyebileceği bir yapısal durum var mı?', 'Asansör emreamadeliğe uygun mu?', 'Yürüyen merdiven emreamadeliğe uygun mu?', 'Çevre ve giriş temizliği uygun mu?', 'Bölge aydınlatmaları çalışıyor mu?', 'YBS ekranları doğru ve çalışır durumda mı?']],
        ['station-group-guvenlik', 'GÜVENLİK', 'fa-shield-alt', ['Görev numarasına uyumlu mu?', 'Personel yaka kimliği görünür durumda mı?', 'Personel teçhizatı uygun mu?', 'Personel kılık ve kıyafeti uygun mu?', 'Görev mahallini kontrol ediyor mu? Arama kontrolü yapıyor mu?', 'Yolculara karşı tutum ve davranışları uygun mudur?', 'Üstlerine ve çalışma arkadaşlarına karşı üslup ve davranışı uygun mudur?']],
        ['station-group-temizlik', 'TEMİZLİK', 'fa-broom', ['Temizlik odası tertip ve düzen kontrolü uygun mu?', 'Personel kılık kıyafeti kurumsal standartlara uygun mu?', 'Personel görev numarasına bağlı olarak iş planına uygun mu çalışıyor?', 'İş planında yer alan iş kalemlerini uygun ekipmanla mı yapıyor?', 'Üstleri ve çalışma arkadaşlarına karşı üslup ve iletişimi uygun mu?', 'Temizlik otomat makinası çalışma planına uygun mu?']]
    ];
    await db.collection('auditTypes').doc(QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID).set(QUESTION_BANK_STATION_AUDIT_TYPE, { merge: true });
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const [id, name, icon, questions] = groups[groupIndex];
        const group = normalizeQuestionBankGroup({ id, auditTypeId: QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID, name, title: name, icon, scoringStrategy: 'booleanAverage', orderIndex: groupIndex });
        await db.collection('auditQuestionGroups').doc(id).set(group, { merge: true });
        for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
            const qid = `${id}-q${questionIndex + 1}`;
            await db.collection('auditQuestions').doc(qid).set(normalizeQuestionBankQuestion({ id: qid, auditTypeId: QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID, groupId: id, categoryName: name, questionText: questions[questionIndex], answerType: 'boolean', maxScore: 1, orderIndex: questionIndex }), { merge: true });
        }
    }
}

async function removeAutoCreated5SAuditType() {
    const autoType = (appData.auditTypes || []).find(t => String(t.id) === 'audit-type-5s-denetimi');
    if (!autoType || autoType.isDeleted) return;
    const fiveSTypes = (appData.auditTypes || []).filter(t => {
        const name = String(t.title || t.name || '').toLocaleUpperCase('tr-TR');
        return !t.isDeleted && name.includes('5S');
    });
    if (fiveSTypes.length <= 1) return;
    await db.collection('auditTypes').doc('audit-type-5s-denetimi').set({
        isDeleted: true,
        isActive: false,
        deletedAt: new Date().toISOString(),
        deletedReason: 'genel denetim mevcut başlık içinden kategori gruplarına dönüştürüldü.'
    }, { merge: true });
}

async function migrateExisting5SGroupToCategoryGroups() {
    if (window.__migrateExisting5SGroupRunning) return;
    const fiveSType = (appData.auditTypes || []).find(t => {
        const name = String(t.title || t.name || '').toLocaleUpperCase('tr-TR');
        return !t.isDeleted && name.includes('5S') && String(t.id) !== 'audit-type-5s-denetimi';
    }) || (appData.auditTypes || []).find(t => {
        const name = String(t.title || t.name || '').toLocaleUpperCase('tr-TR');
        return !t.isDeleted && name.includes('5S');
    });
    if (!fiveSType) return;

    const required5SCategories = ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME'];
    const existingCategoryGroups = (appData.questionGroups || []).filter(g =>
        !g.isDeleted &&
        String(g.auditTypeId) === String(fiveSType.id) &&
        String(g.id || '').startsWith('5s-group-')
    );
    const hasAllCategoryGroups = required5SCategories.every(category =>
        existingCategoryGroups.some(g => String(g.name || g.title || '').toLocaleUpperCase('tr-TR') === category)
    );

    const candidates = (appData.questionGroups || []).map(group => {
        const questions = (appData.questions || [])
            .filter(q => String(q.groupId) === String(group.id) && !q.isDeleted)
            .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
        const categories = [...new Set(questions.map(q => q.categoryName || 'Genel'))];
        const groupName = String(group.name || group.title || '').toLocaleUpperCase('tr-TR');
        const belongsTo5S = String(group.auditTypeId || '') === String(fiveSType.id) || groupName.includes('5S');
        return { group, questions, categories, belongsTo5S };
    });

    let target = candidates.find(item =>
        item.belongsTo5S &&
        !item.group.isDeleted &&
        !String(item.group.id || '').startsWith('5s-group-') &&
        item.questions.length >= 30 &&
        item.categories.length > 1
    ) || candidates.find(item =>
        item.belongsTo5S &&
        !item.group.isDeleted &&
        !String(item.group.id || '').startsWith('5s-group-') &&
        item.categories.length > 1
    );
    if (!target && hasAllCategoryGroups) return;

    if (!target) {
        const legacy = await findLegacy5SQuestionGroupFromFirestore(fiveSType.id);
        if (!legacy) return;
        target = legacy;
    }

    const legacyGroup = target.group;
    const legacyQuestions = target.questions.length ? target.questions : getDefault5SQuestionsForRepair();
    const categories = required5SCategories;

    window.__migrateExisting5SGroupRunning = true;
    const auditTypeId = fiveSType.id;
    const iconMap = {
        'SINIFLANDIRMA': 'fa-boxes-stacked',
        'SIRALAMA': 'fa-list-check',
        'SİLME': 'fa-broom',
        'STANDARTLAŞTIRMA': 'fa-clipboard-list',
        'SAHİPLENME': 'fa-handshake'
    };

    for (let groupIndex = 0; groupIndex < categories.length; groupIndex++) {
        const categoryName = categories[groupIndex];
        const existingGroupForCategory = (appData.questionGroups || []).find(group =>
            !group.isDeleted &&
            String(group.auditTypeId) === String(auditTypeId) &&
            String(group.name || group.title || '').toLocaleUpperCase('tr-TR') === categoryName
        );
        const groupId = existingGroupForCategory?.id || `5s-group-${String(fiveSType.id).replace(/[^a-zA-Z0-9-]+/g, '-')}-${categoryName.toLocaleLowerCase('tr-TR').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, '-')}`;
        let categoryQuestions = legacyQuestions.filter(q => (q.categoryName || 'Genel') === categoryName);
        if (!categoryQuestions.length) {
            categoryQuestions = getDefault5SQuestionsForRepair().filter(q => q.categoryName === categoryName);
        }
        const group = normalizeQuestionBankGroup({
            ...(existingGroupForCategory || {}),
            id: groupId,
            auditTypeId,
            name: categoryName,
            title: categoryName,
            icon: iconMap[categoryName] || 'fa-folder-open',
            scoringStrategy: 'scaleAverage',
            allowedAnswerTypes: ['scale'],
            config: QUESTION_BANK_SCALE_OPTIONS.scaleAverage.config,
            orderIndex: Number(legacyGroup.orderIndex || 0) + groupIndex
        });
        await db.collection('auditQuestionGroups').doc(groupId).set(group, { merge: true });

        for (let questionIndex = 0; questionIndex < categoryQuestions.length; questionIndex++) {
            const source = categoryQuestions[questionIndex];
            const questionId = `5s-${groupId}-q${questionIndex + 1}`;
            await db.collection('auditQuestions').doc(questionId).set(normalizeQuestionBankQuestion({
                ...source,
                id: questionId,
                auditTypeId,
                groupId,
                categoryName,
                answerType: 'scale',
                maxScore: 5,
                orderIndex: questionIndex,
                migratedFrom: source.id || null
            }), { merge: true });
            if (!appData.questions.some(q => String(q.id) === String(questionId))) {
                appData.questions.push(normalizeQuestionBankQuestion({
                    ...source,
                    id: questionId,
                    auditTypeId,
                    groupId,
                    categoryName,
                    answerType: 'scale',
                    maxScore: 5,
                    orderIndex: questionIndex,
                    migratedFrom: source.id || null
                }));
            }
        }
    }

    await db.collection('auditQuestionGroups').doc(legacyGroup.id).set({
        isActive: true,
        isDeleted: false,
        migratedTo: '5s-category-groups',
        preservedAsSource: true,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    await db.collection('question_groups').doc(legacyGroup.id).set({
        isActive: true,
        isDeleted: false,
        migratedTo: '5s-category-groups',
        preservedAsSource: true,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    window.__migrateExisting5SGroupRunning = false;
}

function getDefault5SQuestionsForRepair() {
    return [
        { categoryName: 'SINIFLANDIRMA', questionText: 'Fazla Sarf Malzeme /Ekipman var mı?' },
        { categoryName: 'SINIFLANDIRMA', questionText: 'Fazla Demirbaş var mı?' },
        { categoryName: 'SINIFLANDIRMA', questionText: 'Kullanılmayan Malzeme/Ekipman/Doküman var mı?' },
        { categoryName: 'SINIFLANDIRMA', questionText: 'İşlevini Yitirmiş Malzeme/Ekipman/Doküman/İlk Yardım Çantası var mı?' },
        { categoryName: 'SINIFLANDIRMA', questionText: 'Ulaşılamayan oda, bölge veya alan var mı? (Kilitli odalar için kilitler sorumlu odasında bulunuyor mu?)' },
        { categoryName: 'SINIFLANDIRMA', questionText: 'Karantina alanına ihtiyaç var mı? Karantina alanı mevcut mu? Gereksiz/Fazla Malzeme ve ekipmanın kaydı tutulmuş mu?' },
        { categoryName: 'SIRALAMA', questionText: 'Yeri belli olmayan malzeme ekipman vb. var mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Yeri uygun olmayan malzeme ekipman vb. var mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Dekota / etiket çalışması yapılmış mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Temizlik Dolabı içinin etiketleri var mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Anahtarlık Dolabı içinin etiketleri var mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Acil Müdahale Dolabı içinin etiketleri var mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Soyunma Dolabı etiketleri var mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Diğer dolap içi etiketleri var mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Yer çizgisi çalışması ile alan belirlenmesi yapılmış mı?' },
        { categoryName: 'SIRALAMA', questionText: 'Stoklamaya önden başlama, farklı ürünlerin ayırt edilmesi, zemine direkt ekipman bırakılmaması ve yer tahsisinde derinlik/yükseklik kriterleri sağlanıyor mu?' },
        { categoryName: 'SIRALAMA', questionText: 'Temizlik malzemeleri ayrı dolaplarda ve uygun şekilde muhafaza ediliyor mu?' },
        { categoryName: 'SIRALAMA', questionText: 'Temizlik malzeme etiketleri ve Güvenlik Bilgi Formları (MSDS) var mı?' },
        { categoryName: 'SİLME', questionText: 'Zemin temiz tutuluyor ve akışkan maddelerin yerlere akmaması için gerekliyse koruyucu önlemler alınıyor mu?' },
        { categoryName: 'SİLME', questionText: 'Ekipmanlar ve malzemeler temiz tutuluyor mu?' },
        { categoryName: 'SİLME', questionText: 'Duvarlar, kolonlar, korkuluklar, panolar, yürüyen merdiven ve asansörler vb. boyalı ve/veya temiz tutuluyor mu?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'İstasyon Kat Planları var mı?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'Temizlik Odası Planları var mı?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'Dinlenme Odası Planı var mı?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'İstasyon Amirliği Odası Planı var mı?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'Varsa diğer odaların planı var mı? (İlk yardım, makinist, bebek bakım odası vb.)' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'Acil Müdahale Dolabı Planı var mı?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'Temizlik Dolabı planı var mı?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'Anahtarlık Dolabı Planı var mı?' },
        { categoryName: 'STANDARTLAŞTIRMA', questionText: 'İyileştirme panosu mevcut ve pano içinde olması gereken dökümanlar bulunuyor mu? (İstasyon denetim sorumlusu, Denetim Kontrol Formu, önce/sonra fotoğrafları vb.)' },
        { categoryName: 'SAHİPLENME', questionText: 'Tutum ve davranışlar denetim yaklaşımının faydalarının anlaşıldığını gösteriyor mu?' },
        { categoryName: 'SAHİPLENME', questionText: 'denetim standartlarını uygularken israflardan kaçınılmış mı?' },
        { categoryName: 'SAHİPLENME', questionText: 'denetim çalışması yaparken örnek alınacak uygulamalar geliştiriliyor mu?' }
    ].map((question, index) => ({ ...question, orderIndex: index, answerType: 'scale', maxScore: 5 }));
}

async function findLegacy5SQuestionGroupFromFirestore(auditTypeId) {
    const groupSnapshots = await Promise.all([
        db.collection('auditQuestionGroups').get(),
        db.collection('question_groups').get()
    ]);
    const groups = groupSnapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

    for (const group of groups) {
        if (group.isDeleted || String(group.id || '').startsWith('5s-group-')) continue;
        const groupName = String(group.name || group.title || '').toLocaleUpperCase('tr-TR');
        const belongsTo5S = String(group.auditTypeId || '') === String(auditTypeId) || groupName.includes('5S');
        if (!belongsTo5S) continue;

        const questionSnapshots = await Promise.all([
            db.collection('auditQuestions').where('groupId', '==', group.id).get(),
            db.collection('questions').where('groupId', '==', group.id).get()
        ]);
        const questions = questionSnapshots
            .flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
            .filter(q => !q.isDeleted)
            .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
        const categories = [...new Set(questions.map(q => q.categoryName || 'Genel'))];

        if (questions.length >= 30 && categories.length > 1) {
            return { group, questions, categories, belongsTo5S: true };
        }
    }

    return null;
}

async function cleanupDuplicate5SGroups() {
    if (window.__cleanupDuplicate5SGroupsRunning) return;
    const fiveSType = (appData.auditTypes || []).find(t => {
        const name = String(t.title || t.name || '').toLocaleUpperCase('tr-TR');
        return !t.isDeleted && name.includes('5S') && String(t.id) !== 'audit-type-5s-denetimi';
    }) || (appData.auditTypes || []).find(t => {
        const name = String(t.title || t.name || '').toLocaleUpperCase('tr-TR');
        return !t.isDeleted && name.includes('5S');
    });
    if (!fiveSType) return;

    const groups = (appData.questionGroups || [])
        .filter(g => !g.isDeleted && String(g.auditTypeId) === String(fiveSType.id))
        .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    const required5SCategories = ['SINIFLANDIRMA', 'SIRALAMA', 'SİLME', 'STANDARTLAŞTIRMA', 'SAHİPLENME'];
    const hasAllCategoryGroups = required5SCategories.every(category =>
        groups.some(g => String(g.id || '').startsWith('5s-group-') && String(g.name || g.title || '').toLocaleUpperCase('tr-TR') === category)
    );
    const seen = new Set();
    const duplicates = [];

    groups.forEach(group => {
        const name = String(group.name || group.title || '').trim();
        const upperName = name.toLocaleUpperCase('tr-TR');
        const isMigrated5SCategory = String(group.id || '').startsWith('5s-group-');

        if (hasAllCategoryGroups && upperName.includes('5S') && !isMigrated5SCategory) {
            duplicates.push(group);
            return;
        }

        if (seen.has(upperName)) {
            duplicates.push(group);
            return;
        }
        seen.add(upperName);
    });

    if (!duplicates.length) return;
    window.__cleanupDuplicate5SGroupsRunning = true;
    for (const group of duplicates) {
        await db.collection('auditQuestionGroups').doc(group.id).set({
            isDeleted: true,
            isActive: false,
            hiddenReason: '5S kategori grupları tekilleştirildi.',
            updatedAt: new Date().toISOString()
        }, { merge: true });
    }
    window.__cleanupDuplicate5SGroupsRunning = false;
}

function getLineStationName(station) {
    if (typeof station === 'string') return station;
    return String(station?.name || station?.title || station?.id || '').trim();
}

function getSortedLineStations(lineName) {
    const stationNums = appData.stationNumbers?.[lineName] || {};
    return (appData.stations?.[lineName] || [])
        .map(station => getLineStationName(station))
        .filter(Boolean)
        .sort((left, right) => {
            const leftNumber = Number(stationNums[left]);
            const rightNumber = Number(stationNums[right]);
            const safeLeft = Number.isFinite(leftNumber) ? leftNumber : Number.MAX_SAFE_INTEGER;
            const safeRight = Number.isFinite(rightNumber) ? rightNumber : Number.MAX_SAFE_INTEGER;
            return safeLeft - safeRight || left.localeCompare(right, 'tr', { numeric: true });
        });
}

function normalizeLineSearchText(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0131/g, 'i');
}

function updateLineNetworkSummary(lines) {
    const totalStations = lines.reduce((sum, line) => sum + getSortedLineStations(line).length, 0);
    const values = {
        'lines-total-count': lines.length,
        'stations-total-count': totalStations
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
}

// Hat ve İstasyon Yönetimi professional network layout.
function renderLines() {
    const container = document.getElementById('lines-table-body');
    if (!container) return;

    const lines = Object.keys(appData.lineColors || {})
        .sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
    updateLineNetworkSummary(lines);

    const searchInput = document.getElementById('lines-search-input');
    const query = normalizeLineSearchText(searchInput?.value || '');
    const visibleLines = lines.filter(line => {
        if (!query) return true;
        const stations = getSortedLineStations(line);
        return normalizeLineSearchText([line, ...stations].join(' ')).includes(query);
    });

    const summary = document.getElementById('lines-summary-card');
    if (summary) {
        summary.textContent = `${visibleLines.length} / ${lines.length} hat`;
    }

    const emptyState = document.getElementById('lines-empty-state');
    const emptyText = document.getElementById('lines-empty-state-text');
    if (!visibleLines.length) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'flex';
        if (emptyText) {
            emptyText.textContent = query
                ? 'Aramanızla eşleşen bir hat veya istasyon bulunamadı.'
                : 'Henüz tanımlı bir hat bulunmuyor.';
        }
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

    const rowsHtml = visibleLines.map((line) => {
        const stations = getSortedLineStations(line);
        const color = appData.lineColors?.[line] || '#2563eb';

        return `
            <tr class="people-row" style="--line-color:${escapeAttr(color)};">
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); vertical-align: middle;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div class="line-network-logo" style="background:${escapeAttr(color)}; width: 36px; height: 36px; flex: 0 0 36px; box-shadow: none; font-size: 0.65rem; border-width: 2px;">${escapeAttr(line)}</div>
                        <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">${escapeAttr(line)} Hattı</span>
                    </div>
                </td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); vertical-align: middle;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">
                        <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${escapeAttr(color)}; border: 1px solid rgba(255,255,255,0.2);"></span>
                        <span>${escapeAttr(color)}</span>
                    </div>
                </td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); vertical-align: middle;">
                    <span style="font-weight: 700; font-size: 0.8rem; background: rgba(59, 130, 246, 0.08); color: #3b82f6; padding: 0.25rem 0.6rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="fas fa-location-dot" style="font-size: 0.7rem;"></i> ${stations.length} İstasyon
                    </span>
                </td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: center; vertical-align: middle;">
                    <div style="display: flex; gap: 0.4rem; justify-content: center; align-items: center;">
                        <button class="btn-primary" onclick="viewStations('${jsArg(line)}')" title="İstasyonları Yönet" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                            <i class="fas fa-location-dot" style="font-size: 0.7rem;"></i> İstasyonları Yönet
                        </button>
                        <button class="btn-outline" onclick="openEditLineModal('${jsArg(line)}')" title="Hattı Düzenle" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: none; border: 1px solid var(--border-main); color: var(--text-secondary); cursor: pointer; transition: all 0.2s;">
                            <i class="fas fa-pen" style="font-size: 0.7rem;"></i>
                        </button>
                        <button class="btn-outline" onclick="removeLineFromFirebase('${jsArg(line)}')" title="Hattı Sil" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: none; border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.05)'" onmouseout="this.style.background='none'">
                            <i class="fas fa-trash-alt" style="font-size: 0.7rem;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="table-responsive">
            <table class="cms-table people-table" style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">Hat</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">Hat Rengi</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">İstasyon Sayısı</th>
                        <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: center; width: 260px;">İşlemler</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;
}

function viewStations(lineName) {
    const title = document.getElementById('station-modal-title');
    const body = document.getElementById('station-modal-body');
    if (!title || !body) return;

    const stationNums = appData.stationNumbers?.[lineName] || {};
    const stations = getSortedLineStations(lineName);
    const color = appData.lineColors?.[lineName] || '#2563eb';

    title.innerHTML = `
        <div class="station-modal-title-wrap">
            <div class="station-modal-line-logo" style="background:${escapeAttr(color)};">${escapeAttr(lineName)}</div>
            <div>
                <span>Hat İstasyon Yönetimi</span>
                <strong>${escapeAttr(lineName)} Hattı</strong>
            </div>
        </div>
    `;

    const stationListHtml = stations.length
        ? stations.map((station, index) => {
            const num = stationNums[station] ?? index + 1;
            const nfcKey = `${lineName}_${station}`;
            const nfcData = appData.stationNfcs?.[nfcKey];
            const locData = appData.stationLocations?.[nfcKey];
            const nfcBadge = nfcData && nfcData.uid 
                ? `<span class="station-nfc-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;"><i class="fa-solid fa-nfc-directional" style="margin-right:2px;"></i> NFC: ${escapeAttr(nfcData.uid)}</span>` 
                : `<span class="station-nfc-badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;"><i class="fas fa-ban" style="margin-right:2px;"></i> NFC Yok</span>`;
            const locBadge = locData && locData.latitude && locData.longitude
                ? `<span class="station-loc-badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;"><i class="fas fa-location-dot" style="margin-right:2px;"></i> Konum: ${locData.latitude.toFixed(4)}, ${locData.longitude.toFixed(4)} (${locData.radius}m)</span>`
                : `<span class="station-loc-badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;"><i class="fas fa-ban" style="margin-right:2px;"></i> Konum Yok</span>`;
            return `
            <tr class="people-row station-network-item"
                data-station-search="${escapeAttr(normalizeLineSearchText(`${num} ${station}`))}"
                style="--line-color:${escapeAttr(color)};">
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); vertical-align: middle;">
                    <span class="station-premium-index" style="width: 28px; height: 28px; font-size: 0.7rem; border-radius: 6px;">${escapeAttr(num)}</span>
                </td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); vertical-align: middle;">
                    <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">${escapeAttr(station)}</div>
                    <div style="font-size: 0.68rem; color: var(--text-dim); margin-top: 2px;">${escapeAttr(lineName)} hattı · ${escapeAttr(num)}. sıra</div>
                </td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); vertical-align: middle;">
                    <div style="display: inline-flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
                        ${nfcBadge}
                        ${locBadge}
                    </div>
                </td>
                <td style="padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: center; vertical-align: middle;">
                    <div style="display: flex; gap: 0.4rem; justify-content: center; align-items: center;">
                        <button class="btn-outline" onclick="editStationInLine('${jsArg(lineName)}', '${jsArg(station)}')" title="İstasyonu Düzenle" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: none; border: 1px solid var(--border-main); color: var(--text-secondary); cursor: pointer; transition: all 0.2s;">
                            <i class="fas fa-pen" style="font-size: 0.7rem;"></i>
                        </button>
                        <button class="btn-outline" onclick="removeStationFromFirebase('${jsArg(lineName)}', '${jsArg(station)}')" title="İstasyonu Sil" style="width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: none; border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.05)'" onmouseout="this.style.background='none'">
                            <i class="fas fa-trash-alt" style="font-size: 0.7rem;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `}).join('')
        : '';

    body.innerHTML = `
        <div class="station-network-shell" style="--line-color:${escapeAttr(color)};">
            <div class="station-network-overview">
                <div class="station-network-overview-icon"><i class="fas fa-route"></i></div>
                <div>
                    <strong>${stations.length} istasyon</strong>
                    <span>Hat güzergâhındaki sıralı istasyon listesi</span>
                </div>
                <button class="btn-primary station-network-add-btn" onclick="addStationToLine('${jsArg(lineName)}')">
                    <i class="fas fa-plus"></i> Yeni İstasyon
                </button>
            </div>

            <div class="station-network-toolbar">
                <label class="station-network-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input type="search" placeholder="İstasyon veya sıra numarası ara..." oninput="filterStationModal(this.value)" autocomplete="off">
                </label>
                <span id="station-modal-result-count">${stations.length} kayıt</span>
            </div>

            <div class="station-premium-table-container table-responsive" style="max-height: min(440px, 52vh); overflow-y: auto;">
                <table class="cms-table people-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left; width: 60px;">Sıra</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">İstasyon</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: left;">Donanım / Durum</th>
                            <th style="font-weight: 850; font-size: 0.72rem; text-transform: uppercase; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--border-main); text-align: center; width: 100px;">İşlemler</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stationListHtml || `<tr><td colspan="4" style="text-align:center; padding:2.5rem; color:var(--text-dim); font-weight:700; font-size:0.8rem;">Henüz istasyon tanımlanmadı.</td></tr>`}
                    </tbody>
                </table>
            </div>

            <div id="station-modal-empty-state" class="station-network-empty" style="display:${stations.length ? 'none' : 'flex'};">
                <span><i class="fas fa-location-dot"></i></span>
                <strong>${stations.length ? 'Eşleşen istasyon bulunamadı' : 'Henüz istasyon tanımlanmadı'}</strong>
                <small>${stations.length ? 'Arama ifadenizi değiştirerek tekrar deneyin.' : 'Yeni İstasyon butonuyla bu hattın ilk istasyonunu ekleyin.'}</small>
            </div>
        </div>
    `;

    document.getElementById('station-modal').style.display = 'flex';
}

function filterStationModal(value) {
    const query = normalizeLineSearchText(value);
    const items = Array.from(document.querySelectorAll('#station-modal-body .station-network-item'));
    const count = document.getElementById('station-modal-result-count');
    const empty = document.getElementById('station-modal-empty-state');
    let visibleCount = 0;

    items.forEach(item => {
        const matches = !query || String(item.dataset.stationSearch || '').includes(query);
        item.style.display = matches ? '' : 'none';
        if (matches) visibleCount += 1;
    });

    if (count) count.textContent = `${visibleCount} / ${items.length} kayıt`;
    if (empty) {
        empty.style.display = visibleCount ? 'none' : 'flex';
        const title = empty.querySelector('strong');
        const description = empty.querySelector('small');
        if (title) title.textContent = items.length ? 'Eşleşen istasyon bulunamadı' : 'Henüz istasyon tanımlanmadı';
        if (description) {
            description.textContent = items.length
                ? 'Arama ifadenizi değiştirerek tekrar deneyin.'
                : 'Yeni İstasyon butonuyla bu hattın ilk istasyonunu ekleyin.';
        }
    }
}

function normalizeQuestionBankSearchText(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0131/g, 'i')
        .replace(/\u0130/g, 'i')
        .replace(/\u011f/g, 'g')
        .replace(/\u00fc/g, 'u')
        .replace(/\u015f/g, 's')
        .replace(/\u00f6/g, 'o')
        .replace(/\u00e7/g, 'c');
}

function isDefaultStationAuditType(type = {}) {
    const searchable = normalizeQuestionBankSearchText(`${type.id || ''} ${type.title || ''} ${type.name || ''}`);
    return String(type.id || '') === QUESTION_BANK_DEFAULT_AUDIT_TYPE_ID || searchable.includes('istasyon');
}

function isDefaultFiveSAuditType(type = {}) {
    const searchable = normalizeQuestionBankSearchText(`${type.id || ''} ${type.title || ''} ${type.name || ''}`);
    return searchable.includes('5s');
}

function buildDefaultStationCategories(type = {}) {
    const groups = [
        ['station-group-giris', 'İSTASYON GİRİŞİ', 'fa-door-open', ['İstasyon yönlendirmeleri usule uygun mu?', 'İşletmeyi engelleyebileceği bir yapısal durum var mı?', 'Asansör emreamadeliğe uygun mu?', 'Yürüyen merdiven emreamadeliğe uygun mu?', 'Çevre ve giriş temizliği uygun mu?', 'Totem / alınlık temizlik ve yapısal durumu uygun mu?']],
        ['station-group-konkors-turnike', 'KONKORS TURNİKE', 'fa-ticket-alt', ['İstasyon yönlendirmeleri usule uygun mu?', 'İşletmeyi engelleyebileceği bir yapısal durum var mı?', 'Asansör emreamadeliğe uygun mu?', 'Yürüyen merdiven emreamadeliğe uygun mu?', 'Çevre ve giriş temizliği uygun mu?', 'Turnikeler dijital/mekanik olarak çalışıyor mu?', 'Bölge aydınlatmaları çalışıyor mu?', 'Biletmatikler sorunsuz dolum yapıyor mu?']],
        ['station-group-peron', 'PERON', 'fa-train-subway', ['İstasyon yönlendirmeleri usule uygun mu?', 'İşletmeyi engelleyebileceği bir yapısal durum var mı?', 'Asansör emreamadeliğe uygun mu?', 'Yürüyen merdiven emreamadeliğe uygun mu?', 'Çevre ve giriş temizliği uygun mu?', 'Bölge aydınlatmaları çalışıyor mu?', 'YBS ekranları doğru ve çalışır durumda mı?']],
        ['station-group-guvenlik', 'GÜVENLİK', 'fa-shield-alt', ['Görev numarasına uyumlu mu?', 'Personel yaka kimliği görünür durumda mı?', 'Personel teçhizatı uygun mu?', 'Personel kılık ve kıyafeti uygun mu?', 'Görev mahallini kontrol ediyor mu? Arama kontrolü yapıyor mu?', 'Yolculara karşı tutum ve davranışları uygun mudur?', 'Üstlerine ve çalışma arkadaşlarına karşı üslup ve davranışı uygun mudur?']],
        ['station-group-temizlik', 'TEMİZLİK', 'fa-broom', ['Temizlik odası tertip ve düzen kontrolü uygun mu?', 'Personel kılık kıyafeti kurumsal standartlara uygun mu?', 'Personel görev numarasına bağlı olarak iş planına uygun mu çalışıyor?', 'İş planında yer alan iş kalemlerini uygun ekipmanla mı yapıyor?', 'Üstleri ve çalışma arkadaşlarına karşı üslup ve iletişimi uygun mu?', 'Temizlik otomat makinası çalışma planına uygun mu?']]
    ];

    return groups.map(([id, name, icon, questions], categoryIndex) => normalizeAuditModelCategory({
        id,
        auditTypeId: type.id,
        name,
        title: name,
        icon,
        orderIndex: categoryIndex,
        questions: questions.map((questionText, questionIndex) => normalizeAuditModelQuestion({
            id: `${id}-q${questionIndex + 1}`,
            auditTypeId: type.id,
            categoryId: id,
            groupId: id,
            categoryName: name,
            text: questionText,
            questionText,
            type: 'yes-no',
            answerType: 'boolean',
            maxScore: 1,
            orderIndex: questionIndex
        }, { id, name }, type))
    }, type));
}

function buildDefaultFiveSCategories(type = {}) {
    const iconMap = {
        'SINIFLANDIRMA': 'fa-boxes-stacked',
        'SIRALAMA': 'fa-list-check',
        'SİLME': 'fa-broom',
        'STANDARTLAŞTIRMA': 'fa-clipboard-list',
        'SAHİPLENME': 'fa-handshake'
    };
    const questions = getDefault5SQuestionsForRepair();
    const categoryNames = [...new Set(questions.map(question => question.categoryName || 'Genel'))];

    return categoryNames.map((name, categoryIndex) => {
        const id = `5s-group-${String(type.id || 'default').replace(/[^a-zA-Z0-9-]+/g, '-')}-${toStableId('category', name).replace(/^category-/, '')}`;
        const categoryQuestions = questions.filter(question => (question.categoryName || 'Genel') === name);
        return normalizeAuditModelCategory({
            id,
            auditTypeId: type.id,
            name,
            title: name,
            icon: iconMap[name] || 'fa-folder-open',
            orderIndex: categoryIndex,
            questions: categoryQuestions.map((question, questionIndex) => normalizeAuditModelQuestion({
                ...question,
                id: `5s-${id}-q${questionIndex + 1}`,
                auditTypeId: type.id,
                categoryId: id,
                groupId: id,
                categoryName: name,
                text: question.text || question.questionText,
                questionText: question.questionText || question.text,
                type: '5s-score',
                answerType: 'scale',
                maxScore: 5,
                orderIndex: questionIndex
            }, { id, name }, type))
        }, type);
    });
}

function buildDefaultCategoriesForAuditType(type = {}) {
    if (isDefaultStationAuditType(type)) return buildDefaultStationCategories(type);
    if (isDefaultFiveSAuditType(type)) return buildDefaultFiveSCategories(type);
    return [];
}

function persistDefaultCategoriesForEmptyAuditTypes(rawTypes = [], normalizedTypes = []) {
    if (typeof db === 'undefined' || !db) return;
    window.__defaultAuditTypeCategoryPersist = window.__defaultAuditTypeCategoryPersist || {};
    normalizedTypes.forEach(type => {
        if (!isDefaultStationAuditType(type) && !isDefaultFiveSAuditType(type)) return;
        if (!(type.categories || []).length) return;
        const rawType = rawTypes.find(item => String(item.id) === String(type.id)) || {};
        const rawHasUsableCategories = Array.isArray(rawType.categories) && rawType.categories.some(category =>
            !category.isDeleted && Array.isArray(category.questions) && category.questions.some(question => !question.isDeleted)
        );
        if (rawHasUsableCategories || window.__defaultAuditTypeCategoryPersist[type.id]) return;
        window.__defaultAuditTypeCategoryPersist[type.id] = true;
        db.collection('auditTypes').doc(type.id).set({
            categories: type.categories,
            defaultAnswerValue: type.defaultAnswerValue,
            modelVersion: AUDIT_MODEL_VERSION,
            updatedAt: new Date().toISOString()
        }, { merge: true }).catch(err => {
            window.__defaultAuditTypeCategoryPersist[type.id] = false;
            console.error('Default audit categories persist error:', err);
        });
    });
}

// Effective new-model overrides. This block must stay last because this file has legacy duplicates.
function normalizeQuestionBankType(type = {}) {
    const isStation = isDefaultStationAuditType(type);
    const strategy = isStation ? 'booleanAverage' : (type.scoringStrategy || 'scaleAverage');
    const scale = QUESTION_BANK_SCALE_OPTIONS[strategy] || QUESTION_BANK_SCALE_OPTIONS.scaleAverage;
    const normalized = {
        ...type,
        id: type.id || toStableId('audit-type', type.title || type.name || 'Denetim Tipi'),
        name: type.name || type.title || 'Denetim Tipi',
        title: type.title || type.name || 'Denetim Tipi',
        defaultAnswerValue: type.defaultAnswerValue ?? (isStation ? true : 5),
        scoringStrategy: strategy,
        allowedAnswerTypes: isStation ? ['boolean'] : (type.allowedAnswerTypes || scale.allowedAnswerTypes),
        config: isStation ? QUESTION_BANK_SCALE_OPTIONS.booleanAverage.config : (type.config || scale.config),
        evidenceRequired: type.evidenceRequired !== undefined ? Boolean(type.evidenceRequired) : (isStation ? false : strategy !== 'none'),
        evidenceRule: type.evidenceRule || 'nonconformity',
        evidenceRequiredValues: normalizeAuditEvidenceRequiredValues(type.evidenceRequiredValues || type.evidenceValues || type.requiredEvidenceAnswers, strategy, type.config || scale.config, type.evidenceRequired !== false),
        isActive: type.isActive !== false,
        isDeleted: type.isDeleted === true,
        orderIndex: Number(type.orderIndex) || 0,
        modelVersion: Number(type.modelVersion) || (Array.isArray(type.categories) ? AUDIT_MODEL_VERSION : 1)
    };
    normalized.categories = (type.categories || [])
        .map(category => normalizeAuditModelCategory(category, normalized))
        .filter(category => !category.isDeleted);
    const hasCategoryQuestions = normalized.categories.some(category =>
        (category.questions || []).some(question => !question.isDeleted && question.isActive !== false)
    );
    if ((!normalized.categories.length || !hasCategoryQuestions) && (isDefaultStationAuditType(normalized) || isDefaultFiveSAuditType(normalized))) {
        normalized.categories = buildDefaultCategoriesForAuditType(normalized);
        if (normalized.categories.length) normalized.modelVersion = AUDIT_MODEL_VERSION;
    }
    return normalized;
}

function getQuestionsForGroup(groupId) {
    return (appData.questions || [])
        .filter(question => String(question.groupId || question.categoryId) === String(groupId) && !question.isDeleted)
        .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
}

async function saveAuditTypeCategories(auditTypeId, categories) {
    await db.collection('auditTypes').doc(auditTypeId).set({
        categories,
        modelVersion: AUDIT_MODEL_VERSION,
        updatedAt: new Date().toISOString()
    }, { merge: true });
}

async function processNewGroup() {
    const name = document.getElementById('new-group-name')?.value.trim();
    const icon = document.getElementById('new-group-icon')?.value || 'fa-layer-group';
    if (!name) return showToast('Lutfen kategori adini giriniz.');
    const type = getQuestionBankAuditType(appData.selectedAuditTypeId);
    const categories = [...(type.categories || [])];
    categories.push(normalizeAuditModelCategory({
        id: `CAT-${Date.now()}`,
        auditTypeId: type.id,
        name,
        icon,
        orderIndex: categories.length,
        questions: []
    }, type));
    await saveAuditTypeCategories(type.id, categories);
    const localType = (appData.auditTypes || []).find(item => String(item.id) === String(type.id));
    if (localType) localType.categories = categories;
    closeGroupModal();
    showToast('Kategori olusturuldu.');
    checkAndWarnCategoryWeights(type.id);
}

async function saveQuestionGroupEdit() {
    const id = document.getElementById('edit-group-id')?.value;
    const name = document.getElementById('edit-group-name')?.value.trim();
    const icon = document.getElementById('edit-group-icon')?.value || 'fa-layer-group';
    const weightVal = document.getElementById('edit-group-weight')?.value;
    const weight = weightVal !== undefined && weightVal !== '' ? parseFloat(weightVal) : 1.0;
    if (!id || !name) return showToast('Kategori adini giriniz.');
    const type = (appData.auditTypes || []).find(t => (t.categories || []).some(c => String(c.id) === String(id)));
    if (!type) return showToast('Kategori bulunamadi.');
    const categories = (type.categories || []).map(category => String(category.id) === String(id)
        ? normalizeAuditModelCategory({ ...category, name, title: name, icon, weight: isNaN(weight) ? 1.0 : weight, updatedAt: new Date().toISOString() }, type)
        : category);
    await saveAuditTypeCategories(type.id, categories);
    const localType = (appData.auditTypes || []).find(item => String(item.id) === String(type.id));
    if (localType) localType.categories = categories;
    closeEditQuestionGroupModal();
    showToast('Kategori guncellendi.');
    checkAndWarnCategoryWeights(type.id);
}


function installQuestionBankRealtime() {
    if (window.__questionBankRealtimeInstalled) return;
    window.__questionBankRealtimeInstalled = true;
    db.collection('auditTypes').orderBy('orderIndex').onSnapshot(snapshot => {
        const rawTypes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const types = rawTypes.map(type => normalizeQuestionBankType(type)).filter(t => !t.isDeleted);
        appData.auditTypes = types.length ? types : [normalizeQuestionBankType(QUESTION_BANK_STATION_AUDIT_TYPE)];
        if (!appData.auditTypes.some(t => t.id === appData.selectedAuditTypeId)) appData.selectedAuditTypeId = appData.auditTypes[0]?.id;
        persistDefaultCategoriesForEmptyAuditTypes(rawTypes, appData.auditTypes);
        deriveCompatibilityCollectionsFromAuditTypes();
        populateAuditTypeFilters();
        migrateOldQuestionGroupsToAuditTypes();
        renderQuestionGroups();
        if (appData.selectedGroupId) renderQuestions(appData.selectedGroupId);
        if (typeof renderPlanning === 'function') renderPlanning();
        updateStats();
        renderAllAuditsTable();
        renderNCs();
    }, err => console.error('Audit types sync error:', err));
    db.collection('auditQuestionGroups').orderBy('orderIndex').onSnapshot(snapshot => {
        appData.legacyQuestionGroups = snapshot.docs.map(doc => normalizeQuestionBankGroup({ id: doc.id, ...doc.data() })).filter(g => !g.isDeleted);
        if (!hasAuditTypeCategories()) appData.questionGroups = appData.legacyQuestionGroups;
        migrateOldQuestionGroupsToAuditTypes();
        renderQuestionGroups();
    }, err => console.error('Legacy audit category sync error:', err));
    db.collection('auditQuestions').orderBy('orderIndex').onSnapshot(snapshot => {
        appData.legacyQuestions = snapshot.docs.map(doc => normalizeQuestionBankQuestion({ id: doc.id, ...doc.data() })).filter(q => !q.isDeleted);
        if (!hasAuditTypeCategories()) appData.questions = appData.legacyQuestions;
        migrateOldQuestionGroupsToAuditTypes();
        if (!appData.selectedGroupId && appData.questionGroups.length) appData.selectedGroupId = appData.questionGroups[0].id;
        renderQuestionGroups();
        if (appData.selectedGroupId) renderQuestions(appData.selectedGroupId);
    }, err => console.error('Legacy audit questions sync error:', err));
}

// Final question add overrides: active end-of-file copy.
function openAddQuestionModal() {
    const select = document.getElementById('new-q-group');
    if (!select) return;
    const selectedTypeId = appData.selectedAuditTypeId || appData.auditTypes?.[0]?.id;
    const categories = (appData.questionGroups || [])
        .filter(group => String(group.auditTypeId) === String(selectedTypeId) && group.isActive !== false && !group.isDeleted)
        .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));

    if (!categories.length) {
        showToast('Once bu denetim tipi icin kategori olusturun.');
        return;
    }

    select.innerHTML = categories.map(category => `
        <option value="${escapeAttr(category.id)}" ${String(appData.selectedGroupId || '') === String(category.id) ? 'selected' : ''}>
            ${escapeAttr(category.name || category.title || 'Kategori')}
        </option>
    `).join('');

    const categoryWrapper = document.getElementById('new-q-category-wrapper') || document.getElementById('new-q-category')?.closest('.input-group');
    if (categoryWrapper) categoryWrapper.style.display = 'none';
    const categoryInput = document.getElementById('new-q-category');
    if (categoryInput) categoryInput.value = '';
    const questionInput = document.getElementById('new-q-text');
    if (questionInput) questionInput.value = '';
    document.getElementById('question-modal').style.display = 'flex';
}

async function processNewQuestion() {
    const categoryId = document.getElementById('new-q-group')?.value;
    const questionText = document.getElementById('new-q-text')?.value.trim();
    if (!categoryId || !questionText) return showToast('Lutfen kategori ve soru metnini giriniz.');

    const type = (appData.auditTypes || []).find(item =>
        (item.categories || []).some(category => String(category.id) === String(categoryId))
    ) || getQuestionBankAuditType(appData.selectedAuditTypeId);
    const category = (type.categories || []).find(item => String(item.id) === String(categoryId));
    if (!category) return showToast('Kategori bulunamadi.');

    const selectedTypeVal = document.getElementById('new-q-type')?.value || '5s-score';
    let qType = '5s-score';
    let qAnswerType = 'scale';
    let qMaxScore = 5;

    if (selectedTypeVal === 'scale6') {
        qType = 'scale6';
        qAnswerType = 'scale6';
        qMaxScore = 5;
    } else if (selectedTypeVal === 'yes-no') {
        qType = 'yes-no';
        qAnswerType = 'boolean';
        qMaxScore = 1;
    }

    const categories = (type.categories || []).map(item => {
        if (String(item.id) !== String(categoryId)) return item;
        const questions = [...(item.questions || [])];
        questions.push(normalizeAuditModelQuestion({
            id: `Q-${Date.now()}`,
            auditTypeId: type.id,
            categoryId: item.id,
            groupId: item.id,
            categoryName: item.name,
            text: questionText,
            questionText,
            type: qType,
            answerType: qAnswerType,
            maxScore: qMaxScore,
            orderIndex: questions.length
        }, item, type));
        return normalizeAuditModelCategory({ ...item, questions }, type);
    });

    try {
        await saveAuditTypeCategories(type.id, categories);
        const localType = (appData.auditTypes || []).find(item => String(item.id) === String(type.id));
        if (localType) localType.categories = categories;
        appData.selectedGroupId = categoryId;
        deriveCompatibilityCollectionsFromAuditTypes();
        closeQuestionModal();
        renderQuestionGroups();
        renderQuestions(categoryId);
        showToast('Soru kategoriye eklendi.');
    } catch (err) {
        console.error('Question add error:', err);
        showToast(`Soru eklenemedi: ${err && err.message ? err.message : 'bilinmeyen hata'}`);
    }
}
// Final audit type selector override: active end-of-file copy.
function renderAuditTypes() {
    ensureQuestionBankState();
    const existing = document.getElementById('audit-types-container');
    const container = existing || document.getElementById('question-groups-container')?.parentElement;
    if (!container) return;

    const wrap = existing || document.createElement('div');
    const auditTypes = (appData.auditTypes || []).filter(type => !type.isDeleted);
    wrap.id = 'audit-types-container';
    wrap.className = 'audit-types-panel';
    wrap.style.marginBottom = '1.5rem';
    wrap.innerHTML = `
        <div class="section-header" style="position: static !important; margin-bottom: 0.65rem; background: transparent !important; border: none; box-shadow: none; padding: 0;">
            <div>
                <h2 style="margin:0; font-size:1.4rem; font-weight:900;">Denetim Tipleri</h2>
                <p class="audit-types-subtitle" style="margin: 0.2rem 0 0 0; font-size:0.78rem; color:var(--text-secondary);">Kategori ve sorular seçili denetim tipine göre listelenir.</p>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
                <input type="file" id="excel-import-input" accept=".xlsx, .xls" style="display:none;" onchange="handleQuestionBankExcelImport(event)">
                <button class="btn-outline" onclick="downloadQuestionBankTemplate()" onmouseover="this.style.background='var(--primary)'; this.style.color='white';" onmouseout="this.style.background='transparent'; this.style.color='var(--primary)';" style="padding:0.45rem 0.85rem; font-size:0.75rem; border-radius:10px; height:34px; display:inline-flex; align-items:center; gap:0.4rem; font-weight:800; border-color:var(--primary); color:var(--primary); transition: all 0.2s;"><i class="fas fa-download"></i> Şablon İndir</button>
                <button class="btn-outline" onclick="document.getElementById('excel-import-input').click()" onmouseover="this.style.background='#10b981'; this.style.color='white';" onmouseout="this.style.background='transparent'; this.style.color='#10b981';" style="padding:0.45rem 0.85rem; font-size:0.75rem; border-radius:10px; height:34px; display:inline-flex; align-items:center; gap:0.4rem; font-weight:800; border-color:#10b981; color:#10b981; transition: all 0.2s;"><i class="fas fa-file-excel"></i> Excel'den Yükle</button>
                <button class="btn-outline audit-type-add-btn" onclick="openAuditTypeModal()"><i class="fas fa-plus"></i> Denetim Tipi Ekle</button>
            </div>
        </div>
        <div class="audit-type-strip" style="display: flex; flex-wrap: wrap; gap: 0.55rem; align-items: center;">
            ${auditTypes.map((type, index) => {
                const typeColor = getAuditTypeColor(type.id, index);
                const categories = (type.categories || []).filter(category => !category.isDeleted);
                const questionCount = categories.reduce((total, category) => total + (category.questions || []).filter(question => !question.isDeleted).length, 0);
                const isSelected = String(appData.selectedAuditTypeId) === String(type.id);
                
                const bgStyle = isSelected 
                    ? `background: linear-gradient(135deg, color-mix(in srgb, ${typeColor} 24%, #08111e) 0%, #050b14 100%) !important;`
                    : `background: var(--bg-card) !important;`;
                const titleColor = isSelected ? '#ffffff !important' : 'var(--text-primary)';
                const subColor = isSelected ? 'rgba(255, 255, 255, 0.7) !important' : 'var(--text-secondary)';
                const countColor = isSelected ? '#ffffff !important' : typeColor;
                const isActive = type.isActive !== false;
                const opacityStyle = isActive ? '' : 'opacity: 0.65;';

                return `
                    <div class="audit-type-chip ${isSelected ? 'active' : ''}" onclick="selectAuditType('${jsArg(type.id)}')" style="--audit-type-color:${typeColor}; width:240px; height:88px; padding:0.75rem 0.9rem; border-radius:14px; display:inline-flex; align-items:center; justify-content:space-between; border:1px solid ${isSelected ? typeColor : 'var(--border-main)'}; border-left:4px solid ${typeColor} !important; ${bgStyle} box-shadow:${isSelected ? '0 12px 28px ' + typeColor + '22' : 'none'}; transition:all 0.22s cubic-bezier(0.4, 0, 0.2, 1); cursor:pointer; flex:0 0 auto; box-sizing:border-box; ${opacityStyle}">
                        <div style="display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; text-align:left;">
                            <span class="audit-type-chip-title" style="font-size:0.88rem; font-weight:900; color:${titleColor}; word-wrap:break-word; white-space:normal; margin:0; line-height:1.25;">${escapeAttr(type.title)} ${isActive ? '' : '(Pasif)'}</span>
                            <span style="font-size:0.7rem; font-weight:700; color:${subColor}; word-wrap:break-word; white-space:normal; line-height:1.2;">${escapeAttr(getAuditScaleLabel(type.scoringStrategy))}</span>
                            <span style="font-size:0.68rem; font-weight:800; color:${countColor}; line-height:1.2;">${questionCount} Soru</span>
                        </div>
                        <div style="display:flex; gap:6px; flex-shrink:0; align-items:center; margin-left:0.5rem;">
                            <button class="audit-type-chip-toggle" style="width:24px; height:24px; border-radius:6px; background:${isSelected ? 'rgba(255,255,255,0.15)' : (isActive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)')}; color:${isSelected ? '#ffffff' : (isActive ? '#10b981' : '#ef4444')}; border:none; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:0.2s; padding:0;" onclick="event.stopPropagation(); toggleAuditTypeStatus('${jsArg(type.id)}', ${isActive})" title="${isActive ? 'Pasif Yap' : 'Aktif Yap'}"><i class="${isActive ? 'fas fa-eye' : 'fas fa-eye-slash'}" style="font-size:0.72rem;"></i></button>
                            <button class="audit-type-chip-edit" style="width:24px; height:24px; border-radius:6px; background:${isSelected ? 'rgba(255,255,255,0.15)' : 'color-mix(in srgb, ' + typeColor + ' 12%, transparent)'}; color:${isSelected ? '#ffffff' : typeColor}; border:none; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:0.2s; padding:0;" onclick="event.stopPropagation(); openEditAuditTypeModal('${jsArg(type.id)}')" title="Düzenle"><i class="fas fa-pen" style="font-size:0.72rem;"></i></button>
                            <button class="audit-type-chip-delete" style="width:24px; height:24px; border-radius:6px; background:${isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.1)'}; color:${isSelected ? '#ffffff' : '#ef4444'}; border:none; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:0.2s; padding:0;" onclick="event.stopPropagation(); deleteAuditType('${jsArg(type.id)}')" title="Sil"><i class="fas fa-trash-alt" style="font-size:0.72rem;"></i></button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="audit-type-action-panel" style="margin-top: 0.85rem; padding: 0.75rem 1rem; border-radius: 14px;">
            <div>
                <div class="audit-type-action-title" style="font-size:0.86rem; font-weight:800;">Seçili denetim tipi altına kategori ekle</div>
                <div class="audit-type-action-subtitle" style="font-size:0.75rem; margin-top:0.15rem;">Yeni kategori, aktif seçili denetim tipinin altına bağlanır.</div>
            </div>
            <button class="btn-secondary" onclick="openAddGroupModal()" style="padding:0.45rem 0.85rem; font-size:0.75rem; border-radius:10px;"><i class="fas fa-folder-plus"></i> Yeni Kategori</button>
        </div>
    `;
    if (!existing) container.insertBefore(wrap, document.getElementById('question-groups-container'));
}

async function updateEmbeddedAuditTypeQuestion(questionId, updates) {
    if (!appData.auditTypes) return;
    for (const type of appData.auditTypes) {
        let changed = false;
        const updatedCategories = (type.categories || []).map(category => {
            let categoryQuestions = category.questions || [];
            let questionIdx = categoryQuestions.findIndex(q => String(q.id) === String(questionId));
            if (questionIdx !== -1) {
                changed = true;
                const updatedQuestion = { ...categoryQuestions[questionIdx], ...updates };
                if (updates.questionText) {
                    updatedQuestion.text = updates.questionText;
                    updatedQuestion.questionText = updates.questionText;
                }
                const newQs = [...categoryQuestions];
                newQs[questionIdx] = updatedQuestion;
                return { ...category, questions: newQs };
            }
            return category;
        });

        if (changed) {
            await db.collection('auditTypes').doc(type.id).set({
                categories: updatedCategories
            }, { merge: true });
            type.categories = updatedCategories;
            break;
        }
    }
}

async function deleteEmbeddedAuditTypeQuestion(questionId) {
    if (!appData.auditTypes) return;
    for (const type of appData.auditTypes) {
        let changed = false;
        const updatedCategories = (type.categories || []).map(category => {
            let categoryQuestions = category.questions || [];
            let questionIdx = categoryQuestions.findIndex(q => String(q.id) === String(questionId));
            if (questionIdx !== -1) {
                changed = true;
                const newQs = categoryQuestions.filter(q => String(q.id) !== String(questionId));
                return { ...category, questions: newQs };
            }
            return category;
        });

        if (changed) {
            await db.collection('auditTypes').doc(type.id).set({
                categories: updatedCategories
            }, { merge: true });
            type.categories = updatedCategories;
            break;
        }
    }
}

async function deleteEmbeddedAuditTypeCategory(categoryId) {
    if (!appData.auditTypes) return null;
    let targetAuditTypeId = null;
    for (const type of appData.auditTypes) {
        let changed = false;
        const updatedCategories = (type.categories || []).map(category => {
            if (String(category.id) === String(categoryId)) {
                changed = true;
                targetAuditTypeId = type.id;
                return { ...category, isDeleted: true, isActive: false, updatedAt: new Date().toISOString() };
            }
            return category;
        });

        if (changed) {
            await db.collection('auditTypes').doc(type.id).set({
                categories: updatedCategories
            }, { merge: true });
            type.categories = updatedCategories;
            break;
        }
    }
    return targetAuditTypeId;
}

function checkAndWarnCategoryWeights(auditTypeId) {
    const type = (appData.auditTypes || []).find(t => String(t.id) === String(auditTypeId));
    if (!type) return;
    const activeCategories = (type.categories || []).filter(c => !c.isDeleted && c.isActive !== false);
    let sum = 0;
    activeCategories.forEach(c => {
        sum += c.weight !== undefined ? Number(c.weight) : 1.0;
    });
    if (Math.abs(sum - 100) > 0.0001) {
        setTimeout(() => {
            showToast(`Uyarı: "${type.title}" aktif kategori ağırlıkları toplamı 100 olmalıdır. (Mevcut: ${sum})`, 'warning');
        }, 500);
    }
}

async function toggleQuestionStatus(questionId, currentActive) {
    try {
        const nextActive = !currentActive;
        await updateEmbeddedAuditTypeQuestion(questionId, { isActive: nextActive });

        const auditDocRef = db.collection('auditQuestions').doc(questionId);
        const auditDocSnap = await auditDocRef.get();
        if (auditDocSnap.exists) {
            await auditDocRef.set({ isActive: nextActive }, { merge: true });
        }
        const questionsDocRef = db.collection('questions').doc(questionId);
        const questionsDocSnap = await questionsDocRef.get();
        if (questionsDocSnap.exists) {
            await questionsDocRef.set({ isActive: nextActive }, { merge: true });
        }

        deriveCompatibilityCollectionsFromAuditTypes();
        renderQuestionGroups();
        if (appData.selectedGroupId) renderQuestions(appData.selectedGroupId);
        showToast(`Soru durumu ${nextActive ? 'Aktif' : 'Pasif'} olarak güncellendi.`);
    } catch (err) {
        console.error('Toggle question status error:', err);
        showToast('Hata oluştu!');
    }
}

function openEditQuestionModal(questionId) {
    const question = (appData.questions || []).find(q => String(q.id) === String(questionId)) ||
                     (appData.legacyQuestions || []).find(q => String(q.id) === String(questionId));
    if (!question) return showToast('Soru bulunamadı.');
    ensureEditQuestionModal();
    document.getElementById('edit-q-id').value = question.id;
    document.getElementById('edit-q-text').value = question.questionText || '';
    document.getElementById('edit-q-category').value = question.categoryName || '';
    
    let currentTypeVal = '5s-score';
    if (question.answerType === 'scale6' || question.type === 'scale6') {
        currentTypeVal = 'scale6';
    } else if (question.answerType === 'boolean' || question.type === 'yes-no') {
        currentTypeVal = 'yes-no';
    }
    const typeSelect = document.getElementById('edit-q-type');
    if (typeSelect) typeSelect.value = currentTypeVal;
    
    document.getElementById('edit-question-modal').style.display = 'flex';
}

function ensureEditQuestionModal() {
    if (document.getElementById('edit-question-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="edit-question-modal" class="modal-overlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:9999;">
            <div class="modal-content" style="max-width:560px;background:var(--bg-card);border:1px solid var(--border-main);border-radius:18px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.3);">
                <div class="modal-header" style="padding:1.25rem 1.5rem;border-bottom:1px solid var(--border-main);display:flex;align-items:center;justify-content:space-between;">
                    <h3 style="margin:0;font-size:1.15rem;font-weight:900;color:var(--text-primary);">Soruyu Düzenle</h3>
                    <i class="fas fa-times close-modal" onclick="closeEditQuestionModal()" style="cursor:pointer;color:var(--text-secondary);font-size:1rem;transition:0.2s;" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-secondary)'"></i>
                </div>
                <div class="modal-body" style="padding:1.5rem;display:flex;flex-direction:column;gap:1.25rem;">
                    <input type="hidden" id="edit-q-id">
                    <div class="input-group" style="display:flex;flex-direction:column;gap:0.5rem;">
                        <label style="display:block;font-size:.72rem;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin:0;">Kategori Adı</label>
                        <input type="text" id="edit-q-category" class="cms-input" style="width:100%;padding:0.65rem 0.85rem;border-radius:10px;background:var(--bg-main);border:1px solid var(--border-main);color:var(--text-primary);font-size:0.85rem;font-weight:700;box-sizing:border-box;">
                    </div>
                    <div class="input-group" style="display:flex;flex-direction:column;gap:0.5rem;">
                        <label style="display:block;font-size:.72rem;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin:0;">Değerlendirme Skalası (Soru Tipi)</label>
                        <select id="edit-q-type" class="cms-input" style="width:100%;padding:0.65rem 0.85rem;border-radius:10px;background:var(--bg-main);border:1px solid var(--border-main);color:var(--text-primary);font-size:0.85rem;font-weight:700;box-sizing:border-box;">
                            <option value="5s-score">1-5 Skalası (1-5 Puan)</option>
                            <option value="scale6">6'lı Sistem Skalası (0-5 Puan)</option>
                            <option value="yes-no">Evet / Hayır</option>
                        </select>
                    </div>
                    <div class="input-group" style="display:flex;flex-direction:column;gap:0.5rem;">
                        <label style="display:block;font-size:.72rem;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin:0;">Soru Metni</label>
                        <textarea id="edit-q-text" class="cms-input" rows="4" style="width:100%;padding:0.65rem 0.85rem;border-radius:10px;background:var(--bg-main);border:1px solid var(--border-main);color:var(--text-primary);font-size:0.85rem;font-weight:700;resize:vertical;box-sizing:border-box;"></textarea>
                    </div>
                </div>
                <div class="modal-footer" style="padding:1.25rem 1.5rem;border-top:1px solid var(--border-main);display:flex;justify-content:flex-end;gap:.75rem;">
                    <button class="btn-secondary" onclick="closeEditQuestionModal()" style="padding:0.5rem 1rem;font-size:0.75rem;border-radius:10px;font-weight:800;cursor:pointer;background:var(--bg-main);border:1px solid var(--border-main);color:var(--text-secondary);transition:0.2s;">Vazgeç</button>
                    <button class="btn-primary" onclick="saveQuestionEdit()" style="padding:0.5rem 1rem;font-size:0.75rem;border-radius:10px;font-weight:800;cursor:pointer;background:var(--primary);color:#ffffff;border:none;display:inline-flex;align-items:center;gap:0.4rem;transition:0.2s;"><i class="fas fa-save"></i> Kaydet</button>
                </div>
            </div>
        </div>
    `);
}

function closeEditQuestionModal() {
    const modal = document.getElementById('edit-question-modal');
    if (modal) modal.style.display = 'none';
}

async function saveQuestionEdit() {
    const id = document.getElementById('edit-q-id')?.value;
    const categoryName = document.getElementById('edit-q-category')?.value.trim();
    const questionText = document.getElementById('edit-q-text')?.value.trim();
    const selectedTypeVal = document.getElementById('edit-q-type')?.value || '5s-score';
    
    if (!id || !categoryName || !questionText) return showToast('Lütfen tüm alanları doldurunuz.');

    let qType = '5s-score';
    let qAnswerType = 'scale';
    let qMaxScore = 5;

    if (selectedTypeVal === 'scale6') {
        qType = 'scale6';
        qAnswerType = 'scale6';
        qMaxScore = 5;
    } else if (selectedTypeVal === 'yes-no') {
        qType = 'yes-no';
        qAnswerType = 'boolean';
        qMaxScore = 1;
    }

    const updates = { 
        categoryName, 
        questionText,
        type: qType,
        answerType: qAnswerType,
        maxScore: qMaxScore
    };

    try {
        await updateEmbeddedAuditTypeQuestion(id, updates);

        const auditDocRef = db.collection('auditQuestions').doc(id);
        const auditDocSnap = await auditDocRef.get();
        if (auditDocSnap.exists) {
            await auditDocRef.set(updates, { merge: true });
        }
        const questionsDocRef = db.collection('questions').doc(id);
        const questionsDocSnap = await questionsDocRef.get();
        if (questionsDocSnap.exists) {
            await questionsDocRef.set(updates, { merge: true });
        }
        closeEditQuestionModal();
        deriveCompatibilityCollectionsFromAuditTypes();
        renderQuestionGroups();
        if (appData.selectedGroupId) renderQuestions(appData.selectedGroupId);
        showToast('Soru başarıyla güncellendi.');
    } catch (err) {
        console.error('Save question edit error:', err);
        showToast('Hata oluştu!');
    }
}

// --- YÖNETİCİ SAAS DASHBOARD GEREKSİNİMLERİ ---

function populateDashboardFilters() {
    renderUnifiedDateOptions();
    updateUnifiedDateTriggerLabel();
    const typeSelect = document.getElementById('dashboard-filter-type');
    const lineSelect = document.getElementById('dashboard-filter-line');
    const stationSelect = document.getElementById('dashboard-filter-station');
    const userSelect = document.getElementById('dashboard-filter-user');
    const yearSelect = document.getElementById('dashboard-filter-year');
    const monthSelect = document.getElementById('dashboard-filter-month');
    const accessibleAudits = getFilteredAudits();
    const scopedLines = getScopedAuditLines();

    if (!typeSelect || !lineSelect || !stationSelect || !userSelect || !yearSelect || !monthSelect) return;

    // 1. Hat Filtresi
    const currentLines = getMultiSelectValues(lineSelect);
    if (lineSelect.options.length <= 1) {
        lineSelect.innerHTML = '<option value="all">Tüm Hatlar</option>';
        scopedLines.forEach(l => lineSelect.add(new Option(l, l)));
        setMultiSelectValues(lineSelect, currentLines);
    }

    // 2. İstasyon Filtresi (Hatta göre süzülen istasyonlar)
    const selectedLines = getMultiSelectValues(lineSelect);
    const currentStations = getMultiSelectValues(stationSelect);
    stationSelect.innerHTML = '<option value="all">Tüm İstasyonlar</option>';
    
    let stationsToDisplay = [];
    if (!selectedLines.length) {
        scopedLines.forEach(line => {
            stationsToDisplay.push(...((appData.stations || {})[line] || []));
        });
        accessibleAudits.forEach(audit => {
            if (audit.station) stationsToDisplay.push(audit.station);
        });
    } else {
        selectedLines.forEach(line => {
            stationsToDisplay.push(...((appData.stations || {})[line] || []));
        });
        stationsToDisplay.push(...accessibleAudits
            .filter(audit => selectedLines.includes(audit.line))
            .map(audit => audit.station)
            .filter(Boolean));
    }
    [...new Set(stationsToDisplay)].sort((a, b) => a.localeCompare(b, 'tr')).forEach(station => {
        stationSelect.add(new Option(station, station));
    });
    setMultiSelectValues(stationSelect, currentStations);

    // 3. Denetçi / Personel Filtresi (Türkçe normalize)
    const currentUsers = getMultiSelectValues(userSelect);
    if (userSelect.options.length <= 1) {
        userSelect.innerHTML = '<option value="all">Tüm Denetçiler</option>';
        const auditorMap = new Map();
        accessibleAudits.forEach(audit => {
            if (!audit.auditorName) return;
            const key = normalizeTurkish(audit.auditorName);
            if (!auditorMap.has(key)) auditorMap.set(key, audit.auditorName);
        });
        const auditors = [...auditorMap.values()];
        auditors.sort((a, b) => getAuditorDisplayName(a).localeCompare(getAuditorDisplayName(b), 'tr')).forEach(auditor => {
            userSelect.add(new Option(getAuditorDisplayName(auditor), auditor));
        });
        setMultiSelectValues(userSelect, currentUsers);
    }

    // 4. Yıl Filtresi
    const currentYears = getMultiSelectValues(yearSelect);
    if (yearSelect.options.length <= 1) {
        yearSelect.innerHTML = '<option value="all">Tüm Yıllar</option>';
        const years = accessibleAudits
            .map(audit => audit.date ? new Date(audit.date).getFullYear() : null)
            .filter(year => Number.isFinite(year))
            .map(String);
        [...new Set(years)].sort((a, b) => Number(b) - Number(a)).forEach(year => {
            yearSelect.add(new Option(year, year));
        });
        setMultiSelectValues(yearSelect, currentYears);
    }

    // 5. Ay Filtresi
    const currentMonths = getMultiSelectValues(monthSelect);
    if (monthSelect.options.length <= 1) {
        monthSelect.innerHTML = '<option value="all">Tüm Aylar</option>';
        const aylarnames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        aylarnames.forEach((name, index) => {
            monthSelect.add(new Option(name, String(index + 1)));
        });
        setMultiSelectValues(monthSelect, currentMonths);
    }

    // Sync custom dropdown select elements
    if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
    }
}

function getFilteredDashboardData() {
    const typeFilter = document.getElementById('dashboard-filter-type')?.value || 'all';
    const lineFilters = getMultiSelectValues('dashboard-filter-line');
    const stationFilters = getMultiSelectValues('dashboard-filter-station');
    const userFilters = getMultiSelectValues('dashboard-filter-user');
    const yearFilters = getMultiSelectValues('dashboard-filter-year');
    const monthFilters = getMultiSelectValues('dashboard-filter-month');

    const selectedYears = unifiedDateFilters.dashboard.years || [];
    const selectedMonths = unifiedDateFilters.dashboard.months || [];
    const selectedWeeks = unifiedDateFilters.dashboard.weeks || [];
    const selectedDays = unifiedDateFilters.dashboard.days || [];

    let audits = getFilteredAudits() || [];
    let ncs = getFilteredNCs() || [];

    // Apply Audit Type Filter
    audits = filterByAuditType(audits, typeFilter);
    ncs = filterByAuditType(ncs, typeFilter, getNonconformityTypeValues);

    // Apply Line Filter
    if (lineFilters.length) {
        audits = audits.filter(a => lineFilters.includes(a.line));
        ncs = ncs.filter(nc => {
            const audit = getAccessibleAuditById(nc.auditId) || {};
            return lineFilters.includes(audit.line) || lineFilters.includes(nc.line);
        });
    }

    // Apply Station Filter
    if (stationFilters.length) {
        audits = audits.filter(a => stationFilters.includes(a.station));
        ncs = ncs.filter(nc => {
            const audit = getAccessibleAuditById(nc.auditId) || {};
            return stationFilters.includes(audit.station) || stationFilters.includes(nc.station);
        });
    }

    // Apply Auditor Filter
    if (userFilters.length) {
        audits = audits.filter(a => userFilters.some(f => normalizeTurkish(f) === normalizeTurkish(a.auditorName)));
        ncs = ncs.filter(nc => userFilters.some(f => normalizeTurkish(f) === normalizeTurkish(nc.auditorName)));
    }

    // Apply Unified Date Filters: Year
    if (selectedYears.length) {
        audits = audits.filter(a => selectedYears.includes(new Date(a.date).getFullYear().toString()));
        ncs = ncs.filter(nc => {
            const audit = getAccessibleAuditById(nc.auditId) || {};
            const date = nc.detectionDate || nc.createdAt || nc.date || audit.date;
            return selectedYears.includes(new Date(date).getFullYear().toString());
        });
    }

    // Apply Unified Date Filters: Month
    if (selectedMonths.length) {
        audits = audits.filter(a => selectedMonths.includes((new Date(a.date).getMonth() + 1).toString()));
        ncs = ncs.filter(nc => {
            const audit = getAccessibleAuditById(nc.auditId) || {};
            const date = nc.detectionDate || nc.createdAt || nc.date || audit.date;
            return selectedMonths.includes((new Date(date).getMonth() + 1).toString());
        });
    }

    // Apply Unified Date Filters: Week
    if (selectedWeeks.length) {
        audits = audits.filter(a => selectedWeeks.includes(getISOWeekNumber(new Date(a.date)).toString()));
        ncs = ncs.filter(nc => {
            const audit = getAccessibleAuditById(nc.auditId) || {};
            const date = nc.detectionDate || nc.createdAt || nc.date || audit.date;
            return selectedWeeks.includes(getISOWeekNumber(new Date(date)).toString());
        });
    }

    // Apply Unified Date Filters: Day
    if (selectedDays.length) {
        audits = audits.filter(a => selectedDays.includes(getLocalDateString(a.date)));
        ncs = ncs.filter(nc => {
            const audit = getAccessibleAuditById(nc.auditId) || {};
            const date = nc.detectionDate || nc.createdAt || nc.date || audit.date;
            return selectedDays.includes(getLocalDateString(date));
        });
    }

    return { audits, ncs };
}

function renderAuditorPerformance() {
    const tbody = document.querySelector('#auditor-performance-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const { audits, ncs } = getFilteredDashboardData();

    const auditorStats = {};
    
    audits.forEach(a => {
        const name = a.auditorName || 'Bilinmeyen';
        if (!auditorStats[name]) {
            auditorStats[name] = { auditsCount: 0, totalScore: 0, ncCount: 0, closedNcCount: 0 };
        }
        auditorStats[name].auditsCount++;
        auditorStats[name].totalScore += (a.score || 0);
    });

    ncs.forEach(nc => {
        const name = nc.auditorName || 'Bilinmeyen';
        if (!auditorStats[name]) {
            auditorStats[name] = { auditsCount: 0, totalScore: 0, ncCount: 0, closedNcCount: 0 };
        }
        auditorStats[name].ncCount++;
        if (isNcClosed(nc)) {
            auditorStats[name].closedNcCount++;
        }
    });

    const rows = Object.entries(auditorStats).map(([name, stats]) => {
        const avgScore = stats.auditsCount > 0 ? stats.totalScore / stats.auditsCount : 0;
        const displayName = getAuditorDisplayName(name);
        return { name: displayName, ...stats, avgScore };
    }).sort((a, b) => b.auditsCount - a.auditsCount);

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 1.5rem; font-weight: 600; font-size:0.8rem;">Seçilen filtrelere uygun denetçi verisi bulunmadı.</td></tr>';
        return;
    }

    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeAttr(r.name)}</strong></td>
            <td><span style="font-weight:800; color:var(--primary); background:rgba(37,99,235,0.06); padding:0.15rem 0.5rem; border-radius:6px; font-size:0.75rem;">${r.auditsCount} Denetim</span></td>
            <td><span style="font-weight:700; color:#f43f5e; background:rgba(244,63,94,0.06); padding:0.15rem 0.5rem; border-radius:6px; font-size:0.75rem;">${r.ncCount} Uygunsuzluk</span></td>
            <td><span style="font-weight:700; color:#10b981; background:rgba(16,185,129,0.06); padding:0.15rem 0.5rem; border-radius:6px; font-size:0.75rem;">${r.closedNcCount} Kapatılan</span></td>
            <td><strong style="color: ${r.avgScore > 80 ? '#10b981' : r.avgScore > 50 ? '#f59e0b' : '#ef4444'}; font-size:0.85rem;">%${r.avgScore.toFixed(1)}</strong></td>
        `;
        tbody.appendChild(tr);
    });
}

// ============================================
// --- PREMIUM COMPACT CUSTOM SELECT HELPERS ---
// ============================================

// Toggle Custom Dropdown Options Card
function toggleCustomSelect(wrapperId) {
    // Close other dropdowns
    document.querySelectorAll('.custom-select-options-card').forEach(card => {
        if (card.parentNode.id !== wrapperId) {
            card.style.display = 'none';
        }
    });

    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;
    const card = wrapper.querySelector('.custom-select-options-card');
    if (!card) return;
    
    card.style.display = card.style.display === 'block' ? 'none' : 'block';
}

// Close Dropdowns on Click Outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-select-wrapper')) {
        document.querySelectorAll('.custom-select-options-card').forEach(card => {
            card.style.display = 'none';
        });
    }
});

window.clearFilters = function(view) {
    let selectIds = [];
    if (view === 'dashboard') {
        selectIds = [
            'dashboard-filter-type',
            'dashboard-filter-line',
            'dashboard-filter-station',
            'dashboard-filter-user',
            'dashboard-filter-year',
            'dashboard-filter-month'
        ];
    } else if (view === 'stats') {
        selectIds = [
            'filter-stats-type',
            'filter-stats-line',
            'filter-stats-station',
            'filter-stats-user',
            'filter-stats-year',
            'filter-stats-month'
        ];
    } else if (view === 'audits') {
        selectIds = [
            'audit-filter-type',
            'audit-filter-month',
            'audit-filter-year',
            'audit-filter-line',
            'audit-filter-station',
            'audit-filter-user',
            'audit-filter-status'
        ];
    } else if (view === 'nc') {
        selectIds = [
            'nc-filter-type',
            'filter-nc-line',
            'filter-nc-station',
            'filter-nc-category',
            'filter-nc-year',
            'filter-nc-month',
            'filter-nc-status',
            'filter-nc-responsible'
        ];
    }

    selectIds.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        
        // Reset selections
        Array.from(select.options).forEach(opt => {
            opt.selected = (opt.value === 'all');
        });
        
        // Trigger onchange to populate other fields and update views
        select.dispatchEvent(new Event('change'));
        if (typeof select.onchange === 'function') {
            select.onchange();
        }
    });

    // Re-render UI
    if (view === 'dashboard') {
        unifiedDateFilters.dashboard.years = [];
        unifiedDateFilters.dashboard.months = [];
        unifiedDateFilters.dashboard.weeks = [];
        unifiedDateFilters.dashboard.days = [];
        updateUnifiedDateTriggerLabel('dashboard');
        renderUnifiedDateOptions('dashboard');
        selectedYears = [];
        selectedMonths = [];
        selectedWeeks = [];
        selectedDays = [];
        populateDashboardFilters();
        renderAll();
    } else if (view === 'stats') {
        unifiedDateFilters.stats.years = [];
        unifiedDateFilters.stats.months = [];
        unifiedDateFilters.stats.weeks = [];
        unifiedDateFilters.stats.days = [];
        updateUnifiedDateTriggerLabel('stats');
        renderUnifiedDateOptions('stats');
        populateStatsFilters();
        updateStats();
    } else if (view === 'audits') {
        unifiedDateFilters.audits.years = [];
        unifiedDateFilters.audits.months = [];
        unifiedDateFilters.audits.weeks = [];
        unifiedDateFilters.audits.days = [];
        updateUnifiedDateTriggerLabel('audits');
        renderUnifiedDateOptions('audits');
        populateAuditPageFilters();
        renderAllAuditsTable();
    } else if (view === 'nc') {
        unifiedDateFilters.nc.years = [];
        unifiedDateFilters.nc.months = [];
        unifiedDateFilters.nc.weeks = [];
        unifiedDateFilters.nc.days = [];
        updateUnifiedDateTriggerLabel('nc');
        renderUnifiedDateOptions('nc');
        initNCFilters();
        renderNCs();
    }
    
    // Global UI sync
    if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
    }
};

function syncCustomSelects() {
    // Dashboard Custom Selects
    syncSingleCustomSelect('dashboard-filter-type', 'custom-options-type', 'Tüm Tipler', 'Tip Seçildi', false, '');
    syncSingleCustomSelect('dashboard-filter-line', 'custom-options-line', 'Tüm Hatlar', 'Hat Seçildi', true, '');
    syncSingleCustomSelect('dashboard-filter-station', 'custom-options-station', 'Tüm İstasyonlar', 'İst. Seçildi', true, '');
    syncSingleCustomSelect('dashboard-filter-user', 'custom-options-user', 'Tüm Denetçiler', 'Denetçi Seçildi', true, '');
    syncSingleCustomSelect('dashboard-filter-year', 'custom-options-year', 'Tüm Yıllar', 'Yıl Seçildi', true, '');
    syncSingleCustomSelect('dashboard-filter-month', 'custom-options-month', 'Tüm Aylar', 'Ay Seçildi', true, '');

    // Audits Page Custom Selects
    if (document.getElementById('custom-options-audit-type')) {
        syncSingleCustomSelect('audit-filter-type', 'custom-options-audit-type', 'Tüm Tipler', 'Tip Seçildi', true, '');
        syncSingleCustomSelect('audit-filter-month', 'custom-options-audit-month', 'Tüm Aylar', 'Ay Seçildi', true, '');
        syncSingleCustomSelect('audit-filter-year', 'custom-options-audit-year', 'Tüm Yıllar', 'Yıl Seçildi', true, '');
        syncSingleCustomSelect('audit-filter-line', 'custom-options-audit-line', 'Tüm Hatlar', 'Hat Seçildi', true, '');
        syncSingleCustomSelect('audit-filter-station', 'custom-options-audit-station', 'Tüm İstasyonlar', 'İst. Seçildi', true, '');
        syncSingleCustomSelect('audit-filter-user', 'custom-options-audit-user', 'Tüm Kullanıcılar', 'Denetçi Seçildi', true, '');
        syncSingleCustomSelect('audit-filter-status', 'custom-options-audit-status', 'Tüm Durumlar', 'Durum Seçildi', true, '');
    }

    // Stats Page Custom Selects
    if (document.getElementById('custom-options-stats-type')) {
        syncSingleCustomSelect('filter-stats-type', 'custom-options-stats-type', 'Tüm Tipler', 'Tip Seçildi', true, '');
        syncSingleCustomSelect('filter-stats-line', 'custom-options-stats-line', 'Tüm Hatlar', 'Hat Seçildi', true, '');
        syncSingleCustomSelect('filter-stats-station', 'custom-options-stats-station', 'Tüm İstasyonlar', 'İst. Seçildi', true, '');
        syncSingleCustomSelect('filter-stats-user', 'custom-options-stats-user', 'Tüm Denetçiler', 'Denetçi Seçildi', true, '');
        syncSingleCustomSelect('filter-stats-year', 'custom-options-stats-year', 'Tüm Yıllar', 'Yıl Seçildi', true, '');
        syncSingleCustomSelect('filter-stats-month', 'custom-options-stats-month', 'Tüm Aylar', 'Ay Seçildi', true, '');
    }

    // NC Page Custom Selects
    if (document.getElementById('custom-options-nc-type')) {
        syncSingleCustomSelect('nc-filter-type', 'custom-options-nc-type', 'Tüm Tipler', 'Tip Seçildi', true, '');
        syncSingleCustomSelect('filter-nc-line', 'custom-options-nc-line', 'Tüm Hatlar', 'Hat Seçildi', true, '');
        syncSingleCustomSelect('filter-nc-station', 'custom-options-nc-station', 'Tüm İstasyonlar', 'İst. Seçildi', true, '');
        syncSingleCustomSelect('filter-nc-category', 'custom-options-nc-category', 'Tüm Kategoriler', 'Kat. Seçildi', true, '');
        syncSingleCustomSelect('filter-nc-year', 'custom-options-nc-year', 'Tüm Yıllar', 'Yıl Seçildi', true, '');
        syncSingleCustomSelect('filter-nc-month', 'custom-options-nc-month', 'Tüm Aylar', 'Ay Seçildi', true, '');
        syncSingleCustomSelect('filter-nc-responsible', 'custom-options-nc-responsible', 'Tüm Kullanıcılar', 'Kullanıcı Seçildi', true, '');
    }
}

// Sync a single custom select wrapper
function syncSingleCustomSelect(selectId, optionsContainerId, defaultLabel, activeLabelSuffix, isMulti, prefix) {
    const select = document.getElementById(selectId);
    const optionsContainer = document.getElementById(optionsContainerId);
    if (!select || !optionsContainer) return;
    
    optionsContainer.innerHTML = '';
    const selectedValues = isMulti ? getMultiSelectValues(select) : [select.value];
    
    // Build checkboxed options list
    Array.from(select.options).forEach(opt => {
        if (!opt.value) return;
        
        const isSelected = isMulti 
            ? (selectedValues.includes(opt.value) || (selectedValues.length === 0 && opt.value === 'all'))
            : (select.value === opt.value);
            
        const optDiv = document.createElement('div');
        optDiv.className = 'custom-option-item' + (isSelected ? ' selected' : '');
        
        // Apply custom color for audit type dropdown options
        if (selectId.includes('type') && opt.value !== 'all') {
            const typeColor = getAuditTypeColor(opt.value);
            optDiv.style.borderLeft = `3px solid ${typeColor}`;
            optDiv.style.paddingLeft = '8px';
            optDiv.style.color = typeColor;
            optDiv.style.fontWeight = '700';
        }
        
        const checkboxHtml = isMulti 
            ? `<input type="checkbox" ${isSelected ? 'checked' : ''} style="pointer-events:none; margin:0;">`
            : '';
            
        optDiv.innerHTML = `${checkboxHtml} <span>${escapeHtml(opt.text)}</span>`;
        
        optDiv.addEventListener('click', function(e) {
            e.stopPropagation();
            if (isMulti) {
                if (opt.value === 'all') {
                    // Choose "all" and deselect others
                    Array.from(select.options).forEach(o => o.selected = (o.value === 'all'));
                } else {
                    opt.selected = !opt.selected;
                    // Uncheck "all" option
                    const allOpt = Array.from(select.options).find(o => o.value === 'all');
                    if (allOpt) allOpt.selected = false;
                    
                    // Fallback to "all" if empty
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
                optionsContainer.parentElement.style.display = 'none'; // Close dropdown
            }
            renderAll();
        });
        
        optionsContainer.appendChild(optDiv);
    });
    
    // Update Trigger Label Text
    const wrapper = optionsContainer.closest('.custom-select-wrapper');
    if (wrapper) {
        const triggerLabel = wrapper.querySelector('.custom-select-label');
        if (triggerLabel) {
            let valText = '';
            if (isMulti) {
                if (selectedValues.length === 0 || selectedValues.includes('all')) {
                    valText = defaultLabel;
                } else {
                    if (selectedValues.length <= 2) {
                        const texts = selectedValues.map(val => {
                            const found = Array.from(select.options).find(o => o.value === val);
                            return found ? found.text : '';
                        }).filter(Boolean);
                        valText = texts.join(', ');
                    } else {
                        valText = `${selectedValues.length} ${activeLabelSuffix}`;
                    }
                }
            } else {
                const selectedOpt = Array.from(select.options).find(o => o.value === select.value);
                valText = selectedOpt ? selectedOpt.text : defaultLabel;
            }
            triggerLabel.innerText = prefix ? `${prefix}: ${valText}` : valText;
        }
    }
}

const escapeHtml = escapeAttr;

async function runM1Migration() {
    // Check if M1A/M1B exist anywhere or if M1 is missing from lines/colors
    const hasOldM1 = appData.lines.includes('M1A') || appData.lines.includes('M1B') ||
                     'M1A' in appData.lineColors || 'M1B' in appData.lineColors ||
                     'M1A' in appData.stations || 'M1B' in appData.stations;
                     
    const isM1Missing = !appData.lines.includes('M1') || !('M1' in appData.lineColors);
    const needsStationNumbers = !appData.stationNumbers || Object.keys(appData.stationNumbers).length === 0;

    if (!hasOldM1 && !isM1Missing && !needsStationNumbers) return;

    console.log('Running robust M1 and station numbers migration...');

    // 1. Clean up lines array
    appData.lines = appData.lines.filter(l => l !== 'M1A' && l !== 'M1B');
    if (!appData.lines.includes('M1')) {
        appData.lines.unshift('M1');
    }

    // 2. Clean up lineColors map
    if ('M1A' in appData.lineColors) {
        appData.lineColors['M1'] = appData.lineColors['M1A'] || '#E31E24';
        delete appData.lineColors['M1A'];
    }
    if ('M1B' in appData.lineColors) {
        if (!appData.lineColors['M1']) {
            appData.lineColors['M1'] = appData.lineColors['M1B'] || '#E31E24';
        }
        delete appData.lineColors['M1B'];
    }
    if (!appData.lineColors['M1']) {
        appData.lineColors['M1'] = '#E31E24';
    }

    // 3. Force-update standard stations and numbers to Metro Istanbul data
    if (typeof DEFAULT_STATIONS !== 'undefined' && typeof DEFAULT_STATION_NUMBERS !== 'undefined') {
        Object.keys(DEFAULT_STATIONS).forEach(line => {
            appData.stations[line] = JSON.parse(JSON.stringify(DEFAULT_STATIONS[line]));
        });
        appData.stationNumbers = JSON.parse(JSON.stringify(DEFAULT_STATION_NUMBERS));
    }

    // Delete old keys
    delete appData.stations['M1A'];
    delete appData.stations['M1B'];

    // 4. Save migrated data to Firestore
    await db.collection('system_config').doc('lines_stations').set({
        lineColors: appData.lineColors,
        lines: appData.lines,
        stations: appData.stations,
        stationNumbers: appData.stationNumbers,
        stationNfcs: appData.stationNfcs || {}
    });
    
    console.log('M1 Migration / Station Numbers successfully applied and saved to Firestore!');

    // 5. Migrate users assigned to M1A or M1B
    try {
        const usersSnapshot = await db.collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            let userLines = userData.authorizedLines || [];
            if (userLines.includes('M1A') || userLines.includes('M1B')) {
                userLines = userLines.filter(l => l !== 'M1A' && l !== 'M1B');
                if (!userLines.includes('M1')) userLines.push('M1');
                await db.collection('users').doc(userDoc.id).update({
                    authorizedLines: userLines
                });
                console.log(`Updated user ${userData.email || userDoc.id} authorizedLines to M1`);
            }
        }
    } catch (e) {
        console.error('Error migrating users to M1:', e);
    }

    // 6. Migrate existing audits, NCs, and plans
    try {
        const collectionsToMigrate = ['audits', 'nonconformities', 'plans'];
        for (const colName of collectionsToMigrate) {
            const snapshot = await db.collection(colName).get();
            for (const doc of snapshot.docs) {
                const docData = doc.data();
                if (docData.line === 'M1A' || docData.line === 'M1B') {
                    await db.collection(colName).doc(doc.id).update({
                        line: 'M1'
                    });
                    console.log(`Updated ${colName} doc ${doc.id} line to M1`);
                }
            }
        }
    } catch (e) {
        console.error('Error migrating audits/NCs/plans to M1:', e);
    }
}

async function seedLinesStationsToFirebase() {
    try {
        await db.collection('system_config').doc('lines_stations').set({
            lineColors: appData.lineColors || {},
            lines: appData.lines || [],
            stations: appData.stations || {},
            stationNumbers: appData.stationNumbers || {},
            stationNfcs: appData.stationNfcs || {},
            stationLocations: appData.stationLocations || {}
        });
        console.log('Lines/Stations seeded to Firestore.');
    } catch (e) {
        console.error('Error seeding lines_stations', e);
    }
}

async function saveLinesStationsToFirebase() {
    try {
        await db.collection('system_config').doc('lines_stations').set({
            lineColors: appData.lineColors || {},
            lines: appData.lines || [],
            stations: appData.stations || {},
            stationNumbers: appData.stationNumbers || {},
            stationNfcs: appData.stationNfcs || {},
            stationLocations: appData.stationLocations || {}
        }, { merge: true });
        console.log('Lines/Stations saved to Firestore.');
    } catch (e) {
        console.error('Error saving lines_stations', e);
    }
}









// --- Feedbacks Management ---
let unsubscribeFeedbacks = null;
let feedbackRecords = [];

function parseFeedbackDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getFeedbackCategoryMeta(category) {
    const label = String(category || 'Diğer').trim() || 'Diğer';
    const normalized = label.toLocaleLowerCase('tr-TR');

    if (normalized.includes('hata')) {
        return { key: 'error', label, icon: 'fa-bug' };
    }
    if (normalized.includes('öneri') || normalized.includes('oneri')) {
        return { key: 'suggestion', label, icon: 'fa-lightbulb' };
    }
    if (normalized.includes('soru')) {
        return { key: 'question', label, icon: 'fa-circle-question' };
    }
    return { key: 'other', label, icon: 'fa-message' };
}

function getFeedbackImageUrl(value) {
    const rawUrl = String(value || '').trim();
    if (!rawUrl) return '';
    try {
        const parsedUrl = new URL(rawUrl, window.location.href);
        return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : '';
    } catch (_) {
        return '';
    }
}

function getFeedbackInitials(name) {
    const parts = String(name || 'Bilinmeyen Kullanıcı')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
    return parts.map(part => part.charAt(0).toLocaleUpperCase('tr-TR')).join('') || 'BK';
}

function formatFeedbackDate(value) {
    const date = parseFeedbackDate(value);
    if (!date) return 'Tarih bilgisi yok';
    return new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function updateFeedbackSummary(records) {
    const categoryCounts = records.reduce((counts, item) => {
        const key = getFeedbackCategoryMeta(item.category).key;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});

    const values = {
        'feedback-total-count': records.length,
        'feedback-error-count': categoryCounts.error || 0,
        'feedback-suggestion-count': categoryCounts.suggestion || 0,
        'feedback-media-count': records.filter(item => getFeedbackImageUrl(item.imageUrl)).length
    };

    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
}

function resetFeedbackFilters() {
    const searchInput = document.getElementById('feedback-search-input');
    const categoryFilter = document.getElementById('feedback-category-filter');
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    renderFeedbacks();
}

function renderFeedbacks() {
    const list = document.getElementById('feedbacks-list');
    const empty = document.getElementById('feedbacks-empty');
    const emptyText = document.getElementById('feedbacks-empty-text');
    const resultCount = document.getElementById('feedback-result-count');
    const searchInput = document.getElementById('feedback-search-input');
    const categoryFilter = document.getElementById('feedback-category-filter');
    if (!list) return;

    const query = String(searchInput?.value || '').trim().toLocaleLowerCase('tr-TR');
    const selectedCategory = categoryFilter?.value || 'all';
    const visibleRecords = feedbackRecords.filter(item => {
        const category = getFeedbackCategoryMeta(item.category);
        const searchableText = [
            category.label,
            item.reporterName,
            item.title,
            item.description
        ].join(' ').toLocaleLowerCase('tr-TR');
        const matchesQuery = !query || searchableText.includes(query);
        const matchesCategory = selectedCategory === 'all' || category.key === selectedCategory;
        return matchesQuery && matchesCategory;
    });

    if (resultCount) {
        resultCount.textContent = `${visibleRecords.length} / ${feedbackRecords.length} kayıt`;
    }

    list.innerHTML = visibleRecords.map((item, index) => {
        const category = getFeedbackCategoryMeta(item.category);
        const reporterName = String(item.reporterName || 'Bilinmeyen Kullanıcı').trim();
        const title = String(item.title || 'Başlıksız geri bildirim').trim();
        const description = String(item.description || 'Açıklama eklenmemiş.').trim();
        const imageUrl = getFeedbackImageUrl(item.imageUrl);
        const categoryColors = {
            error: 'var(--feedback-red)',
            suggestion: 'var(--feedback-green)',
            question: 'var(--feedback-blue)',
            other: 'var(--feedback-amber)'
        };
        const categoryColor = categoryColors[category.key] || 'var(--feedback-blue)';

        const imageSectionHtml = imageUrl ? `
            <button type="button" class="btn-outline js-feedback-image"
                data-image-url="${escapeAttr(imageUrl)}"
                aria-label="${escapeAttr(title)} görselini büyüt"
                style="height: 26px; padding: 0 6px; font-size: 0.65rem; border-color: var(--primary); color: var(--primary); background: transparent; cursor: pointer; border-radius: 6px; display: inline-flex; align-items: center; gap: 3px; font-family: inherit; font-weight: 800;">
                <i class="fas fa-expand"></i><span>Aç</span>
            </button>
        ` : '<span style="font-size: 0.65rem; color: var(--text-dim); font-weight: 500;">—</span>';

        return `
            <tr style="border-bottom: 1px solid var(--border-main); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.01)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 8px 12px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span class="feedback-category-badge" style="display: inline-flex; align-items: center; gap: 3px; padding: 3px 7px; border-radius: 999px; font-size: 0.6rem; font-weight: 800; border: 1px solid color-mix(in srgb, ${categoryColor} 38%, transparent); color: ${categoryColor}; background: color-mix(in srgb, ${categoryColor} 9%, transparent);">
                        <i class="fas ${category.icon}"></i>
                        ${escapeAttr(category.label)}
                    </span>
                </td>
                <td style="padding: 8px 12px; vertical-align: middle; font-size: 0.7rem; color: var(--text-dim); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <i class="far fa-clock" style="margin-right: 2px;"></i>
                    ${escapeAttr(formatFeedbackDate(item.createdAt))}
                </td>
                <td style="padding: 8px 12px; vertical-align: middle; font-weight: 800; font-size: 0.78rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeAttr(title)}">
                    ${escapeAttr(title)}
                </td>
                <td style="padding: 8px 12px; vertical-align: middle; font-size: 0.72rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeAttr(description)}">
                    ${escapeAttr(description)}
                </td>
                <td style="padding: 8px 12px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                        <span class="feedback-reporter-avatar" style="flex-shrink: 0;">${escapeAttr(getFeedbackInitials(reporterName))}</span>
                        <strong style="font-size: 0.72rem; color: var(--text-primary); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeAttr(reporterName)}</strong>
                    </div>
                </td>
                <td style="padding: 8px 12px; vertical-align: middle; text-align: center;">
                    ${imageSectionHtml}
                </td>
            </tr>
        `;
    }).join('');

    list.querySelectorAll('.js-feedback-image').forEach(button => {
        button.addEventListener('click', () => openImagePreview(button.dataset.imageUrl || ''));
    });

    const filtersActive = Boolean(query || selectedCategory !== 'all');
    if (empty) empty.style.display = visibleRecords.length ? 'none' : 'flex';
    if (emptyText) {
        emptyText.textContent = filtersActive
            ? 'Arama veya kategori filtrenizle eşleşen bir kayıt bulunamadı.'
            : 'Henüz sisteme iletilmiş bir geri bildirim yok.';
    }
}

function loadFeedbacks() {
    const list = document.getElementById('feedbacks-list');
    const loading = document.getElementById('feedbacks-loading');
    const empty = document.getElementById('feedbacks-empty');

    if (!isSuperAdmin()) {
        if (unsubscribeFeedbacks) {
            unsubscribeFeedbacks();
            unsubscribeFeedbacks = null;
        }
        feedbackRecords = [];
        if (list) list.innerHTML = '';
        if (loading) loading.style.display = 'none';
        if (empty) empty.style.display = 'none';
        updateFeedbackSummary([]);
        return;
    }

    if (list) list.innerHTML = '';
    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';

    if (unsubscribeFeedbacks) {
        unsubscribeFeedbacks();
    }

    unsubscribeFeedbacks = db.collection('feedbacks')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            if (loading) loading.style.display = 'none';
            feedbackRecords = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            updateFeedbackSummary(feedbackRecords);
            renderFeedbacks();
        }, error => {
            console.error('Error loading feedbacks:', error);
            feedbackRecords = [];
            updateFeedbackSummary([]);
            renderFeedbacks();
            if (empty) empty.style.display = 'none';
            if (loading) {
                loading.style.display = 'flex';
                loading.innerHTML = `
                    <span class="feedback-loading-spinner feedback-loading-spinner--error"><i class="fas fa-triangle-exclamation"></i></span>
                    <div>
                        <strong>Geri bildirimler yüklenemedi</strong>
                        <span>Lütfen bağlantınızı kontrol edip sayfayı yenileyin.</span>
                    </div>
                `;
            }
        });
}
function openImagePreview(url) {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('image-preview-content');
    if (modal && img) {
        img.src = url;
        modal.style.display = 'flex';
    }
}

function closeImagePreview() {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('image-preview-content');
    if (modal && img) {
        modal.style.display = 'none';
        img.src = '';
    }
}

// ==========================================
// EXCEL QUESTION BANK IMPORT & EXPORT
// ==========================================

function downloadQuestionBankTemplate() {
    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Sayfayı yenileyin.');
        return;
    }

    const wb = XLSX.utils.book_new();

    // 1. Soru Şablonu
    const wsData = [
        ["Denetim Tipi Adı", "Puanlama Sistemi", "Fotoğraf Zorunlu mu?", "Açıklama Zorunlu mu?", "Kategori Adı", "Soru Metni", "Soru Cevap Tipi"],
        ["5S Örnek Denetim", "5'li Skala", "1, 2, 3", "1, 2", "1. İstasyon Girişi", "Çevre temizliği uygun mu?", "Skala"],
        ["5S Örnek Denetim", "5'li Skala", "1, 2, 3", "1, 2", "1. İstasyon Girişi", "Yönlendirmeler eksiksiz mi?", "Skala"],
        ["5S Örnek Denetim", "5'li Skala", "1, 2, 3", "1, 2", "2. Turnike Bölgesi", "Turnikeler aktif ve çalışıyor mu?", "Skala"],
        ["5S Örnek Denetim", "5'li Skala", "1, 2, 3", "1, 2", "2. Turnike Bölgesi", "Zemin temizliği yapılmış mı?", "Skala"],
        ["Güvenlik Denetimi", "Evet-Hayır", "Hayır", "Hayır", "Kameralar", "Tüm kameralar kayıt alıyor mu?", "Evet-Hayır"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Style headers and set column widths
    const range = XLSX.utils.decode_range(ws['!ref']);
    for(let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if(!ws[address]) continue;
        ws[address].s = { font: { bold: true } };
    }
    
    ws['!cols'] = [
        { wch: 25 }, { wch: 20 }, { wch: 28 }, { wch: 28 }, { wch: 25 }, { wch: 45 }, { wch: 20 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Soru Şablonu");

    // 2. Nasıl Yapılır
    const instructions = [
        ["❓ SORU BANKASI EXCEL YÜKLEME REHBERİ", "", ""],
        ["Bu şablonu kullanarak Soru Bankası'na toplu olarak Denetim Tipleri, Kategoriler ve Sorular ekleyebilirsiniz.", "", ""],
        ["", "", ""],
        ["📌 TEMEL BİLGİLER", "", ""],
        ["- Aynı denetim tipi altına birden fazla kategori ve soru eklemek için, alt alta olan satırlarda 'Denetim Tipi' ve 'Kategori' adlarını AYNI YAZMANIZ yeterlidir.", "", ""],
        ["- İlk sayfadaki ('Soru Şablonu') sütun başlıklarını değiştirmeyin veya silmeyin.", "", ""],
        ["- İçeri aktarma sırasında SADECE ilk sayfa okunur. Bu rehber sayfası veya sonradan eklediğiniz sayfalar dikkate alınmaz.", "", ""],
        ["", "", ""],
        ["📋 SÜTUN AÇIKLAMALARI VE KABUL EDİLEN DEĞERLER", "", ""],
        ["SÜTUN ADI", "AÇIKLAMA", "NE YAZMALISINIZ? (Kabul Edilen Değerler)"],
        ["", "", ""],
        ["1) Denetim Tipi Adı", "Sorunun ait olduğu denetim tipinin adıdır.", "Herhangi bir metin (Örn: 5S Denetimi)"],
        ["", "", ""],
        ["2) Puanlama Sistemi", "Bu denetim tipinin genel puanlama mantığını belirler.", "Aşağıdakilerden birini yazın:"],
        ["", "(Yalnızca ilk satırda yazılması yeterlidir)", "- 5'li Skala"],
        ["", "", "- Evet-Hayır"],
        ["", "", "- Toplam Puan"],
        ["", "", ""],
        ["3) Fotoğraf Zorunlu mu?", "Hangi yanıtlarda fotoğrafın zorunlu olacağını belirler.", "Aşağıdakilerden birini veya virgülle ayırarak yazın:"],
        ["", "(Yalnızca ilk satırda yazılması yeterlidir)", "- Skala için: 1, 2, 3, 4, 5"],
        ["", "", "- Evet-Hayır için: Evet, Hayır"],
        ["", "", "- Tümü (Tüm durumlarda zorunlu)"],
        ["", "", "- Zorunlu Değil (Hiçbir zaman istenmez)"],
        ["", "", ""],
        ["4) Açıklama Zorunlu mu?", "Hangi yanıtlarda açıklamanın zorunlu olacağını belirler.", "Aşağıdakilerden birini veya virgülle ayırarak yazın:"],
        ["", "(Yalnızca ilk satırda yazılması yeterlidir)", "- Skala için: 1, 2, 3, 4, 5"],
        ["", "", "- Evet-Hayır için: Evet, Hayır"],
        ["", "", "- Tümü (Tüm durumlarda zorunlu)"],
        ["", "", "- Zorunlu Değil (Hiçbir zaman istenmez)"],
        ["", "", ""],
        ["5) Kategori Adı", "Sorunun gruplandığı kategori başlığıdır.", "Herhangi bir metin (Örn: 1. Güvenlik, Temizlik)"],
        ["", "", ""],
        ["6) Soru Metni", "Denetim sırasında sorulacak sorudur.", "Herhangi bir metin (Örn: Zemin temiz mi?)"],
        ["", "", ""],
        ["7) Soru Cevap Tipi", "Bu özel sorunun nasıl cevaplanacağını belirler.", "Aşağıdakilerden birini yazın:"],
        ["", "", "- Skala"],
        ["", "", "- Evet-Hayır"]
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    
    // Formatting widths and merges for visual quality
    wsInstr['!cols'] = [
        { wch: 32 }, // Sütun Adı
        { wch: 65 }, // Açıklama
        { wch: 55 }  // Kabul Edilen Değerler
    ];
    
    wsInstr['!merges'] = [
        { s: {r: 0, c: 0}, e: {r: 0, c: 2} },
        { s: {r: 1, c: 0}, e: {r: 1, c: 2} },
        { s: {r: 3, c: 0}, e: {r: 3, c: 2} },
        { s: {r: 4, c: 0}, e: {r: 4, c: 2} },
        { s: {r: 5, c: 0}, e: {r: 5, c: 2} },
        { s: {r: 6, c: 0}, e: {r: 6, c: 2} },
        { s: {r: 8, c: 0}, e: {r: 8, c: 2} }
    ];

    XLSX.utils.book_append_sheet(wb, wsInstr, "Nasıl Yapılır");

    XLSX.writeFile(wb, "Soru_Bankasi_Sablonu.xlsx");
}

function parseExcelRuleToValues(ruleStr, strategy) {
    if (!ruleStr) return [];
    const lower = String(ruleStr).toLowerCase().trim();
    if (lower === 'tümü' || lower === 'tumu' || lower === 'tümü,') {
        if (strategy === 'booleanAverage') return [true, false];
        return [1, 2, 3, 4, 5];
    }
    if (lower === 'zorunlu değil' || lower === 'zorunlu degil' || lower === 'boş bırakın') return [];
    if ((lower === 'hayır' || lower === 'hayir') && strategy !== 'booleanAverage') return [];

    const parts = lower.split(',').map(s => s.trim()).filter(Boolean);
    const results = [];
    
    for (const part of parts) {
        if (strategy === 'booleanAverage') {
            if (part === 'evet') results.push(true);
            if (part === 'hayır' || part === 'hayir') results.push(false);
        } else {
            const num = parseInt(part, 10);
            if (!isNaN(num) && num >= 1 && num <= 5) {
                results.push(num);
            }
        }
    }
    return results;
}

async function handleQuestionBankExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.');
        return;
    }

    showToast('Excel dosyası işleniyor...', 'info');

    try {
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array' });
        
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        // Remove header row
        rows.shift();

        // 1. Group by Audit Type
        const typesMap = {};
        
        for (const row of rows) {
            if (!row || row.length < 6) continue;
            
            const typeName = String(row[0] || '').trim();
            const strategyRaw = String(row[1] || '').trim();
            const photoRulesRaw = String(row[2] || '').trim();
            const commentRulesRaw = String(row[3] || '').trim();
            const categoryName = String(row[4] || '').trim();
            const questionText = String(row[5] || '').trim();
            const questionTypeRaw = String(row[6] || '').trim();

            if (!typeName || !categoryName || !questionText) continue;

            if (!typesMap[typeName]) {
                let strategy = 'scaleAverage';
                if (strategyRaw.toLowerCase() === 'evet-hayır' || strategyRaw.toLowerCase() === 'evet-hayir') strategy = 'booleanAverage';
                if (strategyRaw.toLowerCase() === 'toplam puan') strategy = 'sumTotal';
                
                typesMap[typeName] = {
                    name: typeName,
                    strategy: strategy,
                    evidenceRules: parseExcelRuleToValues(photoRulesRaw, strategy),
                    commentRules: parseExcelRuleToValues(commentRulesRaw, strategy),
                    categories: {}
                };
            }
            
            if (!typesMap[typeName].categories[categoryName]) {
                typesMap[typeName].categories[categoryName] = [];
            }
            
            let qType = typesMap[typeName].strategy === 'booleanAverage' ? 'yes-no' : '5s-score';
            let aType = typesMap[typeName].strategy === 'booleanAverage' ? 'boolean' : 'scale';
            
            if (questionTypeRaw.toLowerCase() === 'evet-hayır' || questionTypeRaw.toLowerCase() === 'evet-hayir') {
                qType = 'yes-no';
                aType = 'boolean';
            } else if (questionTypeRaw.toLowerCase() === 'skala') {
                qType = '5s-score';
                aType = 'scale';
            }
            
            typesMap[typeName].categories[categoryName].push({
                text: questionText,
                type: qType,
                answerType: aType
            });
        }

        // 2. Merge with existing data
        for (const [tName, tData] of Object.entries(typesMap)) {
            // Find existing type or create new
            let existingType = (appData.auditTypes || []).find(t => (t.title || '').toLowerCase() === tName.toLowerCase());
            
            let typeId = existingType ? existingType.id : `AT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            
            let mergedType = {
                id: typeId,
                title: tName,
                scoringStrategy: existingType && !tData.strategy ? existingType.scoringStrategy : tData.strategy,
                evidenceRequiredValues: existingType && tData.evidenceRules.length === 0 ? existingType.evidenceRequiredValues : tData.evidenceRules,
                commentRequiredValues: existingType && tData.commentRules.length === 0 ? existingType.commentRequiredValues : tData.commentRules,
                isActive: existingType ? existingType.isActive : true,
                isDeleted: false,
                categories: existingType ? [...(existingType.categories || [])] : []
            };

            for (const [cName, cQuestions] of Object.entries(tData.categories)) {
                let existingCategory = mergedType.categories.find(c => (c.name || '').toLowerCase() === cName.toLowerCase());
                
                if (existingCategory) {
                    // append questions
                    for (const q of cQuestions) {
                        existingCategory.questions.push({
                            id: `Q-${Date.now()}-${Math.floor(Math.random()*10000)}`,
                            text: q.text,
                            type: q.type,
                            answerType: q.answerType,
                            isActive: true,
                            isDeleted: false,
                            orderIndex: existingCategory.questions.length
                        });
                    }
                } else {
                    // create category
                    let newCategory = {
                        id: `CAT-${Date.now()}-${Math.floor(Math.random()*10000)}`,
                        name: cName,
                        title: cName,
                        icon: 'fa-layer-group',
                        isActive: true,
                        isDeleted: false,
                        orderIndex: mergedType.categories.length,
                        questions: []
                    };
                    
                    for (const q of cQuestions) {
                        newCategory.questions.push({
                            id: `Q-${Date.now()}-${Math.floor(Math.random()*10000)}`,
                            text: q.text,
                            type: q.type,
                            answerType: q.answerType,
                            isActive: true,
                            isDeleted: false,
                            orderIndex: newCategory.questions.length
                        });
                    }
                    mergedType.categories.push(newCategory);
                }
            }
            
            // Save to Firestore
            await db.collection('auditTypes').doc(typeId).set(normalizeQuestionBankType(mergedType), { merge: true });
        }
        
        showToast('Excel başarıyla içeri aktarıldı.');
        document.getElementById('excel-import-input').value = '';
        
    } catch (err) {
        console.error("Excel import error:", err);
        showToast('Excel okunurken bir hata oluştu.');
        document.getElementById('excel-import-input').value = '';
    }
}

// ==========================================
// BULK EXCEL IMPORT: PERSONNEL
// ==========================================
function downloadPeopleTemplate() {
    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.');
        return;
    }

    const wb = XLSX.utils.book_new();

    // 1. Data Template Sheet
    const headers = [
        "Kullanıcı Adı", "Ad Soyad", "E-posta", "Rol (Yetki)", "Ünvan", "Yetkili Hatlar"
    ];
    const exampleRow = [
        "ramazan.tilki", "Ramazan Tilki", "ramazan.tilki@metro.istanbul", "Süper Admin", "Baş Onaylayıcı", "Tümü"
    ];
    const wsData = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
    
    // Style headers
    wsData['!cols'] = [
        { wch: 20 }, { wch: 25 }, { wch: 30 }, { wch: 25 }, { wch: 20 }, { wch: 40 }
    ];

    XLSX.utils.book_append_sheet(wb, wsData, "Personel Şablonu");

    // 2. Instructions Sheet
    const instructions = [
        ["❓ PERSONEL EXCEL YÜKLEME REHBERİ", "", ""],
        ["Bu şablonu kullanarak sisteme toplu olarak personel ekleyebilirsiniz.", "", ""],
        ["", "", ""],
        ["📌 TEMEL BİLGİLER", "", ""],
        ["- İlk sayfadaki ('Personel Şablonu') sütun başlıklarını değiştirmeyin veya silmeyin.", "", ""],
        ["- Eklenen tüm yeni kullanıcılara varsayılan şifre olarak '123456' atanacaktır.", "", ""],
        ["- Sadece ilk sayfa okunur, bu rehber sayfası dikkate alınmaz.", "", ""],
        ["", "", ""],
        ["📋 SÜTUN AÇIKLAMALARI VE KABUL EDİLEN DEĞERLER", "", ""],
        ["SÜTUN ADI", "AÇIKLAMA", "NE YAZMALISINIZ?"],
        ["", "", ""],
        ["1) Kullanıcı Adı", "Sisteme giriş için kullanılacak eşsiz addır. Sistemde kayıtlıysa güncellenir.", "Boşluksuz metin (Örn: ramazan.tilki)"],
        ["", "", ""],
        ["2) Ad Soyad", "Kullanıcının tam adıdır.", "Herhangi bir metin"],
        ["", "", ""],
        ["3) E-posta", "Kullanıcının e-posta adresidir.", "Geçerli e-posta (isteğe bağlı)"],
        ["", "", ""],
        ["4) Rol (Yetki)", "Kullanıcının sistemdeki yetkisini belirler.", "Aşağıdakilerden birini yazın:"],
        ["", "", "- Süper Admin"],
        ["", "", "- Ü.Yönetici"],
        ["", "", "- Yönetici"],
        ["", "", "- Onaylayıcı"],
        ["", "", "- Saha Denetçisi + Aksiyon Sorumlusu"],
        ["", "", "- Saha Denetçisi"],
        ["", "", ""],
        ["5) Yetkili Hatlar", "Kullanıcının hangi hatlarda denetim yapabileceğini belirler.", "Virgülle ayırarak hat kodlarını yazın."],
        ["", "", "Eğer tüm hatları görebilecekse sadece 'Tümü' yazın."],
        ["", "", "(Örn: M1, M2, M3)"]
    ];
    
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr['!cols'] = [{ wch: 30 }, { wch: 60 }, { wch: 50 }];
    wsInstr['!merges'] = [
        { s: {r: 0, c: 0}, e: {r: 0, c: 2} },
        { s: {r: 1, c: 0}, e: {r: 1, c: 2} },
        { s: {r: 3, c: 0}, e: {r: 3, c: 2} },
        { s: {r: 4, c: 0}, e: {r: 4, c: 2} },
        { s: {r: 5, c: 0}, e: {r: 5, c: 2} },
        { s: {r: 6, c: 0}, e: {r: 6, c: 2} },
        { s: {r: 8, c: 0}, e: {r: 8, c: 2} }
    ];

    XLSX.utils.book_append_sheet(wb, wsInstr, "Nasıl Yapılır");

    XLSX.writeFile(wb, "Personel_Sablonu.xlsx");
}

async function handlePeopleExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.');
        return;
    }

    showToast('Aktarım başlatıldı, lütfen bekleyin...');
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (rows.length < 2) {
                showToast("Excel dosyası boş veya sadece başlıklar var.");
                return;
            }

            let importCount = 0;
            let updateCount = 0;

            const batch = db.batch();

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0 || !row[0]) continue;

                const username = String(row[0] || '').trim();
                const name = String(row[1] || '').trim();
                const email = String(row[2] || '').trim();
                const rawRole = String(row[3] || '').trim().toLowerCase();
                const title = String(row[4] || '').trim();
                const rawLines = String(row[5] || '').trim();

                if (!username || !name) continue;

                // Parse Role
                let roleId = 'Field_Auditor';
                let authorityValue = 'Auditor';
                
                if (rawRole.includes('süper') || rawRole.includes('super')) {
                    roleId = 'Super_Admin';
                    authorityValue = 'Super_Admin';
                } else if (rawRole.includes('ü.yönetici') || rawRole.includes('ü. yönetici')) {
                    roleId = 'Executive_Viewer_Global';
                    authorityValue = 'Admin';
                } else if (rawRole.includes('yönetici')) {
                    roleId = 'Executive_Viewer_Restricted';
                    authorityValue = 'Admin';
                } else if (rawRole.includes('onaylayıcı')) {
                    roleId = 'Approver';
                    authorityValue = 'Admin';
                } else if (rawRole.includes('aksiyon')) {
                    roleId = 'Field_Auditor_Action_Owner';
                }

                // Parse Lines
                let authorizedLines = [];
                if (rawLines.toLowerCase() === 'tümü' || roleId === 'Super_Admin' || roleId === 'Executive_Viewer_Global') {
                    if (roleId !== 'Super_Admin' && roleId !== 'Executive_Viewer_Global') {
                        authorizedLines = ['ALL'];
                    }
                } else {
                    authorizedLines = rawLines.split(',').map(l => l.trim()).filter(l => l);
                }

                // Check if user exists
                const existingUser = appData.users.find(u => u.username === username);
                const userId = existingUser ? existingUser.id : `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

                const roleName = RBAC_ROLES.find(r => r.id === roleId)?.name || 'Saha Denetçisi';

                const userData = {
                    username: username,
                    name: name,
                    email: email,
                    title: title || roleName,
                    roleId: roleId,
                    roleName: roleName,
                    authorityValue: authorityValue,
                    authorizedLines: authorizedLines,
                    isActive: true,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (!existingUser) {
                    userData.password = '123456';
                    userData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    importCount++;
                } else {
                    updateCount++;
                }

                const userRef = db.collection('users').doc(userId);
                batch.set(userRef, userData, { merge: true });
            }

            if (importCount > 0 || updateCount > 0) {
                await batch.commit();
                showToast(`${importCount} yeni personel eklendi, ${updateCount} güncellendi.`);
                // trigger re-render if we are on people tab
                if (document.getElementById('people-view').style.display !== 'none') {
                    // It will auto-update via snapshot, but we can force it
                }
            } else {
                showToast("Aktarılacak geçerli satır bulunamadı.");
            }

        } catch (error) {
            console.error('Excel parse error:', error);
            showToast('Excel okunurken hata oluştu: ' + error.message);
        } finally {
            event.target.value = ''; // Reset input
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==========================================
// BULK EXCEL IMPORT: LINES & STATIONS
// ==========================================
function downloadLinesStationsTemplate() {
    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi.');
        return;
    }

    const wb = XLSX.utils.book_new();

    const headers = [
        "Hat Kodu (ID)", "Hat Adı", "Hat Rengi (Hex)", "İstasyon Kodu (ID)", "İstasyon Adı", "Tesis Tipi"
    ];
    const wsData = XLSX.utils.aoa_to_sheet([headers]);
    
    wsData['!cols'] = [
        { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 30 }, { wch: 20 }
    ];

    XLSX.utils.book_append_sheet(wb, wsData, "Hat-İstasyon Şablonu");

    const instructions = [
        ["❓ HAT VE İSTASYON EXCEL YÜKLEME REHBERİ", "", ""],
        ["Sisteme yeni hat ve istasyonları toplu olarak ekleyebilirsiniz.", "", ""],
        ["📌 TEMEL BİLGİLER", "", ""],
        ["- Her satır bir İSTASYON (veya yerleşke vb.) temsil eder.", "", ""],
        ["- Aynı Hat Kodu altına birden fazla istasyon eklenebilir.", "", ""],
        ["- Sistem, aynı Hat Kodunu gördüğünde onları tek bir hatta bağlar.", "", ""],
        ["", "", ""],
        ["SÜTUN ADI", "AÇIKLAMA", "NE YAZMALISINIZ?"],
        ["1) Hat Kodu", "Hattın benzersiz ID'si.", "Örn: M1, M2, T1"],
        ["2) Hat Adı", "Hattın tam adı.", "Örn: Yenikapı - Atatürk Havalimanı"],
        ["3) Hat Rengi", "Hattın rengi (Sadece ilk istasyonda yazmanız yeterli).", "Örn: #E30A17"],
        ["4) İstasyon Kodu", "İstasyonun benzersiz ID'si.", "Örn: M1_Yenikapi"],
        ["5) İstasyon Adı", "İstasyonun görünen adı.", "Örn: Yenikapı"],
        ["6) Tesis Tipi", "Bu yerin tipi (İstasyon, Yerleşke vs.).", "Örn: İstasyon"]
    ];
    
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr['!cols'] = [{ wch: 20 }, { wch: 60 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, "Nasıl Yapılır");

    XLSX.writeFile(wb, "Hatlar_Istasyonlar_Sablon.xlsx");
}

async function handleLinesStationsExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi.');
        return;
    }

    showToast('Hatlar aktarılıyor, bekleyin...');
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (rows.length < 2) {
                showToast("Excel dosyası boş veya sadece başlıklar var.");
                return;
            }

            let linesMap = new Map(appData.lines.map(l => [l.id, l]));
            let colorsMap = { ...appData.lineColors };
            
            let stationsMap = {};
            for (const [lId, stArr] of Object.entries(appData.stations || {})) {
                stationsMap[lId] = [...stArr];
            }

            let changed = false;

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !row[0]) continue;

                const lineId = String(row[0] || '').trim();
                const lineName = String(row[1] || '').trim();
                const lineColor = String(row[2] || '').trim();
                const stationId = String(row[3] || '').trim();
                const stationName = String(row[4] || '').trim();
                const type = String(row[5] || 'İstasyon').trim();

                if (!lineId) continue;
                changed = true;

                // Handle Line
                if (!linesMap.has(lineId)) {
                    linesMap.set(lineId, { id: lineId, name: lineName || lineId, isActive: true });
                } else if (lineName) {
                    const existing = linesMap.get(lineId);
                    existing.name = lineName;
                }

                if (lineColor) {
                    colorsMap[lineId] = lineColor;
                }

                // Handle Station
                if (stationId && stationName) {
                    if (!stationsMap[lineId]) stationsMap[lineId] = [];
                    const existingStation = stationsMap[lineId].find(s => s.id === stationId);
                    if (!existingStation) {
                        stationsMap[lineId].push({ id: stationId, name: stationName, type: type, isActive: true });
                    } else {
                        existingStation.name = stationName;
                        existingStation.type = type;
                    }
                }
            }

            if (changed) {
                appData.lines = Array.from(linesMap.values());
                appData.lineColors = colorsMap;
                appData.stations = stationsMap;
                
                await saveLinesStationsToFirebase();
                showToast("Hat ve İstasyonlar başarıyla güncellendi.");
                renderLines();
            } else {
                showToast("Aktarılacak satır bulunamadı.");
            }
        } catch (error) {
            console.error(error);
            showToast('Hata: ' + error.message);
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==========================================
// BULK EXCEL IMPORT: PLANNING (GÖREV PLANLAMA)
// ==========================================
function downloadPlanningTemplate() {
    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi.');
        return;
    }

    const wb = XLSX.utils.book_new();

    const headers = [
        "Plan Tipi (Aylık/Yıllık/Yıllık Haftalık)", "Yıl (Örn: 2026)", "Ay (1-12)", "Hafta (1-4) (Aylık/Yıllık Haftalık İçin)", "Görev Türü (İstasyon/Hat)", "Denetçi (Kullanıcı Adı)", "Hat Kodu", "İstasyon Kodu", "Denetim Tipi Adı"
    ];
    const wsData = XLSX.utils.aoa_to_sheet([headers]);
    
    wsData['!cols'] = [
        { wch: 35 }, { wch: 15 }, { wch: 15 }, { wch: 30 }, { wch: 30 }, { wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 35 }
    ];

    XLSX.utils.book_append_sheet(wb, wsData, "Görev Şablonu");

    const instructions = [
        ["❓ GÖREV PLANLAMA EXCEL YÜKLEME REHBERİ", "", ""],
        ["Toplu şekilde aylık, yıllık veya yıllık haftalık görevler planlayabilirsiniz.", "", ""],
        ["", "", ""],
        ["SÜTUN ADI", "AÇIKLAMA", "NE YAZMALISINIZ?"],
        ["1) Plan Tipi", "Görevin Aylık, Yıllık veya Yıllık Haftalık mı olduğunu belirler.", "Aylık, Yıllık VEYA Yıllık Haftalık"],
        ["2) Yıl", "Görevin hangi yılda yapılacağı.", "Örn: 2026"],
        ["3) Ay", "Görevin hangi ayda yapılacağı (Sayı olarak).", "Örn: 6 (Haziran için)"],
        ["4) Hafta", "Aylık veya Yıllık Haftalık planlar için gereklidir.", "1, 2, 3 veya 4"],
        ["5) Görev Türü", "İstasyon mu, Hat mı vb.", "İstasyon Denetimi VEYA Hat Denetimi"],
        ["6) Denetçi", "Görevin atanacağı kişinin kullanıcı adı.", "Sistemde var olan bir kullanıcı adı"],
        ["7) Hat Kodu", "Denetlenecek hat ID'si.", "Örn: M1"],
        ["8) İstasyon Kodu", "Gerekiyorsa İstasyon ID'si.", "Örn: M1_Yenikapi"],
        ["9) Denetim Tipi Adı", "Uygulanacak soru bankası.", "Örn: 5S Denetimi"]
    ];
    
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr['!cols'] = [{ wch: 30 }, { wch: 50 }, { wch: 40 }];
    wsInstr['!merges'] = [
        { s: {r: 0, c: 0}, e: {r: 0, c: 2} },
        { s: {r: 1, c: 0}, e: {r: 1, c: 2} }
    ];
    XLSX.utils.book_append_sheet(wb, wsInstr, "Nasıl Yapılır");

    XLSX.writeFile(wb, "Gorev_Planlama_Sablon.xlsx");
}

async function handlePlanningExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Excel kütüphanesi yüklenemedi.');
        return;
    }

    showToast('Planlar aktarılıyor...');
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
            
            if (rows.length < 2) return showToast("Excel dosyası boş.");

            const batch = db.batch();
            let count = 0;

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !row[0]) continue;

                const planTypeRaw = String(row[0] || '').trim().toLowerCase();
                const year = parseInt(row[1]);
                const month = parseInt(row[2]);
                const week = parseInt(row[3]);
                const type = String(row[4] || 'İstasyon Denetimi').trim();
                const username = String(row[5] || '').trim();
                const lineId = String(row[6] || '').trim();
                const stationId = String(row[7] || '').trim();
                const auditTypeName = String(row[8] || '').trim();

                if (isNaN(year) || isNaN(month)) continue;

                // Find Assigned User
                const userObj = appData.users.find(u => u.username === username);
                const assignedUserId = userObj ? userObj.id : 'unassigned';

                // Find Audit Type ID
                const auditTypeObj = appData.auditTypes.find(a => a.name === auditTypeName);
                const auditTypeId = auditTypeObj ? auditTypeObj.id : '';

                let id, startDate, endDate;

                if (planTypeRaw.includes('aylık') || planTypeRaw.includes('aylik')) {
                    const validWeek = isNaN(week) ? 1 : week;
                    startDate = new Date(year, month - 1, (validWeek - 1) * 7 + 1);
                    endDate = new Date(year, month - 1, validWeek * 7);
                    id = `MT-${Date.now()}-${validWeek}-${Math.floor(Math.random()*1000)}`;
                } else if (planTypeRaw.includes('yıllık') || planTypeRaw.includes('yillik')) {
                    if (planTypeRaw.includes('hafta') || planTypeRaw.includes('haftalık') || planTypeRaw.includes('haftalik')) {
                        const validWeek = isNaN(week) ? 1 : week;
                        startDate = new Date(year, month - 1, (validWeek - 1) * 7 + 1);
                        endDate = new Date(year, month - 1, validWeek * 7);
                        id = `YWT-${Date.now()}-${month}-${validWeek}-${Math.floor(Math.random()*1000)}`;
                    } else {
                        startDate = new Date(year, month - 1, 1);
                        endDate = new Date(year, month, 0); // last day of month
                        id = `YT-${Date.now()}-${month}-${Math.floor(Math.random()*1000)}`;
                    }
                } else {
                    // Fallback to manual if unknown
                    startDate = new Date(year, month - 1, 1);
                    endDate = new Date(year, month, 0);
                    id = `${Date.now()}-${Math.floor(Math.random()*1000)}`;
                }

                const task = {
                    assignedUserId,
                    type,
                    stationId,
                    lineId,
                    auditType: auditTypeId, 
                    startDate: startDate.toISOString(),
                    dueDate: endDate.toISOString(),
                    status: 'pending',
                    createdBy: currentUser ? currentUser.id : null,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                const docRef = db.collection('plans').doc(id);
                batch.set(docRef, task);
                count++;
            }

            if (count > 0) {
                await batch.commit();
                showToast(`${count} görev başarıyla eklendi.`);
            } else {
                showToast("Geçerli görev bulunamadı.");
            }

        } catch (error) {
            console.error(error);
            showToast('Hata: ' + error.message);
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// Presence Tracking & Online Users Management
let presenceHeartbeatInterval = null;
let onlineUsersRefreshInterval = null;

function startPresenceHeartbeat() {
    if (presenceHeartbeatInterval) {
        clearInterval(presenceHeartbeatInterval);
    }
    
    // Run immediately on start
    runPresenceHeartbeat();
    
    // Repeat every 30 minutes to check if calendar day changes
    presenceHeartbeatInterval = setInterval(runPresenceHeartbeat, 1800000);
}

function runPresenceHeartbeat() {
    if (currentUser && currentUser.id) {
        const now = new Date();
        if (currentUser.lastActive) {
            const lastActiveDate = new Date(currentUser.lastActive);
            const isToday = lastActiveDate.getDate() === now.getDate() &&
                            lastActiveDate.getMonth() === now.getMonth() &&
                            lastActiveDate.getFullYear() === now.getFullYear();
            if (isToday && currentUser.activePlatform === 'web') {
                console.log('Kullanıcı bugün zaten aktif kaydedilmiş, yazma atlanıyor.');
                return;
            }
        }
        
        db.collection('users').doc(currentUser.id).update({
            lastActive: now.toISOString(),
            activePlatform: 'web'
        }).then(() => {
            currentUser.lastActive = now.toISOString();
            currentUser.activePlatform = 'web';
        }).catch(err => console.error('Presence Heartbeat Error:', err));
    }
}

function getUserInitials(name) {
    if (!name) return 'U';
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
}

function getUserAvatarBgColor(name) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e'];
    if (!name) return colors[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

function renderOnlineUsers() {
    console.log('Rendering online users...');
    const tbody = document.getElementById('online-users-list');
    const emptyDiv = document.getElementById('online-users-empty');
    const onlineCountEl = document.getElementById('online-users-count');
    const totalCountEl = document.getElementById('total-users-count');
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    // Total count update
    const totalUsers = appData.users ? appData.users.length : 0;
    if (totalCountEl) totalCountEl.innerText = totalUsers;
    
    const now = new Date();
    
    // Filter users active today (calendar day) on web
    const onlineUsers = (appData.users || []).filter(u => {
        if (!u.lastActive || u.activePlatform !== 'web') return false;
        const lastActiveDate = new Date(u.lastActive);
        return lastActiveDate.getDate() === now.getDate() &&
               lastActiveDate.getMonth() === now.getMonth() &&
               lastActiveDate.getFullYear() === now.getFullYear();
    });
    
    // Sort: most recently active first
    onlineUsers.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
    
    if (onlineCountEl) onlineCountEl.innerText = onlineUsers.length;
    
    if (onlineUsers.length === 0) {
        emptyDiv.style.display = 'block';
        tbody.parentElement.style.display = 'none';
        return;
    }
    
    emptyDiv.style.display = 'none';
    tbody.parentElement.style.display = 'table';
    
    onlineUsers.forEach(u => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        
        // Avatar color and initials
        const avatarBg = getUserAvatarBgColor(u.name);
        const initials = getUserInitials(u.name);
        
        // Time text (Format as Today HH:MM)
        const dateObj = new Date(u.lastActive);
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const timeText = `Bugün ${hours}:${minutes}`;
        
        tr.innerHTML = `
            <td style="padding: 12px 16px; display: flex; align-items: center; gap: 12px;">
                <div style="position: relative; display: inline-block; flex-shrink: 0;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: ${avatarBg}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem;">
                        ${initials}
                    </div>
                    <span style="position: absolute; bottom: -2px; right: -2px; width: 12px; height: 12px; border-radius: 50%; background: #10b981; border: 2.5px solid var(--bg-card); box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.3);"></span>
                </div>
                <div>
                    <div style="font-weight: 700; color: var(--text-primary); font-size: 0.85rem; line-height: 1.2;">${escapeAttr(u.name || '-')}</div>
                    <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 2px;">@${escapeAttr(u.username || '-')}</div>
                </div>
            </td>
            <td style="padding: 12px 16px; font-size: 0.8rem; color: var(--text-secondary); vertical-align: middle;">
                ${escapeAttr(u.email || '-')}
            </td>
            <td style="padding: 12px 16px; font-size: 0.8rem; color: var(--text-secondary); vertical-align: middle;">
                <span style="font-weight: 600;">${escapeAttr(u.roleName || u.title || '-')}</span>
            </td>
            <td style="padding: 12px 16px; font-size: 0.8rem; color: var(--text-secondary); text-align: right; font-weight: 600; vertical-align: middle;">
                <span style="display: inline-flex; align-items: center; gap: 6px; color: #10b981;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; display: inline-block;"></span>${timeText}</span>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // Schedule periodic UI-only refresh if not already scheduled (every 5 minutes is plenty for daily active view)
    if (!onlineUsersRefreshInterval) {
        onlineUsersRefreshInterval = setInterval(() => {
            if (document.getElementById('online-users-view')?.style.display !== 'none') {
                renderOnlineUsers();
            } else {
                clearInterval(onlineUsersRefreshInterval);
                onlineUsersRefreshInterval = null;
            }
        }, 300000);
    }
}


