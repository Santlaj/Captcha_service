import { describe, it, expect, afterEach } from 'vitest';
import express, { Express } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

describe('Trust Proxy and Client IP Resolution (Requirement 3)', () => {
  let servers: http.Server[] = [];

  function createTestServer(trustProxySetting: boolean | number | string): Promise<{
    url: string;
    server: http.Server;
  }> {
    const app: Express = express();
    app.set('trust proxy', trustProxySetting);

    app.get('/client-ip', (req, res) => {
      res.json({
        ip: req.ip,
        ips: req.ips,
        socketRemoteAddress: req.socket.remoteAddress,
      });
    });

    return new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        servers.push(server);
        const address = server.address() as AddressInfo;
        resolve({
          url: `http://127.0.0.1:${address.port}`,
          server,
        });
      });
    });
  }

  afterEach(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    servers = [];
  });

  it('ignores spoofed X-Forwarded-For when trust proxy is false (direct internet deployment)', async () => {
    const { url } = await createTestServer(false);

    const res = await fetch(`${url}/client-ip`, {
      headers: {
        'X-Forwarded-For': '203.0.113.195',
      },
    });

    const data = (await res.json()) as { ip: string; ips: string[]; socketRemoteAddress: string };

    // With trust proxy = false, Express ignores X-Forwarded-For and uses socket remote address
    expect(data.ip).toBe('127.0.0.1');
    expect(data.ip).not.toBe('203.0.113.195');
    expect(data.ips).toEqual([]);
  });

  it('correctly resolves client IP from X-Forwarded-For when single reverse proxy is trusted (trust proxy = 1)', async () => {
    const { url } = await createTestServer(1);

    const res = await fetch(`${url}/client-ip`, {
      headers: {
        'X-Forwarded-For': '203.0.113.195',
      },
    });

    const data = (await res.json()) as { ip: string; ips: string[] };

    // With trust proxy = 1, Express trusts 1 reverse proxy hop (e.g. AWS ALB / Nginx)
    expect(data.ip).toBe('203.0.113.195');
  });

  it('prevents spoofing of left-most IP when trust proxy is 1 hop (e.g., untrusted client prepending headers)', async () => {
    const { url } = await createTestServer(1);

    // Attacker sends: X-Forwarded-For: "spoofed-ip, real-client-ip"
    // Reverse proxy appends client IP, so rightmost is the real client seen by reverse proxy
    const res = await fetch(`${url}/client-ip`, {
      headers: {
        'X-Forwarded-For': '198.51.100.1, 203.0.113.195',
      },
    });

    const data = (await res.json()) as { ip: string };

    // When 1 hop is trusted, Express takes the 1st untrusted IP from the right (203.0.113.195),
    // rejecting the attacker's spoofed 198.51.100.1
    expect(data.ip).toBe('203.0.113.195');
  });

  it('supports trusted CIDR / subnet configuration (e.g. loopback, 127.0.0.1)', async () => {
    const { url } = await createTestServer('loopback');

    const res = await fetch(`${url}/client-ip`, {
      headers: {
        'X-Forwarded-For': '203.0.113.195',
      },
    });

    const data = (await res.json()) as { ip: string };
    expect(data.ip).toBe('203.0.113.195');
  });
});
