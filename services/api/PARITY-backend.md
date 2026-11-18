# PARITY-backend — ثوابت البيانات ↔ الاختبار الذي يحرسها

كل بند من `docs/next/PARITY.md` §٦ مع الاختبار الذي يفشل إن انكسر. «عيّنة» = يعتمد على ملف حقيقي
خارج المستودع (يُتخطّى بلا `EGCO_REQUIRE_SAMPLES=1`) — مذكور صراحةً حتى لا يبدو مغطّى وهو ليس كذلك.

| البند | الثابت | الاختبار |
|---|---|---|
| P-583 | المفتوح = المفوتر − المسدد بعد FIFO، الرصيد الدائن خارجه | `test_parity_invariants.py::test_p583_outstanding_is_invoiced_minus_paid_fifo` · `test_payables.py::test_fifo_settles_the_oldest_invoice_first` · `::test_overpayment_does_not_make_a_negative_remainder` |
| P-584 | إجماليات القائمة = Σ المجموعة المصفّاة | `test_filters_totals.py::test_suppliers_filtered_totals_match_independent_recomputation` · `::test_contractors_direction_filter_matches_recomputation` · `::test_revenues_amount_filter_totals_match` |
| P-585 | overview = dashboard = suppliers = report (نطاق الشركة) | `test_synergy_screens.py::test_suppliers_totals_match_dashboard_and_overview_for_same_window` · `::test_per_supplier_outstanding_matches_list_detail_and_report_row` · `test_events_today.py::test_today_shape_and_numbers_match_overview` |
| P-586 | Σ شرائح التأخر = delay.amount؛ حدود الشرائح | `test_payables.py::test_bucket_of_days_boundaries_pinned_exactly` · `::test_compute_delay_routes_amount_to_correct_bucket_at_boundary` · `test_contractor_delay.py::test_fifo_oldest_claim_first_and_buckets` |
| P-587 | Σ الأعمار + «بلا تاريخ» = المفتوح | `test_report_balance_identity.py::*` (٦ اختبارات) |
| P-588 | افتتاحي + مفوتر − مسدد = ختامي | `test_report_balance_identity.py::test_identity_holds_company_scope` وأخواتها · `test_filters_totals.py::test_suppliers_date_window_gives_opening_closing` |
| P-589 | إشارة الكشف (سالب = ندين لهم) | `test_debts_report_xls.py::test_commit_is_idempotent_and_flags_balance_mismatch` (عيّنة) · `test_contractors.py::test_parse_diyar_reconciles_exactly` (عيّنة) · بلا عيّنة: `test_parity_invariants.py::test_p590_contractor_balance_sign_and_owed` |
| P-590 | رصيد المقاول = مدين − دائن؛ owedToContractors = Σ max(0, −balance) | `test_parity_invariants.py::test_p590_contractor_balance_sign_and_owed` · `test_contractors.py::test_position_sums_are_decimal` |
| P-591 | تلوين متناقض في الواجهة القديمة | واجهة فقط — لا ثابت خادم (مسؤولية قسم الواجهة) |
| P-592 | جانب المدين = debitTotal | محسوب في الواجهة القديمة (ContractorDetail.tsx)؛ الخادم يعيد الحركات و`paidTotal/deductionsTotal` المغطّاة بـ`test_contractors.py::test_position_sums_are_decimal` |
| P-593 | البادئة تحسم النوع | `test_account_lengths.py::test_dispatch_kind_is_length_agnostic_on_prefix` · `test_contractors.py::test_211_account_takes_supplier_flow_even_when_unknown` · `test_migrate_211_contractors.py::*` |
| P-594 | صافي المستخلص = أعمال − تأمين − خصومات | الحساب في نموذج الواجهة؛ الخادم يخزّن ما يُرسل حرفياً ويُراكم التأمين: `test_contractors.py::test_claims_accumulate_into_guarantee` |
| P-595 | تأخر المقاول لمن له مدة فقط؛ بلا مدة = null | `test_contractor_delay.py::test_no_term_returns_none_not_zero` · `test_contractors_overdue_api.py::test_list_overdue_column_and_disclosure` · `::test_status_overdue_filter_only_with_term` |
| P-599 | التحصيلات: الكل = مفتوح + محصّل؛ غير المؤرخ لا يدخل التوقع | `test_parity_invariants.py::test_p599_revenues_total_is_open_plus_collected_and_undated_not_forecast` · `test_revenues.py::test_manual_dated_open_revenue_feeds_cashflow_inflow_and_clears_warning` |
| P-600 | الموازنة: انحراف = فعلي − مخطط؛ السلسلة تُعاد؛ التعارض لا يُكتب صامتاً | `test_budget.py::test_rebuild_chain_propagates_after_editing_old_month` · `::test_conflict_detected_between_file_and_manual_entry` |
| P-601 | مطابقة ضمانات 216 | `test_guarantees_page.py::test_totals_and_reconciliation_match` · `::test_reconciliation_flags_mismatch` |
| P-602 | المُبلَّغ والمشتق لا يُجمعان | `test_contractor_overview.py::test_balance_mismatch_parsed_from_latest_debts_report_log` · `::test_totals_and_top_owed` |
| P-603 | Σ أسطر التخصيص = مبلغ الدفعة؛ متوقف = FIFO حرفياً | `test_payment_allocation.py::test_allocation_sum_mismatch_rejected` · `::test_smart_false_is_pure_fifo_no_holds_regardless_of_data` · `::test_disabling_setting_ignores_saved_decisions_and_reverts_to_fifo` |
| P-604 | حذف منطقي؛ الاسترجاع يعيد التبعيات؛ حذف استيراد لا يمسّ اليدوي | `test_trash.py::test_restore_supplier_brings_back_exact_amount` · `::test_delete_supplier_response_lists_dependents` · `test_import_history.py::test_delete_then_reimport_resurrects_rows_and_balance_reconciles` (عيّنة) · م-٥٠: `test_project_parties_amounts.py::test_unlink_is_soft_and_relink_revives` |
| P-606 | المعاينة = الأثر الفعلي للدمج؛ الدمج لا يُيتّم مبلغاً | `test_project_admin.py::test_merge_preview_matches_actual_effect` · `test_project_parties_amounts.py::test_merge_keeps_amounts_and_id` |
| P-607 | لا فرق هللة بين شاشتين (الأرقام الذهبية) | `test_golden_numbers.py::test_golden_numbers_seed` · `::test_golden_numbers_real_copy` (نسخة حقيقية، تُتخطّى بغيابها) · `test_synergy_screens.py::*_exact_decimal_sum_not_float_drift` |

**فجوة معلنة:** P-604 «حذف استيراد لا يمسّ اليدوي» مغطّى فقط باختبار يحتاج عيّنة PDF؛ اختبار بلا عيّنة يحتاج
مسار رفع CSV مصنوع داخل `import_service` (ملك وكيل قرّاء البيانات) — يُضاف بعد دمج الموجة ٤.
