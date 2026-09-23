# -*- coding: utf-8 -*-
"""project_key (م-٣٠) — «السدن»/«سدن» يجب أن يلتقيا، بلا كسر أسماء لا تحمل أل
تعريف فعلية."""
from app.utils.arabic import project_key


def test_leading_al_ignored():
    assert project_key('السدن') == project_key('سدن')
    assert project_key('المهندية') == project_key('مهندية')
    assert project_key('المهيلب') == project_key('مهيلب')


def test_no_leading_al_still_matches_itself():
    assert project_key('سدن') == project_key('سدن')


def test_short_result_keeps_al_conservatively():
    # لو حذف "ال" يترك حرفاً واحداً أو صفراً، الأرجح أنها ليست أداة تعريف —
    # القاعدة تبقيها كما هي بدل تخمين قد يخلط اسمين مختلفين حقاً.
    assert project_key('الله') == project_key('الله')


def test_empty_and_whitespace():
    assert project_key('') == ''
    assert project_key('   ') == ''


def test_different_projects_stay_different():
    assert project_key('السدن') != project_key('الرسين')
    assert project_key('الهضبة') != project_key('بيت الآباء')
