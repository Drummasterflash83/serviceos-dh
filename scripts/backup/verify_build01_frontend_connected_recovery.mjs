/** One-shot localhost browser probe for the already isolated Build 01 restore.
 * The Python caller supplies only disposable Auth credentials and a synthetic
 * public key. Docker services remain in their network-none namespace; this
 * process forwards bounded HTTP requests over docker exec and never opens a
 * production/provider connection. It prints aggregate booleans only.
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const oldSource = join(root, ".verification-results/build01-frontend-rebuild-20261017/source");
const source = join(root, ".verification-results/build01-frontend-connected-20261017/source");
const dbName = process.env.LEARN_RECOVERY_DB_NAME;
const email = process.env.LEARN_RECOVERY_EMAIL;
const password = process.env.LEARN_RECOVERY_PASSWORD;
const anonKey = process.env.LEARN_RECOVERY_ANON_KEY;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dockerPath = "/usr/local/bin/docker";
if (!/^serviceos-db-recovery-[a-f0-9]+$/.test(dbName ?? "") ||
    !email || !password || !anonKey || !existsSync(chromePath) || !existsSync(oldSource))
  throw Error("Exact isolated recovery browser inputs required");

const counts = { authLoginOk: 0, authLoginResponseShapeOk: 0,
  authUserOk: 0, restCardOk: 0, restRpcRequests: 0, edgeOk: 0,
  blockedAdminRequests: 0 };
const report = { version: "learn-build01-connected-frontend-recovery/1",
  frontendSource: "last_verified_live_git_archive_77a73802",
  restoredServiceNetwork: "none", hostListen: "127.0.0.1 ephemeral",
  temporaryChromeProfileRemoved: false, temporaryServerStopped: false,
  productionProviderConnectionAvailableToRestoredServices: false,
  productionWrites: false,
  frontendBuildSucceeded: false, loginFormRendered: false,
  signedInRedirected: false, learnRouteRendered: false,
  browserTenantCardRead: false, browserCurrentEdgeRead: false,
  browserActor: "synthetic_tenant_user_in_disposable_restore" };
let server, chrome, profile, ws, handler;
let phase = "preflight";

function contentType(path) {
  const ext = path.split(".").pop();
  return ({ js: "text/javascript", mjs: "text/javascript", css: "text/css",
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", webp: "image/webp", ico: "image/x-icon",
    woff2: "font/woff2", json: "application/json" })[ext] ?? "application/octet-stream";
}

async function bodyOf(request, max = 1024 * 1024) {
  const blocks = []; let bytes = 0;
  for await (const block of request) {
    bytes += block.length;
    if (bytes > max) throw Error("Recovery browser request exceeded bound");
    blocks.push(block);
  }
  return Buffer.concat(blocks);
}

async function dockerHttp(request, response, port, path) {
  const data = await bodyOf(request);
  const args = ["exec", "-i", dbName, "curl", "--silent", "--show-error",
    "--max-time", "12", "--include", "--request", request.method];
  for (const name of ["authorization", "apikey", "content-type", "accept", "prefer",
      "range", "x-client-info", "accept-profile", "content-profile"]) {
    const value = request.headers[name];
    if (typeof value === "string" && !/[\r\n]/.test(value)) args.push("--header", `${name}: ${value}`);
  }
  if (data.length) args.push("--data-binary", "@-");
  args.push(`http://127.0.0.1:${port}${path}`);
  const child = spawn(dockerPath, args, { stdio: ["pipe", "pipe", "pipe"] });
  const parts = []; let total = 0;
  child.stdout.on("data", part => { total += part.length; if (total <= 8 * 1024 * 1024) parts.push(part); else child.kill(); });
  child.stdin.end(data);
  const exit = await new Promise(resolveExit => child.on("close", resolveExit));
  if (exit !== 0 || total > 8 * 1024 * 1024) { response.writeHead(502); response.end(); return; }
  const raw = Buffer.concat(parts);
  const marker = raw.indexOf("\r\n\r\n");
  if (marker < 0) { response.writeHead(502); response.end(); return; }
  const head = raw.subarray(0, marker).toString("latin1").split("\r\n");
  const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(head[0])?.[1] ?? 502);
  const headers = {};
  for (const line of head.slice(1)) {
    const split = line.indexOf(":");
    if (split < 1) continue;
    const key = line.slice(0, split).toLowerCase();
    if (["content-type", "content-range", "cache-control", "etag"].includes(key))
      headers[key] = line.slice(split + 1).trim();
  }
  if (port === 9999 && path.startsWith("/token") && status === 200) {
    counts.authLoginOk++;
    try { const parsed = JSON.parse(raw.subarray(marker + 4).toString("utf8"));
      if (parsed.access_token && parsed.user?.id) counts.authLoginResponseShapeOk++;
    } catch { /* The aggregate diagnostic remains false. */ }
  }
  if (port === 9999 && path === "/user" && status === 200) counts.authUserOk++;
  if (port === 3000 && path.startsWith("/customer_cards") && status === 200) counts.restCardOk++;
  if (port === 3000 && path.startsWith("/rpc/")) counts.restRpcRequests++;
  if (port === 9000 && status === 200) counts.edgeOk++;
  response.writeHead(status, headers); response.end(raw.subarray(marker + 4));
}

class DevTools {
  constructor(socket) { this.socket = socket; this.next = 1; this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const msg = JSON.parse(data); const pending = this.pending.get(msg.id);
      if (pending) { this.pending.delete(msg.id); clearTimeout(pending.timer);
        msg.error ? pending.reject(Error(msg.error.message)) : pending.resolve(msg.result); }
    });
  }
  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolveValue, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error("Browser command timed out")); }, 12000);
      this.pending.set(id, { resolve: resolveValue, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true,
      awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw Error("Browser script failed");
    return result.result?.value;
  }
}

async function pause(ms) { await new Promise(r => setTimeout(r, ms)); }
async function until(check, limitMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < limitMs) { const value = await check(); if (value) return value; await pause(250); }
  return null;
}

try {
  phase = "loopback_server";
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/auth/v1/admin/")) {
        counts.blockedAdminRequests++; response.writeHead(403); response.end(); return;
      }
      const route = url.pathname.startsWith("/auth/v1/") ? [9999, url.pathname.slice(8) + url.search]
        : url.pathname.startsWith("/rest/v1/") ? [3000, url.pathname.slice(8) + url.search]
        : url.pathname === "/functions/v1/learn-launch-status" ? [9000, "/" + url.search]
        : null;
      if (route) { await dockerHttp(request, response, ...route); return; }
      if (url.pathname.startsWith("/functions/") || url.pathname.startsWith("/storage/") ||
          url.pathname.startsWith("/realtime/")) {
        response.writeHead(503); response.end(); return;
      }
      const staticRoot = join(source, ".vercel/output/static");
      const local = resolve(staticRoot, "." + decodeURIComponent(url.pathname));
      if (local.startsWith(staticRoot + sep) && existsSync(local) && statSync(local).isFile()) {
        response.writeHead(200, { "content-type": contentType(local) });
        response.end(readFileSync(local)); return;
      }
      if (!handler) { response.writeHead(503); response.end(); return; }
      const proxied = await handler.fetch(new Request(`http://127.0.0.1:${server.address().port}${request.url}`,
        { method: request.method, headers: request.headers,
          ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: await bodyOf(request) }) }), {});
      const headers = Object.fromEntries(proxied.headers);
      response.writeHead(proxied.status, headers);
      response.end(Buffer.from(await proxied.arrayBuffer()));
    } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  if (!existsSync(source)) cpSync(oldSource, source, { recursive: true, filter: path =>
    !path.includes(`${sep}.vercel${sep}`) && !path.endsWith(`${sep}.vercel`) });
  phase = "vercel_frontend_build";
  const build = spawnSync("npm", ["run", "build"], { cwd: source,
    env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${port}`,
      VITE_SUPABASE_ANON_KEY: anonKey, NITRO_PRESET: "vercel", VERCEL: "1" },
      encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
      timeout: 180000 });
  if (build.status !== 0) throw Error("Connected frontend rebuild failed");
  report.frontendBuildSucceeded = true;
  const handlerFile = join(source, ".vercel/output/functions/__server.func/index.mjs");
  handler = (await import(pathToFileURL(handlerFile))).default;
  phase = "headless_browser_startup";
  profile = mkdtempSync(join(tmpdir(), "serviceos-recovery-chrome-"));
  chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-background-networking",
    "--disable-sync", "--disable-extensions", "--disable-component-update", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  const cdpPort = await until(() => existsSync(portFile) && readFileSync(portFile, "utf8").split("\n")[0], 15000);
  if (!cdpPort) throw Error("Headless browser did not start");
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const target = targets.find(x => x.type === "page");
  if (!target) throw Error("Headless page target absent");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", reject, { once: true }); });
  const cdp = new DevTools(ws);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  phase = "browser_login";
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/login` });
  report.loginFormRendered = !!await until(() => cdp.evaluate("Boolean(document.querySelector('#email') && document.querySelector('#password'))"));
  if (!report.loginFormRendered) throw Error("Recovered frontend login form unavailable");
  report.loginInputsEnabled = !!await until(() => cdp.evaluate(
    "Boolean(!document.querySelector('#email')?.disabled && !document.querySelector('#password')?.disabled)"));
  if (!report.loginInputsEnabled) throw Error("Recovered frontend login controls never enabled");
  await cdp.evaluate("document.querySelector('#email').focus()");
  await cdp.send("Input.insertText", { text: email });
  await cdp.evaluate("document.querySelector('#password').focus()");
  await cdp.send("Input.insertText", { text: password });
  const entered = await until(() => cdp.evaluate(`document.querySelector('#email')?.value === ${JSON.stringify(email)} && document.querySelector('#password')?.value === ${JSON.stringify(password)}`));
  if (!entered) throw Error("Recovered login form could not be filled");
  await pause(200);
  await cdp.evaluate("document.querySelector('form').requestSubmit()");
  report.signedInRedirected = !!await until(() => cdp.evaluate("location.pathname === '/client'"), 30000);
  if (!report.signedInRedirected) {
    report.loginInlineErrorVisible = await cdp.evaluate(
      "Boolean(document.querySelector('[role=alert]'))");
    report.sessionStored = await cdp.evaluate(
      "Object.keys(localStorage).some(key => key.startsWith('sb-') && key.endsWith('-auth-token'))");
  }
  if (!report.signedInRedirected) throw Error("Recovered frontend did not complete signed-in redirect");
  phase = "browser_learn_route";
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/client?tenant=00000000-0000-0000-0000-000000000001&section=learn` });
  report.learnRouteRendered = !!await until(() => cdp.evaluate("location.pathname === '/client' && document.body.innerText.includes('LEARN')"), 20000);
  const browserReads = await cdp.evaluate(`(async () => {
    const entry = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const session = entry && JSON.parse(localStorage.getItem(entry));
    if (!session?.access_token) return { session: false, cards: false, edge: false };
    const headers = { apikey: ${JSON.stringify(anonKey)}, authorization: 'Bearer ' + session.access_token };
    const cards = await fetch('/rest/v1/customer_cards?select=id,tenant_id&limit=5', { headers });
    const rows = cards.ok ? await cards.json() : [];
    const edge = await fetch('/functions/v1/learn-launch-status', { method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: '00000000-0000-0000-0000-000000000001' }) });
    const value = edge.ok ? await edge.json() : {};
    return { session: true, cards: cards.ok && Array.isArray(rows) && rows.length === 5 &&
      rows.every(row => row.tenant_id === '00000000-0000-0000-0000-000000000001'),
      edge: edge.ok && value.tenant_id === '00000000-0000-0000-0000-000000000001' &&
        value.counts?.phone?.record_count > 0 && value.counts?.email?.record_count > 0 };
  })()`);
  report.browserTenantCardRead = browserReads?.cards === true;
  report.browserCurrentEdgeRead = browserReads?.edge === true;
  report.proxyCounts = counts;
  if (!report.learnRouteRendered || !report.browserTenantCardRead || !report.browserCurrentEdgeRead ||
      counts.authLoginOk < 1 || counts.restCardOk < 1 || counts.edgeOk < 1)
    throw Error("Connected browser acceptance incomplete");
  report.state = "connected_signed_in_recovered_route_verified";
} catch {
  report.state = "connected_signed_in_recovered_route_unverified";
  report.failurePhase = phase;
} finally {
  if (ws) ws.close();
  if (chrome) { chrome.kill("SIGTERM"); await pause(1000); if (chrome.exitCode === null) chrome.kill("SIGKILL"); }
  if (profile) { rmSync(profile, { recursive: true, force: true }); report.temporaryChromeProfileRemoved = !existsSync(profile); }
  if (server) { await new Promise(resolveClose => server.close(resolveClose)); report.temporaryServerStopped = true; }
  report.proxyCounts = counts;
  console.log(JSON.stringify(report));
  if (report.state !== "connected_signed_in_recovered_route_verified") process.exitCode = 1;
}
