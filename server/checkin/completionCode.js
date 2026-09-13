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
  const expected = generateCompletionCode(args);
  if (typeof code !== 'string' || expected.length !== code.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code));
}

module.exports = { generateCompletionCode, verifyCompletionCode, base32Encode };
