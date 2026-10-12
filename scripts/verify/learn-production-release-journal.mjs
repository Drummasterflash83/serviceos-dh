/** Durable sequencing for the separately approved production release.
 * No network, credentials, automatic retries, approval fabrication or deployment
 * adapter lives here. Callers supply the reviewed operation and observation ports.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function check(value, message) { if (!value) throw Error(message); }
export function validateReleasePlan(plan) {
  check(exact(plan,['version','projectRef','candidateSha256','steps']) &&
    plan.version === 'learn-production-release-sequence/1' && plan.projectRef === 'tgbnakbxwcqjeimygroz' &&
    isHash(plan.candidateSha256) && Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 100,
    'Invalid production release plan');
  check(new Set(plan.steps.map(s => s.id)).size === plan.steps.length && plan.steps.every(s =>
    exact(s,['id','kind','pinSha256']) && /^[a-z][a-z0-9-]{1,100}$/.test(s.id) &&
    ['check','schedule','database','configuration','runtime','frontend'].includes(s.kind) && isHash(s.pinSha256)),
    'Invalid release step scope');
  return JSON.parse(JSON.stringify(plan));
}
function observation(value) {
  check(exact(value,['state','evidenceSha256']) &&
    ['ready','applied','inconclusive','drift'].includes(value.state) && isHash(value.evidenceSha256),
    'Incomplete release observation');
  return value;
}
function durableWrite(dir, path, value) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value)+'\n'); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(dir, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

/** A process lock is never removed based on age or a timeout. After a crashed
 * process, an operator must first prove that writer stopped before removing it.
 * Event files contain scope and evidence hashes only, never API bodies or errors.
 */
export function openReleaseJournal(directory, inputPlan, { create = false } = {}) {
  const plan = validateReleasePlan(inputPlan), planSha256 = digest(plan), dir = resolve(directory);
  if (create) mkdirSync(dir,{mode:0o700});
  const stat = lstatSync(dir);
  check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    'Private real journal directory required');
  const lockPath = join(dir,'writer.lock');
  durableWrite(dir,lockPath,{pid:process.pid,planSha256});
  let closed = false, poisoned = false, busy = false, events = [], cursor = 0, pending = null;
  function append(data) {
    check(!closed && !poisoned,'Release journal is not writable');
    const event = { sequence:events.length, previous:events.at(-1)?.sha256 ?? null,
      planSha256, at:new Date().toISOString(), ...data };
    const row = {...event,sha256:digest(event)};
    try { durableWrite(dir,join(dir,String(events.length).padStart(4,'0')+'.json'),row); }
    catch { poisoned=true; throw Error('Durable release journal write unconfirmed; stop and inspect'); }
    events.push(row);
  }
  function validateEvents() {
    cursor=0; pending=null;
    for (let i=0; i<events.length; i++) {
      const row=events[i], {sha256,...body}=row;
      check(isHash(sha256) && digest(body)===sha256 && row.sequence===i && row.planSha256===planSha256 &&
        row.previous===(i ? events[i-1].sha256 : null) && Number.isFinite(Date.parse(row.at)),
        'Release journal chain or plan differs');
      const base=['sequence','previous','planSha256','at','type','sha256'];
      if (i===0) {
        check(row.type==='plan' && exact(row,[...base,'plan']) && digest(row.plan)===planSha256,'Release journal plan missing');
      } else if (row.type==='intent') {
        check(!pending && row.step===plan.steps[cursor]?.id && isHash(row.evidenceSha256) && isHash(row.approvalEvidenceSha256) &&
          exact(row,[...base,'step','evidenceSha256','approvalEvidenceSha256']),'Release intent order differs');
        pending=row.step;
      } else if (row.type==='verified') {
        check(pending===row.step && isHash(row.evidenceSha256) && typeof row.reconciled==='boolean' &&
          exact(row,[...base,'step','evidenceSha256','reconciled']),'Release verification order differs');
        pending=null; cursor++;
      } else {
        check(row.type==='unknown' && pending===row.step && exact(row,[...base,'step']), 'Unexpected release event');
      }
    }
  }
  try {
    const files=readdirSync(dir).filter(n=>n!=='writer.lock').sort();
    check(files.every((n,i)=>n===String(i).padStart(4,'0')+'.json'),'Unexpected journal files or missing sequence');
    for (const file of files) {
      const path=join(dir,file), info=lstatSync(path);
      check(info.isFile() && !info.isSymbolicLink() && (info.mode&0o077)===0 && info.size<100000,'Unsafe journal event');
      events.push(JSON.parse(readFileSync(path,'utf8')));
    }
    if (!events.length) { check(create,'Existing release journal is empty'); append({type:'plan',plan}); }
    validateEvents();
  } catch (error) { unlinkSync(lockPath); throw error; }
  const status=()=>({completed:cursor,total:plan.steps.length,pending,
    state:pending?'unknown_outcome':cursor===plan.steps.length?'sequence_verified':'ready_for_next_step',planSha256});
  return {
    status,
    /** observe must compare the exact scoped remote state, not just HTTP status.
     * authorize must resolve actual approval and current release gates. A hash
     * references that retained evidence; it cannot manufacture user approval.
     * apply may be invoked at most once for each persisted intent.
     */
    async next({observe,authorize,apply}) {
      check(!closed && !poisoned,'Release journal is closed or uncertain');
      check(!busy,'A release operation is already in progress');
      busy=true;
      try {
      check([observe,authorize,apply].every(f=>typeof f==='function'),'Reviewed release ports required');
      if (cursor===plan.steps.length) return status();
      const step=Object.freeze({...plan.steps[cursor]});
      if (pending) {
        // An earlier request can still commit after a read says "before".
        // Only conclusive after-state may settle it; never resend on timeout.
        const current=observation(await observe(step,'reconcile'));
        if (current.state==='applied') {
          append({type:'verified',step:step.id,evidenceSha256:current.evidenceSha256,reconciled:true});
          validateEvents();
        }
        return status();
      }
      const approvalEvidenceSha256=await authorize(step,planSha256);
      check(isHash(approvalEvidenceSha256),'Explicit release approval and current gates required');
      const before=observation(await observe(step,'before'));
      check(before.state==='ready','Release precondition differs; no action submitted');
      append({type:'intent',step:step.id,evidenceSha256:before.evidenceSha256,approvalEvidenceSha256});
      pending=step.id;
      try {
        await apply(step);
        const after=observation(await observe(step,'after'));
        if (after.state!=='applied') throw Error('After-state unconfirmed');
        append({type:'verified',step:step.id,evidenceSha256:after.evidenceSha256,reconciled:false});
        validateEvents();
      } catch {
        // Even a returned HTTP failure can be ambiguous. Retain intent and only
        // whitelisted state; no request body, credential or raw error is logged.
        if (!poisoned) append({type:'unknown',step:step.id});
      }
      return status();
      } finally { busy=false; }
    },
    close() {
      if (closed) return;
      check(!busy,'Cannot close a running release operation');
      closed=true;
      unlinkSync(lockPath);
      const fd=openSync(dir,constants.O_RDONLY|constants.O_NOFOLLOW);
      try { fsyncSync(fd); } finally { closeSync(fd); }
    },
  };
}
