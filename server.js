const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ytdl = require('ytdl-core');
const fs = require('fs');
const { exec } = require('child_process');
const Spotify = require('spotifydl-core').default;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint to check download status
app.get('/download/status/:downloadId', (req, res) => {
  const { downloadId } = req.params;
  const downloadPath = path.join(__dirname, 'downloads', downloadId);
  
  // Check if the download directory exists
  if (!fs.existsSync(downloadPath)) {
    return res.status(404).json({ status: 'not_found', message: 'Download not found' });
  }
  
  // List files in the download directory
  fs.readdir(downloadPath, (err, files) => {
    if (err) {
      return res.status(500).json({ status: 'error', message: 'Failed to check download status' });
    }
    
    if (files.length === 0) {
      // No files yet, download is still in progress
      return res.json({ status: 'in_progress', message: 'Download in progress' });
    } else {
      // Files exist, download is complete
      return res.json({ 
        status: 'complete', 
        message: 'Download complete', 
        files: files.map(file => ({
          name: file,
          url: `/download/file/${downloadId}/${encodeURIComponent(file)}`
        }))
      });
    }
  });
});

// Endpoint to download a specific file
app.get('/download/file/:downloadId/:filename', (req, res) => {
  const { downloadId, filename } = req.params;
  const filePath = path.join(__dirname, 'downloads', downloadId, decodeURIComponent(filename));
  
  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Send the file
  res.download(filePath, decodeURIComponent(filename), (err) => {
    if (err) {
      console.error('Error sending file:', err);
      return res.status(500).json({ error: 'Failed to download file' });
    }
  });
});

// Helper function to ensure downloads directory exists
const ensureDownloadsDir = () => {
  if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
    fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
  }
};

// Helper function to check if a URL is from Spotify
const isSpotifyUrl = (url) => {
  return url.includes('spotify.com') || url.includes('open.spotify');
};

// Helper function to check if a URL is from Deezer
const isDeezerUrl = (url) => {
  return url.includes('deezer.com');
};

// API endpoint to handle download requests
app.post('/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Ensure downloads directory exists
    ensureDownloadsDir();

    // Check if URL is from YouTube
    if (ytdl.validateURL(url)) {
      // Get video info
      const info = await ytdl.getInfo(url);
      const videoTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '');
      const videoPath = path.join(__dirname, 'downloads', `${videoTitle}.mp4`);
      
      // Download the video
      ytdl(url, { quality: 'highest' })
        .pipe(fs.createWriteStream(videoPath))
        .on('finish', () => {
          // Send the file to the client
          res.download(videoPath, `${videoTitle}.mp4`, (err) => {
            if (err) {
              console.error('Error sending file:', err);
            }
            // Optionally delete the file after sending
            // fs.unlinkSync(videoPath);
          });
        });
    } 
    // Check if URL is from Spotify
    else if (isSpotifyUrl(url)) {
      try {
        // Create a unique download ID and path
        const downloadId = Date.now().toString();
        const outputPath = path.join(__dirname, 'downloads', downloadId);
        
        // Ensure the output directory exists
        if (!fs.existsSync(outputPath)) {
          fs.mkdirSync(outputPath, { recursive: true });
        }
        
        // Initialize the Spotify downloader
        const spotify = new Spotify({
          clientId: 'your-spotify-client-id', // Replace with your Spotify client ID
          clientSecret: 'your-spotify-client-secret', // Replace with your Spotify client secret
          directory: {
            tracks: outputPath,
            albums: outputPath,
            playlists: outputPath
          }
        });
        
        // Send a response to inform the client that the download has started
        res.status(202).json({ 
          message: 'Spotify download started. This may take a while depending on the content.', 
          downloadId: downloadId 
        });
        
        // Download the Spotify track/album/playlist
        (async () => {
          try {
            // Determine if it's a track, album, or playlist and download accordingly
            if (url.includes('/track/')) {
              await spotify.downloadTrack(url);
            } else if (url.includes('/album/')) {
              await spotify.downloadAlbum(url);
            } else if (url.includes('/playlist/')) {
              await spotify.downloadPlaylist(url);
            } else {
              console.error('Unsupported Spotify URL type');
              return;
            }
            
            console.log(`Download completed to ${outputPath}`);
            
            // We don't send the file here since we've already sent a 202 response
            // The client will need to poll for the download status or use WebSockets
            // for real-time updates, which we'll implement in a future version
          } catch (error) {
            console.error('Error downloading from Spotify:', error);
          }
        })();
      } catch (error) {
        console.error('Error setting up Spotify download:', error);
        return res.status(500).json({ error: 'Failed to set up Spotify download' });
      }
    }
    // Check if URL is from Deezer
    else if (isDeezerUrl(url)) {
      // For now, we'll return a message that this feature is coming soon
      return res.status(501).json({ 
        error: 'Deezer downloads are coming soon! Currently only YouTube and Spotify URLs are supported.' 
      });
    } else {
      // For other URLs, return error
      return res.status(400).json({ 
        error: 'URL not supported. Currently only YouTube URLs are supported.' 
      });
    }
  } catch (error) {
    console.error('Error processing download:', error);
    res.status(500).json({ error: 'Failed to process download' });
  }
});

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app; // Export for testing
