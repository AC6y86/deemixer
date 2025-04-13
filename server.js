// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Spotify = require('spotifydl-core').default;
const youtubeDl = require('youtube-dl-exec');

// Spotify API credentials from environment variables
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'YOUR_SPOTIFY_CLIENT_ID';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'YOUR_SPOTIFY_CLIENT_SECRET';

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
      // Check if there's an error file
      if (files.includes('download_error.txt')) {
        // Read the error file
        try {
          const errorMessage = fs.readFileSync(path.join(downloadPath, 'download_error.txt'), 'utf8');
          return res.json({ 
            status: 'error', 
            message: errorMessage || 'Download failed' 
          });
        } catch (readErr) {
          return res.json({ 
            status: 'error', 
            message: 'Download failed with unknown error' 
          });
        }
      }
      
      // Files exist and no error, download is complete
      // Log the files found for debugging
      console.log(`Found ${files.length} files in download directory ${downloadPath}:`, files);
      
      // Filter out any error or system files
      const downloadableFiles = files.filter(file => 
        file !== 'download_error.txt' && !file.startsWith('.'));
      
      return res.json({ 
        status: 'complete', 
        message: 'Download complete', 
        files: downloadableFiles.map(file => ({
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
              // Download the highest quality available
              format: 'bestvideo+bestaudio/best',
              mergeOutputFormat: 'mp4',
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
            // Create an error file in the download directory to indicate failure
            const errorFilePath = path.join(outputDir, 'download_error.txt');
            fs.writeFileSync(errorFilePath, `Download failed: ${error.message || 'Unknown error'}`);
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
        
        // Check if Spotify credentials are set
        // Check if using placeholder credentials
        if (SPOTIFY_CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' || SPOTIFY_CLIENT_SECRET === 'YOUR_SPOTIFY_CLIENT_SECRET') {
          return res.status(400).json({ 
            error: 'Spotify API credentials not configured. Please add your Spotify Developer credentials to the .env file.'
          });
        }
        
        // Initialize the Spotify downloader with custom options
        const spotify = new Spotify({
          clientId: SPOTIFY_CLIENT_ID,
          clientSecret: SPOTIFY_CLIENT_SECRET,
          directory: {
            tracks: outputPath,
            albums: outputPath,
            playlists: outputPath
          },
          // Set to download FLAC format (highest quality)
          format: {
            audio: 'FLAC'
          },
          // Use alternative download method if available
          // This can help bypass the ytdl-core issues
          alternativeMethod: true
        });
        
        // Create a placeholder file to indicate download has started
        const placeholderPath = path.join(outputPath, 'download_started.txt');
        fs.writeFileSync(placeholderPath, `Download started at ${new Date().toISOString()}\nThis file will be replaced with the actual media files when download completes.`);
        
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
            // Create a fallback download info file with instructions
            const fallbackInfoPath = path.join(outputPath, 'alternative_download_info.txt');
            const fallbackContent = `
Spotify Download Information
=========================
Requested URL: ${url}
Time: ${new Date().toISOString()}

Due to current limitations with the Spotify API and YouTube extraction,
direct downloads may not be working properly.

Alternative download options:
1. Use spotify-dl CLI tool: https://github.com/SathyaBhat/spotify-dl
2. Use spotDL: https://github.com/spotDL/spotify-downloader
3. Use Spotiflyer: https://github.com/Shabinder/SpotiFlyer

These tools may provide better compatibility with the latest Spotify API changes.
`;
            fs.writeFileSync(fallbackInfoPath, fallbackContent);
            
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
            
            // Create a more detailed error file with troubleshooting info
            const errorFilePath = path.join(outputPath, 'download_error.txt');
            const errorContent = `
Spotify Download Error
====================
Time: ${new Date().toISOString()}
URL: ${url}

Error Message: ${error.message || 'Unknown error'}

Possible Solutions:
1. Check your Spotify API credentials
2. The ytdl-core library may need to be updated
3. Try using an alternative download method (see alternative_download_info.txt)

Full Error Details:
${JSON.stringify(error, null, 2)}
`;
            
            fs.writeFileSync(errorFilePath, errorContent);
            
            // Create the alternative download info file as a fallback
            const alternativeInfoPath = path.join(outputPath, 'alternative_download_info.txt');
            const alternativeContent = `
Alternative Download Options
==========================
Since the automatic download failed, you can try these alternatives:

1. Use spotify-dl CLI tool: https://github.com/SathyaBhat/spotify-dl
2. Use spotDL: https://github.com/spotDL/spotify-downloader
3. Use Spotiflyer: https://github.com/Shabinder/SpotiFlyer

These tools are regularly updated to work with the latest Spotify API changes.
`;
            
            fs.writeFileSync(alternativeInfoPath, alternativeContent);
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
