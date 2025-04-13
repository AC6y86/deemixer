// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const youtubeDl = require('youtube-dl-exec');
const axios = require('axios');

// Deezer ARL token from environment variables (required for deemix)
const DEEZER_ARL = process.env.DEEZER_ARL || 'YOUR_DEEZER_ARL';

// Spotify API credentials from environment variables (optional for metadata)
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'YOUR_SPOTIFY_CLIENT_ID';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'YOUR_SPOTIFY_CLIENT_SECRET';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Create downloads directory if it doesn't exist
const ensureDownloadsDir = () => {
  const downloadsDir = path.join(__dirname, 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
};

// Helper function to check if a URL is from Spotify
const isSpotifyUrl = (url) => {
  return url && (url.includes('spotify.com') || url.includes('open.spotify'));
};

// Helper function to check if a URL is from Deezer
const isDeezerUrl = (url) => {
  return url && (url.includes('deezer.com') || url.includes('dzr.page.link'));
};

// Helper function to check if a URL is from YouTube
const isYouTubeUrl = (url) => {
  return url && (url.includes('youtube.com') || url.includes('youtu.be'));
};

// Helper function to validate URL format
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
};

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
      const errorFile = files.find(file => file.includes('error') && file.endsWith('.txt'));
      if (errorFile) {
        // Read the error file to get the error message
        try {
          const errorContent = fs.readFileSync(path.join(downloadPath, errorFile), 'utf8');
          const errorMessage = errorContent.split('\n')[0] || 'Unknown error occurred';
          return res.json({ status: 'error', message: errorMessage });
        } catch (e) {
          return res.json({ status: 'error', message: 'An error occurred during download' });
        }
      }
      
      // Check if there's a "download_started.txt" file but no other files yet
      if (files.length === 1 && files[0] === 'download_started.txt') {
        return res.json({ status: 'in_progress', message: 'Download in progress' });
      }
      
      // If we get here, the download is complete
      // Filter out text files and get the actual media files
      const mediaFiles = files.filter(file => !file.endsWith('.txt'));
      
      // Create URLs for each file
      const fileUrls = files.map(file => {
        return {
          name: file,
          url: `/download/file/${downloadId}/${encodeURIComponent(file)}`
        };
      });
      
      return res.json({ 
        status: 'complete', 
        message: 'Download complete', 
        files: fileUrls
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
  res.download(filePath);
});

// API endpoint to handle download requests
app.post('/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Validate URL format
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL format. Please enter a valid URL.' });
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
          message: 'YouTube download started. This may take a while depending on the video quality.', 
          downloadId: downloadId,
          statusUrl: `/download/status/${downloadId}`,
          autoCheckStatus: true
        });
        
        // Download the YouTube video (asynchronously)
        (async () => {
          try {
            // Use youtube-dl to download the video in the highest quality
            await youtubeDl(url, {
              output: outputPath,
              format: 'bestvideo+bestaudio/best', // Get the best quality
              mergeOutputFormat: 'mp4',           // Merge into MP4 format
              noCheckCertificates: true,
              noWarnings: true,
              preferFreeFormats: true,
              addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              ]
            });
            
            console.log(`YouTube download completed to ${outputPath}`);
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
    // Check if URL is from Spotify or Deezer
    else if (isSpotifyUrl(url) || isDeezerUrl(url)) {
      try {
        // Create a unique download ID and path
        const downloadId = Date.now().toString();
        const outputPath = path.join(__dirname, 'downloads', downloadId);
        
        // Ensure the output directory exists
        if (!fs.existsSync(outputPath)) {
          fs.mkdirSync(outputPath, { recursive: true });
        }
        
        // Check if Deezer ARL token is set
        if (DEEZER_ARL === 'YOUR_DEEZER_ARL') {
          return res.status(400).json({ 
            error: 'Deezer ARL token not configured. Please add your Deezer ARL token to the .env file.'
          });
        }
        
        // Create a placeholder file to indicate download has started
        const placeholderPath = path.join(outputPath, 'download_started.txt');
        fs.writeFileSync(placeholderPath, `Download started at ${new Date().toISOString()}\nThis file will be replaced with the actual media files when download completes.`);
        
        // Send a response to inform the client that the download has started
        res.status(202).json({ 
          message: isSpotifyUrl(url) ? 'Spotify download started via Deezer' : 'Deezer download started', 
          downloadId: downloadId,
          statusUrl: `/download/status/${downloadId}`,
          autoCheckStatus: true,
          note: 'Note: Some tracks may not be available for download due to licensing restrictions or subscription level.'
        });
        
        // Use our Python script to download from Deezer (or convert Spotify URL to Deezer)
        (async () => {
          try {
            const pythonScript = path.join(__dirname, 'deemix_downloader.py');
            const pythonVenv = path.join(__dirname, 'deemix-env', 'bin', 'python');
            
            // Make the Python script executable
            fs.chmodSync(pythonScript, '755');
            
            // Run the Python script to download the content
            const pythonProcess = spawn(pythonVenv, [
              pythonScript,
              '--url', url,
              '--output', outputPath,
              '--arl', DEEZER_ARL
            ]);
            
            // Log output from the Python script
            pythonProcess.stdout.on('data', (data) => {
              console.log(`Python stdout: ${data}`);
            });
            
            pythonProcess.stderr.on('data', (data) => {
              console.error(`Python stderr: ${data}`);
              
              // Create an error log file
              const errorLogPath = path.join(outputPath, 'python_error.log');
              fs.appendFileSync(errorLogPath, data);
            });
            
            pythonProcess.on('close', (code) => {
              console.log(`Python process exited with code ${code}`);
              
              if (code !== 0) {
                // Create an error file if the Python script failed
                const errorFilePath = path.join(outputPath, 'download_error.txt');
                fs.writeFileSync(errorFilePath, `Download failed with exit code ${code}. Check python_error.log for details.`);
              } else {
                console.log(`Download completed to ${outputPath}`);
              }
            });
          } catch (error) {
            console.error('Error downloading from Deezer:', error);
            
            // Create a more detailed error file with troubleshooting info
            const errorFilePath = path.join(outputPath, 'download_error.txt');
            const errorContent = `
Download Error
====================
Time: ${new Date().toISOString()}
URL: ${url}

Error Message: ${error.message || 'Unknown error'}

Possible Solutions:
1. Check your Deezer ARL token
2. Make sure the URL is valid
3. Check if the content is available on Deezer

Full Error Details:
${JSON.stringify(error, null, 2)}
`;
            
            fs.writeFileSync(errorFilePath, errorContent);
          }
        })();
      } catch (error) {
        console.error('Error setting up download:', error);
        res.status(500).json({ error: 'Error setting up download: ' + error.message });
      }
    } else {
      // Unsupported URL
      return res.status(400).json({ error: 'Unsupported URL. Only YouTube, Spotify, and Deezer URLs are supported.' });
    }
  } catch (error) {
    console.error('Error handling download request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
