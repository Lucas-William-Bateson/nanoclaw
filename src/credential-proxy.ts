/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Copilot API.
 * The proxy injects real credentials so containers never see them.
 *
 * Auth mode:
 *   GitHub token: Proxy injects Bearer token on every request.
 *   The container sends requests with a placeholder token,
 *   and the proxy replaces it with the real GITHUB_TOKEN.
 *
 * Legacy Anthropic auth is still supported for backwards compatibility.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'github-token' | 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'GITHUB_TOKEN',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'COPILOT_API_URL',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.GITHUB_TOKEN
    ? 'github-token'
    : secrets.ANTHROPIC_API_KEY
      ? 'api-key'
      : 'oauth';

  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  // Determine upstream URL based on auth mode
  const upstreamUrl = new URL(
    authMode === 'github-token'
      ? secrets.COPILOT_API_URL || 'https://api.githubcopilot.com'
      : secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'github-token') {
          // GitHub token mode: replace Bearer placeholder with real token
          delete headers['authorization'];
          headers['authorization'] = `Bearer ${secrets.GITHUB_TOKEN}`;
        } else if (authMode === 'api-key') {
          // Legacy Anthropic API key mode
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // Legacy OAuth mode
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: req.url,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['GITHUB_TOKEN', 'ANTHROPIC_API_KEY']);
  return secrets.GITHUB_TOKEN
    ? 'github-token'
    : secrets.ANTHROPIC_API_KEY
      ? 'api-key'
      : 'oauth';
}
