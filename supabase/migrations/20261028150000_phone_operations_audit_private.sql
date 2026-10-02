-- Internal provider configuration and test transcripts are not client-facing
-- status updates. Preserve every row and all service-role processing access.
begin;

drop policy if exists phone_operations_audit_select_tenant on public.phone_operations_audit;
create policy phone_operations_audit_select_operator
  on public.phone_operations_audit for select to authenticated
  using (public.care_desk_operator());

comment on policy phone_operations_audit_select_operator on public.phone_operations_audit is
  'Internal maintenance evidence only: existing Chris-only active OpenFolk administrator gate, denied during client preview. No direct tenant read.';

commit;
