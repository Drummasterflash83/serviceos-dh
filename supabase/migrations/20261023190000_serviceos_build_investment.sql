-- Private retrospective estimate, not a timesheet or a billable-hours ledger.
-- Keep the estimate out of public/client bundles and require the existing Chris-only gate.
begin;
create or replace function public.openfolk_build_investment()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.care_desk_operator(), false) then
   raise exception 'OpenFolk administrator required' using errcode='42501';
 end if;
 return jsonb_build_object(
   'project', 'Service OS',
   'estimatedHours', 320,
   'rangeLow', 240,
   'rangeHigh', 400,
   'asOf', '2026-09-29',
   'firstRecordedBuild', '2026-06-24',
   'recordedActivityDates', 38,
   'confidence', 'Low',
   'basis', '38 dates with recorded code changes, provisionally allowing 5–8 hours per date, plus 50–100 hours for earlier Claude work and sessions without code changes. These allowances are judgement, not measured time; the rounded range is 240–400 hours and its midpoint is 320.',
   'scope', 'The whole Service OS platform across Claude and OpenFolk builds, including planning, building, review, testing and waiting for AI when Chris could not move on.',
   'exclusions', 'No separate addition for overlapping AI runs, unattended processing, unrelated work or idle computer time. This is not a measure of device activity.',
   'coverage', '24 June is the first reliable build date found, not a claim that all work began then. Earlier Claude history and unrecorded time remain unverified.'
 );
end $$;
revoke all on function public.openfolk_build_investment() from public, anon;
grant execute on function public.openfolk_build_investment() to authenticated;
commit;
