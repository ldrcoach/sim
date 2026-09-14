const request = require('supertest');

let mockAvailable = true;
const mockUpsertParticipant = jest.fn().mockResolvedValue(undefined);
const mockFindLatestResponseId = jest.fn().mockResolvedValue(null);
const mockInsertResponse = jest.fn().mockResolvedValue({ id: 1, submitted_at: '2027-01-15T00:00:00Z' });
const mockFindLatestSubscaleScores = jest.fn().mockResolvedValue(null);

jest.mock('../checkin/db', () => ({
  isAvailable: () => mockAvailable,
  upsertParticipant: (...args) => mockUpsertParticipant(...args),
  findLatestResponseId: (...args) => mockFindLatestResponseId(...args),
  insertResponse: (...args) => mockInsertResponse(...args),
  recordInstrumentVersion: jest.fn().mockResolvedValue(true),
  initCheckinSchema: jest.fn().mockResolvedValue(true),
  findLatestSubscaleScores: (...args) => mockFindLatestSubscaleScores(...args),
}));

let mockCourseConfig = { identity_mode: 'email' };
jest.mock('../checkin/courses', () => ({
  getCourseConfig: (...args) => mockGetCourseConfig(...args),
  load: jest.fn(),
  ensureLoaded: jest.fn(),
  getAllCourseConfigs: jest.fn().mockReturnValue({}),
}));
const mockGetCourseConfig = jest.fn((course) => (course === 'OBLD500' ? mockCourseConfig : null));

// Mock the sim_sessions db module too, since index.js requires it unconditionally.
jest.mock('../db', () => ({
  getPool: () => null,
  isAvailable: () => false,
  initSchema: jest.fn().mockResolvedValue(true),
  setPool: jest.fn(),
}));

function createApp() {
  delete require.cache[require.resolve('../index')];
  Object.keys(require.cache).forEach((key) => {
    if (key.includes('express-rate-limit')) delete require.cache[key];
  });
  return require('../index');
}

const validBaselineBody = () => ({
  course: 'OBLD500',
  module: 4,
  phase: 'baseline',
  identity: { email: 'student@erau.edu' },
  started_at: '2027-01-15T00:00:00.000Z',
  answers: {
    AL01: 5, AL02: 5, AL03: 5, AL04: 5, AL05: 5,
    AL06: 5, AL07: 5, AL08: 5, AL09: 5, AL10: 5,
    AL11: 5, AL12: 5, AL13: 5, AL14: 5, AL15: 5,
    AL16: 5, AL17: 5, AL18: 5, AL19: 5, AL20: 5,
  },
});

describe('GET /api/instrument/:course/:module/:phase', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  test('returns the public baseline view without reverse flags', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/4/baseline');
    expect(res.status).toBe(200);
    expect(res.body.abbrev).toBe('AL');
    expect(res.body.subscales[0].items[0]).toEqual({ id: 'AL01', text: expect.any(String) });
    expect(res.body.debrief_extras).toBeUndefined();
  });

  test('returns debrief_extras for the debrief phase', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/4/debrief');
    expect(res.status).toBe(200);
    expect(res.body.debrief_extras.open_ended).toHaveLength(3);
  });

  test('returns 400 for an invalid phase', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/4/nonsense');
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown module', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/99/baseline');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/responses', () => {
  let app;

  beforeEach(() => {
    mockAvailable = true;
    app = createApp();
    mockUpsertParticipant.mockClear();
    mockFindLatestResponseId.mockClear().mockResolvedValue(null);
    mockInsertResponse.mockClear().mockResolvedValue({ id: 1, submitted_at: '2027-01-15T00:00:00Z' });
    mockFindLatestSubscaleScores.mockClear().mockResolvedValue(null);
    mockCourseConfig = { identity_mode: 'email' };
    mockGetCourseConfig.mockClear();
  });

  test('accepts a valid baseline submission and returns a completion code', async () => {
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(200);
    expect(res.body.completion_code).toMatch(/^AL4-B-[A-Z2-7]{8}$/);
    expect(res.body.subscale_means).toHaveLength(4);
    expect(mockInsertResponse).toHaveBeenCalledTimes(1);
  });

  test('derives the same participant_id for the same email across calls', async () => {
    await request(app).post('/api/responses').send(validBaselineBody());
    await request(app).post('/api/responses').send(validBaselineBody());
    const firstId = mockUpsertParticipant.mock.calls[0][0];
    const secondId = mockUpsertParticipant.mock.calls[1][0];
    expect(firstId).toBe(secondId);
  });

  test('returns 400 for an invalid email', async () => {
    const body = { ...validBaselineBody(), identity: { email: 'not-an-email' } };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
    expect(mockInsertResponse).not.toHaveBeenCalled();
  });

  test('returns 400 when an item answer is out of range', async () => {
    const body = validBaselineBody();
    body.answers.AL01 = 9;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 400 when an item is missing', async () => {
    const body = validBaselineBody();
    delete body.answers.AL01;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 400 for an unknown item id', async () => {
    const body = validBaselineBody();
    body.answers.NOT_REAL = 5;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown course/module', async () => {
    const body = { ...validBaselineBody(), module: 99 };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(404);
  });

  test('accepts a course with no courses.json entry, defaulting to email mode', async () => {
    mockGetCourseConfig.mockReturnValueOnce(null); // unknown course, no config entry
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(200);
  });

  test('returns 501 when the configured identity_mode is not "email"', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(501);
    expect(mockInsertResponse).not.toHaveBeenCalled();
  });

  test('requires extras for a debrief submission', async () => {
    const body = { ...validBaselineBody(), phase: 'debrief' };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('accepts a complete debrief submission', async () => {
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: {
          AL_Q1: 'A'.repeat(40),
          AL_Q2: 'B'.repeat(40),
          AL_Q3: 'C'.repeat(40),
        },
      },
    };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
  });

  test('rejects an open-ended answer shorter than 40 characters', async () => {
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: { AL_Q1: 'too short', AL_Q2: 'B'.repeat(40), AL_Q3: 'C'.repeat(40) },
      },
    };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('sets supersedes when a prior response exists', async () => {
    mockFindLatestResponseId.mockResolvedValueOnce(17);
    await request(app).post('/api/responses').send(validBaselineBody());
    expect(mockInsertResponse.mock.calls[0][0].supersedes).toBe(17);
  });

  test('includes baseline_comparison in a debrief response when a baseline exists', async () => {
    mockFindLatestSubscaleScores.mockResolvedValueOnce([
      { subscale_id: 'sensing', mean: 5, n_items: 5 },
      { subscale_id: 'attending', mean: 4, n_items: 5 },
      { subscale_id: 'processing', mean: 5, n_items: 5 },
      { subscale_id: 'responding', mean: 5, n_items: 5 },
    ]);
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: { AL_Q1: 'A'.repeat(40), AL_Q2: 'B'.repeat(40), AL_Q3: 'C'.repeat(40) },
      },
    };
    // AL05 is the sensing subscale's reverse-scored item (see instruments/AL.json),
    // so raw 3 -> scored 5, keeping the whole sensing subscale at a scored mean of 5
    // to match the mocked baseline mean and produce an exact zero delta below.
    body.answers = { ...body.answers, AL05: 3 };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
    expect(res.body.baseline_comparison).toBeDefined();
    expect(res.body.baseline_comparison).toHaveLength(4);
    const sensing = res.body.baseline_comparison.find((c) => c.subscale_id === 'sensing');
    expect(sensing.baseline_mean).toBe(5);
    expect(sensing.debrief_mean).toBe(5);
    expect(sensing.delta).toBe(0);
  });

  test('omits baseline_comparison when no baseline exists yet', async () => {
    mockFindLatestSubscaleScores.mockResolvedValueOnce(null);
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: { AL_Q1: 'A'.repeat(40), AL_Q2: 'B'.repeat(40), AL_Q3: 'C'.repeat(40) },
      },
    };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
    expect(res.body.baseline_comparison).toBeUndefined();
  });

  test('does not look up a baseline comparison for a baseline submission itself', async () => {
    await request(app).post('/api/responses').send(validBaselineBody());
    expect(mockFindLatestSubscaleScores).not.toHaveBeenCalled();
  });

  test('returns 503 when the database is not configured', async () => {
    mockAvailable = false;
    app = createApp();
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(503);
  });
});

describe('Task 9 regression: check-in router does not affect other /api routes', () => {
  let app;
  beforeEach(() => {
    app = createApp();
  });

  test('a /api/chat body larger than 64KB (but under 1MB) is not rejected by the check-in router\'s 64KB limit', async () => {
    const bigContent = 'x'.repeat(80 * 1024); // 80KB: over check-in's 64KB cap, under the app's 1MB cap
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: bigContent }] });
    expect(res.status).toBe(200);
  });

  test('the check-in rate limiter (30/min) does not apply to non-check-in routes like /api/log', async () => {
    for (let i = 0; i < 35; i++) {
      const res = await request(app).post('/api/log').send({ event: 'test', suite: 's', scenario: 'x' });
      expect(res.status).toBe(200);
    }
  });
});
