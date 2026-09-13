const request = require('supertest');

function createApp() {
  delete require.cache[require.resolve('../index')];
  return require('../index');
}

describe('GET /privacy', () => {
  test('returns a plain-language privacy statement', async () => {
    const app = createApp();
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toMatch(/LDRC/);
    expect(res.text).toMatch(/course measurement/i);
    expect(res.text).toMatch(/delete/i);
  });
});
