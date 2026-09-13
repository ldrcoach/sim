const request = require('supertest');

let mockAvailable = true;
const mockFindResponseByCompletionCode = jest.fn();
const mockGetSummary = jest.fn();
const mockGetExportLongRows = jest.fn();
const mockGetExportPairedRows = jest.fn();

jest.mock('../checkin/db', () => ({
  isAvailable: () => mockAvailable,
  findResponseByCompletionCode: (...args) => mockFindResponseByCompletionCode(...args),
  getSummary: (...args) => mockGetSummary(...args),
  getExportLongRows: (...args) => mockGetExportLongRows(...args),
  getExportPairedRows: (...args) => mockGetExportPairedRows(...args),
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
    mockAvailable = true;
    app = buildApp();
    mockFindResponseByCompletionCode.mockReset();
    mockGetSummary.mockReset();
    mockGetExportLongRows.mockReset();
    mockGetExportPairedRows.mockReset();
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

    test('returns 500 with a generic error when the db call throws', async () => {
      mockGetSummary.mockRejectedValueOnce(new Error('connection refused: some.internal.hostname:5432'));
      const res = await request(app)
        .get('/api/admin/summary?course=OBLD500')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal error' });
      expect(JSON.stringify(res.body)).not.toContain('some.internal.hostname');
    });
  });

  describe('GET /api/admin/export', () => {
    test('long shape, json format returns raw rows', async () => {
      const rows = [{ response_id: 1, item_id: 'AL01', raw_value: 5 }];
      mockGetExportLongRows.mockResolvedValueOnce(rows);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=long&format=json')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ course: 'OBLD500', shape: 'long', rows });
    });

    test('long shape, csv format returns a CSV body', async () => {
      mockGetExportLongRows.mockResolvedValueOnce([{ a: 1, b: 2 }]);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=long&format=csv')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toBe('a,b\n1,2');
    });

    test('paired shape pivots baseline/debrief rows into one row per subscale', async () => {
      mockGetExportPairedRows.mockResolvedValueOnce([
        { participant_id: 'p1', module: 4, phase: 'baseline', subscale_id: 'sensing', mean: '5.00' },
        { participant_id: 'p1', module: 4, phase: 'debrief', subscale_id: 'sensing', mean: '6.00' },
      ]);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=paired&format=json')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([
        { participant_id: 'p1', module: 4, subscale_id: 'sensing', baseline_mean: 5, debrief_mean: 6, delta: 1 },
      ]);
    });

    test('defaults to format=json, shape=long when not specified', async () => {
      mockGetExportLongRows.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.shape).toBe('long');
      expect(mockGetExportLongRows).toHaveBeenCalledWith('OBLD500');
    });

    test('returns 400 for an invalid format', async () => {
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&format=xml')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });

    test('returns 400 for an invalid shape', async () => {
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=triangular')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });
  });

  describe('db availability guard', () => {
    test('returns 503 with a clean error when the database is not configured', async () => {
      mockAvailable = false;
      const res = await request(app)
        .get('/api/admin/verify?code=AL4-B-K7Q2M9PX')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'Database not configured' });
      expect(mockFindResponseByCompletionCode).not.toHaveBeenCalled();
    });
  });
});
