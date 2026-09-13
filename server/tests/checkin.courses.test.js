const fs = require('fs');
const os = require('os');
const path = require('path');

describe('courses.js', () => {
  let courses;
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    courses = require('../checkin/courses');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-courses-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads the real courses.json and serves the OBLD500 entry', () => {
    courses.load(path.join(__dirname, '..', 'checkin', 'courses.json'));
    const cfg = courses.getCourseConfig('OBLD500');
    expect(cfg).not.toBeNull();
    expect(cfg.identity_mode).toBe('email');
    expect(cfg.course_end_date).toBe('2027-03-14');
    expect(cfg.retention_days_after_end).toBe(90);
  });

  test('getCourseConfig returns null for an unknown course', () => {
    courses.load(path.join(__dirname, '..', 'checkin', 'courses.json'));
    expect(courses.getCourseConfig('NOTACOURSE')).toBeNull();
  });

  test('getAllCourseConfigs returns the full config object', () => {
    courses.load(path.join(__dirname, '..', 'checkin', 'courses.json'));
    const all = courses.getAllCourseConfigs();
    expect(Object.keys(all)).toContain('OBLD500');
  });

  test('throws with all validation errors when a course entry is missing required fields', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bad.json'),
      JSON.stringify({ BADCOURSE: { course_code: 'X' } })
    );
    expect(() => courses.load(path.join(tmpDir, 'bad.json'))).toThrow(/identity_mode/);
  });

  test('throws when course_end_date is not a parseable date', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bad-date.json'),
      JSON.stringify({
        X: {
          course_code: 'X-2027',
          identity_mode: 'email',
          email_domain_hint: 'example.edu',
          course_end_date: 'not-a-date',
          retention_days_after_end: 90,
          allow_embed: true,
        },
      })
    );
    expect(() => courses.load(path.join(tmpDir, 'bad-date.json'))).toThrow(/course_end_date/);
  });

  test('throws when retention_days_after_end is not a non-negative integer', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bad-retention.json'),
      JSON.stringify({
        X: {
          course_code: 'X-2027',
          identity_mode: 'email',
          email_domain_hint: 'example.edu',
          course_end_date: '2027-01-01',
          retention_days_after_end: -5,
          allow_embed: true,
        },
      })
    );
    expect(() => courses.load(path.join(tmpDir, 'bad-retention.json'))).toThrow(/retention_days_after_end/);
  });

  test('throws with the file path and underlying error when courses.json is malformed', () => {
    const badPath = path.join(tmpDir, 'malformed.json');
    fs.writeFileSync(badPath, '{ this is not valid json');
    expect(() => courses.load(badPath)).toThrow(/malformed\.json/);
  });

  describe('validateCourseConfig', () => {
    test('returns an empty array for a fully valid config', () => {
      const errors = courses.validateCourseConfig('OBLD500', {
        course_code: 'OBLD-500-2027',
        identity_mode: 'email',
        email_domain_hint: 'example.edu',
        course_end_date: '2027-03-14',
        retention_days_after_end: 90,
        allow_embed: true,
      });
      expect(errors).toEqual([]);
    });

    test('rejects an identity_mode value outside the allowed enum', () => {
      const errors = courses.validateCourseConfig('OBLD500', {
        course_code: 'OBLD-500-2027',
        identity_mode: 'sso',
        email_domain_hint: 'example.edu',
        course_end_date: '2027-03-14',
        retention_days_after_end: 90,
        allow_embed: true,
      });
      expect(errors.some((e) => e.includes('identity_mode'))).toBe(true);
    });

    test('accepts the "key" and "none" identity_mode values', () => {
      const base = {
        course_code: 'OBLD-500-2027',
        email_domain_hint: 'example.edu',
        course_end_date: '2027-03-14',
        retention_days_after_end: 90,
        allow_embed: true,
      };
      expect(courses.validateCourseConfig('X', { ...base, identity_mode: 'key' })).toEqual([]);
      expect(courses.validateCourseConfig('X', { ...base, identity_mode: 'none' })).toEqual([]);
    });
  });
});
