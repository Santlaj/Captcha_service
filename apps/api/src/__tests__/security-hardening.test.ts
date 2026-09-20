import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { config } from '../config/env.js';

describe('Security Hardening & API Protection (Prompt 5)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('1. Malformed Request Validation', () => {
    it('rejects malformed / unparseable JSON payload with 400 MALFORMED_JSON', async () => {
      const res = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"challengeId": "invalid-json...',
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { code: string; error: string; success: boolean };
      expect(data.success).toBe(false);
      expect(data.code).toBe('MALFORMED_JSON');
    });

    it('rejects non-UUID challengeId with 400 Bad Request before querying database', async () => {
      const res = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: 'not-a-valid-uuid',
          answer: '123456',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string; details: { issues: Array<{ field: string }> } };
      expect(data.error).toBe('Invalid request body');
      expect(data.details.issues.some((i) => i.field === 'challengeId')).toBe(true);
    });

    it('rejects non-numeric answer with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: '550e8400-e29b-41d4-a716-446655440000',
          answer: 'abcdef',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { details: { issues: Array<{ field: string }> } };
      expect(data.details.issues.some((i) => i.field === 'answer')).toBe(true);
    });

    it('rejects answer with incorrect length (e.g. 5 digits or 7 digits) with 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: '550e8400-e29b-41d4-a716-446655440000',
          answer: '12345',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects unexpected / injected body properties with 400 (strict schema enforcement)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: '550e8400-e29b-41d4-a716-446655440000',
          answer: '123456',
          isAdmin: true,
          injectedField: 'malicious',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string; details: { issues: Array<{ field: string; message: string }> } };
      expect(data.details.issues.some((i) => i.message.includes('unrecognized_keys') || i.message.includes('Unrecognized'))).toBe(true);
    });
  });

  describe('2. Request Body Size Limit', () => {
    it('rejects request payloads exceeding 10KB with HTTP 413 Payload Too Large', async () => {
      const oversizedPayload = JSON.stringify({
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        answer: '123456',
        junkData: 'A'.repeat(12 * 1024), // 12KB
      });

      const res = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedPayload,
      });

      expect(res.status).toBe(413);
      const data = (await res.json()) as { code: string; success: boolean };
      expect(data.success).toBe(false);
      expect(data.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('3. Security Headers and Answer Non-Disclosure', () => {
    it('sets standard security headers and strictly excludes answer from challenge response', async () => {
      const res = await fetch(`${baseUrl}/api/v1/challenge`);

      expect(res.status).toBe(200);

      // Verify Helmet security headers
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');

      // Verify Cache-Control
      expect(res.headers.get('cache-control')).toContain('no-store');

      const data = (await res.json()) as Record<string, unknown>;

      // Strictly verify answer non-disclosure
      expect(data['challengeId']).toBeDefined();
      expect(data['image']).toBeDefined();
      expect(data['expiresAt']).toBeDefined();
      expect(data['answer']).toBeUndefined();
      expect(Object.keys(data).sort()).toEqual(['challengeId', 'expiresAt', 'image'].sort());
    });

    it('omits answer from error details when solution verification fails', async () => {
      // Create a valid challenge first
      const challengeRes = await fetch(`${baseUrl}/api/v1/challenge`);
      const { challengeId } = (await challengeRes.json()) as { challengeId: string };

      // Submit incorrect answer
      const wrongRes = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          answer: '000000',
        }),
      });

      expect(wrongRes.status).toBe(400);
      const data = (await wrongRes.json()) as Record<string, unknown>;

      // Neither error message nor details should leak the answer
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain('correctAnswer');
      expect((data['details'] as Record<string, unknown>)?.['answer']).toBeUndefined();
    });
  });

  describe('4. CORS Allowlist Policy', () => {
    it('allows requests from origins defined in config.corsOrigins', async () => {
      const allowedOrigin = config.corsOrigins[0] || 'http://localhost:3000';

      const res = await fetch(`${baseUrl}/api/v1/challenge`, {
        headers: {
          Origin: allowedOrigin,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('rejects requests from disallowed origins with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/v1/challenge`, {
        headers: {
          Origin: 'https://malicious-external-site.com',
        },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as { code: string; success: boolean };
      expect(data.success).toBe(false);
      expect(data.code).toBe('CORS_FORBIDDEN');
    });

    it('responds to preflight OPTIONS requests with allowed methods and headers', async () => {
      const allowedOrigin = config.corsOrigins[0] || 'http://localhost:3000';

      const res = await fetch(`${baseUrl}/api/v1/solution`, {
        method: 'OPTIONS',
        headers: {
          'Origin': allowedOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Site-Key',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
    });
  });
});
