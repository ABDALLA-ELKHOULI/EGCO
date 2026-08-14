import { useEffect, useState } from 'react';
import { api, type PartyScope } from '@/lib/api';
import { ar } from '@/lib/format';

export interface Scope {
  kind: 'company' | 'supplier' | 'project' | 'contractor';
  account?: string;
  project?: string;
  contractor?: string;
}

interface SupplierOption {
  account: string;
  name: string;
  project: string;
  hasData: boolean;
}

interface ContractorOption {
  code: string;
  name: string;
  hasData: boolean;
}

const PARTY_LABELS: { value: PartyScope; label: string }[] = [
  { value: 'both', label: 'كلاهما' },
  { value: 'suppliers', label: 'الموردون فقط' },
  { value: 'contractors', label: 'المقاولون فقط' },
];

/**
 * اختيار نطاق التقرير: كل الشركة · مورد واحد · مشروع واحد · مقاول واحد،
 * إضافة إلى الأطراف المشمولة (موردون / مقاولون / كلاهما).
 *
 * Suppliers with no statements are still listed but marked, because picking one and
 * getting an empty report should be explained before it happens, not after.
 * The contractor list is optional: a backend that does not yet publish it simply
 * hides that option instead of offering a scope it cannot serve.
 */
export function ScopeBar({ scope, onChange, parties, onPartiesChange }: {
  scope: Scope;
  onChange: (s: Scope) => void;
  parties?: PartyScope;
  onPartiesChange?: (p: PartyScope) => void;
}) {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [contractors, setContractors] = useState<ContractorOption[]>([]);

  useEffect(() => {
    api.reportScopes()
      .then((d) => {
        setSuppliers(d.suppliers ?? []);
        setProjects(d.projects ?? []);
        setContractors(d.contractors ?? []);
      })
      .catch(() => { /* الشريط يبقى صالحاً بنطاق الشركة */ });
  }, []);

  const withData = suppliers.filter((s) => s.hasData);
  const withoutData = suppliers.filter((s) => !s.hasData);
  const cWithData = contractors.filter((c) => c.hasData);
  const cWithoutData = contractors.filter((c) => !c.hasData);

  return (
    <div className="toolbar" style={{ marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>نطاق التقرير</span>

      <select
        value={scope.kind}
        onChange={(e) => {
          const kind = e.target.value as Scope['kind'];
          if (kind === 'company') onChange({ kind: 'company' });
          else if (kind === 'supplier') onChange({ kind: 'supplier', account: withData[0]?.account ?? suppliers[0]?.account });
          else if (kind === 'contractor') onChange({ kind: 'contractor', contractor: cWithData[0]?.code ?? contractors[0]?.code });
          else onChange({ kind: 'project', project: projects[0] });
        }}
      >
        <option value="company">كل الموردين</option>
        <option value="supplier">مورد واحد</option>
        <option value="project">مشروع واحد</option>
        {contractors.length > 0 && <option value="contractor">مقاول واحد</option>}
      </select>

      {scope.kind === 'supplier' && (
        <select value={scope.account ?? ''} style={{ minWidth: 300 }}
                onChange={(e) => onChange({ kind: 'supplier', account: e.target.value })}>
          {withData.length > 0 && (
            <optgroup label={`لديهم كشوفات (${ar(withData.length)})`}>
              {withData.map((s) => (
                <option key={s.account} value={s.account}>{s.name}</option>
              ))}
            </optgroup>
          )}
          {withoutData.length > 0 && (
            <optgroup label={`بلا كشوفات — التقرير سيكون فارغاً (${ar(withoutData.length)})`}>
              {withoutData.map((s) => (
                <option key={s.account} value={s.account}>{s.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      )}

      {scope.kind === 'contractor' && (
        <select value={scope.contractor ?? ''} style={{ minWidth: 260 }}
                onChange={(e) => onChange({ kind: 'contractor', contractor: e.target.value })}>
          {cWithData.length > 0 && (
            <optgroup label={`لديهم حركة (${ar(cWithData.length)})`}>
              {cWithData.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </optgroup>
          )}
          {cWithoutData.length > 0 && (
            <optgroup label={`بلا حركة — التقرير سيكون فارغاً (${ar(cWithoutData.length)})`}>
              {cWithoutData.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </optgroup>
          )}
        </select>
      )}

      {scope.kind === 'project' && (
        <select value={scope.project ?? ''} style={{ minWidth: 200 }}
                onChange={(e) => onChange({ kind: 'project', project: e.target.value })}>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}

      {onPartiesChange && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
          الأطراف
          <select value={parties ?? 'suppliers'}
                  onChange={(e) => onPartiesChange(e.target.value as PartyScope)}>
            {PARTY_LABELS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/** يحوّل النطاق إلى معاملات الاستدعاء — مكان واحد يمنع اختلاف الشاشة عن التصدير. */
export function scopeParams(scope: Scope): { account?: string; project?: string; contractor?: string } {
  if (scope.kind === 'supplier') return { account: scope.account };
  if (scope.kind === 'project') return { project: scope.project };
  if (scope.kind === 'contractor') return { contractor: scope.contractor };
  return {};
}
