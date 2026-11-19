/**
 * «اسأل، لا تخمّن» (P-288) — حساب بادئته ليست ٢١١/٢١٢/٢١٦ لا يُحفظ حتى يقرّر
 * المستخدم. اقتراح الذكاء (إن فُعِّل) تنبيه هادئ «القرار لك» ولا يقرّر شيئاً.
 */
import { useState } from 'react';
import { Modal } from '@/ui';
import { useClassify } from '../hooks/useImportHistory';
import { CLASS_LABEL, CLASS_ORDER } from '../lib/labels';
import { errMsg } from '../api';
import { Callout } from './parts';
import type { ClassKind } from '../types';

export interface ClassifyTarget {
  path: string; fileName: string; account: string; parsedName: string;
  /** من قائمة المعاينة (لا الدفعة) — تُعاد معاينة هذا الصف وحده بعد الحفظ (P-289). */
  queueIdx?: number;
}

export function ClassifyModal({ target, aiEnabled, onClose, onSaved }: {
  target: ClassifyTarget; aiEnabled: boolean; onClose: () => void; onSaved: (kind: ClassKind) => void;
}) {
  const { suggestion, save } = useClassify(target.path, aiEnabled);
  const [error, setError] = useState<string | null>(null);

  const choose = (kind: ClassKind) => async (close: (force?: boolean) => void) => {
    setError(null);
    try { await save(target.account, kind, target.parsedName); close(true); onSaved(kind); }
    catch (e) { setError(errMsg(e)); }
  };

  return (
    <Modal open onClose={onClose} title="تصنيف حساب" size="md"
      actions={[
        ...CLASS_ORDER.map((k) => ({ label: CLASS_LABEL[k], kind: k === 'ignore' ? 'ghost' as const : 'primary' as const, onClick: choose(k) })),
        { label: 'إلغاء' },
      ]}>
      <div className="sec-data">
        <p>
          رقم الحساب <b className="num ltr">{target.account || '—'}</b>
          {target.parsedName && <> — «{target.parsedName}»</>} في ملف «{target.fileName}» ليس مورداً (٢١١) ولا مقاولاً (٢١٢) ولا ضماناً (٢١٦).
          اختر تصنيفه ليُحفظ — ونتذكّره في كل رفع قادم.
        </p>
        {aiEnabled && suggestion?.kind && (
          <Callout>اقتراح آلي — القرار لك: {CLASS_LABEL[suggestion.kind as ClassKind] ?? suggestion.kind}{suggestion.reason && <> — {suggestion.reason}</>}</Callout>
        )}
        {error && <Callout tone="bad">{error}</Callout>}
      </div>
    </Modal>
  );
}
