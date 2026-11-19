# -*- coding: utf-8 -*-
"""يصنع PDF «كشوف مجمّعة» صغيراً (٣ حسابات موردين، صفحة لكل حساب) لاختبار e2e.

التخطيط النصي منسوخ من services/api/tests/test_statement_bundle.py (نفس ترويسة الطباعة)
ويُكتب سطراً سطراً بـPyMuPDF وخط يدعم العربية، فيعيد get_text النص نفسه — فيمرّ الملف
بالمسار الحقيقي كاملاً (is_bundle → split → المحلّل → بوابة المطابقة) بلا أي monkeypatch.
الحساب الثالث إجماليه المطبوع لا يطابق عمداً: يجب أن يُحجز وحده ولا يوقف البقية.

  python make_bundle_pdf.py <out.pdf> <account1> <account2> <account3>
"""
import os
import re
import sys

import fitz

HEADER = ('تقرير كشف حساب\nشركة اعمار الخلیج المصریة للمقاولات\nالفرع الرئیسي\n'
          'مطبوع بواسطة\nمدیر النظام\n: من تاریخ2025-01-01\n: الى تاریخ2026-11-10\n'
          '01-07-1446\n30-05-1448\n{pageno}\n{account}\n: الحساب\nالتاریخ\nالوصف\n'
          'مدین\nدائن\n{name}\nالرقم\nرصید\nالفرع\n')


def page(account, name, body, pageno):
    return HEADER.format(pageno=pageno, account=account, name=name) + body


def opening(credit):
    return 'رصید افتتاحي0.00\n%s\n(%s)\n0001\n \n \n' % (credit, credit)


def block(doc, date, desc, debit, credit, balance):
    return ('ID=00TrxType=GLJVTrxNo=%s\n%s%s%s\n%s\n%s\n%s\n0001\n \n \n'
            % (doc, date, desc, debit, credit, doc, balance))


def footer(d, c, closing):
    return '%s\n%sاجمالي الحساب%sفقط لا غير\nPage 1 of 3\n' % (d, c, closing)


FONTS = ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
         '/Library/Fonts/Arial Unicode.ttf',
         '/System/Library/Fonts/Supplemental/Arial.ttf',
         # ويندوز (مشغّل CI windows-latest): خطوط النظام تدعم العربية
         os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', 'arial.ttf'),
         os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', 'tahoma.ttf'),
         # لينكس
         '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']


def main(out, a1, a2, a3):
    import os
    font = next((f for f in FONTS if os.path.exists(f)), None)
    if font is None:
        sys.exit('no Arabic-capable font found')
    pages = [
        page(a1, 'مورد حزمة أول', opening('1,000.00')
             + block('00000001', '2025-02-01', 'فاتوره رقم11 للأول', '0.00', '500.00', '(1,500.00)')
             + footer('0.00', '1,500.00', '(1,500.00)'), 1),
        page(a2, 'مورد حزمة ثان', opening('50.00') + footer('0.00', '50.00', '(50.00)'), 2),
        page(a3, 'مورد حزمة ثالث', opening('10.00') + footer('0.00', '10.00', '(99.00)'), 3),
    ]
    # get_text يعيد ترتيب كل مقطع عربي (يعكسه) ويلحق الأقواس المجاورة به. فكل سطر
    # يُقطَّع مقاطعَ عربية/غير عربية، يُكتب كل مقطع span مستقلاً متتالياً، والعربي
    # معكوساً — فيعيد الاستخراج السطرَ الأصلي حرفياً (مُتحقَّق منه).
    seg = re.compile(r'[\u0600-\u06FF]+(?: [\u0600-\u06FF]+)*|[^\u0600-\u06FF]+')
    arabic = re.compile(r'[\u0600-\u06FF]')
    f = fitz.Font(fontfile=font)
    doc = fitz.open()
    for text in pages:
        p = doc.new_page(width=595, height=1200)
        y = 20
        for line in text.split('\n'):
            x = 20
            for part in seg.findall(line):
                s = part[::-1] if arabic.search(part) else part
                p.insert_text((x, y), s, fontsize=9, fontname='ar', fontfile=font)
                x += f.text_length(s, fontsize=9)
            y += 13
    doc.subset_fonts()  # يضمّن الحروف المستعملة فقط بدل الخط كاملاً (~٢٣ م.ب)
    doc.save(out, garbage=4, deflate=True)


if __name__ == '__main__':
    main(*sys.argv[1:5])
