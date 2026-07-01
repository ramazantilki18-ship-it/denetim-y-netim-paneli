/**
 * WEB PANEL SHIFT MANAGEMENT & PERSONAL MATRIX VIEW
 * 
 * Maps "Puantaj Girişi" to the shift configuration CRUD page,
 * and "Kişisel İstatistikler" to the monthly matrix table.
 */

// Cache of shifts list
let shiftsList = [];
let rosterData = {}; // Cache of loaded monthly roster data

// Global dates for stats
let statsSelectedYear = new Date().getFullYear();
let statsSelectedMonth = new Date().getMonth() + 1;
let statsSelectedLine = 'Tümü';

// ----------------------------------------------------
// DB Listeners & Data Fetching
// ----------------------------------------------------

async function seedDefaultShifts() {
    try {
        const defaults = [
            { code: 'S8', name: 'Sabah', hours: '06:30 - 15:30', type: 'work', group: 'sabah' },
            { code: 'S10', name: 'Sabah', hours: '06:45 - 15:45', type: 'work', group: 'sabah' },
            { code: 'S12', name: 'Sabah', hours: '07:00 - 16:00', type: 'work', group: 'sabah' },
            { code: 'N', name: 'Sabah (Normal)', hours: '08:00 - 17:00', type: 'work', group: 'sabah' },
            { code: 'A9', name: 'Akşam', hours: '14:00 - 23:00', type: 'work', group: 'aksam' },
            { code: 'A10', name: 'Akşam', hours: '12:00 - 21:00', type: 'work', group: 'aksam' },
            { code: 'A11', name: 'Akşam', hours: '14:30 - 23:30', type: 'work', group: 'aksam' },
            { code: 'A12', name: 'Akşam', hours: '14:45 - 23:45', type: 'work', group: 'aksam' },
            { code: 'A13', name: 'Akşam', hours: '15:00 - 23:59', type: 'work', group: 'aksam' },
            { code: 'İ', name: 'Haftalık İzin', hours: 'Tatil', type: 'off', group: 'izin' },
            { code: 'Yİ', name: 'Yıllık İzin', hours: 'İzinli', type: 'off', group: 'izin' },
            { code: 'R', name: 'Rapor', hours: 'İstirahat', type: 'off', group: 'izin' }
        ];

        const snapshot = await db.collection('shifts').get();
        const existingCodes = new Set();
        snapshot.forEach(doc => {
            if (doc.data().code) {
                existingCodes.add(doc.data().code.toUpperCase());
            }
        });

        for (const s of defaults) {
            if (!existingCodes.has(s.code.toUpperCase())) {
                console.log('Seeding missing shift:', s.code);
                await db.collection('shifts').add(s);
            }
        }
    } catch (err) {
        console.error('Error seeding shifts:', err);
    }
}

function initShiftsListener() {
    seedDefaultShifts();
    db.collection('shifts').onSnapshot(snapshot => {
        shiftsList = [];
        snapshot.forEach(doc => {
            shiftsList.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort shifts: work shifts first, then code alphabetically
        shiftsList.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'work' ? -1 : 1;
            return a.code.localeCompare(b.code);
        });
        
        // If current active view is roster-entry-view, re-render shifts crud
        const currentView = document.querySelector('.view-section[style*="display: block"]');
        if (currentView) {
            if (currentView.id === 'roster-entry-view') {
                renderRosterEntry();
            } else if (currentView.id === 'personal-stats-view') {
                renderPersonalStats();
            }
        }
    }, err => console.error('Shifts listener error:', err));
}

async function loadMonthlyRoster(year, month) {
    try {
        const snapshot = await db.collection('user_rosters')
            .where('year', '==', parseInt(year))
            .where('month', '==', parseInt(month))
            .get();
        
        const data = {};
        snapshot.forEach(doc => {
            data[doc.data().userId] = doc.data();
        });
        return data;
    } catch (err) {
        console.error('Roster load error:', err);
        return {};
    }
}

// ----------------------------------------------------
// VIEW 1: Puantaj Girişi / Vardiya Tanımları (roster-entry-view)
// ----------------------------------------------------

function renderRosterEntry() {
    const container = document.getElementById('roster-entry-view');
    if (!container) return;

    let tableRowsHtml = '';
    shiftsList.forEach(shift => {
        const typeText = shift.type === 'work' ? 'Çalışma Günü' : 'İzin / Tatil';
        const typeBadgeClass = shift.type === 'work' ? 'badge-primary' : 'badge-outline';
        
        let groupText = 'İzin ve Diğer';
        if (shift.group === 'sabah') groupText = 'Sabah Vardiyaları';
        else if (shift.group === 'aksam') groupText = 'Akşam Vardiyaları';

        tableRowsHtml += `
            <tr>
                <td style="width: 60px; max-width: 60px; min-width: 60px; padding-left: 2px; padding-right: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><strong>${escapeAttr(shift.code)}</strong></td>
                <td>${escapeAttr(shift.name)}</td>
                <td>${escapeAttr(shift.hours || 'N/A')}</td>
                <td>${typeText}</td>
                <td>${escapeAttr(groupText)}</td>
                <td style="width: 90px; max-width: 90px; min-width: 90px; white-space: nowrap;"><strong>${shift.requiredAuditCount || 0}</strong></td>
                <td style="width: 180px; max-width: 180px; min-width: 180px; white-space: nowrap;">
                    <button class="btn-outline" style="display: inline-flex; align-items: center; justify-content: center; width: 80px; height: 28px; font-size: 0.72rem; margin-right: 4px; padding: 0;" onclick="openEditShiftModal('${shift.id}')"><i class="fas fa-edit" style="margin-right: 4px;"></i> Düzenle</button>
                    <button class="btn-outline" style="display: inline-flex; align-items: center; justify-content: center; width: 80px; height: 28px; font-size: 0.72rem; color: #ef4444; border-color: #ef4444; padding: 0;" onclick="deleteShift('${shift.id}')"><i class="fas fa-trash" style="margin-right: 4px;"></i> Sil</button>
                </td>
            </tr>
        `;
    });

    container.innerHTML = `
        <div class="roster-card">
            <div class="roster-header" style="justify-content: flex-end;">
                <button class="btn-primary" onclick="openAddShiftModal()"><i class="fas fa-plus"></i> Yeni Vardiya Ekle</button>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-dim); margin-top: -10px; margin-bottom: 20px;">
                Denetçilerin mobil uygulamada günlük puantaj girişi yaparken seçebileceği vardiya saatlerini ve izin tiplerini (S10, S1, A1, HT, Yİ, R vb.) buradan ekleyip düzenleyebilirsiniz.
            </p>
            <div class="matrix-scroll-wrapper">
                <table class="matrix-table" style="min-width: 760px; width: 100%;">
                    <thead>
                        <tr>
                            <th style="width: 60px; max-width: 60px; min-width: 60px; padding-left: 2px; padding-right: 2px;">V.Kodu</th>
                            <th>Vardiya Adı</th>
                            <th>Çalışma Saatleri</th>
                            <th>Tipi</th>
                            <th>Grup</th>
                            <th style="width: 90px; max-width: 90px; min-width: 90px;">Hedef Denetim</th>
                            <th style="width: 180px; max-width: 180px; min-width: 180px;">Aksiyonlar</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml || '<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-dim);">Henüz tanımlı vardiya bulunmuyor.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// Add/Edit Shift Form Modals
window.openAddShiftModal = function() {
    showShiftFormModal();
};

window.openEditShiftModal = function(id) {
    const shift = shiftsList.find(s => s.id === id);
    if (shift) {
        showShiftFormModal(shift);
    }
};

function showShiftFormModal(shift = null) {
    const isEdit = !!shift;
    const modalTitle = isEdit ? 'Vardiya Düzenle' : 'Yeni Vardiya Ekle';
    
    const modal = document.createElement('div');
    modal.className = 'custom-modal';
    modal.id = 'shift-form-modal';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0, 0, 0, 0.6)';
    modal.style.zIndex = '1000';
    
    modal.innerHTML = `
        <div class="roster-card" style="width: 450px; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <div class="roster-header" style="margin-bottom: 1.5rem;">
                <h3>${modalTitle}</h3>
                <button onclick="closeShiftModal()" style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:1.2rem;"><i class="fas fa-times"></i></button>
            </div>
            <form id="shift-form" onsubmit="handleShiftSubmit(event, ${isEdit ? `'${shift.id}'` : 'null'})">
                <div style="display:flex; flex-direction:column; gap:1rem; margin-bottom: 1.5rem;">
                    <div style="display:flex; flex-direction:column; gap:0.4rem;">
                        <label style="font-size:0.8rem; font-weight:600;">Vardiya Kodu (Örn: S8, S10, N, HT)</label>
                        <input type="text" class="cms-input" id="shift-code" value="${isEdit ? escapeAttr(shift.code) : ''}" required style="padding: 0.5rem; border-radius: 8px;" />
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.4rem;">
                        <label style="font-size:0.8rem; font-weight:600;">Vardiya Adı (Örn: Sabah, Hafta Tatili)</label>
                        <input type="text" class="cms-input" id="shift-name" value="${isEdit ? escapeAttr(shift.name) : ''}" required style="padding: 0.5rem; border-radius: 8px;" />
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.4rem;">
                        <label style="font-size:0.8rem; font-weight:600;">Çalışma Saatleri (Örn: 06:30-15:30, İzinliler için boş bırakın)</label>
                        <input type="text" class="cms-input" id="shift-hours" value="${isEdit ? escapeAttr(shift.hours || '') : ''}" placeholder="Örn: 06:30-15:30" style="padding: 0.5rem; border-radius: 8px;" />
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.4rem;">
                        <label style="font-size:0.8rem; font-weight:600;">Vardiya Tipi</label>
                        <select class="cms-input" id="shift-type" style="padding: 0.5rem; border-radius: 8px;">
                            <option value="work" ${isEdit && shift.type === 'work' ? 'selected' : ''}>Çalışma Günü</option>
                            <option value="off" ${isEdit && shift.type === 'off' ? 'selected' : ''}>İzin / Tatil</option>
                        </select>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.4rem;">
                        <label style="font-size:0.8rem; font-weight:600;">Vardiya Grubu</label>
                        <select class="cms-input" id="shift-group" style="padding: 0.5rem; border-radius: 8px;">
                            <option value="sabah" ${isEdit && shift.group === 'sabah' ? 'selected' : ''}>Sabah Vardiyaları</option>
                            <option value="aksam" ${isEdit && shift.group === 'aksam' ? 'selected' : ''}>Akşam Vardiyaları</option>
                            <option value="izin" ${isEdit && shift.group === 'izin' ? 'selected' : ''}>İzin ve Diğer</option>
                        </select>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.4rem;">
                        <label style="font-size:0.8rem; font-weight:600;">Hedef Denetim Sayısı (Vardiyada tamamlanması gereken denetim adedi)</label>
                        <input type="number" class="cms-input" id="shift-required-audit-count" min="0" value="${isEdit ? (shift.requiredAuditCount || 0) : 0}" required style="padding: 0.5rem; border-radius: 8px;" />
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:0.8rem;">
                    <button type="button" class="btn-outline" onclick="closeShiftModal()">İptal</button>
                    <button type="submit" class="btn-primary">Kaydet</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
}

window.closeShiftModal = function() {
    const modal = document.getElementById('shift-form-modal');
    if (modal) {
        modal.remove();
    }
};

window.handleShiftSubmit = async function(event, id) {
    event.preventDefault();
    const code = document.getElementById('shift-code').value.trim().toUpperCase();
    const name = document.getElementById('shift-name').value.trim();
    const hours = document.getElementById('shift-hours').value.trim();
    const type = document.getElementById('shift-type').value;
    const group = document.getElementById('shift-group').value;
    const requiredAuditCount = parseInt(document.getElementById('shift-required-audit-count').value) || 0;

    try {
        const payload = {
            code,
            name,
            hours: hours || '',
            type,
            group,
            requiredAuditCount,
            updatedAt: new Date().toISOString()
        };

        if (id) {
            await db.collection('shifts').doc(id).update(payload);
            showToast('Vardiya başarıyla güncellendi.');
        } else {
            const existing = shiftsList.find(s => s.code === code);
            if (existing) {
                showToast('Bu vardiya kodu zaten mevcut!');
                return;
            }
            await db.collection('shifts').add(payload);
            showToast('Vardiya başarıyla eklendi.');
        }
        closeShiftModal();
    } catch (err) {
        console.error('Shift save error:', err);
        showToast('Hata oluştu: ' + err.message);
    }
};

window.deleteShift = function(id) {
    const shift = shiftsList.find(s => s.id === id);
    if (!shift) return;
    
    if (confirm(`"${shift.code} - ${shift.name}" vardiyasını silmek istediğinize emin misiniz?`)) {
        db.collection('shifts').doc(id).delete()
            .then(() => showToast('Vardiya başarıyla silindi.'))
            .catch(err => {
                console.error('Shift delete error:', err);
                showToast('Hata: ' + err.message);
            });
    }
};


// ----------------------------------------------------
// VIEW 2: Kişisel İstatistikler Matrisi (personal-stats-view)
// ----------------------------------------------------

function renderUserRosterLineLogos(user) {
    const isGlobal = user.roleId === 'Super_Admin' || user.roleId === 'Executive_Viewer_Global' || user.isGlobalScope === true || user.scopeType === 'global';
    if (isGlobal) {
        return `<div class="line-logo" style="background:#475569; color:white; font-size:0.6rem; font-weight:800; border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);" title="Tüm Hatlar"><i class="fas fa-globe" style="font-size:0.65rem;"></i></div>`;
    }
    const lines = Array.isArray(user.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
    if (lines.length === 0) {
        return `<div class="line-logo" style="background:#64748b; color:white; font-size:0.6rem; font-weight:800; border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);" title="Hat Yok">?</div>`;
    }
    return lines.map((line, idx) => {
        const color = (appData.lineColors && appData.lineColors[line]) || '#2563eb';
        return `
            <div class="line-logo" style="background:${color}; color:white; font-size:0.62rem; font-weight:800; border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.1); margin-left:${idx > 0 ? '-6px' : '0px'}; border:1px solid var(--bg-card); z-index:${5 - idx};" title="${line}">${line}</div>
        `;
    }).join('');
}

async function renderPersonalStats() {
    const container = document.getElementById('personal-stats-view');
    if (!container) return;

    // Load Roster and Audits
    const monthlyRosterMap = await loadMonthlyRoster(statsSelectedYear, statsSelectedMonth);
    const audits = appData.audits || [];

    // Pre-process audits into a map by auditorId_year_month_day for O(1) performance
    const auditsLookup = {};
    audits.forEach(audit => {
        if (!audit.date || !audit.auditorId) return;
        const auditDate = new Date(audit.date);
        const y = auditDate.getFullYear();
        const m = auditDate.getMonth() + 1;
        const d = auditDate.getDate();
        
        const key = `${audit.auditorId}_${y}_${m}_${d}`;
        if (!auditsLookup[key]) {
            auditsLookup[key] = [];
        }
        auditsLookup[key].push(audit);
    });

    const yearsOptions = [2025, 2026, 2027].map(y => 
        `<option value="${y}" ${y === statsSelectedYear ? 'selected' : ''}>${y}</option>`
    ).join('');

    const months = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];
    const monthsOptions = months.map((m, idx) => 
        `<option value="${idx + 1}" ${idx + 1 === statsSelectedMonth ? 'selected' : ''}>${m}</option>`
    ).join('');

    const daysInMonth = new Date(statsSelectedYear, statsSelectedMonth, 0).getDate();

    // Table Headers (Person, 1 to 31, Total Audits)
    let dayHeaders = '';
    for (let day = 1; day <= daysInMonth; day++) {
        dayHeaders += `<th class="matrix-day-hdr">${day}</th>`;
    }

    // Dynamic legend generation from db
    const activeShifts = (shiftsList && shiftsList.length > 0) ? shiftsList : [
        { code: 'S', name: 'Sabah', type: 'work' },
        { code: 'A', name: 'Akşam', type: 'work' },
        { code: 'G', name: 'Gece', type: 'work' },
        { code: 'HT', name: 'Hafta Tatili', type: 'off' },
        { code: 'Yİ', name: 'Yıllık İzin', type: 'off' },
        { code: 'R', name: 'Raporlu', type: 'off' }
    ];

    const sabahShifts = activeShifts.filter(s => s.group === 'sabah').sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    const aksamShifts = activeShifts.filter(s => s.group === 'aksam').sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    const izinShifts = activeShifts.filter(s => s.group === 'izin' || s.type !== 'work').sort((a, b) => {
        const order = { 'HT': 1, 'Yİ': 2, 'R': 3 };
        return (order[a.code] || 99) - (order[b.code] || 99);
    });

    function formatHoursCompact(hours) {
        if (!hours) return '';
        return hours.replace(/\s+/g, ''); // Keep full minutes (e.g., 08:00-18:00)
    }

    const sabahShiftsHtml = sabahShifts.map(s => {
        const hoursText = formatHoursCompact(s.hours);
        return `
            <div style="display:inline-flex; flex-direction:column; align-items:center; gap:1px; vertical-align:top; min-width:20px;">
                <span class="legend-shift-text legend-shift-text-s" style="margin:0;" title="${escapeAttr(s.name)}">${s.code}</span>
                ${hoursText ? `<span class="legend-hours-text">${hoursText}</span>` : ''}
            </div>
        `;
    }).join('');

    const aksamShiftsHtml = aksamShifts.map(s => {
        const hoursText = formatHoursCompact(s.hours);
        return `
            <div style="display:inline-flex; flex-direction:column; align-items:center; gap:1px; vertical-align:top; min-width:20px;">
                <span class="legend-shift-text legend-shift-text-a" style="margin:0;" title="${escapeAttr(s.name)}">${s.code}</span>
                ${hoursText ? `<span class="legend-hours-text">${hoursText}</span>` : ''}
            </div>
        `;
    }).join('');

    const izinShiftsHtml = izinShifts.map(s => {
        const hoursText = formatHoursCompact(s.hours);
        let colorClass = 'legend-shift-text-off';
        if (s.code === 'HT') colorClass = 'legend-shift-text-ht';
        else if (s.code === 'Yİ') colorClass = 'legend-shift-text-yi';
        else if (s.code === 'R') colorClass = 'legend-shift-text-r';
        
        return `
            <div style="display:inline-flex; flex-direction:column; align-items:center; gap:1px; vertical-align:top; min-width:20px;">
                <span class="legend-shift-text ${colorClass}" style="margin:0;" title="${escapeAttr(s.name)}">${s.code}</span>
                ${hoursText ? `<span class="legend-hours-text">${hoursText}</span>` : ''}
            </div>
        `;
    }).join('');

    const legendItemsHtml = `
        <div class="legend-group">
            <span class="legend-group-title">Sabah:</span>
            <div class="legend-shifts-container">${sabahShiftsHtml}</div>
        </div>
        <div class="legend-group">
            <span class="legend-group-title">Akşam:</span>
            <div class="legend-shifts-container">${aksamShiftsHtml}</div>
        </div>
        <div class="legend-group">
            <span class="legend-group-title">İzinler:</span>
            <div class="legend-shifts-container">${izinShiftsHtml}</div>
        </div>
        <div style="display:inline-flex; align-items:center; gap:5px; vertical-align:top;">
            <span class="legend-group-title">Diğer:</span>
            <div style="display:inline-flex; gap:6px;">
                <!-- Mazeret -->
                <div style="display:inline-flex; flex-direction:column; align-items:center; gap:1px; vertical-align:top; min-width:20px; margin-top:2px;">
                    <span class="matrix-excuse-dot" style="display:inline-block; background:#d97706; border-radius:50%; width:14px; height:14px; box-shadow:0 1px 2px rgba(0,0,0,0.15);" title="Mazeret"></span>
                    <span class="legend-hours-text" style="margin-top:0px;">Mazeret</span>
                </div>
                <!-- Eksik -->
                <div style="display:inline-flex; flex-direction:column; align-items:center; gap:1px; vertical-align:top; min-width:20px; margin-top:2px;">
                    <span class="matrix-deficit-dot" style="display:inline-block; background:#ef4444; border-radius:50%; width:14px; height:14px; box-shadow:0 1px 2px rgba(0,0,0,0.15);" title="Mazeret Yok"></span>
                    <span class="legend-hours-text" style="margin-top:0px;">Mazeret Yok</span>
                </div>
            </div>
        </div>
    `;

    // Table Rows (Filtered Users)
    let rowsHtml = '';
    const activeUsers = appData.users.filter(u => {
        if (!u.username || u.isDeleted) return false;
        
        // Exclude hat vardiya amiri and istasyon sorumlusu using robust character normalized matching
        const titleClean = (u.title || u.roleName || u.jobTitle || u.role || '')
            .replace(/İ/g, 'i')
            .replace(/ı/g, 'i')
            .replace(/I/g, 'i')
            .toLowerCase()
            .replace(/ş/g, 's')
            .replace(/ö/g, 'o')
            .replace(/ü/g, 'u')
            .replace(/ç/g, 'c')
            .replace(/ğ/g, 'g');
            
        const isSupervisor = 
            titleClean.includes('istasyon sorumlusu') || 
            titleClean.includes('hat vardiya amiri');
            
        if (isSupervisor) {
            return false;
        }

        // Determine role using the official dashboard helper
        const inferredRole = inferRbacRoleId(u);
        const isAuditor = (inferredRole === 'Field_Auditor' || inferredRole === 'Field_Auditor_Action_Owner');

        if (!isAuditor) return false;

        // Line Filter
        if (statsSelectedLine !== 'Tümü') {
            const isGlobal = inferredRole === 'Super_Admin' || inferredRole === 'Executive_Viewer_Global' || u.isGlobalScope === true || u.scopeType === 'global';
            if (!isGlobal) {
                const userLines = u.authorizedLines || [];
                if (!userLines.includes(statsSelectedLine)) return false;
            }
        }

        // Filter by currentUser's authorized lines if currentUser is not global
        const currentIsGlobal = isSuperAdmin() || currentUser.roleId === 'Executive_Viewer_Global' || currentUser.isGlobalScope === true || currentUser.scopeType === 'global';
        if (!currentIsGlobal) {
            const currentLines = Array.isArray(currentUser.authorizedLines) ? currentUser.authorizedLines.filter(Boolean) : [];
            const userLines = Array.isArray(u.authorizedLines) ? u.authorizedLines.filter(Boolean) : [];
            const hasOverlap = userLines.some(l => currentLines.includes(l));
            if (!hasOverlap) return false;
        }

        return true;
    });

    // Helper to get sortable line name
    function getUserSortLine(user) {
        const isGlobal = user.roleId === 'Super_Admin' || user.roleId === 'Executive_Viewer_Global' || user.isGlobalScope === true || user.scopeType === 'global';
        if (isGlobal) return '00_Global';
        const lines = Array.isArray(user.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
        if (lines.length === 0) return '99_None';
        const sorted = [...lines].sort();
        return sorted[0];
    }

    // Sort activeUsers: Line first, then Name
    activeUsers.sort((a, b) => {
        const lineA = getUserSortLine(a);
        const lineB = getUserSortLine(b);
        const lineCompare = lineA.localeCompare(lineB, 'tr');
        if (lineCompare !== 0) return lineCompare;

        const nameA = (a.name || a.displayName || a.username || '').toLowerCase();
        const nameB = (b.name || b.displayName || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB, 'tr');
    });

    activeUsers.forEach(user => {
        const userRoster = monthlyRosterMap[user.id] || { days: {} };
        const userName = user.name || user.displayName || user.username || '';
        let cellsHtml = '';
        let totalUserAuditsForMonth = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = day.toString();
            const rosterDay = userRoster.days?.[dayKey] || { shift: '-', excuse: '' };
            const shift = rosterDay.shift || '-';
            const excuse = rosterDay.excuse || '';

            // O(1) hash map lookup instead of O(K) filter
            const lookupKey = `${user.id}_${statsSelectedYear}_${statsSelectedMonth}_${day}`;
            const dailyAudits = [...(auditsLookup[lookupKey] || [])];
            // Sort audits chronologically
            dailyAudits.sort((a, b) => new Date(a.date) - new Date(b.date));
            const pad = (num) => String(num).padStart(2, '0');
            const auditInfos = dailyAudits.map(a => {
                const d = new Date(a.date);
                const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                const station = a.station || 'Belirtilmedi';
                const lName = a.line || '';
                return `${time}|${station}|${lName}`;
            });
            const auditInfosStr = auditInfos.join('~');
            const hoverTooltip = dailyAudits.map(a => {
                const d = new Date(a.date);
                const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                return `${time} (${a.station || 'Belirtilmedi'})`;
            }).join(', ');
            const auditCount = dailyAudits.length;
            totalUserAuditsForMonth += auditCount;

            // Cell Class & Tooltip
            let cellClass = 'matrix-day-cell';
            let excuseTooltip = '';
            
            // Deficit highlight: working but 0 audits with no excuse
            const matchedShift = activeShifts.find(s => s.code === shift);
            const isWorking = matchedShift ? matchedShift.type === 'work' : ['S', 'A', 'G', 'N', 'S8', 'S10'].includes(shift);
            
            if (isWorking && auditCount === 0 && !excuse) {
                cellClass += ' cell-deficit-red';
            } else if (excuse) {
                cellClass += ' cell-has-excuse-orange';
                excuseTooltip = `title="Mazeret: ${escapeAttr(excuse)}"`;
            }

            // Shift color for the corner display
            let shiftTextColor = 'var(--text-dim)';
            let shiftGroup = matchedShift?.group || '';
            if (shift.startsWith('S') || shiftGroup === 'sabah') shiftTextColor = '#007AFF'; // prominent blue
            else if (shift.startsWith('A') || shiftGroup === 'aksam') shiftTextColor = '#FF9500'; // prominent orange
            else if (shift === 'G') shiftTextColor = '#8b5cf6';
            else if (shift === 'HT') shiftTextColor = '#FF3B30'; // prominent red
            else if (shift === 'Yİ') shiftTextColor = '#34C759'; // prominent green
            else if (shift === 'R') shiftTextColor = '#FF2D55'; // prominent pink
            else if (matchedShift) {
                shiftTextColor = matchedShift.type === 'work' ? '#007AFF' : '#8e8e93';
            }

            cellsHtml += `
                <td class="${cellClass}" ${excuseTooltip} style="padding: 2px; height: 38px; width: 38px; min-width: 38px; position: relative;">
                    <div class="matrix-cell-wrapper" style="position:relative; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:2px 0;">
                        <!-- Shift Code (Top) -->
                        ${shift !== '-' ? `
                            <span class="matrix-corner-shift" style="font-size:0.66rem; font-weight:900; color:${shiftTextColor}; line-height:1; letter-spacing:-0.1px;">
                                ${shift}
                            </span>
                        ` : `
                            <span style="font-size:0.66rem; line-height:1; visibility:hidden;">-</span>
                        `}
                        
                        <!-- Audit Count Box (Bottom) -->
                        ${auditCount > 0 ? `
                            <div class="matrix-audit-box" style="background: ${auditCount >= 10 ? '#166534' : '#991b1b'}; color:white; font-size:0.7rem; font-weight:800; border-radius:3px; min-width:16px; width:auto; height:16px; padding:0 3px; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 2px rgba(0,0,0,0.15); line-height:1; cursor:pointer;" title="Denetimler: ${hoverTooltip}" onclick="showAuditTimesDetail('${userName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${day} ${months[statsSelectedMonth - 1]} ${statsSelectedYear}', '${auditInfosStr}')">${auditCount}</div>
                        ` : `
                            <div class="matrix-audit-box-empty" style="font-size:0.7rem; color:var(--text-dim); opacity:0.35; line-height:1;">-</div>
                        `}
                        
                        <!-- Excuse or Deficit Dot (Bottom-Right Corner) -->
                        ${excuse ? `
                            <span class="matrix-excuse-dot" style="position:absolute; bottom:2px; right:2px; background:#d97706; border-radius:50%; width:8px; height:8px; box-shadow:0 1px 2px rgba(0,0,0,0.15);" title="Mazeret: ${escapeAttr(excuse)}"></span>
                        ` : (isWorking && auditCount === 0) ? `
                            <span class="matrix-deficit-dot" style="position:absolute; bottom:2px; right:2px; background:#ef4444; border-radius:50%; width:8px; height:8px; box-shadow:0 1px 2px rgba(0,0,0,0.15);" title="Mazeret Yok (Eksik)"></span>
                        ` : ''}
                    </div>
                </td>
            `;
        }

        rowsHtml += `
            <tr>
                <td class="matrix-user-cell">
                    <div style="display:flex; align-items:center; gap:0.45rem;">
                        <div style="display:flex; flex-shrink:0;">
                            ${renderUserRosterLineLogos(user)}
                        </div>
                        <div style="display:flex; flex-direction:column; min-width:0; overflow:hidden;">
                            <strong style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeAttr(user.name || user.displayName || user.username)}">${user.name || user.displayName || user.username}</strong>
                            <div style="font-size:0.65rem; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeAttr(user.title || user.roleName || user.jobTitle || user.role || '')}">${user.title || user.roleName || user.jobTitle || user.role || ''}</div>
                        </div>
                    </div>
                </td>
                ${cellsHtml}
                <td class="matrix-total-cell" style="text-align: center; vertical-align: middle;">
                    <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; color: white; font-weight: 800; min-width: 32px; text-align: center; background: #1e3a8a;">
                        ${totalUserAuditsForMonth}
                    </span>
                </td>
            </tr>
        `;
    });

    // Populate lines list
    const currentIsGlobal = isSuperAdmin() || currentUser.roleId === 'Executive_Viewer_Global' || currentUser.isGlobalScope === true || currentUser.scopeType === 'global';
    let linesList = appData.lines || [];
    if (!currentIsGlobal) {
        const currentLines = Array.isArray(currentUser.authorizedLines) ? currentUser.authorizedLines.filter(Boolean) : [];
        linesList = linesList.filter(line => currentLines.includes(line));
    }
    const linesOptions = `<option value="Tümü" ${statsSelectedLine === 'Tümü' ? 'selected' : ''}>Tüm Hatlar</option>` + 
        linesList.map(line => `<option value="${line}" ${line === statsSelectedLine ? 'selected' : ''}>${line}</option>`).join('');

    const monthNamesTr = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    const selectedMonthName = monthNamesTr[statsSelectedMonth - 1] || 'Denetçi';

    container.innerHTML = `
        <div class="roster-card">
            <div class="roster-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; padding:0.4rem 1.25rem; min-height:36px; background:transparent !important; border-bottom:1px solid rgba(255,255,255,0.08); border-top-left-radius:12px; border-top-right-radius:12px;">
                <!-- Left: Filters moved to the top header -->
                <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
                    <div class="filter-group" style="display:flex; align-items:center; gap:0.35rem; margin:0;">
                        <label style="font-weight:700; font-size:0.76rem; color:#f1f5f9;">Yıl:</label>
                        <select class="cms-input" id="stats-year-select" style="padding:3px 8px; font-size:0.76rem; border-radius:5px; min-width:80px; height:28px; background:#0f172a !important; color:#ffffff !important; border:1px solid rgba(255,255,255,0.15) !important;" onchange="changeStatsFilters(this.value, null, null)">
                            ${yearsOptions}
                        </select>
                    </div>
                    <div class="filter-group" style="display:flex; align-items:center; gap:0.35rem; margin:0;">
                        <label style="font-weight:700; font-size:0.76rem; color:#f1f5f9;">Ay:</label>
                        <select class="cms-input" id="stats-month-select" style="padding:3px 8px; font-size:0.76rem; border-radius:5px; min-width:100px; height:28px; background:#0f172a !important; color:#ffffff !important; border:1px solid rgba(255,255,255,0.15) !important;" onchange="changeStatsFilters(null, this.value, null)">
                            ${monthsOptions}
                        </select>
                    </div>
                    <div class="filter-group" style="display:flex; align-items:center; gap:0.35rem; margin:0;">
                        <label style="font-weight:700; font-size:0.76rem; color:#f1f5f9;">Hat:</label>
                        <select class="cms-input" id="stats-line-select" style="padding:3px 8px; font-size:0.76rem; border-radius:5px; min-width:120px; height:28px; background:#0f172a !important; color:#ffffff !important; border:1px solid rgba(255,255,255,0.15) !important;" onchange="changeStatsFilters(null, null, this.value)">
                            ${linesOptions}
                        </select>
                    </div>
                </div>
                <!-- Right: Excel Export Button -->
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn-outline" style="padding:3px 10px; font-size:0.76rem; border-radius:6px; font-weight:700; height:28px; display:inline-flex; align-items:center; gap:4px; background:transparent !important; color:#38bdf8 !important; border:1px solid #38bdf8 !important;" onclick="exportMatrixToExcel()"><i class="fas fa-file-excel"></i> Excel İndir</button>
                </div>
            </div>

            <!-- Legend Bar -->
            <div class="matrix-legend-bar" style="display:flex; justify-content:center; padding:0.4rem 1.25rem; background:transparent !important; border:none !important; overflow-x:auto;">
                <div class="matrix-legend" style="display:flex; justify-content:center; align-items:flex-start; gap:1.25rem; font-size:0.74rem; white-space:nowrap; width:100%;">
                    ${legendItemsHtml}
                </div>
            </div>

            <div class="matrix-scroll-wrapper">
                <table class="matrix-table" id="matrix-stats-table">
                     <thead>
                        <tr>
                            <th class="matrix-user-hdr">${selectedMonthName}</th>
                            ${dayHeaders}
                            <th class="matrix-total-hdr">Toplam</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.changeStatsFilters = function(year, month, line) {
    if (year) statsSelectedYear = parseInt(year);
    if (month) statsSelectedMonth = parseInt(month);
    if (line) statsSelectedLine = line;
    renderPersonalStats();
};

window.exportMatrixToExcel = async function() {
    try {
        const monthlyRosterMap = await loadMonthlyRoster(statsSelectedYear, statsSelectedMonth);
        const audits = appData.audits || [];
        const daysInMonth = new Date(statsSelectedYear, statsSelectedMonth, 0).getDate();
        
        const activeShifts = (shiftsList && shiftsList.length > 0) ? shiftsList : [
            { code: 'S', name: 'Sabah', type: 'work' },
            { code: 'A', name: 'Akşam', type: 'work' },
            { code: 'G', name: 'Gece', type: 'work' },
            { code: 'HT', name: 'Hafta Tatili', type: 'off' },
            { code: 'Yİ', name: 'Yıllık İzin', type: 'off' },
            { code: 'R', name: 'Raporlu', type: 'off' }
        ];

        // Filter activeUsers
        const activeUsers = appData.users.filter(u => {
            if (!u.username || u.isDeleted) return false;

            // Exclude hat vardiya amiri and istasyon sorumlusu using robust character normalized matching
            const titleClean = (u.title || u.roleName || u.jobTitle || u.role || '')
                .replace(/İ/g, 'i')
                .replace(/ı/g, 'i')
                .replace(/I/g, 'i')
                .toLowerCase()
                .replace(/ş/g, 's')
                .replace(/ö/g, 'o')
                .replace(/ü/g, 'u')
                .replace(/ç/g, 'c')
                .replace(/ğ/g, 'g');
                
            const isSupervisor = 
                titleClean.includes('istasyon sorumlusu') || 
                titleClean.includes('hat vardiya amiri');
                
            if (isSupervisor) {
                return false;
            }

            const inferredRole = inferRbacRoleId(u);
            const isAuditor = (inferredRole === 'Field_Auditor' || inferredRole === 'Field_Auditor_Action_Owner');
            if (!isAuditor) return false;

            if (statsSelectedLine !== 'Tümü') {
                const isGlobal = inferredRole === 'Super_Admin' || inferredRole === 'Executive_Viewer_Global' || u.isGlobalScope === true || u.scopeType === 'global';
                if (!isGlobal) {
                    const userLines = u.authorizedLines || [];
                    if (!userLines.includes(statsSelectedLine)) return false;
                }
            }

            // Filter by currentUser's authorized lines if currentUser is not global
            const currentIsGlobal = isSuperAdmin() || currentUser.roleId === 'Executive_Viewer_Global' || currentUser.isGlobalScope === true || currentUser.scopeType === 'global';
            if (!currentIsGlobal) {
                const currentLines = Array.isArray(currentUser.authorizedLines) ? currentUser.authorizedLines.filter(Boolean) : [];
                const userLines = Array.isArray(u.authorizedLines) ? u.authorizedLines.filter(Boolean) : [];
                const hasOverlap = userLines.some(l => currentLines.includes(l));
                if (!hasOverlap) return false;
            }

            return true;
        });

        // Sort activeUsers: Line first, then Name
        function getUserSortLine(user) {
            const inferredRole = inferRbacRoleId(user);
            const isGlobal = inferredRole === 'Super_Admin' || inferredRole === 'Executive_Viewer_Global' || user.isGlobalScope === true || user.scopeType === 'global';
            if (isGlobal) return '00_Global';
            const lines = Array.isArray(user.authorizedLines) ? user.authorizedLines.filter(Boolean) : [];
            if (lines.length === 0) return '99_None';
            const sorted = [...lines].sort();
            return sorted[0];
        }

        activeUsers.sort((a, b) => {
            const lineA = getUserSortLine(a);
            const lineB = getUserSortLine(b);
            const lineCompare = lineA.localeCompare(lineB, 'tr');
            if (lineCompare !== 0) return lineCompare;

            const nameA = (a.name || a.displayName || a.username || '').toLowerCase();
            const nameB = (b.name || b.displayName || b.username || '').toLowerCase();
            return nameA.localeCompare(nameB, 'tr');
        });

        const months = [
            'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
            'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
        ];
        const getTurkishDayName = (date) => {
            const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
            return days[date.getDay()];
        };

        const wsData = [];
        wsData.push(["KURUMSAL DENETİM SİSTEMİ - DETAYLI PUANTAJ VE DENETİM RAPORU"]);
        wsData.push([`Dönem: ${months[statsSelectedMonth - 1]} ${statsSelectedYear}`]);
        wsData.push([`Filtre: Hat - ${statsSelectedLine}`]);
        wsData.push([]); // blank row

        // Headers (9 Columns)
        const headers = [
            "Personel Adı", 
            "Hat", 
            "Ünvan", 
            "Tarih", 
            "Gün",
            "Denetim Sayısı", 
            "Denetim Detayları (Saat - İstasyon)",
            "Vardiya", 
            "Mazeret"
        ];
        wsData.push(headers);

        const endColIndex = 8;
        const merges = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: endColIndex } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: endColIndex } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: endColIndex } }
        ];

        // Data rows (Vertical format: User * Day)
        activeUsers.forEach(user => {
            const userRoster = monthlyRosterMap[user.id] || { days: {} };
            const userLines = Array.isArray(user.authorizedLines) ? user.authorizedLines.filter(Boolean).join(', ') : 'Global';
            const userName = user.name || user.displayName || user.username || '';
            const userTitle = user.title || user.jobTitle || 'Saha Denetçisi';

            for (let day = 1; day <= daysInMonth; day++) {
                const dayKey = day.toString();
                const rosterDay = userRoster.days?.[dayKey] || { shift: '-', excuse: '' };
                const shift = rosterDay.shift || '-';
                const excuse = rosterDay.excuse || '';

                // Count audits
                const dailyAudits = audits.filter(audit => {
                    const auditDate = new Date(audit.date);
                    return audit.auditorId === user.id &&
                           auditDate.getFullYear() === statsSelectedYear &&
                           (auditDate.getMonth() + 1) === statsSelectedMonth &&
                           auditDate.getDate() === day;
                });
                const auditCount = dailyAudits.length;

                if (auditCount > 0) {
                    // Sort audits chronologically
                    dailyAudits.sort((a, b) => new Date(a.date) - new Date(b.date));
                    const pad = (num) => String(num).padStart(2, '0');
                    const auditDetails = dailyAudits.map(a => {
                        const d = new Date(a.date);
                        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                        return `${time} (${a.station || 'Belirtilmedi'})`;
                    }).join(', ');

                    const matchedShift = activeShifts.find(s => s.code === shift);
                    const isWorking = matchedShift ? matchedShift.type === 'work' : ['S', 'A', 'G', 'N', 'S8', 'S10'].includes(shift);

                    // Date string
                    const dateObj = new Date(statsSelectedYear, statsSelectedMonth - 1, day);
                    const dateOnlyStr = `${pad(day)}.${pad(statsSelectedMonth)}.${statsSelectedYear}`;
                    const dayNameStr = getTurkishDayName(dateObj);

                    // Vardiya label
                    let vardiyaLabel = shift;
                    if (matchedShift) {
                        vardiyaLabel = `${shift} - ${matchedShift.name}`;
                    } else if (shift === '-') {
                        vardiyaLabel = 'Atanmamış';
                    }

                    // Mazeret label
                    const mazeretLabel = excuse || (isWorking && auditCount === 0 ? 'Mazeret Belirtilmemiş (Eksik)' : '-');

                    // Audit details string
                    const detailsLabel = auditDetails;

                    wsData.push([
                        userName,
                        userLines,
                        userTitle,
                        dateOnlyStr,
                        dayNameStr,
                        auditCount,
                        detailsLabel,
                        vardiyaLabel,
                        mazeretLabel
                    ]);
                }
            }
        });

        // Create sheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Styling definitions
        const styleHeader = {
            fill: { fgColor: { rgb: "071A33" } },
            font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10, name: "Segoe UI" },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            border: {
                top: { style: "thin", color: { rgb: "CBD5E1" } },
                bottom: { style: "thin", color: { rgb: "CBD5E1" } },
                left: { style: "thin", color: { rgb: "CBD5E1" } },
                right: { style: "thin", color: { rgb: "CBD5E1" } }
            }
        };

        const styleRegular = (isLeft) => ({
            font: { sz: 10, name: "Segoe UI" },
            alignment: { horizontal: isLeft ? "left" : "center", vertical: "center", wrapText: isLeft },
            border: {
                top: { style: "thin", color: { rgb: "CBD5E1" } },
                bottom: { style: "thin", color: { rgb: "CBD5E1" } },
                left: { style: "thin", color: { rgb: "CBD5E1" } },
                right: { style: "thin", color: { rgb: "CBD5E1" } }
            }
        });

        const styleTitle = {
            font: { bold: true, color: { rgb: "071A33" }, sz: 12, name: "Segoe UI" },
            alignment: { horizontal: "left", vertical: "center" }
        };

        // Apply styles to all cells in ws
        for (let cellRef in ws) {
            if (cellRef[0] === '!') continue; // Skip metadata like !merges, !ref

            // Parse cell reference
            const col = cellRef.replace(/[0-9]/g, '');
            const rowIdx = parseInt(cellRef.replace(/[^0-9]/g, '')) - 1; // 0-indexed row
            
            // Get original cell
            const cell = ws[cellRef];
            if (!cell) continue;

            const rowData = wsData[rowIdx];
            if (!rowData) continue;

            const isTitleRow = rowIdx < 3;
            const isHeaderRow = rowIdx === 4;

            if (isTitleRow) {
                cell.s = styleTitle;
            } else if (isHeaderRow) {
                cell.s = styleHeader;
            } else {
                const isLeftAligned = col === 'G'; // Col G is index 6 (Denetim Detayları)
                cell.s = styleRegular(isLeftAligned);
            }
        }

        ws['!merges'] = merges;

        // Column widths - ignore title rows (0-3) for sizing
        const colWidths = [];
        for (let r = 4; r < wsData.length; r++) {
            const row = wsData[r];
            row.forEach((cell, i) => {
                const value = cell ? cell.toString() : "";
                const len = value.length;
                if (!colWidths[i] || len > colWidths[i]) {
                    colWidths[i] = len;
                }
            });
        }
        ws['!cols'] = colWidths.map((w, i) => {
            if (i === 0) return { wch: Math.max(w + 2, 16) }; // Personel Adı
            if (i === 1) return { wch: Math.max(w + 2, 6) };  // Hat
            if (i === 2) return { wch: Math.max(w + 2, 12) }; // Ünvan
            if (i === 3) return { wch: Math.max(w + 2, 11) }; // Tarih
            if (i === 4) return { wch: Math.max(w + 2, 10) }; // Gün
            if (i === 5) return { wch: Math.max(w + 2, 14) }; // Denetim Sayısı
            if (i === 6) return { wch: Math.max(w + 2, 25) }; // Denetim Detayları
            if (i === 7) return { wch: Math.max(w + 2, 12) }; // Vardiya
            return { wch: Math.max(w + 2, 12) };             // Mazeret
        });

        XLSX.utils.book_append_sheet(wb, ws, "Detaylı Rapor");
        XLSX.writeFile(wb, `Kisisel_Denetim_Puantaj_Detayli_Raporu_${statsSelectedYear}_${statsSelectedMonth}.xlsx`);
    } catch (e) {
        console.error("Excel export error: ", e);
        alert("Excel dışa aktarılırken bir hata oluştu: " + e.message);
    }
};

window.showAuditTimesDetail = function(userName, dateText, infosStr) {
    const existing = document.getElementById('dynamic-audit-times-modal');
    if (existing) existing.remove();

    const infosArray = infosStr.split('~').filter(Boolean);
    let timesListHtml = '';
    if (infosArray.length === 0) {
        timesListHtml = '<p style="color:var(--text-dim); text-align:center; font-style:italic; margin: 15px 0;">Bu güne ait denetim kaydı bulunamadı.</p>';
    } else {
        timesListHtml = infosArray.map((item, idx) => {
            const parts = item.split('|');
            const time = parts[0];
            const station = parts[1] || 'Belirtilmedi';
            const lineName = parts[2] || '';
            const idxNum = idx + 1;
            
            // Check if coordinates exist for indicator badge
            const locKey = `${lineName}_${station}`;
            const hasCoords = appData.stationLocations?.[locKey]?.latitude !== undefined;

            return `
                <div class="modal-audit-item" style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); padding:10px 14px; border-radius:8px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.05); gap: 12px; cursor:${hasCoords ? 'pointer' : 'default'}; transition:all 0.2s;" 
                     ${hasCoords ? `onclick="panToModalMarker(${idxNum})"` : ''}
                     onmouseover="this.style.background='rgba(255,255,255,0.08)'" 
                     onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                    <div style="display:flex; flex-direction:column; gap:2px; min-width: 0; flex: 1; text-align: left;">
                        <span style="font-size:0.7rem; color:var(--text-secondary); font-weight:600; display:flex; align-items:center; gap:4px;">
                            ${idxNum}. Denetim 
                            ${hasCoords ? '<i class="fas fa-map-marker-alt" style="color:#22c55e;"></i>' : '<i class="fas fa-map-marker-alt" style="color:var(--text-dim); opacity:0.4;"></i>'}
                        </span>
                        <span style="font-size:0.85rem; color:#fff; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeAttr(station)}">${station}</span>
                    </div>
                    <span style="font-size:0.85rem; color:#007AFF; font-weight:800; font-family:monospace; background:rgba(0,122,255,0.12); padding:3px 8px; border-radius:4px; display:inline-flex; align-items:center; gap:4px; flex-shrink:0;">
                        <i class="far fa-clock"></i> ${time}
                    </span>
                </div>
            `;
        }).join('');
    }

    const modalHtml = `
        <style>
            .map-audit-label {
                background: #ea580c !important;
                border: 1px solid #ff7a45 !important;
                color: #fff !important;
                font-weight: 800 !important;
                font-size: 0.72rem !important;
                padding: 2px 6px !important;
                border-radius: 4px !important;
                box-shadow: 0 2px 6px rgba(0,0,0,0.4) !important;
                font-family: inherit !important;
            }
            .map-audit-label::before {
                border-top-color: #ea580c !important;
            }
            .map-station-label {
                background: rgba(15, 23, 42, 0.85) !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important;
                color: #cbd5e1 !important;
                font-weight: 600 !important;
                font-size: 0.62rem !important;
                padding: 1px 5px !important;
                border-radius: 3px !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
                font-family: inherit !important;
            }
            .map-station-label::before {
                border-right-color: rgba(15, 23, 42, 0.85) !important;
            }
        </style>
        <div id="dynamic-audit-times-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.7); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:99999; opacity:0; transition:opacity 0.2s ease;">
            <div style="background:#0b1e36; border:1px solid rgba(255,255,255,0.1); border-radius:14px; width:820px; max-width:90%; box-shadow:0 12px 30px rgba(0,0,0,0.5); transform:scale(0.9); transition:transform 0.2s ease; overflow:hidden; font-family:inherit; display:flex; flex-direction:column;">
                <div style="background:rgba(255,255,255,0.02); padding:18px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
                    <div style="text-align: left;">
                        <h4 style="margin:0; font-size:0.95rem; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.5px;">Denetim Detayları ve Lokasyonları</h4>
                        <p style="margin:4px 0 0 0; font-size:0.75rem; color:var(--text-secondary); opacity:0.8;">${userName} - ${dateText}</p>
                    </div>
                    <i class="fas fa-times" style="font-size:1.1rem; color:var(--text-dim); cursor:pointer; padding:6px; transition:color 0.2s;" onclick="document.getElementById('dynamic-audit-times-modal').closeModal()" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-dim)'"></i>
                </div>
                
                <div style="display:flex; flex-wrap:wrap; height:420px; overflow:hidden;">
                    <!-- Left List -->
                    <div style="width:320px; border-right:1px solid rgba(255,255,255,0.05); padding:18px; overflow-y:auto; height:100%; box-sizing:border-box;">
                        ${timesListHtml}
                    </div>
                    
                    <!-- Right Map -->
                    <div style="flex:1; min-width:300px; height:100%; background:#071426; position:relative;">
                        <div id="modal-audit-map" style="width:100%; height:100%;"></div>
                    </div>
                </div>
                
                <div style="padding:14px 18px; background:rgba(0,0,0,0.2); display:flex; justify-content:flex-end; border-top:1px solid rgba(255,255,255,0.05); flex-shrink:0;">
                    <button style="background:#007AFF; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-size:0.8rem; font-weight:700; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='#0062cc'" onmouseout="this.style.background='#007AFF'" onclick="document.getElementById('dynamic-audit-times-modal').closeModal()">Kapat</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('dynamic-audit-times-modal');
    const content = modal.querySelector('div');

    modal.closeModal = function() {
        modal.style.opacity = '0';
        content.style.transform = 'scale(0.9)';
        setTimeout(() => modal.remove(), 200);
    };

    // Close on overlay click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.closeModal();
    });

    // Trigger animations
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        content.style.transform = 'scale(1)';
    });

    // Initialize Leaflet Map
    setTimeout(() => {
        let mapCenter = [41.0082, 28.9784]; // Default Istanbul center
        let zoomLevel = 11;
        const points = [];
        const markers = [];

        infosArray.forEach((item, idx) => {
            const parts = item.split('|');
            const time = parts[0];
            const station = parts[1];
            const line = parts[2] || '';
            
            const locKey = `${line}_${station}`;
            const locData = appData.stationLocations?.[locKey];
            if (locData && locData.latitude && locData.longitude) {
                points.push({
                    lat: locData.latitude,
                    lng: locData.longitude,
                    station: station,
                    line: line,
                    time: time,
                    index: idx + 1
                });
            }
        });

        if (points.length > 0) {
            mapCenter = [points[0].lat, points[0].lng];
            zoomLevel = 13;
        }

        const map = L.map('modal-audit-map').setView(mapCenter, zoomLevel);
        
        // Add OpenStreetMap tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Draw transit lines and small station markers for all lines involved in the audits
        const uniqueLines = [...new Set(points.map(p => p.line))];
        uniqueLines.forEach(lineName => {
            if (!lineName) return;
            const stationList = [...(appData.stations?.[lineName] || [])];
            const stationNums = appData.stationNumbers?.[lineName] || {};
            stationList.sort((a, b) => (stationNums[a] !== undefined ? stationNums[a] : 99) - (stationNums[b] !== undefined ? stationNums[b] : 99));

            const lineLatLngs = [];
            stationList.forEach(st => {
                const locKey = `${lineName}_${st}`;
                const loc = appData.stationLocations?.[locKey];
                if (loc && loc.latitude && loc.longitude) {
                    const latlng = [loc.latitude, loc.longitude];
                    lineLatLngs.push(latlng);
                    
                    // Draw small indicator and label only if the station is NOT audited today
                    const isAudited = points.some(p => p.station === st && p.line === lineName);
                    if (!isAudited) {
                        L.circleMarker(latlng, {
                            radius: 4,
                            color: appData.lineColors?.[lineName] || '#64748b',
                            fillColor: '#0b1e36',
                            fillOpacity: 1,
                            weight: 2
                        }).addTo(map)
                          .bindPopup(`<b>İstasyon:</b> ${st}<br><b>Hat:</b> ${lineName}`)
                          .bindTooltip(st, {
                              permanent: false, // Visible on hover/click to keep map clean and prevent overlaps
                              direction: 'right',
                              offset: [6, 0],
                              className: 'map-station-label'
                          });
                    }
                }
            });

            // Draw line route polyline
            if (lineLatLngs.length > 1) {
                const lineColor = appData.lineColors?.[lineName] || '#007AFF';
                L.polyline(lineLatLngs, {
                    color: lineColor,
                    weight: 5,
                    opacity: 0.8,
                    lineJoin: 'round'
                }).addTo(map);
            }
        });

        // Custom orange marker icon for actual completed audits
        const orangeIcon = L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        points.forEach(pt => {
            const marker = L.marker([pt.lat, pt.lng], { icon: orangeIcon })
                .addTo(map)
                .bindPopup(`<b>${pt.index}. Denetim</b><br><b>İstasyon:</b> ${pt.station}<br><b>Hat:</b> ${pt.line}<br><b>Saat:</b> ${pt.time}`);
            
            // Add permanent label for audited stations
            marker.bindTooltip(`${pt.index}. ${pt.station}`, {
                permanent: true,
                direction: 'top',
                offset: [0, -35],
                className: 'map-audit-label'
            });

            markers[pt.index - 1] = marker;
        });

        // Store map reference to pan
        window.panToModalMarker = function(idx) {
            const pt = points.find(p => p.index === idx);
            if (pt) {
                map.setView([pt.lat, pt.lng], 15);
                const marker = markers[idx - 1];
                if (marker) marker.openPopup();
            }
        };

        // If there are multiple points, fit map bounds
        if (points.length > 1) {
            const group = new L.featureGroup(points.map(p => L.marker([p.lat, p.lng])));
            map.fitBounds(group.getBounds().pad(0.15));
        }
    }, 200);
};

// ----------------------------------------------------
// VIEW 3: Mazeret Yönetimi (excuse-management-view)
// ----------------------------------------------------

let excuseMgmtSearch = '';
let excuseMgmtSelectedYear = new Date().getFullYear();
let excuseMgmtSelectedMonth = new Date().getMonth() + 1; // 1-12

async function fetchAllRostersWithExcuses() {
    let query = db.collection('user_rosters').where('year', '==', excuseMgmtSelectedYear);
    if (excuseMgmtSelectedMonth !== 0) {
        query = query.where('month', '==', excuseMgmtSelectedMonth);
    }
    const querySnapshot = await query.get();
    const excusesList = [];
    const audits = appData.audits || [];
    
    querySnapshot.forEach(doc => {
        const data = doc.data();
        if (!data || !data.days) return;
        
        const userId = data.userId;
        const userName = data.userName || '';
        const year = data.year;
        const month = data.month;
        
        Object.entries(data.days).forEach(([dayStr, dayData]) => {
            if (dayData && dayData.excuse && dayData.excuse.trim().length > 0) {
                const day = parseInt(dayStr, 10);
                const excuseText = dayData.excuse;
                const shiftCode = dayData.shift || '';
                
                // Calculate audits completed by user on this day
                const completedCount = audits.filter(audit => {
                    const auditDate = new Date(audit.date);
                    return audit.auditorId === userId &&
                           auditDate.getFullYear() === year &&
                           (auditDate.getMonth() + 1) === month &&
                           auditDate.getDate() === day;
                }).length;
                
                excusesList.push({
                    docId: doc.id,
                    userId: userId,
                    userName: userName,
                    year: year,
                    month: month,
                    day: day,
                    dateStr: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
                    shiftCode: shiftCode,
                    completedCount: completedCount,
                    excuse: excuseText,
                    rawDayData: dayData
                });
            }
        });
    });
    
    // Sort chronologically descending (newest first)
    excusesList.sort((a, b) => {
        const dateA = new Date(a.year, a.month - 1, a.day);
        const dateB = new Date(b.year, b.month - 1, b.day);
        return dateB - dateA;
    });
    
    return excusesList;
}

window.renderExcuseManagement = async function() {
    const container = document.getElementById('excuse-management-view');
    if (!container) return;

    if (typeof showSpinner === 'function') showSpinner();
    try {
        const excuses = await fetchAllRostersWithExcuses();
        
        // Populate years and months options
        const yearsOptions = [2025, 2026, 2027].map(y => 
            `<option value="${y}" ${y === excuseMgmtSelectedYear ? 'selected' : ''}>${y}</option>`
        ).join('');
        
        const months = ['Tüm Aylar', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        const monthsOptions = months.map((m, idx) => 
            `<option value="${idx}" ${idx === excuseMgmtSelectedMonth ? 'selected' : ''}>${m}</option>`
        ).join('');

        // Apply filters
        const filteredExcuses = excuses.filter(item => {
            if (item.year !== excuseMgmtSelectedYear) return false;
            if (excuseMgmtSelectedMonth !== 0 && item.month !== excuseMgmtSelectedMonth) return false;
            if (excuseMgmtSearch.trim().length > 0) {
                const searchLower = excuseMgmtSearch.toLowerCase();
                const userNameLower = (item.userName || '').toLowerCase();
                const excuseLower = (item.excuse || '').toLowerCase();
                if (!userNameLower.includes(searchLower) && !excuseLower.includes(searchLower)) return false;
            }
            return true;
        });

        // Generate Table Rows
        let rowsHtml = '';
        if (filteredExcuses.length === 0) {
            rowsHtml = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 30px; color: var(--text-dim);">
                        <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>
                        Filtrelere uygun mazeret kaydı bulunamadı.
                    </td>
                </tr>
            `;
        } else {
            filteredExcuses.forEach((item, index) => {
                // Get target audit count for this shift
                const shift = (shiftsList || []).find(s => s.code === item.shiftCode);
                const target = (shift && shift.type === 'work') ? (shift.requiredAuditCount || 0) : 0;
                
                rowsHtml += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="text-align: center; font-weight: 700; color: var(--text-dim);">${index + 1}</td>
                        <td style="font-weight: 700; color: #fff;">${item.userName}</td>
                        <td>${item.dateStr}</td>
                        <td><span class="legend-shift-text legend-shift-text-s" style="margin: 0; font-size: 0.72rem; min-width: 28px;">${item.shiftCode}</span></td>
                        <td style="text-align: center; font-weight: 700; color: #fb923c;">${target}</td>
                        <td style="text-align: center; font-weight: 700; color: #4ade80;">${item.completedCount}</td>
                        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeAttr(item.excuse)}">${item.excuse}</td>
                        <td style="text-align: center;">
                            <div style="display: flex; gap: 8px; justify-content: center;">
                                <button class="btn-primary" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 6px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="openEditExcuseModal('${item.docId}', ${item.day}, '${escapeJsString(item.excuse)}')">
                                    <i class="fas fa-edit"></i> Düzenle
                                </button>
                                <button class="btn-danger" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 6px; height: 26px; display: inline-flex; align-items: center; gap: 4px;" onclick="deleteExcuseConfirm('${item.docId}', ${item.day})">
                                    <i class="fas fa-trash-alt"></i> Sil
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });
        }

        container.innerHTML = `
            <div class="roster-card">
                <div class="roster-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; padding:0.4rem 1.25rem; min-height:36px; background:transparent !important; border-bottom:1px solid rgba(255,255,255,0.08);">
                    <!-- Filter Left -->
                    <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap; flex-grow: 1;">
                        <div class="filter-group" style="display:flex; align-items:center; gap:0.35rem; margin:0;">
                            <label style="font-weight:700; font-size:0.76rem; color:#f1f5f9;">Yıl:</label>
                            <select class="cms-input" id="excuse-year-select" style="padding:3px 8px; font-size:0.76rem; border-radius:5px; min-width:80px; height:28px; background:#0f172a !important; color:#ffffff !important; border:1px solid rgba(255,255,255,0.15) !important;" onchange="changeExcuseFilters(this.value, null, null)">
                                ${yearsOptions}
                            </select>
                        </div>
                        <div class="filter-group" style="display:flex; align-items:center; gap:0.35rem; margin:0;">
                            <label style="font-weight:700; font-size:0.76rem; color:#f1f5f9;">Ay:</label>
                            <select class="cms-input" id="excuse-month-select" style="padding:3px 8px; font-size:0.76rem; border-radius:5px; min-width:105px; height:28px; background:#0f172a !important; color:#ffffff !important; border:1px solid rgba(255,255,255,0.15) !important;" onchange="changeExcuseFilters(null, this.value, null)">
                                ${monthsOptions}
                            </select>
                        </div>
                        <div class="filter-group" style="display:flex; align-items:center; gap:0.35rem; margin:0; flex-grow: 1; max-width: 320px;">
                            <input type="text" class="cms-input" id="excuse-search-input" placeholder="Personel veya mazeret ara..." value="${escapeAttr(excuseMgmtSearch)}" style="padding:3px 10px; font-size:0.76rem; border-radius:5px; width: 100%; height:28px; background:#0f172a !important; color:#ffffff !important; border:1px solid rgba(255,255,255,0.15) !important;" oninput="changeExcuseFilters(null, null, this.value)">
                        </div>
                    </div>
                    <!-- Export Button Right -->
                    <div style="display:flex; justify-content:flex-end;">
                        <button class="btn-success" style="padding:4px 12px; font-size:0.76rem; border-radius:6px; height:28px; display:inline-flex; align-items:center; gap:6px; font-weight:700; background:#22c55e !important; color:#fff !important; border:none; cursor:pointer;" onclick="exportExcusesToExcel()">
                            <i class="fas fa-file-excel"></i> Excel'e Aktar
                        </button>
                    </div>
                </div>
                
                <div class="roster-body" style="padding:0; overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem; min-width: 800px;">
                        <thead>
                            <tr style="background:rgba(255,255,255,0.02); border-bottom:1px solid rgba(255,255,255,0.08); text-align: left;">
                                <th style="padding:10px 12px; width:50px; text-align:center; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px;">SIRA</th>
                                <th style="padding:10px 12px; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px;">PERSONEL</th>
                                <th style="padding:10px 12px; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px; width: 100px;">TARİH</th>
                                <th style="padding:10px 12px; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px; width: 80px;">V.KODU</th>
                                <th style="padding:10px 12px; text-align:center; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px; width: 80px;">HEDEF</th>
                                <th style="padding:10px 12px; text-align:center; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px; width: 100px;">TAMAMLANAN</th>
                                <th style="padding:10px 12px; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px;">MAZERET NEDENİ</th>
                                <th style="padding:10px 12px; text-align:center; color: var(--text-dim); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.5px; width: 180px;">İŞLEMLER</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (e) {
        if (typeof showToast === 'function') showToast('Mazeretler yüklenirken hata oluştu: ' + e.message);
        console.error(e);
    } finally {
        if (typeof hideSpinner === 'function') hideSpinner();
    }
};

window.changeExcuseFilters = function(year, month, search) {
    if (year !== null) excuseMgmtSelectedYear = parseInt(year, 10);
    if (month !== null) excuseMgmtSelectedMonth = parseInt(month, 10);
    if (search !== null) excuseMgmtSearch = search;
    renderExcuseManagement();
};

window.openEditExcuseModal = function(docId, day, currentExcuse) {
    // Remove existing modal if any
    const old = document.getElementById('edit-excuse-modal');
    if (old) old.remove();

    const modalHtml = `
        <div id="edit-excuse-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.7); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:99999; opacity:0; transition:opacity 0.2s ease;">
            <div style="background:#0b1e36; border:1px solid rgba(255,255,255,0.1); border-radius:14px; width:420px; box-shadow:0 12px 30px rgba(0,0,0,0.5); transform:scale(0.9); transition:transform 0.2s ease; overflow:hidden; font-family:inherit;">
                <div style="background:rgba(255,255,255,0.02); padding:18px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:space-between;">
                    <h4 style="margin:0; font-size:0.95rem; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.5px;">Mazereti Düzenle</h4>
                    <i class="fas fa-times" style="font-size:1.1rem; color:var(--text-dim); cursor:pointer; padding:6px; transition:color 0.2s;" onclick="closeEditExcuseModal()" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-dim)'"></i>
                </div>
                <div style="padding:18px;">
                    <div class="input-group" style="margin-bottom:0; display:flex; flex-direction:column; gap:0.4rem;">
                        <label style="display:block; font-size:0.75rem; font-weight:700; color:var(--text-secondary); margin-bottom:6px;">Mazeret Metni</label>
                        <textarea id="edit-excuse-textarea" style="width:100%; min-height:100px; padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:#071426; color:#fff; font-family:inherit; font-size:0.85rem; resize:vertical;">${escapeAttr(currentExcuse)}</textarea>
                    </div>
                </div>
                <div style="padding:14px 18px; background:rgba(0,0,0,0.2); display:flex; justify-content:flex-end; gap:10px; border-top:1px solid rgba(255,255,255,0.05);">
                    <button class="btn-outline" style="padding:8px 16px; border-radius:8px; font-size:0.8rem; font-weight:700;" onclick="closeEditExcuseModal()">İptal</button>
                    <button class="btn-primary" style="padding:8px 16px; border-radius:8px; font-size:0.8rem; font-weight:700;" onclick="saveEditedExcuse('${docId}', ${day})">Kaydet</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('edit-excuse-modal');
    const content = modal.querySelector('div');

    modal.closeModal = function() {
        modal.style.opacity = '0';
        content.style.transform = 'scale(0.9)';
        setTimeout(() => modal.remove(), 200);
    };

    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        content.style.transform = 'scale(1)';
    });
};

window.closeEditExcuseModal = function() {
    const modal = document.getElementById('edit-excuse-modal');
    if (modal && modal.closeModal) {
        modal.closeModal();
    }
};

window.saveEditedExcuse = async function(docId, day) {
    const textarea = document.getElementById('edit-excuse-textarea');
    if (!textarea) return;
    const newExcuse = textarea.value.trim();
    if (newExcuse.length === 0) {
        if (typeof showToast === 'function') showToast('Mazeret metni boş olamaz. Silmek için Sil butonunu kullanın.');
        return;
    }

    if (typeof showSpinner === 'function') showSpinner();
    try {
        const docRef = db.collection('user_rosters').doc(docId);
        await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(docRef);
            if (!snapshot.exists) {
                throw new Error('Vardiya kaydı bulunamadı.');
            }
            const data = snapshot.data();
            const daysData = data.days ? {...data.days} : {};
            const key = day.toString();
            if (daysData[key]) {
                daysData[key] = {
                    ...daysData[key],
                    excuse: newExcuse
                };
            }
            transaction.update(docRef, { days: daysData, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        if (typeof showToast === 'function') showToast('Mazeret başarıyla güncellendi.');
        closeEditExcuseModal();
        renderExcuseManagement();
    } catch (e) {
        if (typeof showToast === 'function') showToast('Mazeret güncellenirken hata oluştu: ' + e.message);
        console.error(e);
    } finally {
        if (typeof hideSpinner === 'function') hideSpinner();
    }
};

window.deleteExcuseConfirm = async function(docId, day) {
    const confirmed = confirm('Bu mazeret kaydını silmek istediğinize emin misiniz?\nPersonel mobil uygulamasında eksik hedefler için tekrar mazeret girmek zorunda kalacaktır.');
    if (!confirmed) return;

    if (typeof showSpinner === 'function') showSpinner();
    try {
        const docRef = db.collection('user_rosters').doc(docId);
        await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(docRef);
            if (!snapshot.exists) {
                throw new Error('Vardiya kaydı bulunamadı.');
            }
            const data = snapshot.data();
            const daysData = data.days ? {...data.days} : {};
            const key = day.toString();
            if (daysData[key]) {
                daysData[key] = {
                    ...daysData[key],
                    excuse: "" // Clear the excuse
                };
            }
            transaction.update(docRef, { days: daysData, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        if (typeof showToast === 'function') showToast('Mazeret başarıyla silindi.');
        renderExcuseManagement();
    } catch (e) {
        if (typeof showToast === 'function') showToast('Hata: ' + e.message);
        console.error(e);
    } finally {
        if (typeof hideSpinner === 'function') hideSpinner();
    }
};

function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

window.exportExcusesToExcel = async function() {
    if (typeof showSpinner === 'function') showSpinner();
    try {
        const excuses = await fetchAllRostersWithExcuses();
        
        // Apply filters
        const filteredExcuses = excuses.filter(item => {
            if (item.year !== excuseMgmtSelectedYear) return false;
            if (excuseMgmtSelectedMonth !== 0 && item.month !== excuseMgmtSelectedMonth) return false;
            if (excuseMgmtSearch.trim().length > 0) {
                const searchLower = excuseMgmtSearch.toLowerCase();
                const userNameLower = (item.userName || '').toLowerCase();
                const excuseLower = (item.excuse || '').toLowerCase();
                if (!userNameLower.includes(searchLower) && !excuseLower.includes(searchLower)) return false;
            }
            return true;
        });

        if (filteredExcuses.length === 0) {
            if (typeof showToast === 'function') showToast('Dışa aktarılacak mazeret kaydı bulunmamaktadır.');
            return;
        }

        const months = ['Tüm Aylar', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        const periodText = excuseMgmtSelectedMonth === 0 ? `${excuseMgmtSelectedYear}` : `${months[excuseMgmtSelectedMonth]} ${excuseMgmtSelectedYear}`;

        const wsData = [];
        wsData.push(["METRO İSTANBUL - PERSONEL MAZERET RAPORU"]);
        wsData.push([`Dönem: ${periodText}`]);
        if (excuseMgmtSearch.trim().length > 0) {
            wsData.push([`Arama Filtresi: ${excuseMgmtSearch}`]);
        } else {
            wsData.push([`Arama Filtresi: Yok`]);
        }
        wsData.push([]); // blank row

        // Headers
        const headers = [
            "Sıra",
            "Personel Adı",
            "Tarih",
            "Vardiya Kodu",
            "Vardiya Hedefi",
            "Tamamlanan Denetim",
            "Mazeret Nedeni"
        ];
        wsData.push(headers);

        filteredExcuses.forEach((item, index) => {
            const shift = (shiftsList || []).find(s => s.code === item.shiftCode);
            const target = (shift && shift.type === 'work') ? (shift.requiredAuditCount || 0) : 0;
            
            wsData.push([
                index + 1,
                item.userName,
                item.dateStr,
                item.shiftCode,
                target,
                item.completedCount,
                item.excuse
            ]);
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Styling definitions
        const styleHeader = {
            fill: { fgColor: { rgb: "071A33" } },
            font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10, name: "Segoe UI" },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            border: {
                top: { style: "thin", color: { rgb: "CBD5E1" } },
                bottom: { style: "thin", color: { rgb: "CBD5E1" } },
                left: { style: "thin", color: { rgb: "CBD5E1" } },
                right: { style: "thin", color: { rgb: "CBD5E1" } }
            }
        };

        const styleRegular = (isLeft) => ({
            font: { sz: 10, name: "Segoe UI" },
            alignment: { horizontal: isLeft ? "left" : "center", vertical: "center", wrapText: isLeft },
            border: {
                top: { style: "thin", color: { rgb: "CBD5E1" } },
                bottom: { style: "thin", color: { rgb: "CBD5E1" } },
                left: { style: "thin", color: { rgb: "CBD5E1" } },
                right: { style: "thin", color: { rgb: "CBD5E1" } }
            }
        });

        const styleTitle = {
            font: { bold: true, color: { rgb: "071A33" }, sz: 12, name: "Segoe UI" },
            alignment: { horizontal: "left", vertical: "center" }
        };

        // Apply styles
        const rowOffset = 4;
        for (let r = 0; r < wsData.length; r++) {
            for (let c = 0; c < wsData[r].length; c++) {
                const cellAddr = XLSX.utils.encode_cell({ r, c });
                if (!ws[cellAddr]) continue;
                
                if (r < rowOffset - 1) {
                    ws[cellAddr].s = styleTitle;
                } else if (r === rowOffset) {
                    ws[cellAddr].s = styleHeader;
                } else {
                    const isLeft = (c === 1 || c === 6); // Personel veya Mazeret sol hizalama
                    ws[cellAddr].s = styleRegular(isLeft);
                }
            }
        }

        // Auto widths
        const colWidths = [];
        for (let r = rowOffset; r < wsData.length; r++) {
            const row = wsData[r];
            row.forEach((cell, i) => {
                const value = cell ? cell.toString() : "";
                const len = value.length;
                if (!colWidths[i] || len > colWidths[i]) {
                    colWidths[i] = len;
                }
            });
        }
        ws['!cols'] = colWidths.map((w, i) => {
            if (i === 0) return { wch: Math.max(w + 2, 6) };   // Sıra
            if (i === 1) return { wch: Math.max(w + 2, 20) };  // Personel
            if (i === 2) return { wch: Math.max(w + 2, 12) };  // Tarih
            if (i === 3) return { wch: Math.max(w + 2, 12) };  // Vardiya
            if (i === 4) return { wch: Math.max(w + 2, 14) };  // Hedef
            if (i === 5) return { wch: Math.max(w + 2, 14) };  // Tamamlanan
            return { wch: Math.max(w + 2, 35) };             // Mazeret
        });

        // Merge title rows
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Mazeret Raporu");
        XLSX.writeFile(wb, `Personel_Mazeret_Raporu_${excuseMgmtSelectedYear}_${excuseMgmtSelectedMonth}.xlsx`);
        if (typeof showToast === 'function') showToast('Excel raporu başarıyla indirildi.');
    } catch (e) {
        console.error("Excel export error: ", e);
        if (typeof showToast === 'function') showToast('Excel dışa aktarılırken bir hata oluştu: ' + e.message);
    } finally {
        if (typeof hideSpinner === 'function') hideSpinner();
    }
};
