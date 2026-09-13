// Test environment setup
// Sets mock environment variables and stubs global.fetch

// Provide a fake API key so the server doesn't reject requests
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
process.env.NODE_ENV = 'test';

// Check-in module test secrets (not real secrets -- fixed so tests are deterministic)
process.env.CHECKIN_HMAC_SECRET = 'test-hmac-secret-not-real';
process.env.CHECKIN_AES_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='; // base64 of 32 bytes

// Default mock for global.fetch -- returns a successful Anthropic-style response.
// Individual tests can override this with their own implementation.
const mockAnthropicResponse = {
  id: 'msg_test_123',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Mock response from Claude' }],
  model: 'claude-sonnet-4-20250514',
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
};

global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(mockAnthropicResponse),
    text: () => Promise.resolve(JSON.stringify(mockAnthropicResponse)),
  })
);
