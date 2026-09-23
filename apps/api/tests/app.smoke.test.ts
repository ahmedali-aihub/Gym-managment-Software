import type { Application } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * HTTP smoke tests.
 *
 * These exercise the real Express stack — middleware order, validation,
 * auth guards, error shape — without a database. Prisma is mocked, because
 * what is under test here is the wiring: that an unauthenticated request is
 * rejected before it ever reaches a service, that validation errors come back
 * in the shape the frontend expects, and that unknown routes return structured
 * JSON rather than Express's HTML error page.
 */

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn(async () => null) },
    // An unknown refresh token must reach authService.refresh and be rejected
    // as 401 there — not blow up on an undefined mock and surface as a 500.
    refreshToken: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
  },
  isPrismaError: () => false,
  PrismaErrorCode: {
    UNIQUE_CONSTRAINT: 'P2002',
    FOREIGN_KEY_CONSTRAINT: 'P2003',
    RECORD_NOT_FOUND: 'P2025',
    VALUE_TOO_LONG: 'P2000',
  },
}));

let app: Application;

beforeAll(async () => {
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

describe('health', () => {
  it('reports service status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
  });
});

describe('unknown routes', () => {
  it('returns structured JSON, not an HTML error page', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.headers['content-type']).toMatch(/json/);
  });
});

describe('authentication guard', () => {
  const protectedRoutes = [
    { method: 'get' as const, path: '/api/members' },
    { method: 'get' as const, path: '/api/members/stats' },
    { method: 'post' as const, path: '/api/members' },
    { method: 'get' as const, path: '/api/plans' },
    { method: 'get' as const, path: '/api/payments' },
    { method: 'post' as const, path: '/api/payments' },
    { method: 'get' as const, path: '/api/sms/logs' },
    { method: 'get' as const, path: '/api/sms/failed' },
    { method: 'get' as const, path: '/api/memberships/expiring' },
  ];

  it.each(protectedRoutes)(
    'rejects unauthenticated $method $path',
    async ({ method, path }) => {
      const response = await request(app)[method](path);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    },
  );

  it('rejects a malformed bearer token', async () => {
    const response = await request(app)
      .get('/api/members')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('ignores an Authorization header that is not Bearer', async () => {
    const response = await request(app)
      .get('/api/members')
      .set('Authorization', 'Basic dXNlcjpwYXNz');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('validation', () => {
  it('rejects a login with no credentials and names the fields', async () => {
    const response = await request(app).post('/api/auth/login').send({});

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toHaveProperty('identifier');
    expect(response.body.error.details).toHaveProperty('password');
  });

  it('returns field-keyed details the frontend can map to form errors', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ identifier: '', password: '' });

    expect(response.status).toBe(422);
    expect(Array.isArray(response.body.error.details.identifier)).toBe(true);
  });

  it('validates before authenticating, so no timing oracle is exposed', async () => {
    // An empty body must fail validation (422) rather than reaching the
    // credential check and returning 401.
    const response = await request(app).post('/api/auth/login').send({});
    expect(response.status).toBe(422);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'nonexistent-token' });

    expect(response.status).toBe(401);
  });
});

describe('security headers', () => {
  it('sets helmet defaults', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers).toHaveProperty('x-content-type-options');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // Helmet removes this so the server does not advertise Express.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('exempts health checks from rate limiting', async () => {
    // Uptime monitors poll this constantly; throttling it would make the
    // service look down precisely when it is being watched most closely.
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeUndefined();
  });

  it('rate-limits ordinary API routes', async () => {
    const response = await request(app).get('/api/members');
    expect(response.headers).toHaveProperty('ratelimit-limit');
  });
});

describe('error response shape', () => {
  it('always carries success, error.code and error.message', async () => {
    const response = await request(app).get('/api/members');

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
    });
  });

  it('attaches a request ID for support traceability', async () => {
    const response = await request(app).get('/api/members');
    expect(response.body.requestId).toEqual(expect.any(String));
  });
});
