select set_config('request.jwt.claim.sub',(select corrected_by::text from learn_performance_corrections order by created_at desc limit 1),false);
set role authenticated;
do $$ declare c public.learn_performance_corrections%rowtype;r jsonb;begin
 select * into c from public.learn_performance_corrections where corrected_by=auth.uid() order by created_at desc limit 1;
 if not found then raise exception 'Real working correction fixture missing';end if;
 r:=public.learn_performance_correction_resolve(c.tenant_id,c.predecessor_id,c.id,c.expected_review_revision,c.corrected_value,c.reason,true);
 if r->>'state'<>'recorded' or r->>'measurementId'<>c.id::text or (r->>'recordedAt')::timestamptz<>c.created_at then raise exception 'Real working correction receipt changed';end if;
 r:=public.learn_performance_correction_resolve(c.tenant_id,c.predecessor_id,'fff90000-0000-4000-8000-000000000001',0,17,'Retire stale synthetic request',true);
 if r->>'state'<>'cancelled' then raise exception 'Stale working correction did not cancel';end if;
 begin perform public.learn_performance_correct(c.tenant_id,c.predecessor_id,'fff90000-0000-4000-8000-000000000001',0,17,'Retire stale synthetic request');raise exception 'Cancelled working correction applied';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
select 'PASS: actual working-time corrections recover with receipt guards installed';
