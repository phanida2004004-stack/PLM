document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('pl-theme');

    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.documentElement.classList.add('dark');
    }

    function updateThemeToggle() {
        const isDark = document.body.classList.contains('dark-theme');
        document.documentElement.classList.toggle('dark', isDark);
        themeToggle.innerHTML = isDark
            ? '<i data-lucide="sun" class="w-4 h-4 text-amber-400"></i>'
            : '<i data-lucide="moon" class="w-4 h-4"></i>';
        themeToggle.title = isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
        themeToggle.setAttribute('aria-label', themeToggle.title);
        lucide.createIcons();
    }

    themeToggle.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-theme');
        localStorage.setItem('pl-theme', isDark ? 'dark' : 'light');
        updateThemeToggle();
    });

    lucide.createIcons();
    updateThemeToggle();

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileDetails = document.getElementById('fileDetails');
    const fileNameDisplay = document.getElementById('fileName');
    const fileSizeDisplay = document.getElementById('fileSize');
    const cancelBtn = document.getElementById('cancelBtn');
    const processBtn = document.getElementById('processBtn');

    const uploadSection = document.getElementById('uploadSection');
    const statusSection = document.getElementById('statusSection');
    const previewSection = document.getElementById('previewSection');

    const statusText = document.getElementById('statusText');
    const statusSubText = document.getElementById('statusSubText');

    let selectedFile = null;
    let extractedDataItems = [];
    let currentMetadata = null;
    let savedDocuments = [];
    let currentManualBomContext = null;

    // เอกสารยืนยันแล้ว: เมื่อแก้ไขให้เปิดปุ่มอัปเดตข้อมูล
    function markDocumentChanged() {
        const button = document.getElementById('confirmDataBtn');
        button.textContent = currentMetadata && currentMetadata.confirmedTimestamp
            ? 'อัปเดตข้อมูล' : 'ยืนยันข้อมูล';
        button.classList.remove('hidden');
    }


    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const manualBomModal = document.getElementById('manualBomModal');
    const manualBomForm = document.getElementById('manualBomForm');
    const manualBomError = document.getElementById('manualBomError');

    function openManualBomModal(context) {
        currentManualBomContext = context;
        document.getElementById('manualSapNo').value = String(context.item.sapNo || '').trim();
        document.getElementById('manualBomId').value = context.bomResult.bomId || `${String(context.item.sapNo || '').trim()}-1`;
        document.getElementById('manualProductDescription').value = context.bomResult.productDescription || '';
        document.getElementById('manualBrand').value = context.bomResult.brand || '';

        const selectedModels = new Set(context.productionModels.map(model =>
            String(model.productionModelDescription || '').trim()
        ));
        manualBomForm.querySelectorAll('input[name="manualProductionModel"]').forEach(input => {
            input.checked = selectedModels.has(input.value);
        });

        manualBomError.classList.add('hidden');
        manualBomError.textContent = '';
        manualBomModal.classList.remove('hidden');
        manualBomModal.classList.add('flex');
        lucide.createIcons();
        document.getElementById('manualBomId').focus();
    }

    function closeManualBomModal() {
        manualBomModal.classList.add('hidden');
        manualBomModal.classList.remove('flex');
        currentManualBomContext = null;
    }

    document.getElementById('manualBomClose').addEventListener('click', closeManualBomModal);
    document.getElementById('manualBomCancel').addEventListener('click', closeManualBomModal);
    manualBomModal.addEventListener('click', event => {
        if (event.target === manualBomModal) closeManualBomModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !manualBomModal.classList.contains('hidden')) {
            closeManualBomModal();
        }
    });

    manualBomForm.addEventListener('submit', async event => {
    event.preventDefault();

    if (!currentManualBomContext || !manualBomForm.reportValidity()) return;

    const saveButton = document.getElementById('manualBomSave');

    saveButton.disabled = true;
    manualBomError.classList.add('hidden');

    const selectedModels = [
        ...manualBomForm.querySelectorAll(
            'input[name="manualProductionModel"]:checked'
        )
    ].map(input => input.value);

    const manualData = {
        sapNo: String(
            currentManualBomContext.item.sapNo || ''
        ).trim(),

        sapPo: String(
            currentManualBomContext.item.sapPo || ''
        ).trim(),

        bomFound: true,

        bomId: document
            .getElementById('manualBomId')
            .value
            .trim(),

        productDescription: document
            .getElementById('manualProductDescription')
            .value
            .trim(),

        brand: document
            .getElementById('manualBrand')
            .value
            .trim(),

        brandSource: 'MANUAL',

        productionModels: selectedModels,

        source: 'MANUAL',

        // ยังไม่ถือว่า Confirm
        verified: false
    };

    try {

        if (
            !manualData.bomId ||
            !manualData.productDescription ||
            !manualData.brand
        ) {
            throw new Error(
                'กรุณากรอก BOM ID, Product Description และ Brand ให้ครบ'
            );
        }

        // ==========================================
        // บันทึกเฉพาะในเอกสารปัจจุบัน
        // ยังไม่บันทึกเข้า SAP Memory
        // ==========================================

        const updatedItem = currentManualBomContext.item;

        updatedItem.bomFound = true;
        updatedItem.bomId = manualData.bomId;
        updatedItem.productDescription = manualData.productDescription;
        updatedItem.brand = manualData.brand;
        updatedItem.brandSource = 'MANUAL';
        updatedItem.productionModels = selectedModels;
        updatedItem.source = 'MANUAL';

        // บันทึกแล้ว แต่ยังไม่ Confirm
        updatedItem.verified = false;
        updatedItem.manualBomVerified = false;
        updatedItem.manualBomSaved = true;
        markDocumentChanged();

        // เก็บข้อมูลของเอกสารปัจจุบันไว้ใน Browser
        localStorage.setItem(
            'pl-current-document',
            JSON.stringify({
                metadata: currentMetadata,
                items: extractedDataItems
            })
        );

        closeManualBomModal();

        await buildTableRows();

        updateDashboard(
            currentMetadata,
            extractedDataItems,
            savedDocuments.length
        );

        await Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลแล้ว',
            text: currentMetadata && currentMetadata.confirmedTimestamp ? 'กรุณากดปุ่ม อัปเดตข้อมูล เพื่อบันทึกการเปลี่ยนแปลงลงระบบ' : 'กรุณาตรวจสอบรายการทั้งหมดก่อนกดยืนยันข้อมูล',
            confirmButtonColor: '#2563eb'
        });

    } catch (error) {

        manualBomError.textContent =
            error.message || 'เกิดข้อผิดพลาดในการบันทึก';

        manualBomError.classList.remove('hidden');

    } finally {

        saveButton.disabled = false;
    }
});

    async function loadDocumentHistory() {
        try {
            const response = await fetch('/api/documents');
            const result = await response.json();
            if (!response.ok || !result.success) return;
            savedDocuments = result.documents;
            renderDocumentHistory();
        } catch (error) {
            console.warn('ไม่สามารถโหลดประวัติเอกสารได้', error);
        }
    }

    function renderDocumentHistory() {
        const history = document.getElementById('documentHistory');
        history.innerHTML = '';

        if (savedDocuments.length === 0) {
            history.innerHTML = '<p class="p-5 text-sm text-slate-400">ยังไม่มีเอกสารที่บันทึกไว้</p>';
            return;
        }

        savedDocuments.slice().reverse().forEach(metadata => {
            const row = document.createElement('div');
            row.className = 'p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors';

            const details = document.createElement('div');
            details.className = 'min-w-0 flex-1';
            const name = document.createElement('p');
            name.className = 'text-xs font-bold text-slate-800 dark:text-slate-200 truncate font-mono';
            name.textContent = metadata.originalName;
            const info = document.createElement('p');
            info.className = 'text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono';
            info.textContent = `${metadata.documentId} · ${new Date(metadata.confirmedTimestamp || metadata.uploadTimestamp).toLocaleDateString('th-TH')}`;
            details.append(name, info);

            const openButton = document.createElement('button');
            openButton.type = 'button';
            openButton.className = 'px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg transition-colors';
            openButton.textContent = 'ดูข้อมูล';
            openButton.dataset.documentId = metadata.documentId;

            const pdfLink = document.createElement('a');
            pdfLink.className = 'px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded-lg transition-colors';
            pdfLink.textContent = 'PDF';
            pdfLink.href = `/api/documents/${encodeURIComponent(metadata.documentId)}/file`;
            pdfLink.target = '_blank';
            pdfLink.rel = 'noopener';

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-1.5 shrink-0';
            actions.append(openButton, pdfLink);
            row.append(details, actions);
            history.appendChild(row);
        });
    }

    async function restoreLatestDocument() {
        let latestDocument = null;

        try {
            const response = await fetch('/api/documents/latest');
            const result = await response.json();
            if (response.ok && result.success && result.document) {
                latestDocument = result.document;
            }
        } catch (error) {
            console.warn('ไม่สามารถโหลดเอกสารล่าสุดได้', error);
        }

        const savedDraft = localStorage.getItem('pl-current-document');
        if (savedDraft) {
            try {
                const draftDocument = JSON.parse(savedDraft);
                const serverTime = latestDocument ? new Date(latestDocument.metadata.uploadTimestamp).getTime() : 0;
                const draftTime = new Date(draftDocument.metadata.uploadTimestamp).getTime();
                const sameConfirmedDocument = latestDocument && draftDocument.metadata.documentId === latestDocument.metadata.documentId && latestDocument.metadata.confirmedTimestamp;
                if (!sameConfirmedDocument && (!latestDocument || draftTime >= serverTime)) {
                    renderPreview(draftDocument.metadata, draftDocument.items);
                    return;
                }
            } catch (error) {
                localStorage.removeItem('pl-current-document');
            }
        }

        if (latestDocument) {
            renderPreview(latestDocument.metadata, latestDocument.items);
        }
    }

    async function restoreRequestedDocument() {
        const documentId = new URLSearchParams(window.location.search).get('documentId');
        if (!documentId) {
            restoreLatestDocument();
            return;
        }

        try {
            const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`);
            const result = await response.json();
            if (response.ok && result.success) {
                renderPreview(result.document.metadata, result.document.items);
                document.getElementById('extractedDataSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
        } catch (error) {
            console.warn('ไม่สามารถโหลดเอกสารที่เลือกได้', error);
        }

        restoreLatestDocument();
    }

    function updateDashboard(metadata, items, documentCount = metadata ? 1 : 0) {

    const totalItems = items.length;

    // จำนวนรายการที่พบ BOM
    const foundBomItems = items.filter(item =>
        item.bomFound === true
    ).length;

    // จำนวนรายการที่ไม่พบ BOM
    const missingBomItems = items.filter(item =>
        item.bomFound === false
    ).length;

    // รายการที่ต้องตรวจสอบ
    // เช่น พบ BOM แต่ยังหา Brand ไม่ได้ / Conflict
    const reviewItems = items.filter(item => {
        const brandSource = String(item.brandSource || '').trim();

        return (
            item.bomFound === true &&
            (
                !item.brand ||
                brandSource === 'CONFLICT' ||
                brandSource === 'UNRESOLVED'
            )
        );
    }).length;


    // ==========================================
    // อัปเดตตัวเลขบน Dashboard
    // ==========================================

    const totalElement = document.getElementById('dashboardItems');
    const foundElement = document.getElementById('dashboardBomFound');
    const reviewElement = document.getElementById('dashboardReview');
    const missingElement = document.getElementById('dashboardBomMissing');

    if (totalElement) {
        totalElement.textContent =
            totalItems.toLocaleString('th-TH');
    }

    if (foundElement) {
        foundElement.textContent =
            foundBomItems.toLocaleString('th-TH');
    }

    if (reviewElement) {
        reviewElement.textContent =
            reviewItems.toLocaleString('th-TH');
    }

    if (missingElement) {
        missingElement.textContent =
            missingBomItems.toLocaleString('th-TH');
    }


    // ==========================================
    // Dashboard Status
    // ==========================================

    const dashboardStatus =
        document.getElementById('dashboardStatus');

    if (dashboardStatus) {

        dashboardStatus.innerHTML = metadata
            ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> พร้อมใช้งาน'
            : '<span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ยังไม่มีเอกสาร';

        dashboardStatus.className = metadata
            ? 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-3 py-1 rounded-full font-medium shadow-sm'
            : 'inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 border border-slate-200 text-xs px-3 py-1 rounded-full font-medium shadow-sm';
    }
}
    updateDashboard(null, [], 0);
    restoreRequestedDocument();
    loadDocumentHistory();

    document.getElementById('refreshHistoryBtn').addEventListener('click', loadDocumentHistory);
    document.getElementById('documentHistory').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-document-id]');
        if (!button) return;

        const response = await fetch(`/api/documents/${encodeURIComponent(button.dataset.documentId)}`);
        const result = await response.json();
        if (response.ok && result.success) {
            renderPreview(result.document.metadata, result.document.items);
            document.getElementById('extractedDataSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    document.getElementById('newUploadBtn').addEventListener('click', () => {
        currentMetadata = null;
        extractedDataItems = [];
        localStorage.removeItem('pl-current-document');
        resetUploadForm();
        previewSection.classList.add('hidden');
        document.getElementById('printPreviewBtn').classList.add('hidden');
        statusSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
        updateDashboard(null, [], savedDocuments.length);
        uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50/50');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    function handleFileSelection(file) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            Swal.fire({
                icon: 'error',
                title: 'ข้อผิดพลาด',
                text: 'รองรับเฉพาะไฟล์ PDF เท่านั้น',
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        selectedFile = file;
        fileNameDisplay.textContent = file.name;
        fileSizeDisplay.textContent = (file.size / 1024).toFixed(2) + ' KB';
        
        dropZone.classList.add('hidden');
        fileDetails.classList.remove('hidden');
    }

    cancelBtn.addEventListener('click', resetUploadForm);

    function resetUploadForm() {
        selectedFile = null;
        fileInput.value = '';
        fileDetails.classList.add('hidden');
        dropZone.classList.remove('hidden');
    }

    processBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        uploadSection.classList.add('hidden');
        statusSection.classList.remove('hidden');
        
        updateStatus('กำลังอ่านไฟล์...', 'อ่านไฟล์ PDF และอัปโหลดไปยังระบบ');

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            setTimeout(() => updateStatus('Extract ข้อมูล...', 'ค้นหา SAP PO, SAP NO. และรายการสินค้า'), 600);
            setTimeout(() => updateStatus('ตรวจสอบข้อมูล...', 'ตรวจสอบความสมบูรณ์ของค่าที่สกัดได้'), 1200);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'เกิดข้อผิดพลาดในการประมวลผล');
            }

            renderPreview(result.metadata, result.items);

        } catch (error) {
            statusSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            
            Swal.fire({
                icon: 'error',
                title: 'ไม่สามารถอ่านข้อมูลได้',
                text: error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์',
                confirmButtonColor: '#2563eb'
            });
        }
    });

    function updateStatus(mainText, subText) {
        statusText.textContent = mainText;
        statusSubText.textContent = subText;
    }

    function renderPreview(metadata, items) {
        statusSection.classList.add('hidden');
        previewSection.classList.remove('hidden');

        document.getElementById('metaDocId').textContent = metadata.documentId;
        document.getElementById('metaFileName').textContent = metadata.originalName;
        document.getElementById('metaUploadTime').textContent = new Date(metadata.uploadTimestamp).toLocaleString('th-TH');
        document.getElementById('metaPageCount').textContent = `${metadata.pageCount || '-'} หน้า / ${metadata.fileSize || '-'}`;
        const incompleteCount = items.filter(item => item.status !== 'COMPLETE' || !item.sapNo || !item.description || !item.totalQty).length;
        const validationSummary = document.getElementById('validationSummary');
        validationSummary.textContent = incompleteCount
            ? `ต้องตรวจทานเพิ่ม ${incompleteCount.toLocaleString('th-TH')} รายการ`
            : 'ข้อมูลสกัดครบถ้วนสมบูรณ์ทุกแถว';
        validationSummary.className = incompleteCount
            ? 'text-xs font-semibold mt-1 text-amber-600 dark:text-amber-400'
            : 'text-xs font-semibold mt-1 text-emerald-600 dark:text-emerald-400';
        const processBadge = document.getElementById('metaProcessType');
        const isOcr = metadata.processType === 'OCR';
        processBadge.innerHTML = isOcr
            ? '<i data-lucide="scan-text" class="w-3 h-3"></i> OCR Engine'
            : '<i data-lucide="check-circle" class="w-3 h-3"></i> Text Layer';
        processBadge.className = isOcr
            ? 'inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px] px-2 py-0.5 rounded-md font-semibold font-mono'
            : 'inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] px-2 py-0.5 rounded-md font-semibold font-mono';

        extractedDataItems = items;
        currentMetadata = metadata;
        document.getElementById('confirmDataBtn').textContent = metadata.confirmedTimestamp ? 'อัปเดตข้อมูล' : 'ยืนยันข้อมูล';
        document.getElementById('confirmDataBtn').classList.toggle('hidden', Boolean(metadata.confirmedTimestamp));
        document.getElementById('printPreviewBtn').classList.toggle('hidden', !metadata.confirmedTimestamp);
        localStorage.setItem('pl-current-document', JSON.stringify({ metadata, items }));
        buildTableRows();
    }

    async function buildTableRows() {

    const tbody = document.getElementById('dataTableBody');

    tbody.innerHTML = '';

    if (extractedDataItems.length === 0) {

        updateDashboard(currentMetadata, extractedDataItems, savedDocuments.length);

        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-400 dark:text-slate-500 font-sans">
                    ไม่พบข้อมูลในเอกสาร PDF นี้ หรือโครงสร้าง PDF อ่านยากเกินไป
                </td>
            </tr>
        `;

        return;
    }

    // ==========================================
    // PHASE 3 - STEP 1
    // ตรวจ BOM ของทุกรายการก่อน
    // ==========================================

    const bomResults = [];

    for (let index = 0; index < extractedDataItems.length; index++) {

        const item = extractedDataItems[index];

        const sapNo = String(item.sapNo || '').trim();
        const sapPo = String(item.sapPo || '').trim();

        let bomFound = false;
        let brand = '';
        let bomId = '';
        let productDescription = '';
        let brandSource = '';
        let source = '';
        let verified = false;

        if (item.manualBomSaved === true || currentMetadata.confirmedTimestamp) {

    // ผู้ใช้แก้และกดบันทึกข้อมูลเองแล้ว
    // ให้ Manual Data มีสิทธิ์เหนือ Auto BOM Lookup
    bomFound = item.bomFound === true;
    brand = String(item.brand || '').trim();
    bomId = String(item.bomId || '').trim();
    productDescription = String(
        item.productDescription || ''
    ).trim();

    brandSource = item.brandSource || 'MANUAL';
    source = item.source || 'MANUAL';

    // บันทึกแล้ว แต่ยังไม่ได้ยืนยันทั้งเอกสาร
    verified = Boolean(currentMetadata.confirmedTimestamp);

} else if (sapNo) {

    try {

                const response = await fetch(
                    `/api/bom-lookup/${encodeURIComponent(sapNo)}`
                );

                if (response.ok) {

                    const result = await response.json();

                    bomFound = result.found === true;
                    brand = String(result.brandCandidate || '').trim();
                    bomId = String(result.bomId || '').trim();
                    productDescription = String(result.productDescription || '').trim();
                    brandSource = String(result.brandSource || '').trim();
                    source = String(result.source || '').trim();
                    verified = result.verified === true;

                }

            } catch (error) {

                console.error(
                    `BOM lookup failed for SAP NO. ${sapNo}`,
                    error
                );

            }
        }

        // SAP Memory: ใช้ Brand ที่ผู้ใช้ยืนยันเองเท่านั้น และต้องมี BOM จริง
        // ไม่เปลี่ยน Production Models ซึ่งยังใช้ API เดิม
        if (sapNo && !currentMetadata.confirmedTimestamp && item.manualBomSaved !== true && bomFound) {
            try {
                const memoryResponse = await fetch(`/api/sap-memory/${encodeURIComponent(sapNo)}`);
                if (memoryResponse.ok) {
                    const memoryResult = await memoryResponse.json();
                    const memory = memoryResult.memory;
                    if (memoryResult.found && memory && memory.verified === true &&
                        memory.source === 'MANUAL' && memory.bomFound === true &&
                        String(memory.brand || '').trim()) {
                        brand = String(memory.brand).trim();
                        brandSource = 'MANUAL';
                        source = 'MANUAL';
                        verified = true;
                        if (memory.bomId) bomId = String(memory.bomId).trim();
                        if (memory.productDescription) productDescription = String(memory.productDescription).trim();
                    }
                }
            } catch (error) {
                console.warn('SAP Memory lookup failed:', sapNo, error);
            }
        }

        bomResults.push({
            sapPo: sapPo,
            sapNo: sapNo,
            bomFound: bomFound,
            bomId: bomId,
            originalBrand: brand,
            brand: brand,
            brandSource: brandSource || (brand ? 'BOM' : ''),
            productDescription: productDescription,
            source: source,
            verified: verified,
            conflict: false
        });
    }

    // ==========================================
    // PHASE 3 - STEP 2
    // SAP PO FALLBACK
    // ==========================================

   for (let index = 0; index < bomResults.length; index++) {

    const current = bomResults[index];

    // ==========================================
    // คำที่อยู่หน้าลูกน้ำ แต่ไม่ถือว่าเป็น Brand
    // ==========================================
    const fallbackKeywords = [
        'ICT',
        'PLASTIC',
        'EMPTY'
    ];

    const currentBrand = String(
        current.originalBrand || ''
    ).trim();

    const currentBrandUpper = currentBrand.toUpperCase();

    // ต้องใช้ SAP PO Fallback เมื่อ:
    // 1. Brand ว่าง
    // หรือ
    // 2. คำหน้าลูกน้ำคือ ICT / PLASTIC / EMPTY
    const needsPoFallback =
        !currentBrand ||
        fallbackKeywords.includes(currentBrandUpper);

    if (
        !currentMetadata.confirmedTimestamp &&
        current.bomFound &&
         current.brandSource !== 'MANUAL' &&
         needsPoFallback &&
        current.sapPo
    ) {

        // หา Brand จากรายการอื่นที่อยู่ SAP PO เดียวกัน
        // แต่ห้ามเอา ICT / PLASTIC / EMPTY
        // มาใช้เป็น Brand อ้างอิง
        const brandsInSamePo = bomResults
            .filter(other => {

                const otherBrand = String(
                    other.originalBrand || ''
                ).trim();

                const otherBrandUpper =
                    otherBrand.toUpperCase();

                return (
                    other.sapPo === current.sapPo &&
                    other.bomFound &&
                    otherBrand &&
                    !fallbackKeywords.includes(otherBrandUpper)
                );
            })
            .map(other =>
                String(other.originalBrand || '').trim()
            );

        // ลบ Brand ที่ซ้ำกัน
        const uniqueBrands = [
            ...new Set(brandsInSamePo)
        ];

        // ==========================================
        // SAP PO เดียวกันมี Brand ที่เชื่อถือได้ 1 Brand
        // ==========================================
        if (uniqueBrands.length === 1) {

            current.brand = uniqueBrands[0];
            current.brandSource = 'SAP_PO_FALLBACK';
            current.conflict = false;

        }

        // ==========================================
        // SAP PO เดียวกันมีมากกว่า 1 Brand
        // ห้ามเดา
        // ==========================================
        else if (uniqueBrands.length > 1) {

            current.brand = '';
            current.brandSource = 'CONFLICT';
            current.conflict = true;

        }

        // ==========================================
        // SAP PO เดียวกันยังไม่มี Brand ที่ใช้อ้างอิงได้
        // ==========================================
        else {

            current.brand = '';
            current.brandSource = 'UNRESOLVED';
            current.conflict = false;
        }
    }
}

    bomResults.forEach((result, index) => {
        Object.assign(extractedDataItems[index], {
            bomFound: result.bomFound,
            bomId: result.bomId,
            brand: result.brand,
            brandSource: result.brandSource,
            productDescription: result.productDescription,
            source: result.source,
            verified: result.verified
        });
    });

    updateDashboard(currentMetadata, extractedDataItems, savedDocuments.length);

    // ==========================================
    // สร้างตาราง
    // ==========================================

    const brandBadgePalettes = [
        'bg-[#dbeafe] border-[#3b82f6] text-[#1d4ed8]',
        'bg-[#ede9fe] border-[#8b5cf6] text-[#6d28d9]',
        'bg-[#fce7f3] border-[#ec4899] text-[#be185d]',
        'bg-[#ffe4e6] border-[#f43f5e] text-[#be123c]',
        'bg-[#ffedd5] border-[#f97316] text-[#c2410c]',
        'bg-[#fef3c7] border-[#f59e0b] text-[#b45309]',
        'bg-[#d1fae5] border-[#10b981] text-[#047857]',
        'bg-[#cffafe] border-[#06b6d4] text-[#0e7490]'
    ];
    const brandBadgeColors = new Map();

    for (let index = 0; index < extractedDataItems.length; index++) {

        const item = extractedDataItems[index];

        const bomResult = bomResults[index];

const bomFound = bomResult.bomFound;
const brand = bomResult.brand;

// DEBUG: ตรวจค่าจริงก่อนสร้างแถว
console.log('========== ROW DEBUG ==========');
console.log('INDEX:', index);
console.log('SAP NO:', item.sapNo);
console.log('BOM RESULT:', bomResult);
console.log('BOM FOUND:', bomFound);
console.log('BRAND:', brand);
console.log('================================');
        // ==========================================
// PHASE 4 - ตรวจ Production Models
// ==========================================

let productionModels = [];

// ==========================================
// Production Model
// ถ้าผู้ใช้บันทึก Manual แล้ว
// ให้ใช้ข้อมูล Manual และห้าม API เขียนทับ
// ==========================================

if (
    (item.manualBomSaved === true || currentMetadata.confirmedTimestamp) &&
    Array.isArray(item.productionModels)
) {

    productionModels = item.productionModels
        .map(model => {

            // Manual Model ถูกเก็บเป็น String
            if (typeof model === 'string') {
                return {
                    productionModelDescription: model.trim()
                };
            }

            // รองรับกรณีที่เป็น Object อยู่แล้ว
            return model;
        })
        .filter(model =>
            String(
                model.productionModelDescription || ''
            ).trim()
        );

} else if (item.sapNo) {

    // ไม่ได้แก้ Manual → Lookup จาก Production Model Database ตามปกติ
    try {

        const modelResponse = await fetch(
            `/api/production-model/${encodeURIComponent(item.sapNo)}`
        );

        if (modelResponse.ok) {

            const modelResult = await modelResponse.json();

            productionModels = modelResult.models || [];
        }

    } catch (error) {

        console.error(
            `Production Model lookup failed for SAP NO. ${item.sapNo}`,
            error
        );
    }
}

const productionModelCount = productionModels.length;
// ==========================================
// เก็บผลการตรวจกลับเข้า item
// เพื่อใช้ตอนกด "ยืนยันข้อมูล" ทั้งใบ
// ==========================================

if (item.manualBomSaved === true) {

    // MANUAL:
    // BOM / Brand / Description ที่ผู้ใช้กรอกไว้
    // ถูกเก็บใน item อยู่แล้ว ห้าม BOM Database เขียนทับ

    item.bomFound = true;

    // Production Model ใช้ค่าที่ผู้ใช้เลือก Manual
    item.productionModels = productionModels;

} else {

    // AUTO:
    // เอาผลที่ค้นจาก BOM Database กลับมาเก็บใน item

    item.bomFound = bomResult.bomFound === true;
    item.bomId = String(bomResult.bomId || '').trim();
    item.brand = String(bomResult.brand || '').trim();
    item.brandSource = String(bomResult.brandSource || '').trim();
    item.productDescription = String(
        bomResult.productDescription || ''
    ).trim();

    item.source = String(
        bomResult.source || (item.bomFound ? 'BOM' : '')
    ).trim();

    // เก็บ Production Models ที่ค้นเจอด้วย
    item.productionModels = productionModels;
}
// เก็บ Production Models ไว้กับรายการ
// เพื่อใช้ตอนผู้ใช้กด "ยืนยันข้อมูล"
item.productionModels = productionModels;

// ==========================================


        const tr = document.createElement('tr');

        tr.className =
    "hover:bg-blue-50/70 dark:hover:bg-slate-800/60 transition-all duration-150 border-b border-slate-100 dark:border-slate-800/80 group";

        // BOM presentation uses the existing lookup result.
    const bomText = bomFound ? 'พบ BOM' : 'ไม่พบ BOM';

let brandText = '-';

if (bomFound) {

    if (bomResult.brandSource === 'BOM') {
        // Brand มาจาก BOM โดยตรง
        brandText = bomResult.brand;

    } else if (bomResult.brandSource === 'SAP_PO_FALLBACK') {
        // BOM มีอยู่ แต่ Brand ว่าง
        // ระบบหา Brand จากรายการ SAP PO เดียวกันได้
        brandText = bomResult.brand;

    } else if (bomResult.brandSource === 'CONFLICT') {
        // PO เดียวกันมีหลาย Brand จึงห้ามเดา
        brandText = 'Conflict';

    } else if (bomResult.brandSource === 'UNRESOLVED') {
        // มี BOM แต่ยังไม่มีข้อมูลพอที่จะหา Brand
        brandText = 'รอตรวจสอบ';

    } else {
        brandText = bomResult.brand || 'รอตรวจสอบ';
    }
}

if (bomFound) {

    // มี Brand จาก BOM โดยตรง
    if (bomResult.brandSource === 'BOM') {
        brandText = brand;
    }

    // Brand ที่ได้จาก SAP PO Fallback
    else if (bomResult.brandSource === 'SAP_PO_FALLBACK') {
        brandText = brand;
    }

    // SAP PO เดียวกันพบหลาย Brand
    else if (bomResult.brandSource === 'CONFLICT') {
        brandText = 'Conflict';
    }

    // พบ BOM แต่ยังไม่มีข้อมูลพอหา Brand
    else if (bomResult.brandSource === 'UNRESOLVED') {
        brandText = 'รอตรวจสอบ';
    }

    // ป้องกันกรณีอื่น
    else {
        brandText = brand || 'รอตรวจสอบ';
    }
}

        // Keep both BOM badges aligned and consistently sized.
    const bomClass = "py-2.5 px-3 text-center";
    const bomBadgeClass = bomFound
        ? "border-[#22c55e] bg-[#dcfce7] text-[#15803d] hover:bg-[#bbf7d0] hover:shadow-emerald-200/80"
        : "border-[#ef4444] bg-[#fee2e2] text-[#dc2626] hover:bg-[#fecaca] hover:shadow-rose-200/80";
    const bomIcon = bomFound ? 'circle-check' : 'triangle-alert';
        // ==========================================
// PHASE 4 - สร้างหน้าตา Production Model
// ==========================================

const requiredModels = [
    'Inspection_Assembly',
    'STK+CTN_CHANGE CODE',
    'DIRECT'
];

const existingModelNames = productionModels.map(model =>
    String(model.productionModelDescription || '').trim()
);

let productionModelHtml = '';

if (bomFound) {

    let modelListHtml = '';

    requiredModels.forEach(modelName => {

        const exists = existingModelNames.some(existingName =>
    String(existingName || '')
        .trim()
        .toUpperCase()
        .startsWith(modelName.toUpperCase())
);
        const separatorClass = exists
            ? 'from-[#a7f3d0] via-[#a7f3d0]/60'
            : 'from-[#fecaca] via-[#fecaca]/60';

        if (exists) {
            modelListHtml += `
                <div class="flex items-center justify-between gap-3 rounded-lg bg-[#ecfdf5] px-2.5 py-2 text-[#047857] whitespace-nowrap">
                    <span class="flex min-w-0 items-center gap-2">
                    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 font-bold text-[11px] text-[#10b981]">
                        ✓
                    </span>
                    <span class="truncate font-medium">${escapeHtml(modelName)}</span>
                    </span>
                    <span class="shrink-0 text-[9px] font-bold tracking-wide text-[#047857]">ACTIVE</span>
                </div>
                <div class="my-2.5 h-px w-full bg-gradient-to-r ${separatorClass} to-transparent"></div>
            `;
        } else {
            modelListHtml += `
                <div class="flex items-center justify-between gap-3 rounded-lg bg-[#fff1f2] px-2.5 py-2 text-[#dc2626] whitespace-nowrap">
                    <span class="flex min-w-0 items-center gap-2">
                    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 font-bold text-[11px] text-[#ef4444]">
                        ✕
                    </span>
                    <span class="truncate font-medium">${escapeHtml(modelName)}</span>
                    </span>
                    <span class="shrink-0 text-[9px] font-bold tracking-wide text-[#dc2626]">MISSING</span>
                </div>
                <div class="my-2.5 h-px w-full bg-gradient-to-r ${separatorClass} to-transparent"></div>
            `;
        }
    });


    // ข้อความบน Badge
    const badgeText =
        productionModelCount === 0
            ? 'ไม่มี Model'
            : productionModelCount === 1
                ? '1 Model'
                : `${productionModelCount} Models`;


    const badgeClass = `
        ${productionModelCount === 0
            ? 'border-[#ef4444] bg-[#fee2e2] text-[#dc2626] hover:bg-[#fecaca] hover:shadow-rose-200/80'
            : productionModelCount >= 3
                ? 'border-[#22c55e] bg-[#dcfce7] text-[#15803d] hover:bg-[#bbf7d0] hover:shadow-emerald-200/80'
                : 'border-purple-400 bg-[#ede9fe] text-[#6d28d9] hover:bg-[#ddd6fe] hover:shadow-purple-200/80'}
    `;


    productionModelHtml = `
        <div class="relative group/model inline-block" data-model-tooltip-trigger>

            <!-- Badge -->
            <span class="
                inline-flex h-8 items-center justify-center
                gap-2 px-3.5
                rounded-full
                border
                text-xs
                font-bold
                cursor-default
                whitespace-nowrap
                shadow-sm transition-all duration-200
                hover:-translate-y-0.5 hover:shadow-md
                ${badgeClass}
            ">
                <i data-lucide="${productionModelCount === 0 ? 'package-x' : 'package'}" class="h-4 w-4 ${productionModelCount === 0 ? 'text-[#dc2626]' : productionModelCount >= 3 ? 'text-[#15803d]' : 'text-[#5b21b6]'}"></i>
                ${productionModelCount >= 3 ? '✓ ' : productionModelCount === 0 ? '⚠ ' : ''}${badgeText}
            </span>


            <!-- Hover Popup -->
            <div data-model-popup class="
                invisible translate-y-1 opacity-0 group-hover/model:visible group-hover/model:translate-y-0 group-hover/model:opacity-100
                fixed z-50
                min-w-[280px]
                bg-white dark:bg-slate-900
                border border-[#ddd6fe]
                rounded-2xl
                shadow-xl shadow-purple-200/60
                p-4
                text-left
                transition-all duration-200 ease-out
            ">

                <!-- ลูกศรเล็กด้านบน -->
                <div data-model-tooltip-arrow class="
                    absolute
                    w-3 h-3
                    bg-white dark:bg-slate-900
                    border-l border-t
                    border-[#ddd6fe]
                    rotate-45
                "></div>
            

                <!-- Popup Header -->
                <div class="relative flex items-center gap-2">

                    <div class="
                        w-8 h-8
                        rounded-lg
                        bg-[#ede9fe]
                        text-[#7c3aed]
                        flex items-center justify-center
                    ">
                        <i data-lucide="boxes" class="h-4 w-4"></i>
                    </div>

                    <div>
                        <div class="text-xs font-bold text-[#7c3aed]">
                            Production Models
                        </div>

                        <div class="text-[10px] text-slate-500 mt-0.5">
                            SAP NO. ${escapeHtml(String(item.sapNo || ''))}
                        </div>
                    </div>

                </div>

                <div class="my-3 h-px w-full bg-gradient-to-r from-[#7c3aed] via-[#c4b5fd] to-transparent"></div>


                <!-- Model List -->
                <div class="relative text-xs">
                    ${modelListHtml}
                </div>

                <div class="mt-3 h-px w-full bg-gradient-to-r from-[#c4b5fd] via-[#ddd6fe] to-transparent"></div>

            </div>

        </div>
    `;
}
let brandHtml = '';

// ไม่พบ BOM
if (!bomFound || brandText === '-') {

    brandHtml = `
        <span class="text-sm text-slate-400 dark:text-slate-500">-</span>
    `;

// Conflict
} else if (brandText === 'Conflict') {

    brandHtml = `
        <span class="
            inline-flex h-8 items-center justify-center
            gap-2 px-3.5
            rounded-full
            border border-[#f43f5e]
            bg-[#ffe4e6]
            text-[#be123c]
            text-xs font-bold
            whitespace-nowrap
            shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md
        ">
            <i data-lucide="triangle-alert" class="h-4 w-4"></i><span>Conflict</span>
        </span>
    `;

// รอตรวจสอบ
} else if (brandText === 'รอตรวจสอบ') {

    brandHtml = `
        <span class="
            inline-flex h-8 items-center justify-center
            gap-2 px-3.5
            rounded-full
            border border-[#f59e0b]
            bg-[#fef3c7]
            text-[#b45309]
            text-xs font-bold
            whitespace-nowrap
            shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md
        ">
            <i data-lucide="hourglass" class="h-4 w-4"></i><span>รอตรวจสอบ</span>
        </span>
    `;

// Brand ปกติ
} else {

    if (!brandBadgeColors.has(brandText)) {
        brandBadgeColors.set(
            brandText,
            brandBadgePalettes[brandBadgeColors.size % brandBadgePalettes.length]
        );
    }

    const brandColorClass = brandBadgeColors.get(brandText);

    brandHtml = `
        <span class="
            inline-flex h-8 items-center justify-center
            gap-2 px-3.5
            rounded-full
            border
            ${brandColorClass}
            text-xs font-bold
            whitespace-nowrap
            shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md
        ">
            <i data-lucide="tag" class="h-4 w-4"></i><span>${escapeHtml(brandText)}</span>
        </span>
    `;
}

const isManualBom =
    bomResult.source === 'MANUAL' ||
    item.source === 'MANUAL' ||
    item.manualBomSaved === true;

const actionHtml = isManualBom
    ? `
        <div class="flex flex-col items-center gap-1.5">

            <span class="whitespace-nowrap text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                ✓ บันทึกแล้ว
            </span>

            <span class="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-bold tracking-wide text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
                MANUAL
            </span>

            <button
                type="button"
                data-manual-bom-action
                class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:text-cyan-300 dark:hover:bg-slate-800"
            >
                <i data-lucide="pencil" class="h-3 w-3"></i>
                แก้ไข
            </button>

        </div>
    `
    : `
        <button
            type="button"
            data-manual-bom-action
            class="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-[11px] font-semibold text-blue-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-100 hover:shadow-md dark:border-blue-800 dark:bg-blue-950/50 dark:text-cyan-300 dark:hover:bg-blue-900/60"
        >
            <i data-lucide="square-pen" class="h-3.5 w-3.5"></i>
            จัดการข้อมูล
        </button>
    `;
        tr.innerHTML = `
            <td class="py-2 px-3 text-center text-slate-400 dark:text-slate-500 font-mono text-[11px]">
                ${String(index + 1).padStart(2, '0')}
            </td>

            <td class="py-1 px-2">
                <input
                    type="text"
                    data-field="sapPo"
                    value="${escapeHtml(item.sapPo)}"
                    class="w-full bg-transparent focus:bg-white dark:focus:bg-slate-950 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-blue-500 font-mono text-xs text-slate-800 dark:text-slate-100 transition-all"
                >
            </td>

            <td class="py-1 px-2">
                <input
                    type="text"
                    data-field="sapNo"
                    value="${escapeHtml(item.sapNo)}"
                    class="w-full bg-transparent focus:bg-white dark:focus:bg-slate-950 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-blue-500 font-mono text-xs text-slate-800 dark:text-slate-100 transition-all font-semibold"
                >
            </td>

            <td class="py-1 px-2">
                <input
                    type="text"
                    data-field="description"
                    value="${escapeHtml(item.description)}"
                    class="w-full bg-transparent focus:bg-white dark:focus:bg-slate-950 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-blue-500 text-xs text-slate-800 dark:text-slate-100 transition-all"
                >
            </td>

            <td class="py-1 px-2 text-center">
    ${productionModelHtml}
</td>

<td class="${bomClass}">
    <span class="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${bomBadgeClass}"><i data-lucide="${bomIcon}" class="h-4 w-4"></i><span>${bomText}</span></span>
</td>

<td class="py-2.5 px-3 text-center">
    ${brandHtml}
</td>

<td class="px-2 py-2 text-center">
    ${actionHtml}
</td>
   
        `;

        const manualBomAction = tr.querySelector('[data-manual-bom-action]');
        if (manualBomAction) {
            manualBomAction.addEventListener('click', () => {
                openManualBomModal({ item, bomResult, productionModels });
            });
        }

        const tooltipTrigger = tr.querySelector('[data-model-tooltip-trigger]');
        if (tooltipTrigger) {
            const popup = tooltipTrigger.querySelector('[data-model-popup]');
            const arrow = popup && popup.querySelector('[data-model-tooltip-arrow]');

            if (popup && arrow) {
                const gap = 10;
                const viewportPadding = 8;
                let positionFrame = null;
                const hoverBridge = document.createElement('div');
                hoverBridge.style.position = 'absolute';
                hoverBridge.style.left = '0';
                hoverBridge.style.right = '0';
                hoverBridge.style.height = `${gap}px`;
                hoverBridge.style.background = 'transparent';
                hoverBridge.style.pointerEvents = 'auto';
                popup.prepend(hoverBridge);

                const positionPopup = () => {
                    if (positionFrame !== null) {
                        cancelAnimationFrame(positionFrame);
                    }

                    positionFrame = requestAnimationFrame(() => {
                        positionFrame = null;
                        const badgeRect = tooltipTrigger.getBoundingClientRect();
                        const viewportWidth = document.documentElement.clientWidth;
                        const viewportHeight = document.documentElement.clientHeight;
                        const availableWidth = Math.max(0, viewportWidth - viewportPadding * 2);
                        const availableHeight = Math.max(0, viewportHeight - viewportPadding * 2);

                        popup.style.minWidth = `${Math.min(280, availableWidth)}px`;
                        popup.style.maxWidth = `${availableWidth}px`;
                        popup.style.maxHeight = `${availableHeight}px`;
                        popup.style.overflowY = 'auto';

                        const popupRect = popup.getBoundingClientRect();
                        const availableBelow = viewportHeight - badgeRect.bottom - gap - viewportPadding;
                        const availableAbove = badgeRect.top - gap - viewportPadding;
                        const openAbove = popupRect.height > availableBelow &&
                            (popupRect.height <= availableAbove || availableAbove > availableBelow);

                        const unclampedTop = openAbove
                            ? badgeRect.top - gap - popupRect.height
                            : badgeRect.bottom + gap;
                        const maxTop = Math.max(viewportPadding, viewportHeight - viewportPadding - popupRect.height);
                        const top = Math.min(Math.max(unclampedTop, viewportPadding), maxTop);
                        const centeredLeft = badgeRect.left + badgeRect.width / 2 - popupRect.width / 2;
                        const maxLeft = Math.max(viewportPadding, viewportWidth - viewportPadding - popupRect.width);
                        const left = Math.min(Math.max(centeredLeft, viewportPadding), maxLeft);

                        popup.style.top = `${top}px`;
                        popup.style.left = `${left}px`;

                        const arrowLeft = Math.min(
                            Math.max(badgeRect.left + badgeRect.width / 2 - left, 10),
                            Math.max(10, popupRect.width - 10)
                        );
                        arrow.style.left = `${arrowLeft}px`;
                        arrow.style.top = openAbove ? 'auto' : '-6px';
                        arrow.style.bottom = openAbove ? '-6px' : 'auto';
                        arrow.style.transform = 'translateX(-50%) rotate(45deg)';
                        arrow.style.borderTop = openAbove ? '0' : '1px solid #ddd6fe';
                        arrow.style.borderLeft = openAbove ? '0' : '1px solid #ddd6fe';
                        arrow.style.borderRight = openAbove ? '1px solid #ddd6fe' : '0';
                        arrow.style.borderBottom = openAbove ? '1px solid #ddd6fe' : '0';
                        hoverBridge.style.top = openAbove ? 'auto' : `${-gap}px`;
                        hoverBridge.style.bottom = openAbove ? `${-gap}px` : 'auto';
                    });
                };

                const stopTracking = () => {
                    window.removeEventListener('resize', positionPopup);
                    window.removeEventListener('scroll', positionPopup, true);
                };

                tooltipTrigger.addEventListener('mouseenter', () => {
                    positionPopup();
                    window.addEventListener('resize', positionPopup);
                    window.addEventListener('scroll', positionPopup, true);
                });
                tooltipTrigger.addEventListener('mouseleave', stopTracking);
            }
        }

        const inputs = tr.querySelectorAll('input');

        inputs.forEach(input => {

            input.addEventListener('change', async (e) => {

                const field = e.target.dataset.field;

                extractedDataItems[index][field] = e.target.value;

                extractedDataItems[index].editedByUser = true;

                markDocumentChanged();

                const itemRef = extractedDataItems[index];

                if (
                    itemRef.sapPo &&
                    itemRef.sapNo &&
                    itemRef.description &&
                    itemRef.totalQty
                ) {
                    itemRef.status = 'COMPLETE';
                }

                updateDashboard(
                    currentMetadata,
                    extractedDataItems
                );

                localStorage.setItem(
                    'pl-current-document',
                    JSON.stringify({
                        metadata: currentMetadata,
                        items: extractedDataItems
                    })
                );

                await buildTableRows();

            });

        });

        tbody.appendChild(tr);
    }

    lucide.createIcons();
}document.getElementById('confirmDataBtn').addEventListener('click', async () => {

    const confirmButton = document.getElementById('confirmDataBtn');

    confirmButton.disabled = true;
    confirmButton.classList.add('opacity-60', 'cursor-wait');

    try {

        const response = await fetch('/api/documents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                metadata: currentMetadata,
                items: extractedDataItems
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || 'ไม่สามารถบันทึกข้อมูลได้'
            );
        }
        currentMetadata = result.document.metadata;
        extractedDataItems = result.document.items;
        extractedDataItems.forEach(item => {
            if (item.manualBomSaved === true) {
                item.verified = true;
                item.manualBomVerified = true;
            }
        });

        localStorage.setItem(
            'pl-current-document',
            JSON.stringify({
                metadata: currentMetadata,
                items: extractedDataItems
            })
        );

        confirmButton.classList.add('hidden');
        document.getElementById('printPreviewBtn').classList.remove('hidden');

        resetUploadForm();
        uploadSection.classList.remove('hidden');

        await loadDocumentHistory();

        document.getElementById('dashboardStatus').innerHTML =
            '<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span> บันทึกข้อมูลแล้ว';

        document.getElementById('dashboardStatus').className =
            'inline-flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 text-xs px-3 py-1 rounded-full font-medium shadow-sm';

        uploadSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });

        await Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลสำเร็จ',
            text: 'ข้อมูลถูกจัดเก็บแล้ว และจะถูกเรียกคืนเมื่อกลับเข้าหน้านี้',
            confirmButtonColor: '#059669'
        });

    } catch (error) {

        console.error('Confirm data error:', error);

        Swal.fire({
            icon: 'error',
            title: 'บันทึกข้อมูลไม่สำเร็จ',
            text: error.message,
            confirmButtonColor: '#2563eb'
        });

    } finally {

        confirmButton.disabled = false;

        confirmButton.classList.remove(
            'opacity-60',
            'cursor-wait'
        );
    }
});


    document.getElementById('printPreviewBtn').addEventListener('click', () => {
        if (!currentMetadata || !currentMetadata.confirmedTimestamp) {
            Swal.fire({ icon: 'warning', title: 'กรุณายืนยันข้อมูลก่อน Print' });
            return;
        }
        window.open(`/api/documents/${encodeURIComponent(currentMetadata.documentId)}/print`, '_blank');
    });

    document.getElementById('deleteDataBtn').addEventListener('click', async () => {
        if (!currentMetadata) return;

        const confirmation = await Swal.fire({
            icon: 'warning',
            title: 'ลบเอกสารนี้หรือไม่?',
            text: 'ระบบจะลบข้อมูลที่บันทึกไว้และไฟล์ PDF ด้วย ไม่สามารถย้อนกลับได้',
            showCancelButton: true,
            confirmButtonText: 'ลบข้อมูล',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b'
        });

        if (!confirmation.isConfirmed) return;

        try {
            const response = await fetch(`/api/documents/${encodeURIComponent(currentMetadata.documentId)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metadata: currentMetadata })
            });
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'ไม่สามารถลบข้อมูลได้');
            }

            const deletedDocumentId = currentMetadata.documentId;
            localStorage.removeItem('pl-current-document');
            currentMetadata = null;
            extractedDataItems = [];
            savedDocuments = savedDocuments.filter(document => document.documentId !== deletedDocumentId);
            renderDocumentHistory();
            previewSection.classList.add('hidden');
            statusSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            resetUploadForm();
            updateDashboard(null, [], savedDocuments.length);

            await Swal.fire({
                icon: 'success',
                title: 'ลบข้อมูลสำเร็จ',
                text: 'ลบข้อมูลและไฟล์ PDF เรียบร้อยแล้ว',
                confirmButtonColor: '#2563eb'
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'ลบข้อมูลไม่สำเร็จ',
                text: error.message,
                confirmButtonColor: '#2563eb'
            });
        }
    });
});
