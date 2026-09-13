const { deriveParticipantId, encryptEmail, decryptEmail } = require('../checkin/identity');

const SECRET = process.env.CHECKIN_HMAC_SECRET;
const KEY = process.env.CHECKIN_AES_KEY;

describe('deriveParticipantId', () => {
  test('is deterministic for the same email and secret', () => {
    const a = deriveParticipantId('Student@erau.edu', SECRET);
    const b = deriveParticipantId('Student@erau.edu', SECRET);
    expect(a).toBe(b);
  });

  test('is case-insensitive and trims whitespace', () => {
    const a = deriveParticipantId('Student@erau.edu', SECRET);
    const b = deriveParticipantId('  student@ERAU.edu  ', SECRET);
    expect(a).toBe(b);
  });

  test('differs for different emails', () => {
    const a = deriveParticipantId('student1@erau.edu', SECRET);
    const b = deriveParticipantId('student2@erau.edu', SECRET);
    expect(a).not.toBe(b);
  });

  test('differs for different secrets', () => {
    const a = deriveParticipantId('student@erau.edu', 'secret-a');
    const b = deriveParticipantId('student@erau.edu', 'secret-b');
    expect(a).not.toBe(b);
  });

  test('returns a 64-character hex string (SHA-256)', () => {
    const id = deriveParticipantId('student@erau.edu', SECRET);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('encryptEmail / decryptEmail', () => {
  test('round-trips the original email', () => {
    const encrypted = encryptEmail('student@erau.edu', KEY);
    expect(decryptEmail(encrypted, KEY)).toBe('student@erau.edu');
  });

  test('produces a different ciphertext each time (random IV)', () => {
    const a = encryptEmail('student@erau.edu', KEY);
    const b = encryptEmail('student@erau.edu', KEY);
    expect(a).not.toBe(b);
  });

  test('does not store the plaintext email anywhere in the ciphertext string', () => {
    const encrypted = encryptEmail('student@erau.edu', KEY);
    expect(encrypted).not.toContain('student');
    expect(encrypted).not.toContain('erau');
  });

  test('throws when the key does not decode to 32 bytes', () => {
    expect(() => encryptEmail('student@erau.edu', 'dG9vc2hvcnQ=')).toThrow(/32 bytes/);
  });

  test('decryptEmail throws when the key does not decode to 32 bytes', () => {
    const encrypted = encryptEmail('student@erau.edu', KEY);
    expect(() => decryptEmail(encrypted, 'dG9vc2hvcnQ=')).toThrow(/32 bytes/);
  });

  test('fails to decrypt with the wrong key', () => {
    const encrypted = encryptEmail('student@erau.edu', KEY);
    const wrongKey = Buffer.alloc(32, 7).toString('base64');
    expect(() => decryptEmail(encrypted, wrongKey)).toThrow();
  });
});
