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

  netOutstanding: {
    title: 'الصافي',
    meaning:
      'المديونية المفتوحة بعد خصم أرصدة موردين دفعنا لهم أكثر من فواتيرهم (رصيد لنا مقدَّم). '
      + 'هذا هو الرقم الذي يتصالح فعلاً مع «الافتتاحي + حركة الفترة»؛ المديونية المفتوحة وحدها '
      + 'لا تفعل، لأنها تُصفِّر فائض كل مورد عند الصفر بدل أن تطرحه.',
    formula: 'الصافي = المديونية المفتوحة − أرصدة لنا (مقدَّمة)',
    compute: (v) => {
      const outstanding = v.outstanding, credit = v.creditBalances, net = v.netOutstanding;
      if (outstanding == null || credit == null) return { substitution: null, result: money(net) };
      return {
        substitution: `${sar(outstanding)} − ${sar(credit)}`,
        result: money(net ?? outstanding - credit),
      };
    },
    source: 'من مجموع المديونية المفتوحة وأرصدة الموردين المدفوعة أكثر من فواتيرهم في النطاق المعروض.',
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
      'الأفق ١٣ أو ٢٦ أسبوعاً القادمة، وكل صف في الجدول يمثّل فترة طولها بعدد الأيام '
      + 'المختار في «طول الفترة» أعلاه — أسبوع أو أسبوعان أو شهر أو أي عدد أيام مخصص '
      + 'بين ١ و٩٢. الرصيد في كل فترة تراكمي من بداية الأفق، فرقم سالب فيه يعني عجزاً '
      + 'متوقعاً في تلك الفترة.',
    formula: 'رصيد الفترة = رصيد الفترة السابقة + الداخل − الخارج',
    compute: (v) => {
      const periodDays = v.periodDays;
      if (periodDays == null) return { substitution: null, result: null };
      return { substitution: 'طول الفترة الحالي', result: `${periodDays} يوماً` };
    },
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

  revenuesOpen: {
    title: 'المستحق المفتوح',
    meaning: 'مجموع مبالغ التحصيلات التي لم تُحصَّل بعد — عملاء لم يسددوا دفعتهم حتى الآن.',
    formula: 'المستحق المفتوح = Σ مبالغ التحصيلات بحالة «مفتوح»',
    compute: (v) => {
      const open = v.revenuesOpen;
      return { substitution: open == null ? null : 'مجموع التحصيلات المفتوحة', result: money(open) };
    },
    source: 'من صفوف التحصيلات المدخلة يدوياً أو المرفوعة بحالة «مفتوح».',
  },

  revenuesCollected: {
    title: 'المحصّل',
    meaning: 'مجموع مبالغ التحصيلات التي سُددت فعلاً من العملاء حتى تاريخه.',
    formula: 'المحصّل = Σ مبالغ التحصيلات بحالة «محصّل»',
    compute: (v) => {
      const collected = v.revenuesCollected;
      return { substitution: collected == null ? null : 'مجموع التحصيلات المحصّلة', result: money(collected) };
    },
    source: 'من صفوف التحصيلات المدخلة يدوياً أو المرفوعة بحالة «محصّل».',
  },

  revenuesTotal: {
    title: 'الإجمالي',
    meaning: 'مجموع كل التحصيلات — المفتوح والمحصّل معاً — بصرف النظر عن الحالة.',
    formula: 'الإجمالي = المستحق المفتوح + المحصّل',
    compute: (v) => {
      const open = v.revenuesOpen, collected = v.revenuesCollected, total = v.revenuesTotal;
      if (open == null || collected == null) return { substitution: null, result: money(total) };
      return { substitution: `${sar(open)} + ${sar(collected)}`, result: money(total ?? open + collected) };
    },
    source: 'ناتج مباشر من جمع المستحق المفتوح والمحصّل أعلاه.',
  },

  contractorsOwed: {
    title: 'إجمالي مستحق للمقاولين',
    meaning: 'مجموع أرصدة كل المقاولين الذين رصيدهم سالب — أي ما تدين به الشركة لهم فعلياً («له»).',
    formula: 'مستحق للمقاولين = Σ |رصيد المقاول| لكل مقاول رصيده سالب',
    compute: (v) => {
      const owed = v.contractorsOwed;
      return { substitution: owed == null ? null : 'مجموع الأرصدة السالبة (له) لكل المقاولين', result: money(owed) };
    },
    source: 'من مجموع أرصدة المقاولين المسجّلة في دفاترهم.',
  },

  contractorsOwedToUs: {
    title: 'إجمالي مستحق لنا',
    meaning: 'مجموع أرصدة كل المقاولين الذين رصيدهم موجب — أي ما دفعته الشركة لهم أكثر من المستحق («لنا»).',
    formula: 'مستحق لنا = Σ رصيد المقاول لكل مقاول رصيده موجب',
    compute: (v) => {
      const owedToUs = v.contractorsOwedToUs;
      return { substitution: owedToUs == null ? null : 'مجموع الأرصدة الموجبة (لنا) لكل المقاولين', result: money(owedToUs) };
    },
    source: 'من مجموع أرصدة المقاولين المسجّلة في دفاترهم.',
  },

  contractorsRetention: {
    title: 'الضمانات المحتجزة',
    meaning: 'مجموع ضمانات كل المشاريع المحتجزة لدى الشركة لكل المقاولين مجتمعين، ولم تُصرف بعد.',
    formula: 'الضمانات المحتجزة = Σ ضمانات المشاريع غير المصروفة لكل المقاولين',
    compute: (v) => {
      const held = v.contractorsRetention;
      return { substitution: held == null ? null : 'مجموع الضمانات غير المصروفة لكل المقاولين', result: money(held) };
    },
    source: 'من سجل ضمانات المقاولين لكل مشروع، مستبعداً ما أُفرج عنه.',
  },

  guaranteeStatementsHeld: {
    title: 'المحتجز حسب الكشوف',
    meaning: 'مجموع أرصدة كل حسابات الضمان (٢١٦) المستوردة من كشوفات الحساب — كما وردت من البنك/الجهة.',
    formula: 'المحتجز حسب الكشوف = Σ رصيد كل حساب ضمان',
    compute: (v) => {
      const held = v.guaranteeStatementsHeld;
      return { substitution: held == null ? null : 'مجموع أرصدة حسابات الضمان المستوردة', result: money(held) };
    },
    source: 'من كشوفات حساب الضمان (٢١٦) المرفوعة.',
  },

  guaranteeTrackedHeld: {
    title: 'المحتجز حسب المستخلصات',
    meaning: 'مجموع الضمانات المتتبَّعة يدوياً لكل مقاول ومشروع (من التأمينات المخصومة من المستخلصات)، ولم تُصرف بعد.',
    formula: 'المحتجز حسب المستخلصات = Σ ضمانات المقاولين غير المصروفة',
    compute: (v) => {
      const held = v.guaranteeTrackedHeld;
      return { substitution: held == null ? null : 'مجموع ضمانات المقاولين غير المصروفة', result: money(held) };
    },
    source: 'من سجل ضمانات المقاولين لكل مشروع.',
  },

  guaranteeDueSoon: {
    title: 'مستحقة الصرف',
    meaning: 'عدد الضمانات المستحقة الصرف الآن أو خلال ٣٠ يوماً القادمة.',
    formula: 'مستحقة الصرف = عدد الضمانات (مستحقة + تقترب خلال ٣٠ يوماً)',
    compute: (v) => {
      const overdue = v.guaranteeOverdueCount, dueSoon = v.guaranteeDueSoonCount;
      if (overdue == null || dueSoon == null) return { substitution: null, result: null };
      return { substitution: `${ar0(overdue)} + ${ar0(dueSoon)}`, result: `${overdue + dueSoon}` };
    },
    source: 'من مواعيد فك ضمانات المقاولين المسجّلة.',
  },

  supplierCoverage: {
    title: 'التغطية ٪',
    meaning: 'نسبة الموردين الذين لديهم كشوفات حساب مرفوعة من إجمالي عدد الموردين — كلما زادت النسبة زادت دقة أرقام المديونية.',
    formula: 'التغطية ٪ = (عدد الموردين ذوي الكشوفات ÷ إجمالي عدد الموردين) × ١٠٠',
    compute: (v) => {
      const withData = v.supplierWithData, total = v.supplierCount, pct = v.coveredPct;
      if (withData == null || total == null || !total) return { substitution: null, result: pct == null ? null : `${pct}٪` };
      return { substitution: `(${ar0(withData)} ÷ ${ar0(total)}) × ١٠٠`, result: `${pct ?? Math.round((withData / total) * 100)}٪` };
    },
    source: 'من عدد الموردين الإجمالي مقارنةً بمن رُفعت له كشوفات حساب حديثة.',
  },

  projectsTotals: {
    title: 'إجمالي مديونية المشاريع',
    meaning: 'مجموع المديونية المفتوحة لكل الموردين مجمَّعةً على مستوى كل المشاريع.',
    formula: 'إجمالي المديونية = Σ المديونية المفتوحة لكل مشروع',
    compute: (v) => {
      const total = v.projectsOutstanding;
      return { substitution: total == null ? null : 'مجموع المديونية المفتوحة لكل المشاريع', result: money(total) };
    },
    source: 'من مجموع مديونية الموردين المسجّلة تحت كل مشروع.',
  },

  projectDetailOutstanding: {
    title: 'المديونية المفتوحة للمشروع',
    meaning: 'مجموع المديونية المفتوحة لكل الموردين العاملين في هذا المشروع تحديداً.',
    formula: 'مديونية المشروع = Σ المديونية المفتوحة لموردي هذا المشروع',
    compute: (v) => {
      const outstanding = v.projectOutstanding;
      return { substitution: outstanding == null ? null : 'مجموع مديونية موردي هذا المشروع', result: money(outstanding) };
    },
    source: 'من فواتير ومدفوعات موردي هذا المشروع فقط.',
  },

  ageingByDueDate: {
    title: 'أعمار الديون',
    meaning:
      'كل فئة عمرية تُحسب من تاريخ استحقاق الفاتورة (تاريخ الفاتورة + مدة سداد المورد) لا من تاريخ الفاتورة نفسها. '
      + 'فاتورة لم يحن استحقاقها بعد لا تُحتسب متأخرة حتى لو كان تاريخها قديماً.',
    formula: 'عمر الفاتورة (أيام) = اليوم − تاريخ الاستحقاق؛ تُصنَّف الفاتورة حسب هذا الفارق في فئتها',
    compute: () => ({ substitution: null, result: null }),
    source: 'من تاريخ كل فاتورة ومدة السداد المتفق عليها لكل مورد، مقارنةً بتاريخ اليوم.',
  },

  cashflowColumns: {
    title: 'الداخل / الخارج / الرصيد',
    meaning:
      'الداخل = التحصيلات المتوقعة من العملاء خلال الفترة. الخارج = مستحقات الموردين و/أو المقاولين '
      + 'المتوقع سدادها خلال نفس الفترة. الرصيد عمود تراكمي — يبدأ من الرصيد الافتتاحي ويتراكم فترة بعد '
      + 'فترة، فرقم سالب فيه يعني عجزاً متوقعاً عند تلك الفترة تحديداً وليس في تلك الفترة فقط.',
    formula: 'صافي الفترة = الداخل − الخارج؛ الرصيد = رصيد الفترة السابقة + صافي الفترة',
    compute: () => ({ substitution: null, result: null }),
    source: 'من فواتير الموردين/المقاولين المستحقة والتحصيلات المتوقعة داخل كل فترة من الأفق المختار.',
  },

  reportAgeing: {
    title: 'جدول أعمار الديون',
    meaning:
      'يوزّع المتبقي من الفواتير على فئات حسب عدد الأيام منذ تاريخ الاستحقاق (لا تاريخ الفاتورة). '
      + 'فاتورة استحقاقها لم يحن بعد تظهر في فئة «لم يستحق بعد»، لا في فئة متأخرة.',
    formula: 'فئة الفاتورة = اليوم − تاريخ الاستحقاق، حيث الاستحقاق = تاريخ الفاتورة + مدة سداد المورد',
    compute: () => ({ substitution: null, result: null }),
    source: 'من تاريخ كل فاتورة ومدة السداد المتفق عليها لكل مورد ضمن نطاق التقرير وفترته.',
  },

  cashflowReconciliation: {
    title: 'مطابقة الخارج مع المديونية المفتوحة',
    meaning:
      'جدول الفترات أعلاه لا يستطيع عرض كل ما ندين به: مبلغ استحقاقه مضى لا دلو له، ومبلغ '
      + 'استحقاقه بعد نهاية الأفق خارج الجدول، وفاتورة «مستخلص» بلا تاريخ استحقاق لا يمكن '
      + 'وضعها في أي فترة بأمانة. هذه المعادلة تعرض الفروق الأربعة صراحةً حتى يتطابق مجموعها '
      + 'مع رقم المديونية في شاشة الموردين بالهللة، بدل أن تختفي بصمت.',
    formula:
      'الخارج المجدول + متأخر الآن + بعد نهاية الأفق + بلا تواريخ − أرصدة دائنة = المديونية المفتوحة',
    compute: (v) => {
      const { scheduled, overdueNow, beyondHorizon, undated, credits, openDebt } = v;
      if (scheduled == null || openDebt == null) return { substitution: null, result: null };
      const terms = `${sar(scheduled)} + ${sar(overdueNow ?? 0)} + ${sar(beyondHorizon ?? 0)}`
        + ` + ${sar(undated ?? 0)} − ${sar(credits ?? 0)}`;
      return { substitution: terms, result: `${sar(openDebt)} ر.س` };
    },
    source: 'من فواتير الموردين المفتوحة ودفاتر المقاولين — نفس المصدر الذي تقرأ منه شاشتاهما.',
  },
};

const ar0 = (v: number | undefined | null) => (v == null ? '' : String(Math.round(v)));

export type ExplainMetric = keyof typeof EXPLANATIONS;
