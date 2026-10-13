/** One claimed worker job processes at most one page. Identity and channel
 * rechecks are provider requests too. Count them before dispatch, including
 * rejected/failed responses, and never reset this bound inside a job's lease. */
export const SLACK_HISTORY_PROVIDER_REQUESTS_PER_JOB = 9;
