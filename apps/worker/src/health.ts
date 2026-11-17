import { createServer, type Server } from 'node:http';

const startedAt = Date.now();

export function startHealthServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/health' && req.url !== '/health/ready') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'ROUTE_NOT_FOUND' } }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'viralclip-worker',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString(),
      }),
    );
  });

  server.listen(port);
  return server;
}
