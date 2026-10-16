/** Counts-only LIVE private voicemail and audio-storage coverage. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select count(*)::int saved_messages,
 count(*) filter(where v.recording_available)::int recording_paths,
 count(*) filter(where v.recording_available and o.id is not null)::int matching_audio_objects,
 count(*) filter(where v.recording_available and o.id is null)::int missing_audio_objects,
 count(*) filter(where not v.recording_available)::int without_recording_path,
 count(*) filter(where v.email_status='failed')::int failed_email_statuses,
 (select count(*)::int from public.receptionist_voicemail_intakes i
  where i.tenant_id='${tenant}'::uuid and i.state='published') published_intakes
 from public.receptionist_voicemails v
 left join storage.objects o on o.bucket_id='receptionist-voicemails'
   and o.name=v.recording_path
 where v.tenant_id='${tenant}'::uuid`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE voicemail coverage HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  ["saved_messages","recording_paths","matching_audio_objects",
    "missing_audio_objects","without_recording_path","failed_email_statuses",
    "published_intakes"].some((key) => !Number.isInteger(rows[0]?.[key])))
  throw Error("LIVE voicemail coverage shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  ...rows[0], messageContentReturned: false, audioBytesReturned: false,
  productionDataWrites: false }));
