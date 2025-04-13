const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ytdl = require('ytdl-core');
const fs = require('fs');
const { exec } = require('child_process');

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
    // Check if URL is from Spotify or Deezer
    else if (isSpotifyUrl(url) || isDeezerUrl(url)) {
      // For now, we'll return a message that this feature is coming soon
      return res.status(501).json({ 
        error: 'Spotify/Deezer downloads are coming soon! Currently only YouTube URLs are supported.' 
      });
      
      /* 
      // This is a placeholder for future implementation using deemix CLI
      // We would use child_process.exec to call the deemix CLI
      const downloadId = Date.now().toString();
      const outputPath = path.join(__dirname, 'downloads', downloadId);
      
      exec(`deemix -p ${outputPath} ${url}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error.message}`);
          return res.status(500).json({ error: 'Failed to download from Spotify/Deezer' });
        }
        
        // Find the downloaded file and send it
        fs.readdir(outputPath, (err, files) => {
          if (err || files.length === 0) {
            return res.status(500).json({ error: 'Failed to find downloaded file' });
          }
          
          const filePath = path.join(outputPath, files[0]);
          res.download(filePath, files[0], (err) => {
            if (err) {
              console.error('Error sending file:', err);
            }
            // Optionally clean up after download
            // fs.rmdirSync(outputPath, { recursive: true });
          });
        });
      });
      */
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
