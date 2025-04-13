const request = require('supertest');
const app = require('../server');

describe('Server Endpoints', () => {
  test('GET / should serve the index.html page', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<!DOCTYPE html>');
    expect(response.text).toContain('<title>DeeMixer - Download Music & Videos</title>');
  });

  test('POST /download should return 400 if URL is missing', async () => {
    const response = await request(app)
      .post('/download')
      .send({});
    
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toBe('URL is required');
  });

  test('POST /download should return 400 for unsupported URLs', async () => {
    const response = await request(app)
      .post('/download')
      .send({ url: 'https://example.com/not-a-youtube-url' });
    
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('URL not supported');
  });

  // Note: We're not testing actual YouTube downloads here as that would require
  // network access and would download actual files, which is not ideal for unit tests.
  // In a real-world scenario, you'd mock ytdl-core for these tests.
});
