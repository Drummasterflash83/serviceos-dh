import { Buffer } from "node:buffer";

const identityHeaders = ["from", "subject", "to", "date", "message-id", "mime-version"];
const fail = () => { throw Error("notification_authenticated_mime_unverified"); };

function fields(text) {
  if (text.length > 16384) fail();
  const rows = [];
  for (const line of text.split("\r\n")) {
    if (/^[ \t]/.test(line)) {
      if (!rows.length) fail();
      rows[rows.length - 1] += "\r\n" + line;
    } else {
      if (!/^[a-zA-Z0-9-]+:/.test(line)) fail();
      rows.push(line);
    }
  }
  return rows.map((raw) => ({
    name: raw.slice(0, raw.indexOf(":")).toLowerCase(),
    value: raw.slice(raw.indexOf(":") + 1).replace(/\r\n[ \t]+/g, " ").trim(),
    raw,
  }));
}
const only = (rows, name) => {
  const found = rows.filter((r) => r.name === name);
  if (found.length !== 1) fail();
  return found[0].value;
};

/** Call ONLY after current-provider DKIM authenticates the entire body and every
 * identity header. This is MIME interpretation, never signature verification.
 * The boundary comes from authenticated body bytes. Unsigned root MIME headers
 * can reject an inconsistent source but can never select its interpretation.
 * Scope is the observed two-part legacy template, not arbitrary MIME recovery.
 */
export function reconstructAuthenticatedMultipart(input) {
  if (!(input instanceof Uint8Array) || input.byteLength > 1048576) fail();
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const separator = raw.indexOf("\r\n\r\n");
  if (separator < 1 || separator > 16384) fail();
  const headers = fields(raw.subarray(0, separator).toString("latin1"));
  for (const name of identityHeaders) only(headers, name);
  if (headers.some((h) => ["content-transfer-encoding", "content-disposition"].includes(h.name))) fail();
  const body = raw.subarray(separator + 4);
  const text = body.toString("latin1");
  if (/(^|[^\r])\n|\r(?!\n)/.test(text)) fail();
  const start = /^(?:\r\n){0,4}--([A-Za-z0-9'()+_,.\/:=?-]{1,70})\r\n/.exec(text);
  if (!start) fail();
  const boundary = start[1], delimiter = "--" + boundary;
  // A changed/malformed unsigned declaration is refused, not used to discover
  // boundaries. Duplicate declarations and extra interpretation parameters fail.
  const declaration = /^multipart\/mixed\s*;\s*boundary=(?:"([^"\\]{1,70})"|([^;\s]{1,70}))\s*$/i.exec(only(headers, "content-type"));
  if (!declaration || (declaration[1] ?? declaration[2]) !== boundary) fail();
  const lines = text.split("\r\n"), positions = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(delimiter)) continue;
    if (lines[i] !== delimiter && lines[i] !== delimiter + "--") fail();
    positions.push(i);
  }
  if (positions.length !== 3 || lines[positions[0]] !== delimiter || lines[positions[1]] !== delimiter ||
      lines[positions[2]] !== delimiter + "--" || !lines.slice(positions[2] + 1).every((line) => line === "")) fail();
  const parts = positions.slice(0, 2).map((at, i) => {
    const part = lines.slice(at + 1, positions[i + 1]).join("\r\n");
    const split = part.indexOf("\r\n\r\n");
    if (split < 1 || split > 16384) fail();
    const rows = fields(part.slice(0, split));
    for (const name of ["content-type", "content-disposition", "content-transfer-encoding"])
      if (rows.filter((r) => r.name === name).length > 1) fail();
    return rows;
  });
  // Both interpretation-bearing part headers are inside the authenticated body.
  if (!/^multipart\/alternative\s*;/i.test(only(parts[0], "content-type")) ||
      parts[0].some((h) => ["content-transfer-encoding", "content-disposition"].includes(h.name))) fail();
  if (!/^(?:application\/octet-stream|audio\/mpeg|audio\/mp3)(?:\s*;|\s*$)/i.test(only(parts[1], "content-type")) ||
      !/^attachment\s*;/i.test(only(parts[1], "content-disposition")) ||
      only(parts[1], "content-transfer-encoding").toLowerCase() !== "base64") fail();
  const signedIdentity = headers.filter((h) => identityHeaders.includes(h.name)).map((h) => h.raw);
  return Buffer.concat([
    Buffer.from(signedIdentity.join("\r\n") + '\r\nContent-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n', "latin1"),
    body,
  ]);
}
