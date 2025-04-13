const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Spotify = require('spotifydl-core').default;
const youtubeDl = require('youtube-dl-exec');

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
      // Log the files found for debugging
      console.log(`Found ${files.length} files in download directory ${downloadPath}:`, files);
      
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
  
  // Set headers to force download
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(decodeURIComponent(filename))}"`); 
  res.setHeader('Content-Type', 'application/octet-stream');
  
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

// Helper function to check if a URL is from YouTube
const isYouTubeUrl = (url) => {
  return url.includes('youtube.com') || url.includes('youtu.be');
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
    if (isYouTubeUrl(url)) {
      try {
        // Create a unique download ID and path
        const downloadId = Date.now().toString();
        const outputDir = path.join(__dirname, 'downloads', downloadId);
        
        // Ensure the output directory exists
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Generate a safe filename
        const safeFilename = `video-${downloadId}.mp4`;
        const outputPath = path.join(outputDir, safeFilename);
        
        // Send a response to inform the client that the download has started
        res.status(202).json({ 
          message: 'YouTube download started. This may take a while depending on the video length.', 
          downloadId: downloadId,
          statusUrl: `/download/status/${downloadId}`,
          autoCheckStatus: true
        });
        
        // Download the video using youtube-dl-exec
        (async () => {
          try {
            // Use a more reliable output template that youtube-dl-exec understands
            await youtubeDl(url, {
              // Use the download directory but let youtube-dl name the file
              // This will include the video title in the filename
              output: path.join(outputDir, '%(title)s.%(ext)s'),
              format: 'best[ext=mp4]',
              noCheckCertificate: true,
              noWarnings: true,
              preferFreeFormats: true,
              addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              ]
            });
            
            // Log the directory contents after download
            fs.readdir(outputDir, (err, files) => {
              if (err) {
                console.error('Error reading download directory:', err);
              } else {
                console.log(`Files in download directory after download:`, files);
              }
            });
            
            console.log(`Download completed to ${outputPath}`);
            
            // We don't send the file here since we've already sent a 202 response
            // The client will need to poll for the download status or use WebSockets
            // for real-time updates
          } catch (error) {
            console.error('Error downloading from YouTube:', error);
          }
        })();
      } catch (error) {
        console.error('Error setting up YouTube download:', error);
        return res.status(500).json({ error: 'Failed to set up YouTube download' });
      }
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
          downloadId: downloadId,
          statusUrl: `/download/status/${downloadId}`,
          autoCheckStatus: true
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
