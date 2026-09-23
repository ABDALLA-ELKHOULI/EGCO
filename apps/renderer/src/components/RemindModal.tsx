import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal, useModalClose } from '@/components/Modal';
import { CopyButton } from '@/components/Ai';

/**
 * نافذة «صياغة مطالبة» — تُستخدم في كشف المورد وكشف المقاول.
 * النص مسودة قابلة للتعديل دائماً، ولا يُحفظ تلقائياً في أي مكان.
 */
export function RemindModal({ partyKind, partyKey, onClose }: {
  partyKind: 'supplier' | 'contractor';
  partyKey: string;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // نص «إعادة الصياغة» ليس تعديلاً يدوياً — القيمة الأولية تُحدَّث معه، فلا يُسأل
  // المستخدم عن تجاهل نص لم يكتبه هو.
  const loadedText = useRef('');

  async function load() {
    setBusy(true); setError(null);
    try {
      const r = await api.aiRemind({ partyKind, key: partyKey });
      setText(r.message);
      loadedText.current = r.message;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // dirty: النص يختلف عن آخر ما وصل من الخادم (تحرير يدوي، لا «إعادة صياغة» —
    // تلك تُحدّث loadedText معها في load()).
    <Modal title="صياغة مطالبة" onClose={onClose} maxWidth={560} dirty={text !== loadedText.current}>
      <div className="form-stack">
        {error && <div className="callout bad">{error}</div>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={busy ? 'جارٍ الصياغة…' : ''}
          disabled={busy}
          rows={8}
                  />
        <div className="modal-foot split">
          <button className="btn" onClick={load} disabled={busy}>
            {busy ? 'جارٍ إعادة الصياغة…' : 'إعادة الصياغة'}
          </button>
          <div className="group">
            <CloseButton />
            {/* النسخ هو الإجراء الأساسي هنا — المسودة لا تُحفظ في أي مكان */}
            <CopyButton text={text} primary />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** زرّ «إغلاق» يمرّ بمسار تأكيد Modal (dirty) بدل مناداة onClose مباشرة —
 * مكوّن مستقل لأن useModalClose يقرأ السياق من موضعه في شجرة العرض الفعلية،
 * وهو هنا تحت Modal.Provider (ضمن children)، لا داخل RemindModal نفسها. */
function CloseButton() {
  const requestClose = useModalClose();
  return <button className="btn" onClick={requestClose}>إغلاق</button>;
}
