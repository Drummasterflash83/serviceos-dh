import http from 'node:http';

const routes = [
  ['/auth/v1', 9999],
  ['/rest/v1', 3000],
];

http.createServer((request, response) => {
  const route = routes.find(([prefix]) => request.url === prefix || request.url.startsWith(prefix + '/'));
  if (!route) {
    response.writeHead(404);
    response.end();
    return;
  }
  const [prefix, port] = route;
  const headers = { ...request.headers, host: `127.0.0.1:${port}` };
  const upstream = http.request({
    host: '127.0.0.1', port, method: request.method,
    path: request.url.slice(prefix.length) || '/', headers,
    timeout: 5000,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
}).listen(8000, '127.0.0.1');
