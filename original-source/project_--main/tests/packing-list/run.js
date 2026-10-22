const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { Readable } = require('node:stream');
const csv = require('csv-parser');

const repositoryRoot = path.resolve(__dirname, '../..');
const caseDirectories = ['case-001', 'case-002', 'case-003', 'case-004'];
const comparedColumns = [
    { actual: 'sapPo', expected: 'SAP PO', label: 'SAP PO', compact: true },
    { actual: 'sapNo', expected: 'SAP NO.', label: 'SAP NO.' },
    { actual: 'description', expected: 'DESCRIPTION', label: 'DESCRIPTION', words: true },
    { actual: 'totalQty', expected: 'TOTAL QTY (PCS)', label: 'TOTAL QTY', numeric: true },
    { actual: 'qtyPcs', expected: 'QTY (PCS)', label: 'QTY PCS', numeric: true },
    { actual: 'qtyCtns', expected: 'QTY (CTNS)', label: 'QTY CTNS', numeric: true },
    { actual: 'nw', expected: 'N.W.(KGS)', label: 'N.W.', numeric: true },
    { actual: 'gw', expected: 'G.W.(KGS)', label: 'G.W.', numeric: true },
    { actual: 'meas', expected: 'Meas.', label: 'MEAS.', numeric: true }
];

function normalize(value, column) {
    let normalized = String(value ?? '').trim();
    if (column.compact || column.numeric) normalized = normalized.replace(/[\s,]/g, '');
    if (column.words) normalized = normalized.replace(/\s+/g, ' ');
    return normalized;
}

async function readExpectedRows(filePath) {
    const contents = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = contents.split(/\r?\n/);
    const headerIndex = lines.findIndex(line => /(?:^|,)SAP NO\.(?:,|$)/i.test(line) && /DESCRIPTION/i.test(line));
    if (headerIndex < 0) throw new Error(`Expected CSV header not found: ${filePath}`);

    const csvText = lines.slice(headerIndex).join('\n');
    const rows = [];
    await new Promise((resolve, reject) => {
        Readable.from([csvText])
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    const headers = rows.length ? Object.keys(rows[0]) : [];
    const missingHeaders = comparedColumns
        .map(column => column.expected)
        .filter(header => !headers.includes(header));
    if (missingHeaders.length) {
        throw new Error(`Expected CSV is missing headers: ${missingHeaders.join(', ')}`);
    }

    return rows.filter(row => comparedColumns.some(column => String(row[column.expected] ?? '').trim() !== ''));
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            probe.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}

function prepareSandbox(sandboxRoot) {
    fs.mkdirSync(path.join(sandboxRoot, 'public'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'sample-data'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'uploads'), { recursive: true });

    const productionServerSource = fs.readFileSync(path.join(repositoryRoot, 'server.js'), 'utf8');
    fs.writeFileSync(
        path.join(sandboxRoot, 'server.js'),
        instrumentSandboxServer(productionServerSource),
        'utf8'
    );
    fs.copyFileSync(path.join(repositoryRoot, 'eng.traineddata'), path.join(sandboxRoot, 'eng.traineddata'));
    fs.copyFileSync(
        path.join(repositoryRoot, 'sample-data', 'Project01 - Ex.BOM.csv'),
        path.join(sandboxRoot, 'sample-data', 'Project01 - Ex.BOM.csv')
    );
    fs.copyFileSync(
        path.join(repositoryRoot, 'sample-data', 'Project01 - Ex.Production Model.csv'),
        path.join(sandboxRoot, 'sample-data', 'Project01 - Ex.Production Model.csv')
    );
    fs.writeFileSync(path.join(sandboxRoot, 'sample-data', 'sap-memory.json'), '[]\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'uploads', 'documents.json'), '[]\n', 'utf8');
    fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(sandboxRoot, 'node_modules'), 'dir');
}

function replaceOnce(source, search, replacement, label) {
    const firstIndex = source.indexOf(search);
    if (firstIndex < 0 || source.indexOf(search, firstIndex + search.length) >= 0) {
        throw new Error(`Unable to instrument sandbox server at ${label}`);
    }
    return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + search.length);
}

function instrumentSandboxServer(source) {
    let instrumented = source;
    instrumented = replaceOnce(
        instrumented,
        'const app = express();',
        `const app = express();
global.__packingListDiagnostics = {
    pdfTextCharacters: 0,
    textObjects: 0,
    coordinateGroupedRows: 0,
    dynamicHeaderDetected: false,
    detectedHeaderColumns: [],
    detectedHeader: null,
    dynamicRowSamples: [],
    coordinateRowSamples: [],
    rejectedRowSamples: [],
    coordinateRowsMissingSapNo: 0,
    coordinateRowsMissingDescription: 0,
    coordinateRowsWithSapNo: 0,
    coordinateRowsWithDescription: 0,
    sapNumberObjects: [],
    coordinateRows: 0,
    ocrStarted: false,
    ocrTextCharacters: 0,
    ocrParsedRows: 0,
    fallbackReason: ''
};
app.get('/__test/parser-diagnostics', (req, res) => res.json(global.__packingListDiagnostics));`,
        'Express app initialization'
    );
    instrumented = replaceOnce(
        instrumented,
        '    const textContent = await pageData.getTextContent({',
        '    const textContent = await pageData.getTextContent({',
        'coordinate text content'
    );
    instrumented = replaceOnce(
        instrumented,
        '    });\n\n    return JSON.stringify(textContent.items.map(item => ({',
        '    });\n    global.__packingListDiagnostics.textObjects += textContent.items.length;\n\n    return JSON.stringify(textContent.items.map(item => ({',
        'coordinate text object count'
    );
    instrumented = replaceOnce(
        instrumented,
        '    return rows.sort((left, right) => right.y - left.y);',
        '    global.__packingListDiagnostics.coordinateGroupedRows += rows.length;\n    return rows.sort((left, right) => right.y - left.y);',
        'dynamic coordinate grouped row count'
    );
    instrumented = replaceOnce(
        instrumented,
        '        const rows = groupCoordinateRows(pageItems);',
        `        const rows = groupCoordinateRows(pageItems);
        global.__packingListDiagnostics.coordinateRowSamples = rows.slice(0, 16).map(row => ({ y: row.y, cells: row.cells.slice().sort((left, right) => left.x - right.x).map(cell => ({ text: cell.str, x: cell.x })) }));`,
        'coordinate row x/y samples'
    );
    instrumented = replaceOnce(
        instrumented,
        '        const header = detectPackingListHeader(rows);',
        `        const header = detectPackingListHeader(rows);
        if (header) {
            global.__packingListDiagnostics.dynamicHeaderDetected = true;
            global.__packingListDiagnostics.detectedHeaderColumns = Object.keys(header.columns);
            global.__packingListDiagnostics.detectedHeader = {
                y: header.row.y,
                columns: header.columns,
                text: header.row.cells.slice().sort((left, right) => left.x - right.x).map(cell => cell.str).join(' | ')
            };
        }`,
        'dynamic header detection state'
    );
    instrumented = replaceOnce(
        instrumented,
        '            columnCells[orderedColumns[columnIndex].name].push(cell);',
        `            const assignedColumn = orderedColumns[columnIndex].name;
            if (/\\d{7}/.test(cell.str) && global.__packingListDiagnostics.sapNumberObjects.length < 20) {
                global.__packingListDiagnostics.sapNumberObjects.push({ text: cell.str, x: cell.x, assignedColumn });
            }
            columnCells[assignedColumn].push(cell);`,
        'dynamic SAP digit object assignments'
    );
    instrumented = replaceOnce(
        instrumented,
        "        const description = joinColumn('description');\n        if (!sapNoMatch || !description) return;",
        "        const description = joinColumn('description');\n        if (global.__packingListDiagnostics.dynamicRowSamples.length < 2) {\n            global.__packingListDiagnostics.dynamicRowSamples.push({ rowY: row.y, sapNoCell: joinColumn('sapNo', true), sapNoMatch: sapNoMatch && sapNoMatch[0], description, cells: Object.fromEntries(Object.entries(columnCells).map(([name, cells]) => [name, cells.map(cell => ({ text: cell.str, x: cell.x, width: cell.width }))])) });\n        }\n        if (sapNoMatch) global.__packingListDiagnostics.coordinateRowsWithSapNo += 1;\n        else global.__packingListDiagnostics.coordinateRowsMissingSapNo += 1;\n        if (description) global.__packingListDiagnostics.coordinateRowsWithDescription += 1;\n        else global.__packingListDiagnostics.coordinateRowsMissingDescription += 1;\n        if (!sapNoMatch || !description) return;",
        'dynamic coordinate row rejection counts'
    );
    instrumented = instrumented.replace(
        '        if (!sapNoMatch || !description) return;',
        `        if (!sapNoMatch || !description) {
            if (global.__packingListDiagnostics.rejectedRowSamples.length < 12) {
                global.__packingListDiagnostics.rejectedRowSamples.push({ rowY: row.y, sapNoCell: joinColumn('sapNo', true), sapNoMatch: sapNoMatch && sapNoMatch[0], description, cells: Object.fromEntries(Object.entries(columnCells).map(([name, cells]) => [name, cells.map(cell => ({ text: cell.str, x: cell.x, width: cell.width }))])) });
            }
            return;
        }`
    );
    instrumented = replaceOnce(
        instrumented,
        '    return items;\n}\n\n// Advanced Parsing Engine for Packing Lists',
        '    global.__packingListDiagnostics.coordinateRows = items.length;\n    return items;\n}\n\n// Advanced Parsing Engine for Packing Lists',
        'coordinate parser result'
    );
    instrumented = replaceOnce(
        instrumented,
        "async function processOCR(filePath) {\n    const { pdf }",
        "async function processOCR(filePath) {\n    global.__packingListDiagnostics.ocrStarted = true;\n    const { pdf }",
        'OCR start'
    );
    instrumented = replaceOnce(
        instrumented,
        "    return {\n        isScanned: true,\n        extractedText: pageTexts.join('\\n'),\n        notice: 'Scanned PDF processed with OCR.'\n    };",
        "    const extractedText = pageTexts.join('\\n');\n    global.__packingListDiagnostics.ocrTextCharacters = extractedText.length;\n    return {\n        isScanned: true,\n        extractedText,\n        notice: 'Scanned PDF processed with OCR.'\n    };",
        'OCR text count'
    );
    instrumented = replaceOnce(
        instrumented,
        "            const rawText = pdfData.text ? pdfData.text.trim() : '';",
        "            const rawText = pdfData.text ? pdfData.text.trim() : '';\n            global.__packingListDiagnostics.pdfTextCharacters = rawText.length;",
        'PDF text-layer count'
    );
    instrumented = replaceOnce(
        instrumented,
        "app.post('/api/upload', (req, res) => {\n    upload.single('file')",
        `app.post('/api/upload', (req, res) => {
    global.__packingListDiagnostics = {
        pdfTextCharacters: 0, textObjects: 0, coordinateGroupedRows: 0,
        coordinateRowsMissingSapNo: 0, coordinateRowsMissingDescription: 0,
        coordinateRowsWithSapNo: 0, coordinateRowsWithDescription: 0,
        sapNumberObjects: [], coordinateRows: 0, coordinateGroupedRows: 0,
        dynamicHeaderDetected: false, detectedHeaderColumns: [], detectedHeader: null,
        dynamicRowSamples: [], coordinateRowSamples: [], rejectedRowSamples: [], ocrStarted: false,
        ocrTextCharacters: 0, ocrParsedRows: 0, fallbackReason: ''
    };
    upload.single('file')`,
        'per-upload diagnostics reset'
    );
    instrumented = replaceOnce(
        instrumented,
        '                extractedItems = parsePackingListCoordinates(rawText);',
        "                extractedItems = parsePackingListCoordinates(rawText);\n                if (extractedItems.length === 0) global.__packingListDiagnostics.fallbackReason = 'coordinate parser returned 0 rows';",
        'coordinate fallback reason'
    );
    const ocrParseCall = 'extractedItems = parsePackingListText(ocrResult.extractedText);';
    const ocrParseCallCount = instrumented.split(ocrParseCall).length - 1;
    if (ocrParseCallCount !== 2) {
        throw new Error(`Expected two OCR parse calls in sandbox source; found ${ocrParseCallCount}`);
    }
    instrumented = instrumented.replace(
        /^(\s*)extractedItems = parsePackingListText\(ocrResult\.extractedText\);$/gm,
        (line, indentation) => `${line}\n${indentation}global.__packingListDiagnostics.ocrParsedRows = extractedItems.length;`
    );
    instrumented = replaceOnce(
        instrumented,
        "            } else {\n                const ocrResult = await processOCR(filePath);",
        "            } else {\n                global.__packingListDiagnostics.fallbackReason = 'pdf-parse text layer is 20 characters or fewer';\n                const ocrResult = await processOCR(filePath);",
        'textless fallback reason'
    );
    return instrumented;
}

async function startSandboxServer(sandboxRoot, port) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: sandboxRoot,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });

    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Sandbox server exited (${child.exitCode}): ${stderr}`);
        }
        try {
            const response = await fetch(`${baseUrl}/api/sap-memory`);
            if (response.ok) return { child, baseUrl, stderr: () => stderr };
        } catch (error) {
            // The server is still starting.
        }
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    child.kill('SIGTERM');
    throw new Error(`Sandbox server did not become ready: ${stderr}`);
}

async function stopSandboxServer(child) {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function parsePdfThroughUploadApi(baseUrl, inputPath) {
    const form = new FormData();
    const pdfBuffer = fs.readFileSync(inputPath);
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), path.basename(inputPath));

    const response = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok || !payload.success || !Array.isArray(payload.items)) {
        throw new Error(payload.message || `Upload parser returned HTTP ${response.status}`);
    }
    const diagnosticResponse = await fetch(`${baseUrl}/__test/parser-diagnostics`);
    const diagnostics = diagnosticResponse.ok ? await diagnosticResponse.json() : {};
    return {
        items: payload.items,
        processType: payload.metadata && payload.metadata.processType,
        diagnostics
    };
}

function compareRows(expectedRows, actualRows) {
    const mismatches = [];
    const rowCount = Math.max(expectedRows.length, actualRows.length);

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const expected = expectedRows[rowIndex];
        const actual = actualRows[rowIndex];

        if (!expected || !actual) {
            mismatches.push({
                row: rowIndex + 1,
                column: 'ROW',
                expected: expected ? 'row present' : '<no row>',
                actual: actual ? 'row present' : '<no row>'
            });
            continue;
        }

        for (const column of comparedColumns) {
            const expectedValue = normalize(expected[column.expected], column);
            const actualValue = normalize(actual[column.actual], column);
            if (expectedValue !== actualValue) {
                mismatches.push({
                    row: rowIndex + 1,
                    column: column.label,
                    expected: expectedValue || '<empty>',
                    actual: actualValue || '<empty>'
                });
            }
        }
    }

    return mismatches;
}

async function main() {
    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-packing-list-test-'));
    let server;
    let failedCases = 0;
    const columnFailureCounts = new Map();

    try {
        prepareSandbox(sandboxRoot);
        server = await startSandboxServer(sandboxRoot, await getFreePort());

        for (const caseName of caseDirectories) {
            const caseDirectory = path.join(__dirname, caseName);
            const inputPath = path.join(caseDirectory, 'input.pdf');
            const expectedPath = path.join(caseDirectory, 'expected.csv');
            if (!fs.existsSync(inputPath) || !fs.existsSync(expectedPath)) {
                console.log(`${caseName}: SKIP (input.pdf or expected.csv missing)`);
                continue;
            }

            try {
                const actual = await parsePdfThroughUploadApi(server.baseUrl, inputPath);
                const actualRows = actual.items;
                const expectedRows = await readExpectedRows(expectedPath);
                const mismatches = compareRows(expectedRows, actualRows);
                const passed = mismatches.length === 0;
                if (!passed) failedCases += 1;

                console.log(`${caseName}: ${passed ? 'PASS' : 'FAIL'}`);
                console.log(`  Engine:        ${actual.processType || 'unknown'}`);
                console.log(`  Dynamic header: ${actual.diagnostics.dynamicHeaderDetected ? 'YES' : 'NO'}`);
                if (actual.diagnostics.detectedHeaderColumns && actual.diagnostics.detectedHeaderColumns.length) {
                    console.log(`  Header columns: ${actual.diagnostics.detectedHeaderColumns.join(', ')}`);
                }
                if (actual.diagnostics.detectedHeader) console.log(`  Header detail: ${JSON.stringify(actual.diagnostics.detectedHeader)}`);
                if (actual.diagnostics.dynamicRowSamples && actual.diagnostics.dynamicRowSamples.length) {
                    console.log(`  Dynamic row samples: ${JSON.stringify(actual.diagnostics.dynamicRowSamples)}`);
                }
                if (actual.diagnostics.rejectedRowSamples && actual.diagnostics.rejectedRowSamples.length) {
                    console.log(`  Rejected row samples: ${JSON.stringify(actual.diagnostics.rejectedRowSamples.slice(0, 4))}`);
                }
                if (actual.diagnostics.coordinateRowSamples && actual.diagnostics.coordinateRowSamples.length) {
                    const rowTextSamples = actual.diagnostics.coordinateRowSamples.map(row => ({
                        y: row.y,
                        text: row.cells.map(cell => cell.text).join(' | ')
                    }));
                    console.log(`  Grouped row text/y: ${JSON.stringify(rowTextSamples)}`);
                }
                if (actual.diagnostics.detectedHeader) {
                    console.log(`  Header detail: ${JSON.stringify(actual.diagnostics.detectedHeader)}`);
                }
                if (actual.diagnostics.dynamicRowSamples && actual.diagnostics.dynamicRowSamples.length) {
                    console.log(`  Dynamic row samples: ${JSON.stringify(actual.diagnostics.dynamicRowSamples)}`);
                }
                console.log(`  pdf-parse text: ${actual.diagnostics.pdfTextCharacters > 0 ? 'yes' : 'no'} (${actual.diagnostics.pdfTextCharacters || 0} chars)`);
                console.log(`  Text objects:  ${actual.diagnostics.textObjects || 0}`);
                console.log(`  Grouped rows:  ${actual.diagnostics.coordinateGroupedRows || 0}`);
                console.log(`  Coordinate rows: ${actual.diagnostics.coordinateRows || 0}`);
                console.log(`  Rejected rows: missing SAP NO.=${actual.diagnostics.coordinateRowsMissingSapNo || 0}, missing DESCRIPTION=${actual.diagnostics.coordinateRowsMissingDescription || 0}`);
                if (actual.diagnostics.sapNumberObjects && actual.diagnostics.sapNumberObjects.length) {
                    console.log(`  7-digit object positions: ${JSON.stringify(actual.diagnostics.sapNumberObjects.slice(0, 6))}`);
                }
                console.log(`  OCR used:      ${actual.diagnostics.ocrStarted ? 'Yes' : 'No'}`);
                console.log(`  OCR text chars: ${actual.diagnostics.ocrTextCharacters || 0}`);
                console.log(`  OCR parsed rows: ${actual.diagnostics.ocrParsedRows || 0}`);
                if (actual.diagnostics.fallbackReason) console.log(`  OCR fallback:  ${actual.diagnostics.fallbackReason}`);
                console.log(`  Expected Rows: ${expectedRows.length}`);
                console.log(`  Actual Rows:   ${actualRows.length}`);
                for (const mismatch of mismatches) {
                    columnFailureCounts.set(mismatch.column, (columnFailureCounts.get(mismatch.column) || 0) + 1);
                    console.log(`  Row ${mismatch.row} | Column: ${mismatch.column}`);
                    console.log(`    Expected: ${mismatch.expected}`);
                    console.log(`    Actual:   ${mismatch.actual}`);
                }
            } catch (error) {
                failedCases += 1;
                console.log(`${caseName}: FAIL`);
                console.log(`  Runner error: ${error.message}`);
            }
        }

        console.log('Column mismatch summary:');
        if (columnFailureCounts.size === 0) {
            console.log('  No column mismatches.');
        } else {
            [...columnFailureCounts.entries()]
                .sort((left, right) => right[1] - left[1])
                .forEach(([column, count]) => console.log(`  ${column}: ${count}`));
        }
        console.log(`Failed cases: ${failedCases}`);
        if (failedCases > 0) process.exitCode = 1;
    } finally {
        if (server) await stopSandboxServer(server.child);
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});