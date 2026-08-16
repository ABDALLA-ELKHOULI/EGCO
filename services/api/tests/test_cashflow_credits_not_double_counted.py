# -*- coding: utf-8 -*-
"""معادلة الخارج المجمّعة لا تطرح الأرصدة المقدّمة مرتين.

الخلل الذي يحرسه هذا الاختبار: معادلة الموردين المفردة لا تطرح `credits` — موثّقٌ
في _supplier_reconciliation أن outstanding محجوز عند صفر فلا فجوة سالبة تحتاج
تصحيحاً — بينما كانت المعادلة المجمّعة تطرحها. النتيجة على الشاشة تناقضٌ صريح:

    صف «الموردون»  → الفرق 0.00
    صف «الإجمالي»  → الفرق −474,147.10   (بنفس الأرقام)

والرقم ليس عشوائياً: هو مجموع الأرصدة المقدّمة بالضبط. مستخدمٌ يرى «فرقاً غير
مُفسَّر» بهذا الحجم يبحث عن مال ضائع لا وجود له.

The invariant that must hold: whatever `parties` scope is requested, the combined
outflow equation must balance whenever its constituent equations balance.
"""
import datetime as dt
from decimal import Decimal

from app.services import cashflow_service as CF

ZERO = Decimal('0')


def _supplier_recon(credits: Decimal) -> dict:
    """معادلة موردين متوازنة، مع رصيد مقدّم غير صفري."""
    return dict(scheduled=Decimal('1000'), overdueNow=Decimal('500'),
                beyondHorizon=ZERO, undated=Decimal('200'),
                credits=credits, outstanding=Decimal('1700'),
                difference=ZERO)


def _contractor_recon(excess: Decimal) -> dict:
    return dict(scheduled=ZERO, overdueNow=ZERO, beyondHorizon=ZERO,
                undated=Decimal('300'), excess=excess,
                owedToContractors=Decimal('300') - excess, difference=ZERO)


def test_credits_do_not_create_a_phantom_difference():
    out = CF._combine_outflow(_supplier_recon(Decimal('474147.10')), None)
    assert out['difference'] == ZERO, (
        'الأرصدة المقدّمة طُرحت من المعادلة فظهر فرق وهمي: %s' % out['difference'])
    # تبقى معروضة كمعلومة — حذفها من الاستجابة يخفي مالاً حقيقياً عن العين
    assert out['credits'] == Decimal('474147.10')


def test_combined_equation_balances_when_both_parties_balance():
    out = CF._combine_outflow(_supplier_recon(Decimal('474147.10')),
                              _contractor_recon(Decimal('50')))
    assert out['difference'] == ZERO
    assert out['openDebt'] == Decimal('1700') + Decimal('250')
    # ضمانات المقاول الزائدة تبقى طرفاً في المعادلة — بخلاف credits
    assert out['excess'] == Decimal('50')


def test_contractor_excess_is_still_subtracted():
    """التمييز مقصود: excess طرفٌ في المعادلة، credits ليست كذلك."""
    balanced = _contractor_recon(Decimal('50'))
    out = CF._combine_outflow(None, balanced)
    assert out['difference'] == ZERO

    # لو أُهمل excess لاختلّت المعادلة بمقداره
    without = dict(balanced, excess=ZERO)
    broken = CF._combine_outflow(None, without)
    assert broken['difference'] == Decimal('50')


def test_agrees_with_the_single_party_equation_on_real_shaped_numbers():
    """نفس أرقام قاعدة المستخدم الحقيقية: الصفّان يجب أن يتفقا."""
    sup = dict(scheduled=Decimal('1936170.61'), overdueNow=Decimal('3848887.74'),
               beyondHorizon=ZERO, undated=Decimal('153656.66'),
               credits=Decimal('474147.10'), outstanding=Decimal('5938715.01'),
               difference=ZERO)
    out = CF._combine_outflow(sup, None)
    assert out['difference'] == sup['difference'] == ZERO
