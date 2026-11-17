# -*- coding: utf-8 -*-
"""تصفير البيانات — مسار واحد يمحو بيانات الشركة بعد نسخة احتياطية إجبارية.

مفصول عن `trash.py` عمداً: سلّة المحذوفات تحذف صفاً بعينه اختاره المستخدم ورآه،
وهذا يمحو كل شيء دفعةً واحدة. خلطهما في مسار واحد يجعل خطأً في `kind` قادراً على
محو القاعدة بدل صف.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services import backup_service as BS
from app.services import reset_service as RS

logger = logging.getLogger(__name__)
router = APIRouter()


class ResetBody(BaseModel):
    #: يجب أن تساوي RS.CONFIRM_PHRASE حرفياً
    confirm: str = ''


@router.get('/preview')
def reset_preview(db: Session = Depends(get_session)) -> dict:
    """ماذا سيُحذف وماذا سيبقى — بالأعداد الفعلية قبل التنفيذ."""
    return RS.preview(db)


@router.post('')
def reset(body: ResetBody, db: Session = Depends(get_session)) -> dict:
    """يمحو بيانات الشركة بعد أخذ نسخة احتياطية.

    الترتيب ليس تفصيلاً: النسخة أولاً، وإن فشلت **لا يُمحى شيء**. بيانات لا يمكن
    إعادة إدخالها لا تُمحى على أمل أن تكون هناك نسخة قديمة كافية.
    """
    if body.confirm.strip() != RS.CONFIRM_PHRASE:
        raise HTTPException(400, detail='التأكيد غير مطابق — اكتب «%s» للمتابعة'
                                        % RS.CONFIRM_PHRASE)

    before = RS.preview(db)
    try:
        backup = BS.create_backup('before-reset', BS.get_external_dir(db))
    except (FileNotFoundError, RuntimeError, OSError, ValueError) as e:
        # الرفض هنا هو الحماية نفسها، لا عائقاً أمامها.
        logger.error('أُلغي التصفير: تعذّرت النسخة الاحتياطية — %s', e)
        raise HTTPException(
            500, detail='تعذّر أخذ نسخة احتياطية، ولم يُحذف شيء. '
                        'عالج سبب الفشل ثم أعد المحاولة: %s' % e)

    result = RS.reset_all(db, backup_name=backup.get('name'))
    result['backupInfo'] = backup
    result['before'] = before
    return result
