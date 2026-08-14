/**
 * قاموس شرح الأرقام — كل مقياس يعرّف معناه، صيغته الحسابية، وكيفية تعويض
 * القيم الحقيقية فيها. لا استدعاء لأي خدمة ذكاء اصطناعي هنا: كل شيء حتمي
 * ومحسوب من القيم التي يمرّرها المكوّن مباشرة (ما هو معروض على الشاشة فعلاً).
 */
import { sar } from './format';

export interface ExplainResult {
  /** السطر الذي يعوّض المتغيرات بأرقام حقيقية، أو null إن غابت القيم. */
  substitution: string | null;
  /** النتيجة النهائية المنسّقة، أو null إن تعذّر الحساب. */
  result: string | null;
}

export interface Explanation {
  title: string;
  /** «ماذا يعني» — نثر عربي بسيط لمدير مالي، بلا مصطلحات. */
  meaning: string;
  /** «كيف حُسب» — الصيغة بأسماء المتغيرات. */
  formula: string;
  /** يحسب سطر التعويض والنتيجة من القيم الممرَّرة؛ يتجاهل بأمان أي قيمة غائبة. */
  compute: (values: Record<string, number | undefined | null>) => ExplainResult;
  /** «مصدر البيانات» — جملة قصيرة عن منشأ الأرقام. */
  source: string;
}

const money = (v: number | undefined | null) => (v == null ? null : sar(v));

export const EXPLANATIONS: Record<string, Explanation> = {
  openingBalance: {
    title: 'الرصيد الافتتاحي',
    meaning:
      'كل ما فُوتر قبل بداية الفترة ناقص كل ما سُدد قبلها. رقم سالب يعني أن الشركة '
      + 'دخلت الفترة وهي دافعة مقدّماً (لها رصيد لدى المورد لا عليها).\n'
      + 'ملاحظة: الحساب يغطي فقط الفواتير والمدفوعات الموجودة في البيانات المرفوعة؛ '
      + 'أي حركة سابقة لم تُرفع لا تدخل في الرقم.',
    formula: 'الافتتاحي = Σ الفواتير قبل البداية − Σ المدفوعات قبل البداية',
    compute: (v) => {
      const invoiced = v.invoicedBefore, paid = v.paidBefore, opening = v.openingBalance;
      if (invoiced == null || paid == null) return { substitution: null, result: money(opening) };
      return {
        substitution: `${sar(invoiced)} − ${sar(paid)}`,
        result: money(opening ?? invoiced - paid),
      };
    },
    source: 'من الفواتير والمدفوعات المسجّلة في دفاتر الموردين قبل تاريخ بداية الفترة.',
  },

  periodMovement: {
    title: 'حركة الفترة',
    meaning:
      'المفوتر خلال الفترة ناقص المسدد خلالها. رقم موجب يعني أن المديونية زادت '
      + 'خلال الفترة، وسالب يعني أنها تراجعت.',
    formula: 'الحركة = المفوتر خلال الفترة − المسدد خلالها؛ والمتحقق: الافتتاحي + الحركة = الختامي',
    compute: (v) => {
      const invoiced = v.invoicedInPeriod, paid = v.paidInPeriod;
      const opening = v.openingBalance, closing = v.closingBalance;
      if (invoiced == null || paid == null) return { substitution: null, result: null };
      const movement = v.periodMovement ?? invoiced - paid;
      let sub = `${sar(invoiced)} − ${sar(paid)} = ${sar(movement)}`;
      if (opening != null && closing != null) {
        sub += `\nالافتتاحي + الحركة = الختامي: ${sar(opening)} + ${sar(movement)} = ${sar(opening + movement)} (الختامي المسجَّل ${sar(closing)})`;
      }
      return { substitution: sub, result: money(movement) };
    },
    source: 'من فواتير ومدفوعات الفترة المحدَّدة في نفس النطاق المعروض.',
  },

  closingBalance: {
    title: 'الرصيد الختامي',
    meaning: 'الافتتاحي زائد حركة الفترة — ما تدين به الشركة (أو ما دفعته مقدّماً) في نهاية الفترة.',
    formula: 'الختامي = الافتتاحي + الحركة',
    compute: (v) => {
      const opening = v.openingBalance, movement = v.periodMovement, closing = v.closingBalance;
      if (opening == null || movement == null) return { substitution: null, result: money(closing) };
      return {
        substitution: `${sar(opening)} + ${sar(movement)}`,
        result: money(closing ?? opening + movement),
      };
    },
    source: 'ناتج مباشر من الرصيد الافتتاحي وحركة الفترة أعلاه.',
  },

  outstanding: {
    title: 'المديونية المفتوحة',
    meaning: 'إجمالي المفوتر ناقص إجمالي المسدد — ما تبقى غير مسدد حتى الآن، بصرف النظر عن تاريخ الاستحقاق.',
    formula: 'المديونية المفتوحة = إجمالي المفوتر − إجمالي المسدد',
    compute: (v) => {
      const invoiced = v.totalInvoiced, paid = v.totalPaid, outstanding = v.outstanding;
      if (invoiced == null || paid == null) return { substitution: null, result: money(outstanding) };
      return { substitution: `${sar(invoiced)} − ${sar(paid)}`, result: money(outstanding ?? invoiced - paid) };
    },
    source: 'من مجموع الفواتير والمدفوعات المسجّلة لكل الموردين في النطاق المعروض.',
  },

  overdue: {
    title: 'المتأخر عن موعده',
    meaning: 'مجموع المتبقي من الفواتير التي تجاوز تاريخ استحقاقها اليوم. الاستحقاق = تاريخ الفاتورة + مدة سداد المورد.',
    formula: 'المتأخر = Σ متبقي الفواتير حيث (تاريخ الفاتورة + مدة المورد) < اليوم',
    compute: (v) => {
      const overdue = v.overdue;
      return { substitution: overdue == null ? null : `مجموع الفواتير المتأخرة`, result: money(overdue) };
    },
    source: 'من تاريخ كل فاتورة ومدة السداد المتفق عليها لكل مورد.',
  },

  dueWithin7: {
    title: 'مستحق خلال ٧ أيام',
    meaning: 'مجموع المتبقي من الفواتير التي يقع تاريخ استحقاقها خلال السبعة أيام القادمة من اليوم.',
    formula: 'مستحق خلال ٧ أيام = Σ متبقي الفواتير حيث ٠ ≤ (تاريخ الاستحقاق − اليوم) ≤ ٧',
    compute: (v) => {
      const due = v.dueWithin7;
      return { substitution: due == null ? null : 'مجموع الفواتير المستحقة خلال الأسبوع القادم', result: money(due) };
    },
    source: 'من تاريخ استحقاق كل فاتورة مقارنة بتاريخ اليوم.',
  },

  contractorBalance: {
    title: 'رصيد المقاول',
    meaning:
      'مجموع المستخلصات (مدين) ناقص مجموع المدفوعات (دائن). رصيد سالب معناه «له» — '
      + 'نحن مدينون للمقاول ويجب أن ندفع له. رصيد موجب معناه «لنا» — دفعنا أكثر مما استُحق.',
    formula: 'الرصيد = Σ مدين (مستخلصات) − Σ دائن (مدفوعات)',
    compute: (v) => {
      const debit = v.duesTotal, credit = v.paidTotal, balance = v.balance;
      if (debit == null || credit == null) return { substitution: null, result: money(balance) };
      return { substitution: `${sar(debit)} − ${sar(credit)}`, result: money(balance ?? debit - credit) };
    },
    source: 'من قيد حركات المقاول (مدين/دائن) في دفتره.',
  },

  retentionHeld: {
    title: 'الضمان المحتجز',
    meaning: 'مجموع ضمانات المشاريع التي لم تُصرف بعد لهذا المقاول — مبلغ محتجز لدى الشركة حتى استيفاء شروط الإفراج.',
    formula: 'الضمان المحتجز = Σ ضمانات المشاريع غير المصروفة',
    compute: (v) => {
      const held = v.retentionHeld;
      return { substitution: held == null ? null : 'مجموع الضمانات غير المصروفة', result: money(held) };
    },
    source: 'من سجل ضمانات المقاول لكل مشروع، مستبعداً ما أُفرج عنه.',
  },

  cashflowHorizon: {
    title: 'أفق التدفق النقدي',
    meaning:
      'الأفق ١٣ أو ٢٦ أسبوعاً القادمة، وكل صف في الجدول يمثّل فترة أسبوعين. الرصيد '
      + 'في كل فترة تراكمي من بداية الأفق، فرقم سالب فيه يعني عجزاً متوقعاً في تلك الفترة.',
    formula: 'رصيد الفترة = رصيد الفترة السابقة + الداخل − الخارج',
    compute: () => ({ substitution: null, result: null }),
    source: 'من فواتير الموردين المستحقة والتحصيلات المتوقعة داخل الأفق المختار.',
  },

  budgetDelay: {
    title: 'نسبة التأخر',
    meaning: 'الفجوة بين ما أُنجز فعلياً تراكمياً وما كان مخططاً، منسوبةً إلى المخطط. رقم موجب يعني تأخراً عن الخطة.',
    formula: 'نسبة التأخر = (التراكمي المخطط − التراكمي الفعلي) ÷ التراكمي المخطط',
    compute: (v) => {
      const planned = v.plannedCum, actual = v.actualCum, delayPct = v.delayPct;
      if (planned == null || actual == null) return { substitution: null, result: delayPct == null ? null : `${sar(delayPct * 100)}٪` };
      const pct = delayPct ?? (planned - actual) / planned;
      return { substitution: `(${sar(planned)} − ${sar(actual)}) ÷ ${sar(planned)}`, result: `${sar(pct * 100)}٪` };
    },
    source: 'من تقرير انحراف الموازنة لأحدث شهر مرفوع.',
  },

  budgetCompletion: {
    title: 'نسبة الإنجاز',
    meaning: 'نسبة ما أُنجز فعلياً تراكمياً من إجمالي قيمة العقد المخطط لها.',
    formula: 'نسبة الإنجاز = التراكمي الفعلي ÷ إجمالي العقد المخطط',
    compute: (v) => {
      const actual = v.actualCum, total = v.plannedTotal, completionPct = v.completionPct;
      if (actual == null || total == null) return { substitution: null, result: completionPct == null ? null : `${sar(completionPct * 100)}٪` };
      const pct = completionPct ?? actual / total;
      return { substitution: `${sar(actual)} ÷ ${sar(total)}`, result: `${sar(pct * 100)}٪` };
    },
    source: 'من تقرير انحراف الموازنة لأحدث شهر مرفوع.',
  },
};

export type ExplainMetric = keyof typeof EXPLANATIONS;
