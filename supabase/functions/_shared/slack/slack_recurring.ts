type Database = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown;error: unknown}> };
/** Scheduling records bounded windows; it never obtains a provider credential.
 * The existing Slack worker remains responsible for requests and page settlement.
 */
export async function scheduleRecurringSlack(db: Database) {
  const {data,error} = await db.rpc('learn_slack_schedule_recurring',{p_batch:10});
  if(error || !data || typeof data !== 'object' || Array.isArray(data)) throw Error('slack_schedule_unconfirmed');
  const r = data as Record<string,unknown>;
  if(!['checked','queued','held'].every(k=>Number.isSafeInteger(r[k]) && Number(r[k])>=0 && Number(r[k])<=10) ||
    Number(r.queued)+Number(r.held)>Number(r.checked)) throw Error('slack_schedule_unconfirmed');
  return {checked:Number(r.checked),queued:Number(r.queued),held:Number(r.held)};
}

/** Both dispatchers are idempotent over retained state. A failure is reported;
 * callers must not assume neither side ran if one acknowledgement was lost. */
export async function scheduleSlackCampaigns(db: Database) {
  const {data,error} = await db.rpc('learn_slack_schedule_campaigns',{p_batch:10});
  if(error || !data || typeof data !== 'object' || Array.isArray(data)) throw Error('slack_campaign_schedule_unconfirmed');
  const r = data as Record<string,unknown>;
  if(!['checked','queued','held'].every(k=>Number.isSafeInteger(r[k]) && Number(r[k])>=0 && Number(r[k])<=10) ||
    Number(r.queued)+Number(r.held)>Number(r.checked)) throw Error('slack_campaign_schedule_unconfirmed');
  return {checked:Number(r.checked),queued:Number(r.queued),held:Number(r.held)};
}
