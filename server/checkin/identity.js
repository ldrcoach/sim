const crypto = require('crypto');

function deriveParticipantId(email, secret) {
  const normalized = email.trim().toLowerCase();
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

function encryptEmail(email, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('CHECKIN_AES_KEY must decode to exactly 32 bytes (AES-256)');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptEmail(encrypted, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('CHECKIN_AES_KEY must decode to exactly 32 bytes (AES-256)');
  }
  const [ivB64, tagB64, ciphertextB64] = encrypted.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  if (iv.length !== 12) {
    throw new Error('Invalid ciphertext: IV must be 12 bytes');
  }
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { deriveParticipantId, encryptEmail, decryptEmail };
