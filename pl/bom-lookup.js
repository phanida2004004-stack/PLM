'use strict';

const fs = require('fs');

// อ่านข้อมูล CSV
function parseCSV(input) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    input = String(input).replace(/^\uFEFF/, '');

    for (let i = 0; i < input.length; i++) {
        const c = input[i];

        if (c === '"') {
            if (quoted && input[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (c === ',' && !quoted) {
            row.push(field);
            field = '';
        } else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && input[i + 1] === '\n') i++;

            row.push(field);

            if (row.some(v => v.trim())) {
                rows.push(row);
            }

            row = [];
            field = '';
        } else {
            field += c;
        }
    }

    row.push(field);

    if (row.some(v => v.trim())) {
        rows.push(row);
    }

    return rows;
}

// แยกประเภทสินค้าจากเลขตัวแรก
function getProductType(sapNo) {
    const sap = String(sapNo || '').trim();

    if (sap.startsWith('1')) return 'FG';
    if (sap.startsWith('2')) return 'SG';
    if (sap.startsWith('4')) return 'PK';

    return 'UNKNOWN';
}

// สร้างฐานข้อมูลความสัมพันธ์ BOM
function buildIndex(csvText) {
    const rows = parseCSV(csvText);
    const header = (rows.shift() || []).map(x => x.trim().toLowerCase());

    const col = name => header.indexOf(name.toLowerCase());

    const idCol = col('BoM ID');
    const descCol = col('BoM Description');
    const componentCol = col('Input Product');
    const statusCol = col('Status');

    if ([idCol, descCol, componentCol].some(n => n < 0)) {
        throw Error('Missing required BOM columns');
    }

    const boms = new Map();
    const components = new Map();

    let current = null;

    for (const cells of rows) {
        const get = i =>
            i < 0 ? '' : String(cells[i] || '').trim();

        const id = get(idCol);

        if (id) {
            current = {
                bomId: id,
                description: get(descCol),
                status: get(statusCol),
                components: []
            };

            boms.set(id, current);
        }

        if (!current) continue;

        const code = get(componentCol);

        if (!code) continue;

        current.components.push(code);

        if (!components.has(code)) {
            components.set(code, new Set());
        }

        components.get(code).add(current.bomId);
    }

    return { boms, components };
}

// ดึงชื่อ Brand ที่เป็นไปได้จาก BOM Description
function extractBrandCandidate(description) {
    return String(description || '')
        .split(',')[0]
        .trim();
}

// ค้นหา BOM หลักและความสัมพันธ์ Component แยกกัน
function lookup(index, sapNo) {
    const sap = String(sapNo || '').trim();
    const productType = getProductType(sap);

    // ค้นหา BOM หลักจาก SAP NO.-1
    const bomId = sap + '-1';
    const directBom = index.boms.get(bomId);

    // ค้นหา BOM ที่นำ SAP NO. นี้ไปเป็นส่วนประกอบ
    const parentIds = [
        ...(index.components.get(sap) || [])
    ];

    const componentMatches = parentIds
        .filter(id => id !== bomId)
        .map(id => {
            const bom = index.boms.get(id);

            return {
                bomId: id,
                description: bom.description,
                status: bom.status,
                relation: 'COMPONENT',
                brandCandidate: extractBrandCandidate(bom.description)
            };
        });

    const directMatches = directBom
        ? [{
            bomId: directBom.bomId,
            description: directBom.description,
            status: directBom.status,
            relation: 'DIRECT',
            brandCandidate: extractBrandCandidate(directBom.description)
        }]
        : [];

    // รวบรวม Brand จาก BOM หลัก
const directBrands = [
    ...new Set(
        directMatches
            .map(item => item.brandCandidate)
            .filter(Boolean)
    )
];

// รวบรวม Brand จาก BOM ที่นำ SAP NO. ไปใช้เป็นส่วนประกอบ
const componentBrands = [
    ...new Set(
        componentMatches
            .map(item => item.brandCandidate)
            .filter(Boolean)
    )
];

// BOM หลักมีความสำคัญก่อน BOM ที่เกี่ยวข้อง
const brandCandidates = directBrands.length > 0
    ? directBrands
    : componentBrands;

// เสนอ Brand เฉพาะเมื่อมีเพียงชื่อเดียว
const suggestedBrand = brandCandidates.length === 1
    ? brandCandidates[0]
    : '';

// แจ้งว่าพบ Brand หลายชื่อและต้องตรวจสอบ
const brandConflict = brandCandidates.length > 1;

    return {
        sapNo: sap,
        productType: productType,

        // found หมายถึงพบ BOM หลักของ SAP NO. นี้
       found: directMatches.length > 0 || componentMatches.length > 0,
        directFound: directMatches.length > 0,

        // มีความสัมพันธ์เป็นส่วนประกอบของ BOM อื่นหรือไม่
        componentFound: componentMatches.length > 0,

        bomId: directBom ? directBom.bomId : '',
        brandCandidate: suggestedBrand,
brandConflict: brandConflict,
brandStatus: brandConflict
    ? 'NEEDS_PO_CHECK'
    : suggestedBrand
        ? 'SUGGESTED'
        : 'NOT_FOUND',

        // คงข้อมูล matches ไว้เพื่อรองรับการตรวจสอบเดิม
        matches: [
            ...directMatches,
            ...componentMatches
        ],

        directMatches: directMatches,
        componentMatches: componentMatches,
        brandCandidates: brandCandidates,

        // Brand ยังเป็นเพียงข้อมูลเสนอ ต้องรอยืนยัน
        requiresConfirmation: true
    };
}

function loadIndex(filename) {
    return buildIndex(
        fs.readFileSync(filename, 'utf8')
    );
}

module.exports = {
    parseCSV,
    buildIndex,
    lookup,
    loadIndex,
    getProductType,
    extractBrandCandidate
};