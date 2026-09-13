const { generateCompletionCode, verifyCompletionCode } = require('../checkin/completionCode');

const SECRET = process.env.CHECKIN_HMAC_SECRET;

const baseArgs = {
  abbrev: 'AL',
  module: 4,
  phase: 'baseline',
  course: 'OBLD500',
  participantId: 'abc123',
  submittedAt: '2027-01-15T12:00:00.000Z',
  secret: SECRET,
};

describe('generateCompletionCode', () => {
  test('matches the spec format {ABBREV}{N}-{PHASE}-{8 chars}', () => {
    const code = generateCompletionCode(baseArgs);
    expect(code).toMatch(/^AL4-B-[A-Z2-7]{8}$/);
  });

  test('uses D for the debrief phase', () => {
    const code = generateCompletionCode({ ...baseArgs, phase: 'debrief' });
    expect(code).toMatch(/^AL4-D-[A-Z2-7]{8}$/);
  });

  test('contains no vowels in the 8-character suffix', () => {
    const code = generateCompletionCode(baseArgs);
    const suffix = code.split('-')[2];
    expect(suffix).not.toMatch(/[AEIOU]/);
  });

  test('is deterministic for the same inputs', () => {
    const a = generateCompletionCode(baseArgs);
    const b = generateCompletionCode(baseArgs);
    expect(a).toBe(b);
  });

  test('differs when participantId differs', () => {
    const a = generateCompletionCode(baseArgs);
    const b = generateCompletionCode({ ...baseArgs, participantId: 'xyz789' });
    expect(a).not.toBe(b);
  });

  test('differs when submittedAt differs', () => {
    const a = generateCompletionCode(baseArgs);
    const b = generateCompletionCode({ ...baseArgs, submittedAt: '2027-01-15T12:00:01.000Z' });
    expect(a).not.toBe(b);
  });
});

describe('verifyCompletionCode', () => {
  test('verifies a code generated with the same inputs', () => {
    const code = generateCompletionCode(baseArgs);
    expect(verifyCompletionCode(code, baseArgs)).toBe(true);
  });

  test('rejects a code with one character changed', () => {
    const code = generateCompletionCode(baseArgs);
    const tampered = code.slice(0, -1) + (code.slice(-1) === 'Z' ? 'Y' : 'Z');
    expect(verifyCompletionCode(tampered, baseArgs)).toBe(false);
  });

  test('rejects a code verified against different arguments', () => {
    const code = generateCompletionCode(baseArgs);
    expect(verifyCompletionCode(code, { ...baseArgs, module: 5 })).toBe(false);
  });

  test('rejects a code of the wrong length without throwing', () => {
    expect(verifyCompletionCode('short', baseArgs)).toBe(false);
  });
});
