import http from 'http';
import { getSecretManager } from '@intentorch/core';
import type { RouteContext } from './status';

/**
 * Authentication middleware for daemon server
 * Skips auth for /api/status and /api/auth/token
 */
export async function authMiddleware(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const path = parsedUrl.pathname;
  
  // Skip auth for public endpoints
  if (path === '/api/status' || path === '/api/auth/token' || path === '/api/sui/parse-intent' || path === '/api/sui/build-transaction') {
    return true;
  }
  
  const auth = req.headers.authorization;
  const token = await getSecretManager().get('daemon_auth_token');
  
  if (!auth || auth.substring(7) !== token) {
    if (!res.headersSent) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    return false;
  }
  
  return true;
}

/**
 * Auth verification routes
 * - GET /api/auth/verify
 */
export async function handleAuthRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, res } = ctx;

  // GET /api/auth/verify
  if (path === '/api/auth/verify' && method === 'GET') {
    sendJson(res, 200, { verified: true, message: 'Token is valid' });
    return true;
  }

  return false;
}

function sendJson(res: http.ServerResponse, c: number, d: any) {
  if (!res.headersSent) {
    res.writeHead(c, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(d));
  }
}
