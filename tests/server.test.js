const request = require('supertest');
const path = require('path');

// Mock modules before requiring the app
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  readdir: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({
    on: jest.fn().mockImplementation(function(event, callback) {
      if (event === 'finish') {
        callback();
      }
      return this;
    })
  })
}));

jest.mock('ytdl-core', () => ({
  validateURL: jest.fn(),
  getInfo: jest.fn().mockResolvedValue({
    videoDetails: { title: 'Test Video' }
  }),
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    pipe: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function(event, callback) {
      if (event === 'finish') {
        callback();
      }
      return this;
    })
  }))
}));

jest.mock('spotifydl-core', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    downloadTrack: jest.fn().mockResolvedValue(true),
    downloadAlbum: jest.fn().mockResolvedValue(true),
    downloadPlaylist: jest.fn().mockResolvedValue(true)
  }))
}));

// Now require the app after mocking dependencies
const app = require('../server');
const fs = require('fs');
const ytdl = require('ytdl-core');

describe('Server Endpoints', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  // Test for YouTube download
  test('POST /download should handle YouTube URLs', async () => {
    // Set up mocks for this test
    ytdl.validateURL.mockReturnValue(true);
    
    // We need to mock the ytdl function itself which is called directly
    const mockPipe = jest.fn().mockReturnThis();
    const mockOn = jest.fn().mockImplementation((event, callback) => {
      if (event === 'finish') {
        // Simulate the finish event to trigger the download response
        setTimeout(callback, 10);
      }
      return { pipe: mockPipe, on: mockOn };
    });
    
    // Override the default export
    ytdl.mockImplementation(() => ({
      pipe: mockPipe,
      on: mockOn
    }));
    
    // Make the request
    const response = await request(app)
      .post('/download')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    
    // Verify the mock was called
    expect(ytdl.validateURL).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
  
  // Test for Spotify download
  test('POST /download should handle Spotify URLs', async () => {
    // Skip ytdl validation for Spotify URLs
    ytdl.validateURL.mockReturnValue(false);
    
    const response = await request(app)
      .post('/download')
      .send({ url: 'https://open.spotify.com/track/123456' });
    
    expect(response.status).toBe(202);
    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('downloadId');
    expect(response.body.message).toContain('Spotify download started');
  });
  
  // Test for Deezer download (not yet implemented)
  test('POST /download should return 501 for Deezer URLs', async () => {
    // Skip ytdl validation for Deezer URLs
    ytdl.validateURL.mockReturnValue(false);
    
    const response = await request(app)
      .post('/download')
      .send({ url: 'https://www.deezer.com/track/123456' });
    
    expect(response.status).toBe(501);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('Deezer downloads are coming soon');
  });
  
  // Test for download status endpoint
  describe('Download Status Endpoints', () => {
    test('GET /download/status/:downloadId should return 404 if download not found', async () => {
      // Mock fs.existsSync to return false
      fs.existsSync.mockReturnValue(false);
      
      const response = await request(app).get('/download/status/nonexistent');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('status', 'not_found');
    });
    
    test('GET /download/status/:downloadId should return in_progress if no files', async () => {
      // Mock fs.existsSync to return true
      fs.existsSync.mockReturnValue(true);
      
      // Mock fs.readdir to return empty array
      fs.readdir.mockImplementation((path, callback) => {
        callback(null, []);
      });
      
      const response = await request(app).get('/download/status/123456');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'in_progress');
    });
    
    test('GET /download/status/:downloadId should return complete if files exist', async () => {
      // Mock fs.existsSync to return true
      fs.existsSync.mockReturnValue(true);
      
      // Mock fs.readdir to return array of files
      fs.readdir.mockImplementation((path, callback) => {
        callback(null, ['file1.mp3', 'file2.mp3']);
      });
      
      const response = await request(app).get('/download/status/123456');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'complete');
      expect(response.body).toHaveProperty('files');
      expect(response.body.files).toHaveLength(2);
      expect(response.body.files[0]).toHaveProperty('name', 'file1.mp3');
      expect(response.body.files[0]).toHaveProperty('url');
    });
  });
  
  // Test for file download endpoint
  describe('File Download Endpoint', () => {
    test('GET /download/file/:downloadId/:filename should return 404 if file not found', async () => {
      // Mock fs.existsSync to return false
      fs.existsSync.mockReturnValue(false);
      
      const response = await request(app).get('/download/file/123456/nonexistent.mp3');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'File not found');
    });
  });
});
