# API Contract v0.3 — frozen for parallel implementation

Additive to v0.2. Amounts = JSON numbers, 2dp (Decimal internally). Dates ISO `YYYY-MM-DD`.
Agents implement exactly this. `api/router.py`, `lib/api.ts`, `App.tsx`, `Sidebar.tsx`
are owned by the integrator — agents must NOT edit them.

## Phase 3 — data intake

### Folder scan + bulk import
- `POST /api/v1/import/scan` body `{dir: string}` →
  ```
  { dir, files: [{ path, name, source, sizeKb }], skipped: [{name, reason}] }
  ```
  Non-recursive listing; recognises .pdf → `pdf_statement`, .csv → `csv_statement`,
  .xlsx/.xlsm → `suppliers_excel`. Others go to `skipped` with an Arabic reason.
  404 (Arabic detail) if dir missing/not a directory.

- `POST /api/v1/import/batch` body `{paths: string[], allow_unreconciled?: bool}` →
  ```
  { total, saved, failed,
    results: [{ path, name, source, status, account, supplierName,
                added, skipped, computedBalance, statementBalance, message }] }
  ```
  `status` ∈ `saved` | `not_reconciled` | `unknown_supplier` | `read_error` | `no_account`.
  Suppliers files are processed FIRST regardless of input order. ONE backup before the
  whole batch (not per file). Never raises on a single bad file — it becomes a result row.

### Coverage
- `GET /api/v1/coverage?stale_days=90` →
  ```
  { totals: { suppliers, withData, withoutData, stale, coveredPct },
    asOf, staleDays,
    rows: [{ account, name, project, firstActivity, lastActivity,
             daysSinceLast, invoiceCount, outstanding, state }] }
  ```
  `state` ∈ `none` (no records) | `stale` (last activity older than stale_days) | `ok`.
  Sorted: `none` first, then `stale` by daysSinceLast desc, then `ok`.

### Claim due dates (the مستخلص fix)
- `PUT /api/v1/invoices/{id}/due-date` body `{due_date: string|null}` → invoice json.
  Allowed on `source='statement'` rows — this is the ONLY statement-row mutation
  permitted, because the due date is not part of the reconciliation identity.
  Amount/date/description stay immutable (still 403 via the manual routes).
  404 if invoice missing. Setting null clears the override.

## Phase 4 — projects

- `GET /api/v1/projects` →
  ```
  { asOf,
    totals: { outstanding, overdue, dueWithin7, supplierCount },
    rows: [{ project, supplierCount, suppliersWithData, outstanding, overdue,
             dueWithin7, totalInvoiced, totalPaid, openInvoiceCount,
             topSuppliers: [{account, name, outstanding}] }] }   // max 3
  ```
  Sorted by outstanding desc. Suppliers with empty project → `project: 'غير محدد'`.

- `GET /api/v1/projects/{project}` → same row shape plus
  `suppliers: [...position_json...]` and `schedule: [{date, amount, count}]` (90d).

## Phase 5 — cash flow (in vs out)

### Receivables model + ingest
New table `receivables`: id, project, unit, client, amount, due_date (nullable),
collected_on (nullable), status (`collected`|`open`), source, notes + the standard
id/created_at/updated_at/deleted_at.

- `POST /api/v1/import` gains source `'receivables_legacy_html'` (reads the
  collections tables out of an EGCO `report4.html`) and `'receivables_excel'`
  (columns: الوحدة/unit, العميل/client, المبلغ/amount, تاريخ التحصيل/collected,
  تاريخ الاستحقاق/due, المشروع/project — Arabic or English headers, any order).
  Same preview→commit contract as statements; reconciliation is not applicable so
  `reconciled: true` with an informational issue.

### Cash flow endpoint
- `GET /api/v1/cashflow?weeks=26&from=&opening_balance=0` →
  ```
  { asOf, openingBalance, periodDays: 14,
    periods: [{ label, from, to,
                inflow, outflow, net, balance,
                inflowCount, outflowCount, deficit: bool }],
    summary: { totalInflow, totalOutflow, netTotal, minBalance,
               firstDeficit: {label, from, amount} | null,
               hasReceivables: bool },
    warnings: [string] }   // Arabic, e.g. لم تُرفع بيانات التحصيلات بعد
  ```
  Buckets are 14-day periods anchored on `from` (default: today).
  inflow = receivables due/collected in the window; outflow = supplier invoice
  remainders whose due date falls in the window. balance is cumulative from
  openingBalance. `deficit` = balance < 0. If no receivables exist, inflow is 0
  everywhere and `warnings` says so explicitly — never imply zero income is real.

## Phase 6 — command centre

- `GET /api/v1/overview` →
  ```
  { asOf,
    payables: { outstanding, overdue, dueWithin7, supplierCount, withData },
    coverage: { coveredPct, withoutData, stale },
    cash: { nextDeficit: {label, amount}|null, minBalance, hasReceivables },
    projects: [{ project, outstanding, overdue }],      // top 5
    alerts: [{ level: 'danger'|'warning'|'info', text }] }   // Arabic, derived
  ```
  Alerts are DERIVED from data (overdue exists / coverage gaps / upcoming deficit),
  never hardcoded prose.

## Electron bridge additions

- `window.egco.pickDirectory(): Promise<string | null>` — `openDirectory` dialog.
