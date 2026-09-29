-- Keep imported feedback ordered by when the customer submitted it, not migration time.
begin;
update public.receptionist_care_issues i
set created_at=f.created_at
from public.receptionist_feedback f
where i.feedback_id=f.id and i.tenant_id=f.tenant_id and i.version=1;
commit;
