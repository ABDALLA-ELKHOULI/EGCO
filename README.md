# لوحة إعمار الخليج المصرية للمقاولات

Internal financial dashboard for **شركة إعمار الخليج المصرية للمقاولات** (EGCO). It reads
supplier statements, contractor statements, and budget workbooks, and turns them into
payables, receivables, cash flow, and budget-deviation views for internal use.

لوحة تحكم مالية داخلية لشركة إعمار الخليج المصرية للمقاولات. تعالج كشوف الموردين
والمقاولين وملفات الموازنة، وتعرضها كتقارير للذمم الدائنة والمدينة والتدفق النقدي
والانحراف عن الموازنة، للاستخدام الداخلي فقط.

## Stack

- **Electron** desktop shell (Windows + macOS)
- **React** renderer (`apps/renderer`)
- **FastAPI** backend (`services/api`)
- **SQLite** — fully local storage, no external database or cloud service

Everything runs on the user's machine. There is no server-side component.

## Development

```bash
npm install
npm run setup      # one-time environment/dependency setup (Python venv, etc.)
npm run dev         # runs the Electron app with the renderer and API in dev mode
npm run test:api    # runs the FastAPI test suite (pytest)
```

## Releases

Pushing a tag matching `v*` triggers the GitHub Actions release workflow
(`.github/workflows/release.yml`), which runs `npm run setup`, `npm run test:api`, and
then builds signed Windows and macOS installers. Installed apps check for and apply
updates automatically.

## Data policy

**No company data lives in this repository.** Real financial statements, supplier
account numbers, and any other confidential figures are excluded via `.gitignore`
(`design/samples/*.pdf`, `design/samples/*.xlsx`, `design/samples/statements-batch/`)
and never committed. Tests that depend on those local-only sample files skip
automatically when the files are absent, so the test suite stays green in CI without
them.
