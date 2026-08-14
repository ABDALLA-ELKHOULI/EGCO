# API Contract v0.2 — frozen for parallel implementation

Backend implements exactly this; frontend codes against exactly this. Amounts are JSON
numbers rounded to 2dp (computed with Decimal internally). Dates are ISO `YYYY-MM-DD`.

## Existing (unchanged shapes, gain optional query params)

- `GET /api/v1/dashboard?date_from=&date_to=` — adds to response:
  `summary.openingBalance` (number, 0 when no date_from), `period: {from,to} | null`.
- `GET /api/v1/suppliers` — each row additionally: `firstActivity: string|null`,
  `lastActivity: string|null`, and invoices get `source`.
- `GET /api/v1/suppliers/{account}?date_from=&date_to=` — adds:
  `openingBalance`, `closingBalance`, `hasHistoryBefore: bool`,
  each invoice: `source: 'statement'|'manual'`, `id: string`.
  Identity that must hold: `closingBalance = openingBalance + invoicedInPeriod - paidInPeriod`.
- `GET /api/v1/reports/analysis?account=&date_from=&date_to=` — meta gains
  `opening_balance`, `closing_balance`, period in `meta.period`.

## Suppliers CRUD

- `POST /api/v1/suppliers` body `{account, name, project, term}` → 201 row (409 if account exists).
- `PUT /api/v1/suppliers/{account}` body `{name?, project?, term?}` → row. Account immutable.
- `DELETE /api/v1/suppliers/{account}` → `{deleted: true}`. Soft delete.
  If supplier has any invoices/payments: 409 `{detail}` unless `?force=true`.

## Manual entries (المديونية المستحقة اليدوية)

- `POST /api/v1/manual/invoices` body
  `{account, amount, date, due_date?, description?, reference?}` → invoice json.
  `due_date` omitted ⇒ derived from supplier term (claim terms ⇒ required, else 422).
  Stored with `source='manual'`; reference stored in `doc`.
- `PUT /api/v1/manual/invoices/{id}` body any of the above fields → invoice json.
- `DELETE /api/v1/manual/invoices/{id}` → `{deleted: true}` (soft).
- `POST /api/v1/manual/payments` body `{account, amount, date, description?, reference?}`.
- `DELETE /api/v1/manual/payments/{id}` → `{deleted: true}` (soft).
- Editing/deleting rows with `source='statement'` ⇒ 403 (reconciliation protection).

## Import

- `source` gains `'csv_statement'` (same columns as the PDF statement: date, debit,
  credit, doc, description; header row in Arabic or English accepted).
- Before any committing import, backend copies the DB to
  `<DATA_DIR>/backups/egco-YYYYMMDD-HHMMSS.db` (keep last 20).
- Multi-file is a frontend loop over the existing per-file endpoints; suppliers files
  must be sent before statement files by the frontend.

## Periodic analysis

- `GET /api/v1/reports/periodic?granularity=quarter|half|year&year=2026&account=`
  →
  ```
  {
    granularity, year,
    coverage: {first: date|null, last: date|null},
    periods: [{
      label,                 // "الربع الأول ٢٠٢٦" | "النصف الأول ٢٠٢٦" | "٢٠٢٦"
      from, to,
      opening, invoiced, paid, net, closing,   // closing = opening + invoiced - paid
      cumulativePaid,
      byProject: [{project, paid}],
      topSuppliers: [{account, name, paid}],   // max 5
      avgSettlementDays: number|null,          // FIFO-weighted, payments in period
      complete: bool                           // period fully inside coverage
    }],
    comparison: [{label, paid, prevPaid, prevPct|null, yoyPaid, yoyPct|null}]
  }
  ```
- `GET /api/v1/reports/export.xlsx?granularity=&year=&account=&date_from=&date_to=`
  → `.xlsx` file (Content-Disposition attachment): sheet ١ الملخص, sheet ٢ الفترات,
  sheet ٣ الموردون. Built with openpyxl.

## Electron bridge (preload)

- `window.egco.pickFiles(): Promise<PickedFile[]>` — multiSelections; keeps single
  `pickFile` working (returns first).
