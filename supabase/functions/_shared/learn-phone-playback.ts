/** Audited short-lived links to existing private audio. No provider URLs or fetches. */
export type PlaybackDb = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: unknown }>;
  storage: {
    getBucket(name: string): Promise<{ data: any; error: unknown }>;
    from(name: string): {
      createSignedUrl(path: string, seconds: number): Promise<{ data: any; error: unknown }>;
    };
  };
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export async function retainedPhonePlayback(
  db: PlaybackDb,
  scope: {
    tenant: string;
    actor: string;
    recording: string;
    backend: string;
    operatorReason?: string;
  },
  now = Date.now,
) {
  if (![scope.tenant, scope.actor, scope.recording].every(uuid))
    throw Error("playback_unavailable");
  const backend = new URL(scope.backend);
  if (
    backend.protocol !== "https:" ||
    backend.username ||
    backend.password ||
    backend.pathname !== "/" ||
    backend.search ||
    backend.hash
  )
    throw Error("playback_unavailable");
  const operator = scope.operatorReason !== undefined;
  if (
    operator &&
    (typeof scope.operatorReason !== "string" ||
      scope.operatorReason.trim().length < 3 ||
      scope.operatorReason.trim().length > 500)
  )
    throw Error("playback_unavailable");
  const rpc = operator
    ? "learn_operator_phone_playback_authorize"
    : "learn_phone_playback_authorize";
  const args = {
    p_tenant: scope.tenant,
    p_actor: scope.actor,
    p_recording: scope.recording,
    ...(operator ? { p_reason: scope.operatorReason!.trim() } : {}),
  };
  const target = await db.rpc(rpc, args),
    t = target.data;
  if (
    target.error ||
    (operator && (t?.operator_mode !== true || t?.actor_id !== scope.actor)) ||
    t?.version !== "learn-phone-playback-target/1" ||
    t.tenant_id !== scope.tenant ||
    t.recording_id !== scope.recording ||
    t.request_id !== null ||
    typeof t.storage_path !== "string" ||
    !t.storage_path.startsWith(scope.tenant + "/") ||
    t.storage_path.length > 4096 ||
    /[\x00-\x1f\x7f\\]/.test(t.storage_path) ||
    t.storage_path.split("/").some((s: string) => !s || s === "." || s === "..") ||
    !/^[a-f0-9]{64}$/.test(t.source_digest ?? "")
  )
    throw Error("playback_unavailable");
  const bucket = await db.storage.getBucket("phone-recordings");
  if (bucket.error || bucket.data?.id !== "phone-recordings" || bucket.data.public !== false)
    throw Error("playback_unavailable");
  const started = now();
  const signed = await db.storage.from("phone-recordings").createSignedUrl(t.storage_path, 60);
  if (signed.error || typeof signed.data?.signedUrl !== "string")
    throw Error("playback_unavailable");
  const url = new URL(signed.data.signedUrl);
  const expected =
    "/storage/v1/object/sign/phone-recordings/" +
    t.storage_path.split("/").map(encodeURIComponent).join("/");
  if (
    url.origin !== backend.origin ||
    url.pathname !== expected ||
    url.username ||
    url.password ||
    url.hash ||
    !url.searchParams.get("token") ||
    [...url.searchParams.keys()].some((k) => k !== "token")
  )
    throw Error("playback_unavailable");
  const request = crypto.randomUUID();
  const audited = await db.rpc(rpc, {
    ...args,
    p_source_digest: t.source_digest,
    p_request: request,
  });
  if (
    audited.error ||
    (operator &&
      (audited.data?.operator_mode !== true || audited.data?.actor_id !== scope.actor)) ||
    audited.data?.version !== "learn-phone-playback-target/1" ||
    audited.data.request_id !== request ||
    audited.data.source_digest !== t.source_digest ||
    audited.data.storage_path !== t.storage_path ||
    audited.data.tenant_id !== scope.tenant ||
    audited.data.recording_id !== scope.recording ||
    now() - started > 15000 ||
    now() < started
  )
    throw Error("playback_unavailable");
  return {
    version: "learn-phone-playback/1",
    tenant_id: scope.tenant,
    recording_id: scope.recording,
    request_id: request,
    ...(operator ? { operator_mode: true, actor_id: scope.actor } : {}),
    url: url.href,
    expires_at: new Date(started + 55000).toISOString(),
  };
}
