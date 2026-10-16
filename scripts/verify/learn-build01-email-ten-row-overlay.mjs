/** Exact current deployed-source patch for bounded older Email selection. */
import { createHash } from 'node:crypto';
export function patchDeployedEmailTenRow(source) {
  if (createHash('sha256').update(source).digest('hex') !==
    '7a99df760e37592bd5b751bdbf52d3ce1c5dd1249fcf2c3e7533128120ba2b28')
    throw Error('Ten-row Email deployed baseline changed');
  const before='!currentEmail && source === "email" && (ctx.claim?.attemptCount ?? 1) > 1 ? Math.min(requestedLimit, 50) : requestedLimit';
  const after='!currentEmail && source === "email" ? Math.min(requestedLimit, 10) : requestedLimit';
  const at=source.indexOf(before);
  if(at<0||source.indexOf(before,at+before.length)>=0)
    throw Error('Ten-row Email source anchor changed');
  return source.slice(0,at)+after+source.slice(at+before.length);
}
