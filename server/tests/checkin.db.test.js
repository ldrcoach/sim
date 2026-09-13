const mockQuery = jest.fn();
const mockPool = { query: mockQuery };
let mockAvailable = true;

jest.mock('../db', () => ({
  getPool: () => (mockAvailable ? mockPool : null),
  isAvailable: () => mockAvailable,
}));

const checkinDb = require('../checkin/db');

beforeEach(() => {
  mockAvailable = true;
  mockQuery.mockReset();
});

describe('initCheckinSchema', () => {
  test('creates all five checkin tables when the pool is available', async () => {
    mockQuery.mockResolvedValueOnce({});
    const result = await checkinDb.initCheckinSchema();
    expect(result).toBe(true);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_instruments');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_participants');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_responses');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_response_items');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_subscale_scores');
  });

  test('returns false and does not throw when no pool is available', async () => {
    mockAvailable = false;
    const result = await checkinDb.initCheckinSchema();
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns false when the query rejects', async () => {
    mockQuery.mockRejectedValueOnce(new Error('syntax error'));
    const result = await checkinDb.initCheckinSchema();
    expect(result).toBe(false);
  });
});

describe('upsertParticipant', () => {
  test('inserts with ON CONFLICT DO NOTHING', async () => {
    mockQuery.mockResolvedValueOnce({});
    await checkinDb.upsertParticipant('pid123', 'enc-blob', 'email');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO checkin_participants'),
      ['pid123', 'enc-blob', 'email']
    );
    expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (participant_id) DO NOTHING');
  });
});

describe('findLatestResponseId', () => {
  test('returns the id of the most recent matching response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const id = await checkinDb.findLatestResponseId('pid123', 'OBLD500', 4, 'baseline');
    expect(id).toBe(42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM checkin_responses'),
      ['pid123', 'OBLD500', 4, 'baseline']
    );
  });

  test('returns null when there is no prior response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const id = await checkinDb.findLatestResponseId('pid123', 'OBLD500', 4, 'baseline');
    expect(id).toBeNull();
  });
});

describe('insertResponse', () => {
  test('inserts the response row, then item rows, then subscale rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, submitted_at: '2027-01-15T00:00:00Z' }] }) // response insert
      .mockResolvedValue({}); // all subsequent inserts

    const result = await checkinDb.insertResponse({
      course: 'OBLD500',
      module: 4,
      phase: 'baseline',
      participantId: 'pid123',
      instrumentVersion: 'dev-fixture-v1',
      startedAt: '2027-01-15T00:00:00Z',
      straightlineFlag: false,
      supersedes: null,
      completionCode: 'AL4-B-K7Q2M9PX',
      itemsJson: { AL01: 5 },
      extrasJson: null,
      scoredItems: [{ item_id: 'AL01', raw_value: 5, scored_value: 5 }],
      subscaleScores: [{ subscale_id: 'sensing', mean: 5, n_items: 5 }],
    });

    expect(result).toEqual({ id: 7, submitted_at: '2027-01-15T00:00:00Z' });
    expect(mockQuery).toHaveBeenCalledTimes(3); // response + 1 item + 1 subscale score
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO checkin_responses');
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO checkin_response_items');
    expect(mockQuery.mock.calls[1][1]).toEqual([7, 'AL01', 5, 5]);
    expect(mockQuery.mock.calls[2][0]).toContain('INSERT INTO checkin_subscale_scores');
    expect(mockQuery.mock.calls[2][1]).toEqual([7, 'sensing', 5, 5]);
  });
});

describe('recordInstrumentVersion', () => {
  test('upserts with ON CONFLICT DO UPDATE', async () => {
    mockQuery.mockResolvedValueOnce({});
    await checkinDb.recordInstrumentVersion('OBLD500', 4, 'baseline', 'dev-fixture-v1', { some: 'json' });
    expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (course, module, phase) DO UPDATE');
    expect(mockQuery.mock.calls[0][1][0]).toBe('OBLD500');
    expect(mockQuery.mock.calls[0][1][3]).toBe('dev-fixture-v1');
  });
});

describe('findParticipantIdsWithEmailByCourse', () => {
  test('returns distinct participant ids that still have an encrypted email on file', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ participant_id: 'p1' }, { participant_id: 'p2' }] });
    const ids = await checkinDb.findParticipantIdsWithEmailByCourse('OBLD500');
    expect(ids).toEqual(['p1', 'p2']);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('email_encrypted IS NOT NULL'), ['OBLD500']);
  });

  test('returns an empty array when nobody matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const ids = await checkinDb.findParticipantIdsWithEmailByCourse('OBLD500');
    expect(ids).toEqual([]);
  });
});

describe('purgeParticipantEmails', () => {
  test('nulls email_encrypted for the given participant ids', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 2 });
    const count = await checkinDb.purgeParticipantEmails(['p1', 'p2']);
    expect(count).toBe(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET email_encrypted = NULL'),
      [['p1', 'p2']]
    );
  });

  test('returns 0 and does not query when the id list is empty', async () => {
    const count = await checkinDb.purgeParticipantEmails([]);
    expect(count).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
