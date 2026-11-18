# AUDIT.md — independent audit (agent A)

## Re-audit 2026-11-18 (round 2, after fixes + backend wave)
- **Builds:** `tsc --noEmit` 0 errors (exit 0) · renderer build OK (`✓ built in 2.40s`) · `build:desktop` OK · pytest **550 passed, 80 skipped, 24 warnings in 242.66s** (exit 0; golden included).
- **Parity (9 files incl. shell/desktop/backend):** MISSING **0** (was 114). Multi-referenced 43; all checked samples are explicit `ref →` cross-references with a single declared owner (P-364/366-368 → parties, P-081 → parties, P-358..361 → projects, P-517/522/528 → desktop, P-591 → reports, P-370 = shared F component used by 4 sections). **Real ownership CONFLICTs: 0.**
- **Contracts:** re-dumped 141 routes; every `/api/v1` call in sections/data/shell/lib resolves. No wrong methods.
- **Security/money:** unchanged-clean (only fetch is `data/client.ts:10`; only innerHTML is static `ui/Icon.tsx:52`; no float money reduces in sections).
- **Status:** 13 closed · 1 partially open · 2 open (low). No new findings above low.

| ID | Status | Evidence |
|---|---|---|
| A-001 | closed | tsc 0 errors; build succeeds |
| A-002 | closed | full pytest green |
| A-003 | closed | today/data.ts:61,106 reads `kpis.bankBalance` via `num()`; `newInvoicesAmount` removed |
| A-004 | closed | shell/PARITY-shell.md (27), docs/next/PARITY-desktop.md (28), services/api/PARITY-backend.md (21) |
| A-005 | closed | PARITY-parties.md now 200 P-ids |
| A-006 | closed | owners declared (parties.md:298-301, reports.md:120-121, data.md:140) |
| A-007 | closed | app/routes.tsx:121 skips aliases owned by another section view |
| A-008 | closed | reports/model.ts:88-90 neutral tone |
| A-009 | closed | ProjectView.tsx:77 `termDays != null` guard |
| A-010 | closed | `?? 0` only in comparisons now; Money gets `?? null` (ProjectsView.tsx:117) |
| A-011 | **partially open** | sum now via halala helper; hint text «سُدّد هذا العام» (Due.tsx:~77) still claims a period, but `totalPaid` = lifetime `total_paid` (payables_service.py:246,336) — S1: reword to «سُدّد حتى الآن» unless /dashboard is year-scoped |
| A-012 | closed | PARITY-today.md 49 P-ids |
| A-013 | closed | PARITY-data.md 134 P-ids (MISSING 0) |
| A-014 | open (low, accepted interim) | today/data.ts:5-12 still fans out; /today used for kpis |
| A-015 | closed | routes.tsx:110-111 duplicate warnings |
| A-016 | **open (low)** | revenues.py fixed; ai.py:64 still `body.dict(...)` — B |

Also seen (info): pytest prints `Task was destroyed but it is pending!` at exit (asyncio SSE generator not closed in tests) — harmless, B may close the event stream in teardown.

---
## Round 1 (original)

Read-only audit of `Dashboard-next` while S2/S3/B/Q are still writing. "In progress" = file is being actively written; flagged only if it breaks the build/gate.

## Summary
- **Counts:** critical 1 · high 3 · medium 6 · low 6 (16 findings).
- **Builds:** renderer `tsc --noEmit` -> 2 errors (projects money helpers); `npm --workspace apps/renderer run build` -> **FAIL** (same 2 errors); `npm run build:desktop` -> OK; pytest -> **1 failed, 528 passed, 80 skipped** (golden numbers: 2 passed).
- **Contracts:** every `/api/v1/...` path called from `sections/**`, `data/**`, `lib/api.ts` exists in the live FastAPI route table (140 method+path pairs dumped from `app.main`). No wrong methods found. One field-shape mismatch (`/today` bankBalance, A-003).
- **Shell:** all 6 sections export a default `SectionModule`; view keys match FRONTEND-CONTRACT.md (+ extra `reports.present`). No duplicate keys/paths; every v0.13 route has a redirect. One alias collision (A-009).
- **Parity:** 607 P-ids. **114 claimed by no section PARITY file** (most are shell/desktop/invariant rows with no PARITY file at all), 40 referenced by >1 file (mostly "not here" cross-refs; a few real double ownership).
- **10 high-risk capabilities:** all 10 have an implementation in new code (table below); none missing outright.
- **Security:** no direct `fetch(` in sections/shell/ui (all through `request`/`lib/api`); only `dangerouslySetInnerHTML` is `ui/Icon.tsx:52` with static SVG constants; no secret logging found; tests/e2e use `EGCO_DATA_DIR` temp dirs (conftest.py:84, scripts/e2e-backend.mjs:39); Electron renderer sandboxed with `setWindowOpenHandler` (desktop main/index.ts:186-210).

## Findings
| ID | Sev | Area | file:line | Description | Owner | Suggested fix |
|---|---|---|---|---|---|---|
| A-001 | critical (in progress) | build | apps/renderer/src/sections/projects/logic/budget.ts:3 | Imports `toH`/`fromH` from `./money` which only exports `num, halalas, cmp, toDec` -> `tsc -b` fails -> `vite build` fails; whole renderer unbuildable. | S3 | Export `toH`/`fromH` from logic/money.ts or switch budget.ts to `halalas`/`toDec`. |
| A-002 | high | backend tests | services/api/tests/test_report_parties.py:72 | `test_default_parties_keeps_the_legacy_payload_shape` fails: `/reports/analysis` summary now has `supplierOutstanding, contractorOutstanding, ageingTotal, period_movement` (report_service.py:186-189). These keys ARE in API-CONTRACT.md:301-308, so the test is stale, but suite is red. | B | Extend `LEGACY_SUMMARY_KEYS` to a superset check (`<=`) or add the 4 keys. |
| A-003 | high | contract/today | sections/today/data.ts:57-63, Today.tsx:50, Due.tsx:47 | Frontend reads `td.bankBalance` at top level; backend/API-CONTRACT §2 put it at `kpis.bankBalance` (money string). Result: bank balance is always `null` -> "no bank balance" warning permanent, `useProjection(bank)` never bank-based. Also `newInvoicesAmount` read at Today.tsx:254 is not emitted by `today_service._last_change` (line 213). | S1 | Read `td.kpis?.bankBalance` via `Number()`; drop or request `newInvoicesAmount` from B. |
| A-004 | high | parity gate | docs/next/PARITY.md | No PARITY file for shell, desktop or backend invariants. Unclaimed: shell P-001..004, 006, 007, 018..020, 022..026, 385..390, 393..396, 536, 537, 552; desktop P-420, 510..516, 518..521, 523..535, 550; invariants P-583..595, 599..604, 606, 607 (+P-582). Gate "every row ✅" cannot be evaluated. | F, D, B (P coordinates) | Add `docs/next/PARITY-shell.md`, `PARITY-desktop.md`, and a B invariants→test mapping. |
| A-005 | medium | parity | sections/parties/PARITY-parties.md | Implemented but not claimed: P-380, P-381 (forms), P-400..403, 405, 407..416, 445..447, 449, 452..463, 484, 489, 553. Code exists (parties/api.ts:32-101, Contractors.tsx:330, ContractorDetail.tsx:419). | S2 (in progress) | Add route/form rows to the file. |
| A-006 | medium | parity ownership | multiple PARITY-*.md | Real double ownership: P-364/366-368 (export formats implemented in both parties `ContractorExportMenu` Contractors.tsx:186 and reports ExportsView); P-370 (KPI) in 4 files; P-081/P-543 allocation toggle in data (useSettings.ts:68) and parties; P-358..361/P-475 projects+data. Others (P-253..262 calendar in cash file = "not here") are cross-refs only. | P + S2/S5/S6/S3 | Pick one owner per P-id; others reference with "→ <section>". |
| A-007 | medium | shell routing | app/routes.tsx:63-64, 110-113, 151-154 | When `reports.report` replaces the legacy view it inherits legacy aliases `exports`, `present`; it precedes `reports.present`/`reports.exports` so `findView('exports')`/`go('present')` (⌘K, events) open the report tab instead. | F | Remove `exports`/`present` from the LEGACY entry, or skip merging aliases already owned by another section view. |
| A-008 | medium | sign/colour (P-591) | sections/reports/model.ts:88 vs parties/logic/contractors.ts:18 | Contractor balance `<0` ("له"/we owe) shown `warn` in reports but neutral in parties — exactly the v0.13 inconsistency P-591 says must be unified. | S5 | Use neutral tone (match parties). |
| A-009 | medium | invented number | sections/projects/views/ProjectView.tsx:77 | `termDays ?? 0` renders "0 يوم" when term unknown; rule is "—" not zero. | S3 | Render `—` when `termDays == null`. |
| A-010 | medium | invented zeros | projects/views/ProjectsView.tsx:45-50,115-133; ProjectView.tsx:53-57 | KPIs/cards use `?? 0` -> missing data shows 0.00 SAR. | S3 | Pass `null` so `Kpi`/`Money` render "—". |
| A-011 | low | money arithmetic | sections/today/Due.tsx:75,77 | `s.totalPaid + s.outstanding` float sum displayed (ExplainDot + hint); label "سُدّد هذا العام" asserts a period not verified against /dashboard. | S1 | Use `sumHalalas`; confirm period wording. |
| A-012 | low | parity | sections/today/PARITY-today.md | P-483, P-487, P-488 implemented (Assistant.tsx:42-55) but not listed. | S1 | Add rows. |
| A-013 | low | parity | sections/data/PARITY-data.md | P-481 (`/ai/learned-layouts`) not claimed. | S6 | Add row / verify SettingsView. |
| A-014 | low | perf/contract drift | sections/today/data.ts:5-12 | Today composes 6 endpoints instead of the one-request `/today` (kpis/tasks/staleness unused). | S1 + B | Migrate to `/today` once stable. |
| A-015 | low | shell robustness | app/routes.tsx:104-120 | `build()` silently accepts duplicate keys/paths across sections (none today). | F | DEV-mode warning on duplicates. |
| A-016 | low | backend hygiene | services/api/app/api/routes/ai.py:64, revenues.py:195 | Pydantic v2 `.dict()` deprecation warnings (28). | B | `model_dump()`. |

Note: a first `tsc` pass (taken mid-write) also showed `shell/Island.ts` vs `island.ts` casing collision, missing `@tanstack/react-query`, `useGo` missing from `@/shell`, and implicit-any in cash views; all resolved on re-run (shell now has `StatusIsland.tsx`). Watch case-only renames: they break on case-sensitive FS (CI/Linux).

## 10 high-risk capabilities
| # | P-ids | Status | Evidence |
|---|---|---|---|
| 1 | P-224/227/228 | present | cash/parts/ReconFooter.tsx:39-64 (halala badge, DiffAsk), cash/parts/BreakdownModal.tsx, cash/api.ts:35-41 |
| 2 | P-273/274 | present | data/import/parts.tsx:187-218, data/lib/labels.ts:17 |
| 3 | P-288 | present | data/import/ClassifyModal.tsx, ImportView.tsx:135, data/api.ts:61 |
| 4 | P-109/364/555-572 | present (in progress) | parties/Contractors.tsx:106,186 (14 formats via lib/api.ts:487-491), ContractorDetail.tsx:134 single_statement, print views Contractors.tsx:58-60 |
| 5 | P-093/094 | present | parties/SupplierDetail.tsx:122,177; parties/api.ts:49-59 (incl. clear-allocation) |
| 6 | P-362 | present | ui/Modal.tsx:10-96 (auto-dirty guard, Tab trap, focus restore) |
| 7 | P-135 etc. | present | today/Due.tsx:70,144; parties/hooks.ts:28; reports/ProjectSummaryTab.tsx:84 |
| 8 | P-201/202 | present (in progress) | projects/components/BudgetEntryForm.tsx:62-108 |
| 9 | P-296/299 | present | data/import/History.tsx:72,134 (3-minute legacy), useImportHistory.ts:41-58 |
| 10 | P-004/517/522/528 | present | app/App.tsx:54-87 (backend restarted), data/hooks/useBackups.ts:42, useSettings.ts:75-77 |

## Parity counts (P-ids referenced per file)
today 46 · parties 164 · projects 59 · cash 73 · reports 62 · data 132. Unclaimed 114, multi-referenced 40.
