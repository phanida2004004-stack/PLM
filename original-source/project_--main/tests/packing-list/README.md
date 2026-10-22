# Packing List Parser Regression Baseline

These cases pair each existing `Project01 - Ex.Packing ListN.pdf` with the CSV of the same filename stem. The CSV is an expected-result fixture only; the test runner never supplies it to the parser or the upload endpoint.

Run from the repository root:

```sh
node tests/packing-list/run.js
```

The runner copies `server.js` and its required data files into a temporary sandbox, starts that copy on an available port, and sends each `input.pdf` through the same `POST /api/upload` path used by the website. Temporary uploads, document records, and SAP Memory are isolated from the working project and removed after the run.

The runner compares the parser's returned fields with the corresponding expected CSV columns:

- `SAP PO` -> `sapPo`
- `SAP NO.` -> `sapNo`
- `DESCRIPTION` -> `description`
- `TOTAL QTY (PCS)` -> `totalQty`
- `QTY (PCS)` -> `qtyPcs`
- `QTY (CTNS)` -> `qtyCtns`
- `N.W.(KGS)` -> `nw`
- `G.W.(KGS)` -> `gw`
- `Meas.` -> `meas`

The current parser response does not expose `ITEM NO.` or `PL NO.`, so those source CSV columns are not compared. Each case reports PASS/FAIL, expected/actual row counts, engine type, and each differing row/column/value. No test fixture is read by the production upload flow.
