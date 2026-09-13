const request = require('supertest');

const mockFindResponseByCompletionCode = jest.fn();
const mockGetSummary = jest.fn();

jest.mock('../checkin/db', () => ({
  isAvailable: () => true,
  findResponseByCompletionCode: (...args) => mockFindResponseByCompletionCode(...args),
  getSummary: (...args) => mockGetSummary(...args),
}));

function buildApp() {
  delete require.cache[require.resolve('../checkin/adminRoutes')];
  delete require.cache[require.resolve('../checkin/adminAuth')];
  const express = require('express');
  const adminRoutes = require('../checkin/adminRoutes');
  const app = express();
  app.use('/api/admin', adminRoutes);
  return app;
}

const ADMIN_TOKEN = 'test-admin-token';

describe('admin routes', () => {
  let app;
  const ORIGINAL_TOKEN = process.env.CHECKIN_ADMIN_TOKEN;

  beforeEach(() => {
    process.env.CHECKIN_ADMIN_TOKEN = ADMIN_TOKEN;
    app = buildApp();
    mockFindResponseByCompletionCode.mockReset();
    mockGetSummary.mockReset();
  });

  afterAll(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.CHECKIN_ADMIN_TOKEN;
    else process.env.CHECKIN_ADMIN_TOKEN = ORIGINAL_TOKEN;
  });

  describe('GET /api/admin/verify', () => {
    test('returns valid: true with response details for a known code', async () => {
      mockFindResponseByCompletionCode.mockResolvedValueOnce({
        course: 'OBLD500', module: 4, phase: 'baseline', submitted_at: '2027-01-15T00:00:00Z',
      });
      const res = await request(app)
        .get('/api/admin/verify?code=AL4-B-K7Q2M9PX')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        valid: true, course: 'OBLD500', module: 4, phase: 'baseline', submitted_at: '2027-01-15T00:00:00Z',
      });
    });

    test('returns valid: false for an unknown code', async () => {
      mockFindResponseByCompletionCode.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/api/admin/verify?code=NOT-REAL')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false });
    });

    test('returns 400 when code is missing', async () => {
      const res = await request(app).get('/api/admin/verify').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });

    test('returns 401 without a valid admin token', async () => {
      const res = await request(app).get('/api/admin/verify?code=AL4-B-K7Q2M9PX');
      expect(res.status).toBe(401);
      expect(mockFindResponseByCompletionCode).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/admin/summary', () => {
    test('returns the course summary', async () => {
      const rows = [{ module: 4, phase: 'baseline', total: 10, straightline_count: 1, last_submission: '2027-01-20T00:00:00Z' }];
      mockGetSummary.mockResolvedValueOnce(rows);
      const res = await request(app)
        .get('/api/admin/summary?course=OBLD500')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ course: 'OBLD500', summary: rows });
    });

    test('returns 400 when course is missing', async () => {
      const res = await request(app).get('/api/admin/summary').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });
  });
});
