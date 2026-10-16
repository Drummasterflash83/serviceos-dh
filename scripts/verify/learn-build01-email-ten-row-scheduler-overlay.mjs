/** Exact deployed-source patch for the ten-row older Email schedule payload. */
import { createHash } from 'node:crypto';
export function patchDeployedEmailTenRowSchedule(source) {
  if(createHash('sha256').update(source).digest('hex')!==
    'c1c2e3eb94a07443d58ba147765e31d232eb8f2b8df834b4abde12c5853d0cfb')
    throw Error('Ten-row scheduler baseline changed');
  const before='source: "email",\n        limit: 200';
  const after='source: "email",\n        limit: 10';
  const at=source.indexOf(before);
  if(at<0||source.indexOf(before,at+before.length)>=0)
    throw Error('Ten-row scheduler source anchor changed');
  return source.slice(0,at)+after+source.slice(at+before.length);
}
