/** منتقي النطاق (P-303، P-378): الشركة · مشروع · مورد · مقاول، بمجموعات «لديهم كشوفات/بلا». */
import type { ScopesPayload } from './types';
import type { ScopeValue } from './useReportParams';

export function ScopeSelect({ scopes, value, onChange, label = 'النطاق', allowContractor = true }: {
  scopes: ScopesPayload | null; value: ScopeValue; onChange: (v: ScopeValue) => void; label?: string; allowContractor?: boolean;
}) {
  const sup = scopes?.suppliers ?? [];
  const con = scopes?.contractors ?? [];
  return (
    <label className="rp-f"><span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="company">الشركة كاملة</option>
        {scopes && scopes.projects.length > 0 && (
          <optgroup label="مشروع واحد">{scopes.projects.map((p) => <option key={p} value={`project:${p}`}>{p}</option>)}</optgroup>
        )}
        {sup.some((s) => s.hasData) && (
          <optgroup label="مورد — لديهم كشوفات">{sup.filter((s) => s.hasData).map((s) => <option key={s.account} value={`supplier:${s.account}`}>{s.name} · {s.account}</option>)}</optgroup>
        )}
        {sup.some((s) => !s.hasData) && (
          <optgroup label="مورد — بلا كشوفات (التقرير سيكون فارغاً)">{sup.filter((s) => !s.hasData).map((s) => <option key={s.account} value={`supplier:${s.account}`}>{s.name} · {s.account}</option>)}</optgroup>
        )}
        {allowContractor && con.some((c) => c.hasData) && (
          <optgroup label="مقاول — لديهم حركة">{con.filter((c) => c.hasData).map((c) => <option key={c.code} value={`contractor:${c.code}`}>{c.name} · {c.code}</option>)}</optgroup>
        )}
        {allowContractor && con.some((c) => !c.hasData) && (
          <optgroup label="مقاول — بلا حركة">{con.filter((c) => !c.hasData).map((c) => <option key={c.code} value={`contractor:${c.code}`}>{c.name} · {c.code}</option>)}</optgroup>
        )}
      </select>
    </label>
  );
}
