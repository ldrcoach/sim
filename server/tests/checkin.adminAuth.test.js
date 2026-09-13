const express = require('express');
const request = require('supertest');

describe('requireAdminToken', () => {
  let app;
  const ORIGINAL_TOKEN = process.env.CHECKIN_ADMIN_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.CHECKIN_ADMIN_TOKEN;
    else process.env.CHECKIN_ADMIN_TOKEN = ORIGINAL_TOKEN;
  });

  function buildApp() {
    delete require.cache[require.resolve('../checkin/adminAuth')];
    const { requireAdminToken } = require('../checkin/adminAuth');
    const testApp = express();
    testApp.get('/protected', requireAdminToken, (req, res) => res.json({ ok: true }));
    return testApp;
  }

  test('returns 503 when CHECKIN_ADMIN_TOKEN is not configured', async () => {
    delete process.env.CHECKIN_ADMIN_TOKEN;
    app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(503);
  });

  test('returns 401 when no token header is sent', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  test('returns 401 when the wrong token is sent', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected').set('X-Admin-Token', 'wrong-token');
    expect(res.status).toBe(401);
  });

  test('returns 401 when the token has the wrong length (does not throw)', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected').set('X-Admin-Token', 'short');
    expect(res.status).toBe(401);
  });

  test('allows the request through when the correct token is sent', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected').set('X-Admin-Token', 'correct-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
