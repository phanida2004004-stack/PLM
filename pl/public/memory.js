document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('memoryTableBody');
    const searchInput = document.getElementById('memorySearch');
    const sourceFilter = document.getElementById('memorySourceFilter');
    const statusBox = document.getElementById('memoryStatus');
    const detailModal = document.getElementById('memoryDetailModal');
    const detailContent = document.getElementById('memoryDetailContent');
    const detailSubtitle = document.getElementById('memoryDetailSubtitle');
    let memories = [];
let relatedBomIds = new Map();

function getBomIds(record) {
    const saved = [
        ...(Array.isArray(record.bomIds) ? record.bomIds : []),
        record.bomId
    ];

    const storedIds = [
        ...new Set(
            saved.map(id => String(id || '').trim()).filter(Boolean)
        )
    ];

    if (storedIds.length) return storedIds;

    return relatedBomIds.get(String(record.sapNo || '').trim()) || [];
}

function bomIdsText(record) {
    const ids = getBomIds(record);
    return ids.length ? ids.join(', ') : '-';
}

async function loadRelatedBomIds(records) {
    relatedBomIds = new Map();

    const missing = records.filter(record =>
        !getBomIds(record).length &&
        String(record.sapNo || '').trim()
    );

    for (let offset = 0; offset < missing.length; offset += 8) {
        await Promise.all(
            missing.slice(offset, offset + 8).map(async record => {
                const sapNo = String(record.sapNo).trim();

                try {
                    const response = await fetch(
                        `/api/bom-lookup/${encodeURIComponent(sapNo)}`
                    );

                    if (!response.ok) return;

                    const result = await response.json();

                    if (!result.success || !Array.isArray(result.matches)) {
                        return;
                    }

                    const brand = String(record.brand || '')
                        .trim()
                        .toLocaleLowerCase();

                    const matches = result.matches.filter(match =>
                        !brand ||
                        String(match.brandCandidate || '')
                            .trim()
                            .toLocaleLowerCase() === brand
                    );

                    const ids = [
                        ...new Set(
                            matches
                                .map(match => String(match.bomId || '').trim())
                                .filter(Boolean)
                        )
                    ];

                    relatedBomIds.set(sapNo, ids);
                } catch (error) {
                    console.warn('BOM display lookup failed:', sapNo, error);
                }
            })
        );
    }
}
    const displayValue = value => {
        if (value === null || value === undefined || String(value).trim() === '') return '-';
        return String(value);
    };
    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function applyTheme() {
        const isDark = localStorage.getItem('pl-theme') === 'dark';
        document.body.classList.toggle('dark-theme', isDark);
        document.documentElement.classList.toggle('dark', isDark);
        const button = document.getElementById('themeToggle');
        button.innerHTML = isDark
            ? '<i data-lucide="sun" class="h-4 w-4 text-amber-300"></i>'
            : '<i data-lucide="moon" class="h-4 w-4"></i>';
        button.title = isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
        button.setAttribute('aria-label', button.title);
        lucide.createIcons();
    }

    document.getElementById('themeToggle').addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-theme');
        localStorage.setItem('pl-theme', isDark ? 'dark' : 'light');
        applyTheme();
    });

    function sourceValue(record) {
        return displayValue(record.source || record.brandSource);
    }

    function sourceBadge(record) {
        const source = sourceValue(record);
        const classes = source === 'MANUAL'
            ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
            : source === 'SAP_PO_FALLBACK'
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                : source === 'BOM'
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
        const label = source === 'SAP_PO_FALLBACK' ? 'SAP PO Fallback' : source;
        return `<span class="inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold ${classes}">${escapeHtml(label)}</span>`;
    }

    function brandBadge(record) {
        const brand = displayValue(record.brand);
        if (brand === '-') return '<span class="text-sm text-slate-400">-</span>';
        return `<span class="inline-flex max-w-full items-center truncate rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300" title="${escapeHtml(brand)}">${escapeHtml(brand)}</span>`;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? displayValue(value) : date.toLocaleString('th-TH');
    }

    function isNeedsReview(record) {
        const source = String(record.brandSource || '').trim();
        return record.verified !== true || record.bomFound === false ||
            (record.bomFound === true && (!String(record.brand || '').trim() || source === 'CONFLICT' || source === 'UNRESOLVED'));
    }

    function updateSummary() {
        document.getElementById('memoryTotal').textContent = memories.length.toLocaleString('th-TH');
        document.getElementById('memoryVerified').textContent = memories.filter(record => record.verified === true).length.toLocaleString('th-TH');
        document.getElementById('memoryManual').textContent = memories.filter(record => record.source === 'MANUAL').length.toLocaleString('th-TH');
        document.getElementById('memoryReview').textContent = memories.filter(isNeedsReview).length.toLocaleString('th-TH');
    }

    function showStatus(message, isError = false) {
        statusBox.textContent = message;
        statusBox.classList.remove('hidden');
        statusBox.classList.toggle('text-rose-600', isError);
        statusBox.classList.toggle('dark:text-rose-300', isError);
    }

    // Display only the first BOM ID in the table; keep the full list in details/search.
    // This is a presentation-only change: no SAP Memory records are modified.
    function bomIdCell(record) {
        const ids = getBomIds(record);
        if (!ids.length) return '<span class="text-slate-400">-</span>';
        const fullList = escapeHtml(ids.join(', '));
        const first = escapeHtml(ids[0]);
        const extra = ids.length > 1
            ? `<span class="inline-flex shrink-0 items-center rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">+${ids.length - 1}</span>`
            : '';
        return `<div class="flex min-w-0 max-w-full items-center gap-1.5" title="${fullList}"><span class="min-w-0 truncate">${first}</span>${extra}</div>`;
    }

    function render() {
        const query = searchInput.value.trim().toLocaleLowerCase();
        const selectedSource = sourceFilter.value;
        const filtered = memories.filter(record => {
            const searchable = [record.sapNo, bomIdsText(record), record.brand, record.productDescription]
                .map(value => String(value || '').toLocaleLowerCase())
                .join(' ');
            const matchesQuery = searchable.includes(query);
            const matchesSource = !selectedSource || sourceValue(record) === selectedSource;
            return matchesQuery && matchesSource;
        });

        tableBody.replaceChildren();
        if (filtered.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="8" class="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">${memories.length ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีข้อมูล SAP Memory'}</td>`;
            tableBody.appendChild(row);
            return;
        }

        filtered.forEach((record, index) => {
            const row = document.createElement('tr');
            row.className = 'transition-colors hover:bg-blue-50/60 dark:hover:bg-slate-800/60';
            row.innerHTML = `
                <td class="px-2 py-3 text-center font-mono text-xs text-slate-500 dark:text-slate-400">${index + 1}</td>
                <td class="whitespace-nowrap px-2 py-3 font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(displayValue(record.sapNo))}</td>
                <td class="min-w-0 px-2 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">${bomIdCell(record)}</td>
                <td class="px-2 py-3">${brandBadge(record)}${record.verified === true ? '<span class="ml-1.5 inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300"><i data-lucide="badge-check" class="h-3 w-3"></i>Verified</span>' : ''}</td>
                <td class="px-2 py-3 text-xs text-slate-700 dark:text-slate-300"><span class="block truncate" title="${escapeHtml(displayValue(record.productDescription))}">${escapeHtml(displayValue(record.productDescription))}</span></td>
                <td class="px-2 py-3">${sourceBadge(record)}</td>
                <td class="whitespace-nowrap px-2 py-3 text-xs text-slate-600 dark:text-slate-400">${escapeHtml(formatDate(record.lastChecked || record.updatedAt))}</td>
                <td class="px-2 py-3 text-center"><button type="button" data-detail-index="${memories.indexOf(record)}" class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-cyan-300 dark:hover:bg-blue-900/60"><i data-lucide="eye" class="h-3.5 w-3.5"></i>ดูรายละเอียด</button></td>
            `;
            tableBody.appendChild(row);
        });
        lucide.createIcons();
    }

    function addDetailField(label, value) {
        const field = document.createElement('div');
        field.className = 'min-w-0 rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/50';
        const title = document.createElement('p');
        title.className = 'text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
        title.textContent = label;
        const content = document.createElement('p');
        content.className = 'mt-1 break-words text-sm text-slate-800 dark:text-slate-100';
        content.textContent = displayValue(value);
        field.append(title, content);
        detailContent.appendChild(field);
    }

    function openDetails(record) {
        detailContent.replaceChildren();
        detailSubtitle.textContent = `SAP NO. ${displayValue(record.sapNo)}`;
        addDetailField('SAP NO.', record.sapNo);
        addDetailField('SAP PO.', record.sapPo);
        addDetailField('BOM ID ที่เกี่ยวข้อง', bomIdsText(record));
        addDetailField('Brand', record.brand);
        addDetailField('Product Description', record.productDescription);
        addDetailField('Brand Source', record.brandSource);
        addDetailField('Production Models', Array.isArray(record.productionModels) && record.productionModels.length ? record.productionModels.join(', ') : '-');
        addDetailField('Source', sourceValue(record));
        addDetailField('Verified', record.verified === true ? 'Verified' : record.verified === false ? 'Not verified' : '-');
        addDetailField('Last Checked', formatDate(record.lastChecked || record.updatedAt));
        detailModal.classList.remove('hidden');
        detailModal.classList.add('flex');
    }

    function closeDetails() {
        detailModal.classList.add('hidden');
        detailModal.classList.remove('flex');
    }

    tableBody.addEventListener('click', event => {
        const button = event.target.closest('[data-detail-index]');
        if (!button) return;
        const record = memories[Number(button.dataset.detailIndex)];
        if (record) openDetails(record);
    });
    document.getElementById('memoryDetailClose').addEventListener('click', closeDetails);
    document.getElementById('memoryDetailDone').addEventListener('click', closeDetails);
    detailModal.addEventListener('click', event => {
        if (event.target === detailModal) closeDetails();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !detailModal.classList.contains('hidden')) closeDetails();
    });

    async function loadMemories() {
        showStatus('กำลังโหลด SAP Memory...');
        try {
            const response = await fetch('/api/sap-memory');
            const result = await response.json();
            if (!response.ok || !result.success || !Array.isArray(result.memories)) {
                throw new Error(result.message || 'รูปแบบข้อมูล SAP Memory ไม่ถูกต้อง');
            }
            memories = result.memories;
            await loadRelatedBomIds(memories);
            statusBox.classList.add('hidden');
            updateSummary();
            render();
        } catch (error) {
            memories = [];
            updateSummary();
            render();
            showStatus(error.message || 'โหลด SAP Memory ไม่สำเร็จ', true);
        }
    }

    searchInput.addEventListener('input', render);
    sourceFilter.addEventListener('change', render);
    document.getElementById('refreshMemoryBtn').addEventListener('click', loadMemories);
    applyTheme();
    updateSummary();
    loadMemories();
});
