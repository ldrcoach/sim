const { toCsv } = require('../checkin/csv');

describe('toCsv', () => {
  test('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  test('writes a header row from the first row\'s keys', () => {
    const csv = toCsv([{ a: 1, b: 2 }]);
    expect(csv.split('\n')[0]).toBe('a,b');
  });

  test('writes one line per row in the same column order as the header', () => {
    const csv = toCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    const lines = csv.split('\n');
    expect(lines).toEqual(['a,b', '1,2', '3,4']);
  });

  test('quotes and escapes a field containing a comma', () => {
    const csv = toCsv([{ text: 'hello, world' }]);
    expect(csv.split('\n')[1]).toBe('"hello, world"');
  });

  test('quotes and escapes a field containing a double quote', () => {
    const csv = toCsv([{ text: 'she said "hi"' }]);
    expect(csv.split('\n')[1]).toBe('"she said ""hi"""');
  });

  test('quotes a field containing a newline', () => {
    const csv = toCsv([{ text: 'line one\nline two' }]);
    expect(csv.split('\n')).toHaveLength(3); // header + 1 data row that itself spans 2 lines
    expect(csv).toContain('"line one\nline two"');
  });

  test('quotes a field containing a bare carriage return', () => {
    const csv = toCsv([{ text: 'line one\rline two' }]);
    expect(csv).toContain('"line one\rline two"');
  });

  test('renders null and undefined as empty fields', () => {
    const csv = toCsv([{ a: null, b: undefined }]);
    expect(csv.split('\n')[1]).toBe(',');
  });

  test('serializes a Date value as an ISO string', () => {
    const csv = toCsv([{ when: new Date('2027-01-15T00:00:00.000Z') }]);
    expect(csv.split('\n')[1]).toBe('2027-01-15T00:00:00.000Z');
  });
});
