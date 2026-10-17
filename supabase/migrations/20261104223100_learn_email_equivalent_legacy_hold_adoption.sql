-- Supersede only automated, current-revision legacy-review holds when the
-- retained source and interaction are still field-equivalent. Prior immutable
-- holds remain in the ledger; any operator-reviewed, changed or other hold is
-- excluded. No interaction is rewritten by installing this migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$ declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)'::regprocedure);
 if md5(definition)<>'7098da590fbbb277fb45713e41feae12'
 then raise exception 'email_legacy_adoption_baseline_changed';end if;
 needle:='if exists(select 1 from public.learn_interaction_projection_receipts h
   where h.tenant_id=p_tenant and h.source_kind=''email''
    and h.source_id=source_row.id)
  then continue;end if;';
 replacement:='if exists(select 1 from public.learn_interaction_projection_receipts h
   where h.tenant_id=p_tenant and h.source_kind=''email''
    and h.source_id=source_row.id
    and (h.source_revision is distinct from public.learn_projection_revision(fields,'''')
      or h.receipt->>''state'' is distinct from ''review_required''
      or h.receipt->>''reason'' is distinct from ''legacy_projection_review''
      or exists(select 1 from public.learn_projection_operator_reviews o
       where o.hold_id=h.request_id)))
  then continue;end if;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
 then raise exception 'email_legacy_adoption_receipt_anchor_changed';end if;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
