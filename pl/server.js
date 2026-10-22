const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const csv = require('csv-parser');
const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cors = require('cors');
require('dotenv').config({quiet:true});
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}) : null;
const storageJSON = require('./storage.cjs');
storageJSON.recover();

// Setup Middleware
app.disable('x-powered-by');
app.use(express.json({limit:'15mb'}));
app.use('/pl', express.static(path.join(__dirname, 'public')));

// Ensure Uploads Directory Exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const documentsFile = path.join(uploadDir, 'documents.json');
if (!fs.existsSync(documentsFile)) {
    fs.writeFileSync(documentsFile, '[]', 'utf8');
}

function readDocuments() { return storageJSON.readArray(documentsFile); }
function writeDocuments(documents) { storageJSON.writeBundle([{file:documentsFile,value:documents}]); }
const sampleDir = path.join(__dirname, 'sample-data');
if (!fs.existsSync(sampleDir)) fs.mkdirSync(sampleDir, {recursive:true});

// BOM Database
const bomFile = path.join(sampleDir, 'Project01 - Ex.BOM.csv');

// ฐานข้อมูล BOM ใหม่ สำหรับค้นหาทั้ง BOM หลักและ Component
const newBomFile = path.join(sampleDir, 'database.csv');

// โมดูลค้นหา BOM แบบใหม่
const {
    loadIndex,
    lookup
} = require('./bom-lookup');

// เก็บดัชนี BOM ใหม่ไว้ในหน่วยความจำ
let newBomIndex = null;
let bomDatabase = [];

function loadBomDatabase() {
    return new Promise((resolve, reject) => {
        bomDatabase = [];

        if (!fs.existsSync(bomFile)) {
            console.log('BOM file not found:', bomFile);
            resolve([]);
            return;
        }

        fs.createReadStream(bomFile)
            .pipe(csv())
            .on('data', (row) => {
                bomDatabase.push(row);
            })
            .on('end', () => {
                console.log(`BOM Database Loaded: ${bomDatabase.length} records`);

                resolve(bomDatabase);
            })
            .on('error', reject);
    });
}
// =====================================================
// NEW BOM DATABASE - Direct BOM + Component Lookup
// =====================================================

function loadNewBomDatabase() {
    try {
        if (!fs.existsSync(newBomFile)) {
            console.log('New BOM file not found:', newBomFile);
            return false;
        }

        newBomIndex = loadIndex(newBomFile);

        console.log('========== NEW BOM DATABASE ==========');
        console.log('BOMs:', newBomIndex.boms.size);
        console.log('Component Codes:', newBomIndex.components.size);
        console.log('======================================');

        return true;

    } catch (error) {
        console.error('Failed to load new BOM database:', error.message);
        newBomIndex = null;
        return false;
    }
}
loadNewBomDatabase();
// =====================================================
// Find BOM by SAP NO. / Product ID
// =====================================================

function findBomBySapNo(sapNo) {

    const target = String(sapNo || '').trim();
    const normalizeBomReference = value => String(value || '').trim().replace(/-1$/, '');

    const record = bomDatabase.find(row => {
        const productId = String(row['Product ID'] || '').trim();
        return productId === target || normalizeBomReference(productId) === target;
    }) || bomDatabase.find(row =>
        normalizeBomReference(row['BoM ID']) === target
    );
    // ไม่พบ BOM
    if (!record) {
        return {
            found: false,
            brand: '',
            bomId: '',
            productDescription: ''
        };
    }

    // อ่าน Product Description
    const productDescription = String(
        record['Product Description'] || ''
    ).trim();

    // Brand = ข้อความก่อน comma "," ตัวแรก
    const brand = productDescription
        .split(',')[0]
        .trim();

    // หา Column "BoM ID" โดยทำความสะอาดอักขระแฝงก่อน
const bomIdKey = Object.keys(record).find(key => {

    const cleanKey = String(key)
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    return cleanKey === 'bom id';
});

const bomId = bomIdKey
    ? String(record[bomIdKey] || '').trim()
    : '';
console.log('CLEAN BOM ID KEY:', bomIdKey);
console.log('FINAL BOM ID:', bomId);
return {
    found: true,
    brand: brand,
    bomId: bomId,
    productDescription: productDescription
};
}//


// =====================================================
// PHASE 4 - PRODUCTION MODEL DATABASE
// =====================================================

const productionModelFile = path.join(
    sampleDir,
    'Project01 - Ex.Production Model.csv'
);

let productionModelDatabase = [];

function loadProductionModelDatabase() {

    return new Promise((resolve, reject) => {

        productionModelDatabase = [];

        if (!fs.existsSync(productionModelFile)) {

            console.log(
                'Production Model file not found:',
                productionModelFile
            );

            resolve([]);
            return;
        }

        fs.createReadStream(productionModelFile)
            .pipe(csv())

            .on('data', (row) => {
                productionModelDatabase.push(row);
            })

            .on('end', () => {
                console.log(
                    `Production Model Database Loaded: ${productionModelDatabase.length} records`
                );

                resolve(productionModelDatabase);
            })

            .on('error', reject);
    });
}


function findProductionModelsBySapNo(sapNo) {

    const normalizeProductId = value =>
        String(value || '')
            .trim()
            .replace(/-1$/, '');

    const target = normalizeProductId(sapNo);

    const records = productionModelDatabase.filter(row => {
        const productId = normalizeProductId(row['Product ID']);

        return productId === target;
    });

    return records.map(row => ({
        productionModelId:
            String(row['Production Model ID'] || '').trim(),

        productionModelDescription:
            String(row['Production Model Description'] || '').trim()
    }));
}
// =====================================================
// PHASE 5 - SAP MEMORY / CACHE
// =====================================================

const sapMemoryFile = path.join(
    sampleDir,
    'sap-memory.json'
);

// อ่านข้อมูล Memory ทั้งหมด
function readSapMemory() { return storageJSON.readArray(sapMemoryFile); }
function writeSapMemory(memoryData) { storageJSON.writeBundle([{file:sapMemoryFile,value:memoryData}]); }

// ค้นหา SAP NO. ที่เคยบันทึกไว้
function findSapMemory(sapNo) {

    const target = String(sapNo || '').trim();

    const memoryData = readSapMemory();

    return memoryData.find(item =>
        String(item.sapNo || '').trim() === target
    ) || null;
}


// เพิ่มข้อมูลใหม่ หรืออัปเดตข้อมูลเดิม
function saveSapMemory(memoryItem, memoryData = readSapMemory(), persist = true) {

    const target = String(
        memoryItem.sapNo || ''
    ).trim();

    const existingIndex = memoryData.findIndex(item =>
        String(item.sapNo || '').trim() === target
    );

    const existingItem = existingIndex >= 0 ? memoryData[existingIndex] : null;
    const isManualEntry = memoryItem.source === 'MANUAL' && memoryItem.verified === true;

    if (existingItem && existingItem.source === 'MANUAL' && existingItem.verified === true && !isManualEntry) {
        return existingItem;
    }

    const timestamp = new Date().toISOString();

    const bomIds = [
    ...new Set(
        [
            ...(Array.isArray(memoryItem.bomIds)
                ? memoryItem.bomIds
                : []),
            memoryItem.bomId
        ]
            .map(id => String(id || '').trim())
            .filter(Boolean)
    )
];

const newItem = {
    ...memoryItem,
    sapNo: target,

    // เก็บ BOM ID เดิมไว้เพื่อรองรับระบบเก่า
    bomId: String(memoryItem.bomId || '').trim(),

    // เพิ่มรายการ BOM ID ทั้งหมดที่เกี่ยวข้อง
    bomIds: bomIds,

    lastChecked: timestamp,
    updatedAt: timestamp
};

    if (existingIndex >= 0) {

        // SAP NO. นี้เคยมีแล้ว → Update
        memoryData[existingIndex] = newItem;

    } else {

        // SAP NO. ใหม่ → เพิ่มเข้า Memory
        memoryData.push(newItem);
    }

    if (persist) writeSapMemory(memoryData);

    return newItem;
}
// Multer Setup for Handling File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}.pdf`);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
        cb(null, true);
    } else {
        cb(new Error('INVALID_FILE_TYPE'), false);
    }
};

const upload = multer({ storage, fileFilter, limits:{fileSize:10*1024*1024,files:1} });

// Helper: Generate Document ID (PL-YYYYMMDD-XXXX)
let docCounter = 1;
function generateDocumentId() {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PL-${dateStr}-`;
    const existingIds = readDocuments()
        .map(document => document.metadata && document.metadata.documentId)
        .filter(documentId => documentId && documentId.startsWith(prefix));
    const highestSequence = existingIds.reduce((highest, documentId) => {
        const sequence = Number(documentId.slice(prefix.length));
        return Number.isFinite(sequence) ? Math.max(highest, sequence) : highest;
    }, 0);
    let sequence = Math.max(docCounter, highestSequence + 1);
    let documentId = `${prefix}${String(sequence).padStart(4, '0')}`;

    while (existingIds.includes(documentId)) {
        sequence = docCounter++;
        documentId = `${prefix}${String(sequence).padStart(4, '0')}`;
    }

    docCounter = sequence + 1;
    return documentId;
}

async function renderPageWithCoordinates(pageData) {
    const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: true
    });

    return JSON.stringify(textContent.items.map(item => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width
    })));
}

function parsePackingListCoordinatesFixed(pageText) {
    const pages = pageText.split(/\n\s*\n/).map(page => {
        try {
            return JSON.parse(page);
        } catch (error) {
            return [];
        }
    });
    const items = [];

    pages.forEach(pageItems => {
        const rows = [];
        pageItems.forEach(textItem => {
            if (!textItem.str || !textItem.str.trim()) return;
            let row = rows.find(candidate => Math.abs(candidate.y - textItem.y) < 0.8);
            if (!row) {
                row = { y: textItem.y, cells: [] };
                rows.push(row);
            }
            row.cells.push(textItem);
        });

        rows.sort((left, right) => right.y - left.y).forEach(row => {
            const columns = {
                itemNo: [],
                piNo: [],
                sapPo: [],
                sapNo: [],
                description: [],
                totalQty: [],
                qtyPcs: [],
                qtyCtns: [],
                nw: [],
                gw: [],
                meas: []
            };
            row.cells.forEach(cell => {
    const column = cell.x < 75 ? 'itemNo'
        : cell.x < 145 ? 'piNo'
        : cell.x < 180 ? 'sapPo'
        : cell.x < 215 ? 'sapNo'
        : cell.x < 380 ? 'description'
        : cell.x < 415 ? 'totalQty'
        : cell.x < 445 ? 'qtyPcs'
        : cell.x < 475 ? 'qtyCtns'
        : cell.x < 510 ? 'nw'
        : cell.x < 545 ? 'gw'
        : 'meas';

    columns[column].push(cell);
});

            const joinColumn = column => columns[column].sort((left, right) => left.x - right.x).map(cell => cell.str).join(' ').trim();
            const sapNo = joinColumn('sapNo').match(/\b\d{7,8}\b/);

// Description ที่อยู่ในแถวหลัก
let description = joinColumn('description');

// ถ้ามี SAP NO. แต่ Description ไม่ได้อยู่ y เดียวกัน
// ให้หา Description หลายบรรทัดที่อยู่ใกล้แถว SAP
if (sapNo && !description) {

    const nearbyDescriptionCells = pageItems.filter(cell => {
        if (!cell.str || !cell.str.trim()) return false;

        // ต้องอยู่ในพื้นที่คอลัมน์ Description เท่านั้น
        const isDescriptionColumn =
            cell.x >= 215 && cell.x < 380;

        // รองรับ Description ที่อยู่เหนือ/ใต้ SAP row
        const isNearSapRow =
            Math.abs(cell.y - row.y) <= 5;

        return isDescriptionColumn && isNearSapRow;
    });

    description = nearbyDescriptionCells
        .sort((a, b) => {
            // อ่านจากบรรทัดบนลงล่าง
            if (Math.abs(a.y - b.y) > 0.8) {
                return b.y - a.y;
            }

            // ถ้าอยู่บรรทัดเดียวกัน อ่านซ้ายไปขวา
            return a.x - b.x;
        })
        .map(cell => cell.str.trim())
        .filter(Boolean)
        .join(' ')
        .trim();
}

const totalQty = joinColumn('totalQty');
            if (!sapNo || !description) return;

            const item = {
                id: items.length + 1,
                sapPo: joinColumn('sapPo').replace(/\s+/g, ''),
                sapNo: sapNo[0],
                description,
                totalQty: totalQty.replace(/\s+/g, '').replace(/,/g, ''),
                qtyPcs: joinColumn('qtyPcs').replace(/\s+/g, '').replace(/,/g, ''),
                qtyCtns: joinColumn('qtyCtns').replace(/\s+/g, '').replace(/,/g, ''),
                nw: joinColumn('nw').replace(/\s+/g, '').replace(/,/g, ''),
                gw: joinColumn('gw').replace(/\s+/g, '').replace(/,/g, ''),
                meas: joinColumn('meas').replace(/\s+/g, '').replace(/,/g, ''),
                status: totalQty ? 'COMPLETE' : 'INCOMPLETE',
                editedByUser: false
            };
            items.push(item);
        });
    });

    return items;
}

function groupCoordinateRows(pageItems) {
    const rows = [];
    pageItems.forEach(textItem => {
        if (!textItem.str || !textItem.str.trim()) return;
        let row = rows.find(candidate => Math.abs(candidate.y - textItem.y) < 0.8);
        if (!row) {
            row = { y: textItem.y, cells: [] };
            rows.push(row);
        }
        row.cells.push(textItem);
    });
    return rows.sort((left, right) => right.y - left.y);
}

function detectPackingListHeader(rows) {
    const definitions = [
        { name: 'itemNo', aliases: ['ITEMNO'] },
        { name: 'piNo', aliases: ['PINO', 'PLNO'] },
        { name: 'sapPo', aliases: ['SAPPO'] },
        { name: 'sapNo', aliases: ['SAPNO'] },
        { name: 'description', aliases: ['DESCRIPTION'] },
        { name: 'totalQty', aliases: ['TOTALQTYPCS', 'TOTALQTY'] },
        { name: 'qtyPcs', aliases: ['QTYPCS'] },
        { name: 'qtyCtns', aliases: ['QTYCTNS'] },
        { name: 'nw', aliases: ['NW'] },
        { name: 'gw', aliases: ['GW'] },
        { name: 'meas', aliases: ['MEAS'] }
    ];

    for (const row of rows) {
        const headerBandCells = rows
            .filter(candidate => Math.abs(candidate.y - row.y) <= 3)
            .flatMap(candidate => candidate.cells)
            .sort((left, right) => left.x - right.x);
        let normalizedText = '';
        const characterPositions = [];

        headerBandCells.forEach(cell => {
            const normalizedCell = String(cell.str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            for (const character of normalizedCell) {
                normalizedText += character;
                characterPositions.push(Number(cell.x || 0));
            }
        });

        const candidates = [];
        definitions.forEach(definition => {
            for (const alias of definition.aliases) {
                let start = normalizedText.indexOf(alias);
                while (start >= 0) {
                    candidates.push({ start, end: start + alias.length, length: alias.length, name: definition.name });
                    start = normalizedText.indexOf(alias, start + 1);
                }
            }
        });

        candidates.sort((left, right) => left.start - right.start || right.length - left.length);
        const accepted = [];
        candidates.forEach(candidate => {
            if (accepted.some(existing => candidate.start < existing.end && candidate.end > existing.start)) return;
            accepted.push(candidate);
        });

        const columns = {};
        accepted.forEach(candidate => {
            const positions = characterPositions.slice(candidate.start, candidate.end);
            if (!positions.length) return;
            columns[candidate.name] = (Math.min(...positions) + Math.max(...positions)) / 2;
        });

        if (columns.sapNo !== undefined && columns.description !== undefined && accepted.length >= 4) {
            return { row, columns, headerBandCells };
        }
    }

    return null;
}

function parsePackingListDynamicPage(rows, header) {
    const orderedColumns = Object.entries(header.columns)
        .map(([name, x]) => ({ name, x }))
        .sort((left, right) => left.x - right.x);
    const items = [];

    rows.forEach(row => {
        if (row.y >= header.row.y - 0.8) return;

        const columnCells = Object.fromEntries(orderedColumns.map(column => [column.name, []]));
        row.cells.slice().sort((left, right) => left.x - right.x).forEach(cell => {
            const cellCenter = Number(cell.x || 0) + (Number(cell.width) || 0) / 2;
            let columnIndex = orderedColumns.findIndex((column, index) => {
                if (index === orderedColumns.length - 1) return true;
                const boundary = (column.x + orderedColumns[index + 1].x) / 2;
                return cellCenter < boundary;
            });
            if (columnIndex < 0) columnIndex = orderedColumns.length - 1;
            columnCells[orderedColumns[columnIndex].name].push(cell);
        });

        const joinColumn = (name, compact = false) => {
            const value = (columnCells[name] || [])
                .sort((left, right) => left.x - right.x)
                .map(cell => String(cell.str || '').trim())
                .filter(Boolean)
                .join(compact ? '' : ' ')
                .trim();
            return compact ? value.replace(/[\s,]/g, '') : value.replace(/\s+/g, ' ');
        };
const rowText = row.cells
    .map(cell => String(cell.str || '').trim())
    .join(' ');

        const sapNoMatch = joinColumn('sapNo', true).match(/\d{7,8}/);

let description = joinColumn('description');
// กู้ข้อความ Description ที่ PDF วางชิด SAP NO.
// โดยไม่เปลี่ยนกฎหลักของ Parser
if (sapNoMatch) {
    const sapColumnCells = (columnCells.sapNo || [])
        .slice()
        .sort((a, b) => a.x - b.x);

    // กรณีปกติ เช่น:
    // 2220045 | LUNA
    // SAP NO. เป็น cell ของตัวเอง และ LUNA หลุดเข้าคอลัมน์ SAP NO.
    const exactSapCellIndex = sapColumnCells.findIndex(cell =>
        /^\d{7,8}$/.test(String(cell.str || '').trim())
    );

    if (exactSapCellIndex >= 0) {
        const exactSapNo = String(
            sapColumnCells[exactSapCellIndex].str || ''
        ).trim();

        // ใช้ SAP NO. จาก cell จริง
        sapNoMatch[0] = exactSapNo;

        // ทุก cell หลัง SAP NO. ที่หลุดเข้าคอลัมน์นี้
        // ถือเป็นข้อความต้นของ Description
        const misplacedDescription = sapColumnCells
            .slice(exactSapCellIndex + 1)
            .map(cell => String(cell.str || '').trim())
            .filter(Boolean)
            .join('');

        if (misplacedDescription) {
            description = `${misplacedDescription} ${description}`
                .replace(/\s+/g, ' ')
                .trim();
        }
    }
}
if (sapNoMatch && !description) {

    const descriptionIndex = orderedColumns.findIndex(
        column => column.name === 'description'
    );

    if (descriptionIndex >= 0) {

        const descriptionColumn = orderedColumns[descriptionIndex];

        const leftBoundary =
            descriptionIndex === 0
                ? -Infinity
                : (
                    orderedColumns[descriptionIndex - 1].x +
                    descriptionColumn.x
                ) / 2;

        const rightBoundary =
            descriptionIndex === orderedColumns.length - 1
                ? Infinity
                : (
                    descriptionColumn.x +
                    orderedColumns[descriptionIndex + 1].x
                ) / 2;

        const nearbyDescriptionCells = rows
            .filter(candidate =>
                candidate !== row &&
                Math.abs(candidate.y - row.y) <= 5
            )
            .flatMap(candidate => candidate.cells)
            .filter(cell => {
                const cellCenter =
                    Number(cell.x || 0) +
                    (Number(cell.width) || 0) / 2;

                return (
                    cellCenter >= leftBoundary &&
                    cellCenter < rightBoundary &&
                    String(cell.str || '').trim()
                );
            })
            .sort((a, b) => {
                if (Math.abs(a.y - b.y) > 0.8) {
                    return b.y - a.y;
                }

                return a.x - b.x;
            })
            .map(cell => String(cell.str || '').trim())
            .filter(Boolean);

        description = nearbyDescriptionCells
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
        if (row.cells.some(cell => String(cell.str).includes('2220037'))) {
    console.log('===== DEBUG 2220037 =====');
    console.log('SAP NO COLUMN:', joinColumn('sapNo', true));
    console.log('DESCRIPTION:', description);
    console.log('SAP MATCH:', sapNoMatch);
    console.log('=========================');
}
        if (!sapNoMatch || !description) return;

        const totalQty = joinColumn('totalQty', true).replace(/,/g, '');
        items.push({
            id: 0,
            sapPo: joinColumn('sapPo', true),
            sapNo: sapNoMatch[0],
            description,
            totalQty,
            qtyPcs: joinColumn('qtyPcs', true),
            qtyCtns: joinColumn('qtyCtns', true),
            nw: joinColumn('nw', true),
            gw: joinColumn('gw', true),
            meas: joinColumn('meas', true),
            status: totalQty ? 'COMPLETE' : 'INCOMPLETE',
            editedByUser: false
        });
    });

    return items;
}

function parsePackingListCoordinates(pageText) {
    const pages = pageText.split(/\n\s*\n/).map(page => {
        try {
            return JSON.parse(page);
        } catch (error) {
            return [];
        }
    });
    const items = [];

    pages.forEach(pageItems => {
        const rows = groupCoordinateRows(pageItems);
        const header = detectPackingListHeader(rows);
        const pageRows = header
            ? parsePackingListDynamicPage(rows, header)
            : parsePackingListCoordinatesFixed(JSON.stringify(pageItems));
        items.push(...pageRows);
    });

    items.forEach((item, index) => {
        item.id = index + 1;
    });
    return items;
}

// Advanced Parsing Engine for Packing Lists
function parsePackingListText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const items = [];
    let lastItem = null;
    let pendingItem = null;

    const ignoreKeywords = [
        'INVOICE', 'PACKING LIST', 'SHIP TO', 'SOLD TO', 'PAGE', 'TOTAL', 
        'DESCRIPTION', 'QUANTITY', 'WEIGHT', 'MEASUREMENT', 'ATTN:', 'TEL:', 
        'FAX:', 'REMARK', 'DOKMAI', 'PRAVEJ', 'BANGKOK', 'SECTION', 'SOI',
        'HANGZHOU', 'ROOM ', 'COMETS INTERTRADE', 'SHIPPING MARK',
        'COUNTRY OF ORIGIN', 'TOTAL SHIPPED', 'DATE :', 'TO :'
    ];

    lines.forEach((line) => {
        const upper = line.toUpperCase();
        const isHeader = ignoreKeywords.some(kw => upper === kw || upper.startsWith(`${kw} `));
        if (isHeader) return;

        const sapNoMatches = [...line.matchAll(/\b\d{7,8}\b/g)];
        const sapNoMatch = sapNoMatches.length ? sapNoMatches[sapNoMatches.length - 1] : null;
        const numericOnlyTokens = /^[\d,\.\s]+$/.test(line);

        if (pendingItem && sapNoMatch && line === sapNoMatch[0]) {
            pendingItem.sapNo = sapNoMatch[0];
            return;
        }

        if (!sapNoMatch) {
            if (pendingItem && !numericOnlyTokens) {
                pendingItem.description = line;
                return;
            }
            if (lastItem && numericOnlyTokens) {
                const continuationValues = splitDescriptionAndValues(line).values;
                if (pendingItem && continuationValues.length) {
                    addPackingItem({ ...pendingItem, valueValues: continuationValues });
                    pendingItem = null;
                } else if (!lastItem.totalQty && continuationValues.length) {
                    applyValues(lastItem, continuationValues);
                } else {
                    addPackingItem({
                        sapPo: lastItem.sapPo,
                        sapNo: lastItem.sapNo,
                        description: lastItem.description,
                        valueValues: continuationValues
                    });
                }
            }
            return;
        }

        const sapNo = sapNoMatch[0];
        const prefix = line.slice(0, sapNoMatch.index).trim();
        const suffix = line.slice(sapNoMatch.index + sapNo.length).trim();

        if (sapNoMatch.index === 0 && sapNoMatches.length === 1 && suffix && /[A-Za-z]/.test(suffix)) {
            pendingItem = { sapPo: '', sapNo: '' };
            return;
        }

        const poMatches = prefix.match(/\d{4}/g) || [];
        const sapPo = poMatches.length ? poMatches[poMatches.length - 1] : '';
        const { description, values } = splitDescriptionAndValues(suffix);
        if (!description) {
            pendingItem = { sapPo, sapNo };
            return;
        }
        addPackingItem({ sapPo, sapNo, description, valueValues: values });
    });

    function splitDescriptionAndValues(valueText) {
        let remaining = valueText.trim();
        const decimalValues = [];

        if (/^[\d,\.\s]+$/.test(remaining)) {
            return { description: '', values: splitNumericValues(remaining) };
        }

        const strictTableMatch = remaining.match(/^(\d{1,3}(?:,\d{3})+?)([\d,]+?)(\d+?)(\d+\.\d{2})(\d+\.\d{2})(\d+\.\d{3})$/);

        if (strictTableMatch) {
            return {
                description: '',
                values: strictTableMatch.slice(1).map(value => value.replace(/,/g, ''))
            };
        }

        const compactDecimalMatch = remaining.match(/(\d+\.\d{2})(\d+\.\d{2})(\d+\.\d{3})$/);

        if (compactDecimalMatch) {
            decimalValues.push(compactDecimalMatch[1], compactDecimalMatch[2], compactDecimalMatch[3]);
            remaining = remaining.slice(0, compactDecimalMatch.index).trim();
        }

        const decimalPatterns = [/\d+\.\d{3}\s*$/, /\d+\.\d{2}\s*$/, /\d+\.\d{2}\s*$/];

        if (!compactDecimalMatch) {
            decimalPatterns.forEach(pattern => {
                const match = remaining.match(pattern);
                if (match) {
                    decimalValues.unshift(match[0].trim());
                    remaining = remaining.slice(0, match.index).trim();
                }
            });
        }

        const integerMatch = remaining.match(/(\d[\d,]*)$/);
        if (!integerMatch) return { description: remaining, values: decimalValues };

        const integerText = integerMatch[1].trim();
        const description = remaining.slice(0, integerMatch.index).trim();
        let integerValues = integerText.split(/\s+/);

        if (integerValues.length === 1 && integerValues[0].includes(',')) {
            const compact = integerValues[0];
            const totalMatch = compact.match(/^\d{1,3}(?:,\d{3})+/);
            if (totalMatch) {
                const total = totalMatch[0];
                const remainder = compact.slice(total.length);
                const candidates = [];
                for (let ctnLength = 1; ctnLength <= 3 && ctnLength < remainder.length; ctnLength += 1) {
                    const ctns = remainder.slice(-ctnLength);
                    const pcs = remainder.slice(0, -ctnLength);
                    candidates.push({ pcs, ctns, score: Number(pcs) === Number(total.replace(/,/g, '')) ? 100 : -pcs.length });
                }
                if (candidates.length) {
                    candidates.sort((left, right) => right.score - left.score);
                    integerValues = [total, candidates[0].pcs, candidates[0].ctns];
                }
            }
        } else if (integerValues.length === 1) {
            const compact = integerValues[0];
            const candidates = [];
            for (let ctnLength = 1; ctnLength <= 3 && ctnLength < compact.length; ctnLength += 1) {
                const ctns = compact.slice(-ctnLength);
                const beforeCtns = compact.slice(0, -ctnLength);
                for (let pcsLength = 1; pcsLength <= 5 && pcsLength < beforeCtns.length; pcsLength += 1) {
                    const pcs = beforeCtns.slice(-pcsLength);
                    const total = beforeCtns.slice(0, -pcsLength);
                    if (Number(total) >= Number(pcs)) {
                        candidates.push({ total, pcs, ctns, score: Number(total) === Number(pcs) ? 10 : total.length - pcs.length });
                    }
                }
            }
            if (candidates.length) {
                candidates.sort((left, right) => right.score - left.score);
                integerValues = [candidates[0].total, candidates[0].pcs, candidates[0].ctns];
            }
        }

        return { description, values: integerValues.concat(decimalValues) };
    }

    function splitNumericValues(valueText) {
        let remaining = valueText.replace(/\s+/g, '');
        const values = [];

        for (const decimalPlaces of [3, 2, 2]) {
            const decimalPoint = remaining.lastIndexOf('.');
            if (decimalPoint < 1 || remaining.length - decimalPoint - 1 !== decimalPlaces) return [];
            const previousDecimalPoint = remaining.lastIndexOf('.', decimalPoint - 1);
            let valueStart = previousDecimalPoint >= 0 ? previousDecimalPoint + 3 : decimalPoint - 1;
            if (previousDecimalPoint < 0) {
                while (valueStart >= 0 && /\d/.test(remaining[valueStart])) valueStart -= 1;
                valueStart += 1;
            }
            values.unshift(remaining.slice(valueStart));
            remaining = remaining.slice(0, valueStart);
        }

        if (remaining.includes(',')) {
            const totalMatch = remaining.match(/^\d{1,3}(?:,\d{3})+/);
            if (!totalMatch) return values;
            const total = totalMatch[0];
            const remainder = remaining.slice(total.length);
            const pcsMatch = remainder.match(/^\d{1,3}(?:,\d{3})+/);
            if (pcsMatch) return [total, pcsMatch[0], remainder.slice(pcsMatch[0].length)].concat(values);

            const candidates = [];
            for (let ctnLength = 1; ctnLength <= 3 && ctnLength < remainder.length; ctnLength += 1) {
                const ctns = remainder.slice(-ctnLength);
                const pcs = remainder.slice(0, -ctnLength);
                candidates.push({ pcs, ctns, score: Number(pcs) === Number(total.replace(/,/g, '')) ? 100 : -pcs.length });
            }
            candidates.sort((left, right) => right.score - left.score);
            return candidates.length ? [total, candidates[0].pcs, candidates[0].ctns].concat(values) : values;
        }

        const candidates = [];
        for (let ctnLength = 1; ctnLength <= 3 && ctnLength < remaining.length; ctnLength += 1) {
            const ctns = remaining.slice(-ctnLength);
            const beforeCtns = remaining.slice(0, -ctnLength);
            for (let pcsLength = 1; pcsLength <= 5 && pcsLength < beforeCtns.length; pcsLength += 1) {
                const pcs = beforeCtns.slice(-pcsLength);
                const total = beforeCtns.slice(0, -pcsLength);
                if (Number(total) >= Number(pcs)) {
                    candidates.push({ total, pcs, ctns, score: Number(total) === Number(pcs) ? 100 : -pcs.length });
                }
            }
        }

        candidates.sort((left, right) => right.score - left.score);
        return candidates.length ? [candidates[0].total, candidates[0].pcs, candidates[0].ctns].concat(values) : values;
    }

    function addPackingItem({ sapPo, sapNo, description, valueText, valueValues }) {
        if (!sapNo || !description) return;

        const values = valueText ? valueText.split(/\s+/) : valueValues;
        const normalizedValues = values.map(value => value.replace(/,/g, ''));
        const item = {
            id: items.length + 1,
            sapPo: sapPo || '',
            sapNo,
            description,
            totalQty: '',
            qtyPcs: '',
            qtyCtns: '',
            nw: '',
            gw: '',
            meas: '-',
            status: 'INCOMPLETE',
            editedByUser: false
        };
        applyValues(item, normalizedValues);
        items.push(item);
        lastItem = item;
    }

    function applyValues(item, values) {
        item.totalQty = values[0] || item.totalQty;
        item.qtyPcs = values[1] || item.qtyPcs;
        item.qtyCtns = values[2] || item.qtyCtns;
        item.nw = values[3] || item.nw;
        item.gw = values[4] || item.gw;
        item.meas = values[5] || item.meas;
        item.status = (item.sapPo && item.sapNo && item.description && item.totalQty) ? 'COMPLETE' : 'INCOMPLETE';
    }

    return items;
}

async function processOCR(filePath) {
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(filePath, { scale: 3.5, format: 'png' });
    const worker = await createWorker('eng', 1, {langPath:__dirname,gzip:false,cachePath:uploadDir});
    const pageTexts = [];

    try {
        await worker.setParameters({
            tessedit_pageseg_mode: '6',
            preserve_interword_spaces: '1'
        });
        for await (const page of document) {
            const result = await worker.recognize(page);
            pageTexts.push(result.data.text || '');
        }
    } finally {
        await worker.terminate();
        if (typeof document.destroy === 'function') document.destroy();
    }

    return {
        isScanned: true,
        extractedText: pageTexts.join('\n'),
        notice: 'Scanned PDF processed with OCR.'
    };
}

// ======================================================
// AI PACKING LIST READER
// หน้าที่: ส่ง Packing List PDF ให้ Gemini อ่าน
// AI อ่านเอกสารเท่านั้น ไม่หา BOM / Brand / Model
// ======================================================

async function readPackingListWithAI(filePath) {
    console.log('=================================');
    console.log('🤖 AI PACKING LIST READER');
    console.log('=================================');
    console.log('📄 File:', filePath);

    if (!fs.existsSync(filePath)) {
        throw new Error('AI_READER_FILE_NOT_FOUND');
    }

    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY_NOT_FOUND');
    }

    console.log('📤 Uploading PDF to Gemini...');

    // 1. Upload PDF
    const uploadedFile = await ai.files.upload({
        file: filePath,
        config: {
            mime_type: 'application/pdf'
        }
    });

    console.log('✅ PDF uploaded to Gemini');
    console.log('🤖 Gemini is reading Packing List...');

    // 2. Ask Gemini to extract document data
    const interaction = await ai.interactions.create({
        model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',

        input: [
            {
                type: 'text',
                text: `
You are the document reader for the PL Brand System.

Your ONLY responsibility is to read the attached Packing List
and extract information that actually appears in the document.

DO NOT determine Brand.
DO NOT search BOM.
DO NOT determine Production Model.
DO NOT guess missing information.

Extract every product/item row from the Packing List.

Return ONLY valid JSON using exactly this structure:

{
  "document": {
    "sapPO": "",
    "totalQty": "",
    "totalNW": "",
    "totalGW": "",
    "totalMeas": ""
  },
  "items": [
    {
      "sapPO": "",
      "sapNo": "",
      "description": "",
      "qtyPCS": "",
      "qtyCTNS": "",
      "nw": "",
      "gw": "",
      "meas": ""
    }
  ]
}

RULES:

1. Extract every item row visible in the Packing List.
2. SAP PO means SAP Purchase Order / PO number.
3. SAP NO means the SAP/material/product number.
4. Keep SAP PO and SAP NO as strings.
5. Never calculate or modify SAP numbers.
6. Description may span multiple lines. Combine lines belonging to the same item.
7. Preserve quantities and measurements as shown in the document.
8. If a field is not present or cannot be read confidently, return "".
9. Never infer a missing value from another item.
10. Do not remove duplicate rows if they really exist in the document.
11. Do not create rows that are not present in the document.
12. Do not return Brand.
13. Do not return BOM.
14. Do not return Production Model.
15. Return JSON only. Do not include Markdown code fences or explanations.
`
            },
            {
                type: 'document',
                uri: uploadedFile.uri,
                mime_type: uploadedFile.mime_type
            }
        ]
    });

    console.log('✅ Gemini finished reading Packing List');

    // 3. Get AI response
    let aiText = interaction.output_text;

    if (!aiText) {
        throw new Error('AI_READER_EMPTY_RESPONSE');
    }

    // เผื่อ AI ส่ง ```json ... ``` กลับมา
    aiText = aiText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    // 4. Convert JSON text into JavaScript object
    let parsedData;

    try {
        parsedData = JSON.parse(aiText);
    } catch (error) {
        console.error('❌ AI RAW RESPONSE:');
        console.error(aiText);

        throw new Error('AI_READER_INVALID_JSON');
    }

    // 5. Basic validation
    if (!parsedData || !Array.isArray(parsedData.items)) {
        throw new Error('AI_READER_INVALID_STRUCTURE');
    }

    console.log(`📦 AI extracted ${parsedData.items.length} item(s)`);

    return parsedData;
}
async function extractBuffer(buffer, filename = 'document.pdf') {
    if (!buffer.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw Object.assign(Error('ไฟล์ไม่ใช่ PDF ที่ถูกต้อง'),{status:400});
    let pdfData;
    try { pdfData = await pdfParse(buffer, {pagerender:renderPageWithCoordinates}); }
    catch (e) { throw Object.assign(Error('อ่าน PDF ไม่ได้ ไฟล์อาจเสียหรือมีรหัสผ่าน'),{status:400}); }
    if (pdfData.numpages > 50) throw Object.assign(Error('PDF ต้องไม่เกิน 50 หน้า'),{status:400});
    const rawText = String(pdfData.text || '').trim();
    const items = rawText ? parsePackingListCoordinates(rawText) : [];
    let plainText = rawText;
    try { plainText = JSON.parse('[' + rawText.trim().replace(/\]\s*\[/g, '],[') + ']').flat().map(c=>c.str || '').join(' '); } catch (_) {}
    const invoice = plainText.match(/\bINV\d{2,4}[-_][A-Z0-9-]+/i)?.[0] || filename.match(/\bINV\d{2,4}[-_][A-Z0-9-]+/i)?.[0] || '';
    return {pdfData, items, rawText, invoice};
}

app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, async err => {
        if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({success:false,message:err.code === 'LIMIT_FILE_SIZE' ? 'PDF ใหญ่เกิน 10 MB' : 'รองรับเฉพาะ PDF หนึ่งไฟล์'});
        if (!req.file) return res.status(400).json({success:false,message:'กรุณาเลือก PDF'});
        const filePath = req.file.path;
        try {
            const buffer = fs.readFileSync(filePath);
            if (!buffer.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw Object.assign(Error('ไฟล์ไม่ใช่ PDF ที่ถูกต้อง'),{status:400});
            const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
            const saved = readDocuments().find(d=>d.metadata?.confirmedTimestamp && d.metadata.fileHash===fileHash);
            if (saved && req.body.forceRecheck !== 'true') {
                fs.unlinkSync(filePath);
                return res.json({success:true,reusedSavedDocument:true,metadata:saved.metadata,items:saved.items});
            }
            const result = await extractBuffer(buffer, req.file.originalname);
            let items = result.items, processType = 'TEXT_BASED';
            // Existing Gemini reader is optional. Local is the default and falls back to local OCR.
            if (process.env.PL_READER === 'ai' && ai) {
                try {
                    const data = await readPackingListWithAI(filePath);
                    items = data.items.map((v,i)=>({...v,id:i+1,sapPo:String(v.sapPO||v.sapPo||''),sapNo:String(v.sapNo||''),description:String(v.description||''),totalQty:v.totalQty||'',qtyPcs:v.qtyPCS||v.qtyPcs||'',qtyCtns:v.qtyCTNS||v.qtyCtns||'',status:'COMPLETE'}));
                    processType = 'AI';
                } catch (e) { console.warn('AI reader failed; using local reader:',e.message); }
            }
            if (!items.length) {
                const ocr = await processOCR(filePath);
                items = parsePackingListText(ocr.extractedText);processType='OCR';
            }
            if (!items.length) throw Object.assign(Error('ยังอ่านรายการใน PDF นี้ไม่ได้ กรุณาใช้ Text PDF หรือตรวจภาพสแกนให้ชัดเจน'),{status:422});
            const originalName = repairOriginalName(req.file.originalname);
            return res.json({success:true,metadata:{documentId:generateDocumentId(),fileHash,originalName,invoiceNo:result.invoice,uploadTimestamp:new Date().toISOString(),fileSize:(req.file.size/1024).toFixed(2)+' KB',pageCount:result.pdfData.numpages,mimeType:'application/pdf',storedFileName:req.file.filename,processType,processingStatus:'PROCESSED'},items});
        } catch(e) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            console.error('PDF extraction:',e.message);
            return res.status(e.status||500).json({success:false,message:e.status?e.message:'อ่าน PDF ไม่สำเร็จ กรุณาตรวจ Terminal และลองใหม่'});
        }
    });
});
function repairOriginalName(name) {
    try { const decoded=Buffer.from(name,'latin1').toString('utf8');return decoded.includes('�')?name:decoded; } catch (_) { return name; }
}

app.get('/api/documents/latest', (req, res) => {
    const documents = readDocuments();
    return res.json({ success: true, document: documents[documents.length - 1] || null });
});

app.get('/api/documents', (req, res) => {
    const documents = readDocuments().map(document => document.metadata);
    return res.json({ success: true, documents });
});

app.get('/api/documents/export', (req, res) => {
    return res.json({ success: true, documents: readDocuments() });
});

app.get('/api/documents/:documentId', (req, res) => {
    const document = readDocuments().find(item => item.metadata.documentId === req.params.documentId);
    if (!document) {
        return res.status(404).json({ success: false, message: 'ไม่พบเอกสารที่ต้องการ' });
    }
    return res.json({ success: true, document });
});

// Print PDF: use confirmed document data only; never recompute Brand.
app.get('/api/documents/:documentId/print', async (req,res,next)=>{
    try {
        const saved=readDocuments().find(d=>d.metadata.documentId===req.params.documentId);
        if(!saved?.metadata.confirmedTimestamp)return res.status(404).json({success:false,message:'กรุณายืนยันเอกสารก่อน Print'});
        const file=path.join(uploadDir,path.basename(saved.metadata.storedFileName||''));
        if(!fs.existsSync(file))return res.status(404).json({success:false,message:'ไม่พบ PDF ต้นฉบับ'});
        const {createPrint}=await import('../print.mjs');
        const bytes=await createPrint(file,saved.items);
        res.type('pdf').set('Content-Disposition',`inline; filename="PL-Print-${saved.metadata.documentId}.pdf"`).send(bytes);
    }catch(e){console.error('Print:',e.message);res.status(e.status||500).json({success:false,message:e.status?e.message:'สร้าง Print PDF ไม่สำเร็จ กรุณาตรวจ Terminal',error:e.status?e.message:'สร้าง Print PDF ไม่สำเร็จ'});}
});

app.get('/api/documents/:documentId/file', (req, res) => {
    const document = readDocuments().find(item => item.metadata.documentId === req.params.documentId);
    if (!document) {
        return res.status(404).json({ success: false, message: 'ไม่พบเอกสารที่ต้องการ' });
    }

    let storedFileName = document.metadata.storedFileName
        ? path.basename(document.metadata.storedFileName)
        : '';
    let filePath = storedFileName ? path.join(uploadDir, storedFileName) : '';

    if (!filePath || !fs.existsSync(filePath)) {
        const originalName = path.basename(document.metadata.originalName || '');
        const fallbackName = fs.readdirSync(uploadDir).find(fileName => fileName.endsWith(`-${originalName}`));
        storedFileName = fallbackName || '';
        filePath = storedFileName ? path.join(uploadDir, storedFileName) : '';
    }

    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'ไม่พบไฟล์ PDF ของเอกสารนี้' });
    }

    return res.sendFile(filePath);
});

app.post('/api/documents', (req, res) => {
    const { metadata, items } = req.body;

    if (!metadata || !/^PL-[A-Za-z0-9-]+$/.test(metadata.documentId || '') || !Array.isArray(items) || !items.length || items.some(i=>!i || !String(i.description||'').trim())) {
        return res.status(400).json({ success: false, message: 'ข้อมูลเอกสารไม่ครบถ้วน' });
    }

    if (req.body.reviewed !== true || items.some(i=>i.reviewed !== true)) {
        return res.status(400).json({success:false,message:'กรุณาตรวจและทำเครื่องหมายให้ครบทุกรายการก่อนยืนยัน'});
    }
    const document = {
        metadata: { ...metadata, confirmedTimestamp: metadata.confirmedTimestamp || new Date().toISOString(), updatedAt: new Date().toISOString() },
        items
    };
    const documents = readDocuments();
    const existingIndex = documents.findIndex(item => item.metadata.documentId === metadata.documentId);

    if (existingIndex >= 0) {
        documents[existingIndex] = document;
    } else {
        documents.push(document);
    }

    try {
        // Confirmation and memory are saved by the same server request.
        const memoryData = readSapMemory();
        const seen = new Set();
        for (const item of items) {
            const sapNo = String(item.sapNo || '').trim();
            if (!sapNo || seen.has(sapNo)) continue;
            const same=items.filter(i=>String(i.sapNo||'').trim()===sapNo);
            if(new Set(same.map(i=>String(i.brand||'').trim())).size>1 || same.some(i=>['CONFLICT','UNRESOLVED'].includes(i.brandSource)))continue;
            seen.add(sapNo);
            // ค้นหา BOM ทั้งหมดที่เกี่ยวข้องกับ SAP NO.
const bomLookupResult = newBomIndex
    ? lookup(newBomIndex, sapNo)
    : null;

// เก็บ BOM ID ทุกตัว โดยไม่ให้มีข้อมูลซ้ำ
const bomIds = [
    ...new Set(
        [
            ...(Array.isArray(item.bomIds) ? item.bomIds : []),
            ...(bomLookupResult
                ? bomLookupResult.matches.map(match => match.bomId)
                : [])
        ]
            .map(id => String(id || '').trim())
            .filter(Boolean)
    )
];
            saveSapMemory({
                sapNo, sapPo: String(item.sapPo || '').trim(),
                bomFound: item.bomFound === true,
                bomId: String(item.bomId || '').trim(),
                bomIds: bomIds,
                brand: String(item.brand || '').trim(),
                brandSource: String(item.brandSource || '').trim(),
                productDescription: String(item.productDescription || '').trim(),
                productionModels: (Array.isArray(item.productionModels) ? item.productionModels : [])
                    .map(model => typeof model === 'string' ? model : model.productionModelDescription || '')
                    .map(value => String(value).trim()).filter(Boolean),
                source: item.manualBomSaved === true || item.source === 'MANUAL' ? 'MANUAL' : 'CONFIRMED',
                verified: true
            }, memoryData, false);
        }
        storageJSON.writeBundle([{file:documentsFile,value:documents},{file:sapMemoryFile,value:memoryData}]);
        return res.json({ success: true, document });
    } catch (error) {
        console.error('Confirmation failed:', error.message);
        return res.status(500).json({ success: false, message: 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง' });
    }
});

app.delete('/api/documents/:documentId', (req, res) => {
    const { documentId } = req.params;
    const documents = readDocuments();
    const documentIndex = documents.findIndex(item => item.metadata.documentId === documentId);
    const document = documentIndex >= 0 ? documents[documentIndex] : null;
    const metadata = document ? document.metadata : (req.body && req.body.metadata);
    const storedFileName = metadata && metadata.storedFileName ? path.basename(metadata.storedFileName) : '';
    const originalName = metadata && metadata.originalName ? path.basename(metadata.originalName) : '';

    if (documentIndex >= 0) {
        documents.splice(documentIndex, 1);
        writeDocuments(documents);
    }

    const filesToDelete = fs.readdirSync(uploadDir).filter(fileName => {
        if (fileName === 'documents.json') return false;
        return fileName === storedFileName && !documents.some(d=>d.metadata.storedFileName===fileName);
    });
    filesToDelete.forEach(fileName => fs.unlinkSync(path.join(uploadDir, fileName)));

    return res.json({ success: true, deleted: Boolean(document || filesToDelete.length) });
});

const ready = loadBomDatabase()
    .then(() => {

        // โหลด Production Model ต่อหลังจาก BOM โหลดเสร็จ
        return loadProductionModelDatabase();

    })
    .then(() => {

        // =====================================================
        // API: Find BOM by SAP NO.
        // =====================================================

        // =====================================================
// NEW BOM LOOKUP API - TEST VERSION
// =====================================================

app.get('/api/bom-lookup/:sapNo', (req, res) => {
    try {
        const sapNo = String(req.params.sapNo || '').trim();

        if (!newBomIndex) {
            return res.status(503).json({
                success: false,
                message: 'New BOM database is not loaded'
            });
        }

        const result = lookup(newBomIndex, sapNo);
        const memory = findSapMemory(sapNo);
        const po = String(req.query.sapPo || '').trim();
        const reusable = memory?.verified === true && memory.bomFound === true && String(memory.brand || '').trim() &&
            (memory.source === 'MANUAL' || (memory.source === 'CONFIRMED' && po && String(memory.sapPo||'') === po));
        if (reusable && (result.found || memory.source === 'MANUAL')) Object.assign(result, {
            found:true,brandCandidate:memory.brand,bomId:memory.bomId || result.bomId,
            productDescription:memory.productDescription || '',brandSource:memory.source,
            source:memory.source,verified:true
        });
        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('New BOM lookup error:', error.message);

        res.status(500).json({
            success: false,
            message: 'BOM lookup failed'
        });
    }
});

        // =====================================================
        // PHASE 4
        // API: Find Production Models by SAP NO.
        // =====================================================

        app.get('/api/production-model/:sapNo', (req, res) => {

            const sapNo = req.params.sapNo;

            const memory = findSapMemory(sapNo);
            const isVerifiedManual = memory && memory.verified === true && (memory.source === 'MANUAL' ||
                (memory.source === 'CONFIRMED' && memory.brandSource !== 'SAP_PO_FALLBACK' && memory.brandSource !== 'CONFLICT'));
            const models = isVerifiedManual && memory.source === 'MANUAL'
                ? (Array.isArray(memory.productionModels) ? memory.productionModels : []).map((description, index) => ({
                    productionModelId: `${String(memory.bomId || '').trim()}-MANUAL-${index + 1}`,
                    productionModelDescription: String(description || '').trim()
                }))
                : findProductionModelsBySapNo(sapNo);

            res.json({
                success: true,
                sapNo: sapNo,
                count: models.length,
                models: models
            });
        });
        // =====================================================
// PHASE 5 - SAP MEMORY API
// =====================================================

// ดู Memory ทั้งหมดสำหรับหน้า SAP Memory
app.get('/api/sap-memory', (req, res) => {
    return res.json({
        success: true,
        memories: readSapMemory()
    });
});

// ดู Memory ของ SAP NO. ที่เคยบันทึกไว้
app.get('/api/sap-memory/:sapNo', (req, res) => {

    const sapNo = String(req.params.sapNo || '').trim();

    const memory = findSapMemory(sapNo);

    res.json({
        success: true,
        sapNo: sapNo,
        found: memory !== null,
        memory: memory
    });
});


// บันทึก / อัปเดต Memory
app.post('/api/sap-memory', (req, res) => {

    const memoryItem = req.body || {};

    const sapNo = String(memoryItem.sapNo || '').trim();

    if (!sapNo) {
        return res.status(400).json({
            success: false,
            message: 'SAP NO. is required'
        });
    }

    if (memoryItem.source === 'MANUAL') {
        const requiredFields = ['bomId', 'productDescription', 'brand'];
        const missingFields = requiredFields.filter(field =>
            !String(memoryItem[field] || '').trim()
        );

        if (memoryItem.verified !== true || missingFields.length > 0 || !Array.isArray(memoryItem.productionModels)) {
            return res.status(400).json({
                success: false,
                message: 'Manual BOM requires verified=true, BOM ID, Product Description, Brand and a Production Models list'
            });
        }

        memoryItem.sapNo = sapNo;
        memoryItem.bomFound = true;
        memoryItem.bomId = String(memoryItem.bomId).trim();
        memoryItem.productDescription = String(memoryItem.productDescription).trim();
        memoryItem.brand = String(memoryItem.brand).trim();
        memoryItem.brandSource = 'MANUAL';
        memoryItem.productionModels = memoryItem.productionModels
            .map(model => String(model || '').trim())
            .filter(Boolean);
    }

    try {

        const savedMemory = saveSapMemory(memoryItem);

        res.json({
            success: true,
            memory: savedMemory
        });

    } catch (error) {

        console.error('Failed to save SAP Memory:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to save SAP Memory'
        });
    }
});


        // =====================================================
        // START SERVER
        // =====================================================

    });
module.exports = {app,ready,extractBuffer,readDocuments,readSapMemory,findProductionModelsBySapNo,groupCoordinateRows,detectPackingListHeader};
if (require.main === module) ready.then(()=>app.listen(PORT,'127.0.0.1',()=>console.log(`PL Brand System: http://localhost:${PORT}/pl/`))).catch(e=>{console.error(e.message);process.exitCode=1;});
