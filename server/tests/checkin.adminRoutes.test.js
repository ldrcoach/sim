const request = require('supertest');

let mockAvailable = true;
const mockFindResponseByCompletionCode = jest.fn();
const mockGetSummary = jest.fn();
const mockGetExportLongRows = jest.fn();
const mockGetExportPairedRows = jest.fn();
const mockDeleteParticipant = jest.fn();
const mockFindParticipantIdsWithEmailByCourse = jest.fn();
const mockPurgeParticipantEmails = jest.fn();
const mockFindDistinctCoursesWithParticipantData = jest.fn();

jest.mock('../checkin/db', () => ({
  isAvailable: () => mockAvailable,
  findResponseByCompletionCode: (...args) => mockFindResponseByCompletionCode(...args),
  getSummary: (...args) => mockGetSummary(...args),
  getExportLongRows: (...args) => mockGetExportLongRows(...args),
  getExportPairedRows: (...args) => mockGetExportPairedRows(...args),
  deleteParticipant: (...args) => mockDeleteParticipant(...args),
  findParticipantIdsWithEmailByCourse: (...args) => mockFindParticipantIdsWithEmailByCourse(...args),
  purgeParticipantEmails: (...args) => mockPurgeParticipantEmails(...args),
  findDistinctCoursesWithParticipantData: (...args) => mockFindDistinctCoursesWithParticipantData(...args),
}));

const mockGetAllCourseConfigs = jest.fn();
jest.mock('../checkin/courses', () => ({
  getAllCourseConfigs: () => mockGetAllCourseConfigs(),
  load: jest.fn(),
  ensureLoaded: jest.fn(),
  getCourseConfig: jest.fn(),
}));

const mockInstrumentReload = jest.fn();
jest.mock('../checkin/instrumentLoader', () => ({
  load: jest.fn(),
  ensureLoaded: jest.fn(),
  getInstrument: jest.fn(),
  getPublicView: jest.fn(),
  reload: (...args) => mockInstrumentReload(...args),
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
    mockDeleteParticipant.mockReset();
    mockFindParticipantIdsWithEmailByCourse.mockReset();
    mockPurgeParticipantEmails.mockReset();
    mockFindDistinctCoursesWithParticipantData.mockReset().mockResolvedValue([]);
    mockGetAllCourseConfigs.mockReset().mockReturnValue({});
    mockInstrumentReload.mockReset();
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

  describe('POST /api/admin/instruments/reload', () => {
    test('reloads and returns ok', async () => {
      mockInstrumentReload.mockReturnValueOnce(new Map());
      const res = await request(app).post('/api/admin/instruments/reload').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockInstrumentReload).toHaveBeenCalled();
    });

    test('returns 400 when reload throws (bad instrument file)', async () => {
      mockInstrumentReload.mockImplementationOnce(() => { throw new Error('bad instrument'); });
      const res = await request(app).post('/api/admin/instruments/reload').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/admin/participant', () => {
    test('deletes a participant and their responses', async () => {
      mockDeleteParticipant.mockResolvedValueOnce({ responses_deleted: 2, participant_deleted: true });
      const res = await request(app)
        .delete('/api/admin/participant?participant_id=p1')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ responses_deleted: 2, participant_deleted: true });
    });

    test('returns 400 when participant_id is missing', async () => {
      const res = await request(app).delete('/api/admin/participant').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });

    test('returns 500 with a generic error when deletion throws', async () => {
      mockDeleteParticipant.mockRejectedValueOnce(new Error('connection refused: internal-db-host:5432'));
      const res = await request(app)
        .delete('/api/admin/participant?participant_id=p1')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal error' });
      expect(JSON.stringify(res.body)).not.toContain('internal-db-host');
    });
  });

  describe('POST /api/admin/purge-expired', () => {
    test('purges a course whose threshold has passed', async () => {
      mockGetAllCourseConfigs.mockReturnValueOnce({
        OBLD500: { course_end_date: '2020-01-01', retention_days_after_end: 1 }, // long past
      });
      mockFindParticipantIdsWithEmailByCourse.mockResolvedValueOnce(['p1', 'p2']);
      mockPurgeParticipantEmails.mockResolvedValueOnce(2);
      const res = await request(app).post('/api/admin/purge-expired').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([{ course: 'OBLD500', purged: 2, threshold: expect.any(String), status: 'purged' }]);
    });

    test('does not purge a course whose threshold has not passed yet', async () => {
      mockGetAllCourseConfigs.mockReturnValueOnce({
        OBLD500: { course_end_date: '2099-01-01', retention_days_after_end: 90 }, // far future
      });
      const res = await request(app).post('/api/admin/purge-expired').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([{ course: 'OBLD500', purged: 0, threshold: expect.any(String), status: 'not yet due' }]);
      expect(mockFindParticipantIdsWithEmailByCourse).not.toHaveBeenCalled();
    });

    test('isolates a per-course purge failure without aborting other courses', async () => {
      mockGetAllCourseConfigs.mockReturnValueOnce({
        OBLD500: { course_end_date: '2020-01-01', retention_days_after_end: 1 }, // past due, will fail
        OBLD501: { course_end_date: '2020-01-01', retention_days_after_end: 1 }, // past due, will succeed
      });
      mockFindParticipantIdsWithEmailByCourse.mockImplementation((course) => {
        if (course === 'OBLD500') {
          return Promise.reject(new Error('connection refused: internal-db-host:5432'));
        }
        return Promise.resolve(['p1']);
      });
      mockPurgeParticipantEmails.mockResolvedValue(1);
      const res = await request(app).post('/api/admin/purge-expired').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([
        { course: 'OBLD500', purged: 0, threshold: expect.any(String), status: 'error', error: 'Internal error' },
        { course: 'OBLD501', purged: 1, threshold: expect.any(String), status: 'purged' },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('internal-db-host');
    });

    test('surfaces a course with participant data but no courses.json entry', async () => {
      mockGetAllCourseConfigs.mockReturnValueOnce({
        OBLD500: { course_end_date: '2099-01-01', retention_days_after_end: 90 }, // far future, not yet due
      });
      mockFindDistinctCoursesWithParticipantData.mockResolvedValueOnce(['OBLD500', 'PSYC301']);
      const res = await request(app).post('/api/admin/purge-expired').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([
        { course: 'OBLD500', purged: 0, threshold: expect.any(String), status: 'not yet due' },
        { course: 'PSYC301', purged: 0, threshold: null, status: 'unconfigured' },
      ]);
      expect(mockFindParticipantIdsWithEmailByCourse).not.toHaveBeenCalledWith('PSYC301');
      expect(mockPurgeParticipantEmails).not.toHaveBeenCalled();
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
