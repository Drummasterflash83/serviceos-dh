-- Disposable local database only. Clone an actual saved assessment into 43
-- immutable synthetic rows with timestamp ties straddling page boundaries.
insert into public.learn_assessments(id,tenant_id,publication_id,subject_kind,subject_id,window_start,window_end,recorded_at,recorded_by,reason,request,snapshot)
select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,
 a.tenant_id,a.publication_id,a.subject_kind,a.subject_id,a.window_start,a.window_end,
 a.recorded_at-((n/17)::text||' microseconds')::interval,a.recorded_by,
 'Synthetic history '||n,a.request,
 jsonb_set(a.snapshot,'{assessedAt}',to_jsonb(a.recorded_at-((n/17)::text||' microseconds')::interval))
from public.learn_assessments a cross join generate_series(1,43)n
where a.id='00000000-0000-4000-8000-000000000070';
