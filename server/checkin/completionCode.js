const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function stripVowels(str) {
  return str.replace(/[AEIOU]/g, '');
}

function generateCompletionCode({ abbrev, module, phase, course, participantId, submittedAt, secret }) {
  const phaseLetter = phase === 'baseline' ? 'B' : 'D';
  const message = `${course}|${module}|${phase}|${participantId}|${submittedAt}`;
  const digest = crypto.createHmac('sha256', secret).update(message).digest();
  const encoded = stripVowels(base32Encode(digest));
  const suffix = encoded.slice(0, 8);
  return `${abbrev}${module}-${phaseLetter}-${suffix}`;
}

function verifyCompletionCode(code, args) {
  if (typeof code !== 'string') return false;
  const expected = generateCompletionCode(args);
  const expectedBuf = Buffer.from(expected);
  const codeBuf = Buffer.from(code);
  // Both the byte-length pre-check AND timingSafeEqual (not a bare ===) are required:
  // timingSafeEqual throws if the buffers differ in byte length, and a plain ===
  // (or a naive char-by-char loop) would leak timing information about how many
  // leading bytes match, reopening the constant-time comparison this guards against.
  if (expectedBuf.length !== codeBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, codeBuf);
}

module.exports = { generateCompletionCode, verifyCompletionCode, base32Encode };
