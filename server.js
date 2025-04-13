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

// Helper function to ensure a file mapping exists for a download
const ensureFileMapping = (downloadId) => {
  const downloadPath = path.join(__dirname, 'downloads', downloadId);
  const mappingPath = path.join(downloadPath, 'file_mapping.json');
  
  // Only create mapping if it doesn't exist
  if (!fs.existsSync(mappingPath)) {
    console.log(`\n=== CREATING FILE MAPPING FOR EXISTING DOWNLOAD ===`);
    console.log(`Download ID: ${downloadId}`);
    console.log(`Download path: ${downloadPath}`);
    
    // Check if the download directory exists
    if (!fs.existsSync(downloadPath)) {
      console.log(`ERROR: Download directory does not exist: ${downloadPath}`);
      return false;
    }
    
    // Look for files.json
    const filesJsonPath = path.join(downloadPath, 'files.json');
    if (!fs.existsSync(filesJsonPath)) {
      console.log(`WARNING: files.json not found at ${filesJsonPath}`);
      
      // If no files.json, scan for audio files and create one
      try {
        const audioFiles = [];
        const files = fs.readdirSync(downloadPath);
        
        for (const file of files) {
          if (file.endsWith('.mp3') || file.endsWith('.flac') || file.endsWith('.m4a')) {
            const filePath = path.join(downloadPath, file);
            const stats = fs.statSync(filePath);
            
            audioFiles.push({
              path: file,
              size: stats.size,
              type: 'audio/' + file.split('.').pop().toLowerCase()
            });
          }
        }
        
        if (audioFiles.length > 0) {
          console.log(`Found ${audioFiles.length} audio files, creating files.json`);
          const filesData = { files: audioFiles };
          fs.writeFileSync(filesJsonPath, JSON.stringify(filesData, null, 2));
          console.log(`Created files.json with ${audioFiles.length} entries`);
        } else {
          console.log(`No audio files found in directory, cannot create mapping`);
          return false;
        }
      } catch (err) {
        console.error(`ERROR: Failed to scan directory: ${err.message}`);
        return false;
      }
    }
    
    // Now read the files.json and create mapping
    try {
      const fileContent = fs.readFileSync(filesJsonPath, 'utf8');
      const filesData = JSON.parse(fileContent);
      
      if (filesData && filesData.files && filesData.files.length > 0) {
        // Create simplified IDs for each file
        const fileMapping = {
          files: filesData.files.map((fileInfo, index) => {
            const fileExt = fileInfo.path.split('.').pop().toLowerCase();
            const simpleId = `track_${index + 1}.${fileExt}`;
            const fileExists = fs.existsSync(path.join(downloadPath, fileInfo.path));
            
            // Find actual file if original doesn't exist
            let actualPath = fileInfo.path;
            if (!fileExists) {
              const files = fs.readdirSync(downloadPath);
              const matchingFiles = files.filter(f => f.endsWith(`.${fileExt}`));
              if (matchingFiles.length > 0) {
                actualPath = matchingFiles[0];
              }
            }
            
            return {
              simpleId: simpleId,
              originalPath: fileInfo.path,
              actualPath: actualPath,
              exists: fileExists || actualPath !== fileInfo.path
            };
          })
        };
        
        // Write the mapping file
        fs.writeFileSync(mappingPath, JSON.stringify(fileMapping, null, 2));
        console.log(`SUCCESS: Created file mapping with ${fileMapping.files.length} entries`);
        return true;
      } else {
        console.log(`WARNING: No files found in files.json`);
        return false;
      }
    } catch (err) {
      console.error(`ERROR: Failed to create file mapping: ${err.message}`);
      return false;
    }
  }
  
  return true; // Mapping already exists
};

// Endpoint to check download status
app.get('/download/status/:downloadId', (req, res) => {
  const { downloadId } = req.params;
  const downloadPath = path.join(__dirname, 'downloads', downloadId);
  
  console.log(`\n=== DOWNLOAD STATUS CHECK ===`);
  console.log(`[${new Date().toISOString()}] Checking download status for ID: ${downloadId}`);
  console.log(`Download path: ${downloadPath}`);
  
  // Check if the download directory exists
  if (!fs.existsSync(downloadPath)) {
    console.log(`ERROR: Download directory not found: ${downloadPath}`);
    return res.status(404).json({ status: 'not_found', message: 'Download not found' });
  }
  
  console.log(`SUCCESS: Download directory exists: ${downloadPath}`);
  
  // Ensure file mapping exists for this download
  console.log(`Ensuring file mapping exists for download ${downloadId}...`);
  ensureFileMapping(downloadId);
  
  // Log the directory contents for debugging
  try {
    const dirContents = fs.readdirSync(downloadPath);
    console.log(`Directory contents for ${downloadId}:`);
    dirContents.forEach((file, index) => {
      try {
        const stats = fs.statSync(path.join(downloadPath, file));
        const fileSizeKB = (stats.size / 1024).toFixed(2);
        console.log(`  ${index + 1}. ${file} (${fileSizeKB} KB) - ${stats.isDirectory() ? 'Directory' : 'File'}`);
      } catch (err) {
        console.log(`  ${index + 1}. ${file} (Error getting stats: ${err.message})`);
      }
    });
  } catch (err) {
    console.error(`ERROR: Failed to read directory contents: ${err.message}`);
  }
  
  // List files in the download directory
  fs.readdir(downloadPath, (err, files) => {
    if (err) {
      console.error(`ERROR: Failed to read directory: ${err.message}`);
      return res.status(500).json({ status: 'error', message: 'Failed to check download status' });
    }
    
    console.log(`\n=== FILE PROCESSING ===`);
    console.log(`Found ${files.length} files in directory ${downloadId}`);
    
    if (files.length === 0) {
      // No files yet, download is still in progress
      console.log(`WARNING: No files found in directory ${downloadId}, reporting as in progress`);
      return res.json({ status: 'in_progress', message: 'Download in progress' });
    } else {
      console.log(`SUCCESS: Files found in directory ${downloadId}`);
      
      // Log each file with its details
      files.forEach((file, index) => {
        try {
          const filePath = path.join(downloadPath, file);
          const stats = fs.statSync(filePath);
          const fileSizeKB = (stats.size / 1024).toFixed(2);
          const fileExt = path.extname(file).toLowerCase();
          console.log(`  ${index + 1}. ${file} (${fileSizeKB} KB) - Extension: ${fileExt || 'none'}`);
        } catch (err) {
          console.log(`  ${index + 1}. ${file} (Error getting stats: ${err.message})`);
        }
      });
      console.log(`\n=== FILE ANALYSIS ===`);
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
      console.log(`Processing completed download for ${downloadId}`);
      
      // Filter out text files and get the actual media files
      const mediaFiles = files.filter(file => 
        !file.endsWith('.txt') && 
        !file.includes('arl_temp') && 
        file !== 'files.json'
      );
      
      console.log(`Found ${mediaFiles.length} media files after filtering:`, mediaFiles);
      
      // Check if we have a files.json with metadata
      let filesWithMetadata = [];
      const filesJsonPath = path.join(downloadPath, 'files.json');
      console.log(`\n=== METADATA PROCESSING ===`);
      console.log(`Checking for files.json at: ${filesJsonPath}`);
      
      if (fs.existsSync(filesJsonPath)) {
        try {
          console.log(`SUCCESS: files.json exists at ${filesJsonPath}`);
          const fileContent = fs.readFileSync(filesJsonPath, 'utf8');
          console.log(`files.json content (first 100 chars): ${fileContent.substring(0, 100)}...`);
          
          const filesData = JSON.parse(fileContent);
          console.log(`SUCCESS: Parsed files.json successfully`);
          
          // Log the structure of the parsed data
          console.log(`filesData structure: ${typeof filesData}`);
          if (filesData) {
            console.log(`filesData keys: ${Object.keys(filesData).join(', ')}`);
            if (filesData.files) {
              console.log(`filesData.files is an array: ${Array.isArray(filesData.files)}`);
              console.log(`filesData.files length: ${filesData.files.length}`);
              
              if (filesData.files.length > 0) {
                const firstFile = filesData.files[0];
                console.log(`First file in metadata:`);
                console.log(`  - Keys: ${Object.keys(firstFile).join(', ')}`);
                console.log(`  - path: ${firstFile.path || 'undefined'}`);
                console.log(`  - size: ${firstFile.size || 'undefined'}`);
                console.log(`  - type: ${firstFile.type || 'undefined'}`);
              }
            } else {
              console.log(`WARNING: filesData.files is undefined or not an array`);
            }
          } else {
            console.log(`WARNING: filesData is null or undefined`);
          }
          
          if (filesData && filesData.files) {
            console.log(`\n=== FILE URL GENERATION ===`);
            console.log(`Processing ${filesData.files.length} files from metadata`);
            
            // Create a simplified ID for each file to use in URLs
            filesWithMetadata = filesData.files.map((fileInfo, index) => {
              console.log(`\nProcessing file ${index + 1}:`);
              console.log(`  Original path: ${fileInfo.path}`);
              
              // Extract file extension
              const fileExt = fileInfo.path.split('.').pop().toLowerCase();
              console.log(`  File extension: ${fileExt}`);
              
              // Create a simple ID based on index and file type
              const simpleId = `track_${index + 1}.${fileExt}`;
              console.log(`  Generated simple ID: ${simpleId}`);
              
              // Generate the URL
              const encodedSimpleId = encodeURIComponent(simpleId);
              const fileUrl = `/download/file/${downloadId}/${encodedSimpleId}`;
              console.log(`  Generated URL: ${fileUrl}`);
              
              // Check if the file exists on disk
              const fullFilePath = path.join(downloadPath, fileInfo.path);
              let fileExists = fs.existsSync(fullFilePath);
              console.log(`  File exists at ${fullFilePath}: ${fileExists}`);
              
              // If the file doesn't exist at the expected path, try to find it by scanning the directory
              let actualFilePath = fullFilePath;
              if (!fileExists) {
                console.log(`  WARNING: File not found at expected path: ${fullFilePath}`);
                // Try to find the file by extension
                try {
                  const dirFiles = fs.readdirSync(downloadPath);
                  // First try to find files with the exact extension
                  const matchingFiles = dirFiles.filter(f => f.endsWith(`.${fileExt}`));
                  console.log(`  Found ${matchingFiles.length} files with extension .${fileExt}`);
                  
                  if (matchingFiles.length > 0) {
                    // Use the first matching file found
                    const matchedFile = matchingFiles[0];
                    actualFilePath = path.join(downloadPath, matchedFile);
                    fileExists = true;
                    console.log(`  Found matching file: ${matchedFile}`);
                    console.log(`  Using alternative path: ${actualFilePath}`);
                  }
                } catch (err) {
                  console.error(`  ERROR: Failed to search for matching files: ${err.message}`);
                }
              }
              
              return {
                name: fileInfo.path, // Keep the original name for display
                // Use the simple ID in the URL instead of the full path
                url: fileUrl,
                // Store the original path for reference
                originalPath: fileInfo.path,
                // Store the actual file path (which might be different if we found an alternative)
                actualPath: path.basename(actualFilePath),
                size: fileInfo.size,
                type: fileInfo.type,
                // Store the simple ID for reference
                simpleId: simpleId,
                // Store whether the file exists
                exists: fileExists
              };
            });
            
            // Save the mapping of simple IDs to original filenames for the download endpoint
            const mappingPath = path.join(downloadPath, 'file_mapping.json');
            const mapping = {
              files: filesWithMetadata.map(file => ({
                simpleId: file.simpleId,
                originalPath: file.originalPath,
                actualPath: file.actualPath,
                exists: file.exists
              }))
            };
            
            console.log(`\n=== FILE MAPPING CREATION ===`);
            console.log(`Creating file mapping at ${mappingPath}`);
            fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
            console.log(`SUCCESS: Created file mapping with ${mapping.files.length} entries`);
            
            console.log(`\n=== FILES WITH METADATA ===`);
            filesWithMetadata.forEach((file, index) => {
              console.log(`File ${index + 1}:`);
              console.log(`  Name: ${file.name}`);
              console.log(`  URL: ${file.url}`);
              console.log(`  Original Path: ${file.originalPath}`);
              console.log(`  Actual Path: ${file.actualPath}`);
              console.log(`  Size: ${file.size} bytes`);
              console.log(`  Type: ${file.type}`);
              console.log(`  Simple ID: ${file.simpleId}`);
              console.log(`  Exists: ${file.exists}`);
            });
          }
        } catch (e) {
          console.error('Error parsing files.json:', e);
        }
      } else {
        console.log('files.json not found, checking for media files directly');
      }
      
      // If we have metadata, use it; otherwise fall back to simple file listing
      let fileUrls = [];
      
      if (filesWithMetadata.length > 0) {
        console.log('Using files from metadata');
        fileUrls = filesWithMetadata;
        
        // Debug each file from metadata
        fileUrls.forEach(file => {
          console.log(`File from metadata: ${JSON.stringify(file)}`);
          
          // Ensure the URL is properly encoded
          // Use the most appropriate name property available
          const fileName = file.originalPath || file.actualPath || file.path || file.name || file.simpleId;
          if (fileName) {
            file.url = `/download/file/${downloadId}/${encodeURIComponent(fileName)}`;
            console.log(`Created URL for file: ${file.url}`);
          }
        });
      } else {
        // Check if we have files.json even if filesWithMetadata is empty
        if (fs.existsSync(filesJsonPath)) {
          try {
            const fileContent = fs.readFileSync(filesJsonPath, 'utf8');
            const filesData = JSON.parse(fileContent);
            
            if (filesData && filesData.files && filesData.files.length > 0) {
              console.log(`Found ${filesData.files.length} files in files.json, creating download links`);
              
              fileUrls = filesData.files.map(file => {
                const fileName = file.path;
                return {
                  name: fileName,
                  path: fileName,
                  size: file.size,
                  type: file.type,
                  url: `/download/file/${downloadId}/${encodeURIComponent(fileName)}`
                };
              });
            }
          } catch (e) {
            console.error('Error processing files.json for download links:', e);
          }
        }
        
        // If we still don't have any file URLs, fall back to directory listing
        if (fileUrls.length === 0) {
          console.log('Using files from directory listing');
          fileUrls = mediaFiles.map(file => ({
            name: file,
            url: `/download/file/${downloadId}/${encodeURIComponent(file)}`
          }));
        }
      }
      
      console.log('Final file URLs to send to client:', fileUrls);
      
      // Check if we have any files to return
      if (fileUrls.length === 0) {
        // If no files found in metadata or directory listing, check the download directory for any audio files
        const allFiles = fs.readdirSync(downloadPath);
        const audioFiles = allFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac'].includes(ext);
        });
        
        if (audioFiles.length > 0) {
          console.log(`Found ${audioFiles.length} audio files in download directory that weren't detected earlier`);
          fileUrls = audioFiles.map(file => ({
            name: file,
            path: file,
            url: `/download/file/${downloadId}/${encodeURIComponent(file)}`
          }));
        }
      }
      
      // Check if we have any files in the music directory that match this download
      // We need to be selective and only include files that were downloaded as part of this request
      const musicDir = path.join(__dirname, 'music');
      if (fs.existsSync(musicDir)) {
        try {
          // Get the list of files from the download directory first
          const downloadFiles = fs.readdirSync(downloadPath)
            .filter(file => {
              const ext = path.extname(file).toLowerCase();
              return ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac'].includes(ext);
            })
            .map(file => file.toLowerCase());
          
          // Only include music files that match the files in the download directory
          // This ensures we only show files relevant to the current download
          if (downloadFiles.length > 0) {
            console.log(`Found ${downloadFiles.length} audio files in download directory to match against music directory`);
            
            const musicFiles = fs.readdirSync(musicDir);
            const matchingMusicFiles = musicFiles
              .filter(file => {
                const ext = path.extname(file).toLowerCase();
                // Only include files with matching names to what's in the download directory
                return ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac'].includes(ext) && 
                       downloadFiles.some(downloadFile => {
                         // Check if the music file matches any download file (ignoring case)
                         return file.toLowerCase() === downloadFile;
                       });
              })
              .map(file => ({
                name: file,
                path: file,
                url: `/download/file/music/${encodeURIComponent(file)}`,
                location: 'music',
                source: 'current_download'
              }));
              
            if (matchingMusicFiles.length > 0) {
              console.log(`Found ${matchingMusicFiles.length} matching music files in music directory`);
              // Add these files to the response
              fileUrls = [...fileUrls, ...matchingMusicFiles];
            }
          }
        } catch (err) {
          console.error(`Error checking music directory: ${err.message}`);
        }
      }
      
      // Ensure we have download links for all files
      fileUrls.forEach(file => {
        if (!file.url) {
          const fileName = file.path || file.name || file.originalPath || file.actualPath;
          if (fileName) {
            file.url = `/download/file/${downloadId}/${encodeURIComponent(fileName)}`;
          }
        }
      });
      
      console.log(`Final file URLs to send to client: ${JSON.stringify(fileUrls)}`);
      
      // If no files were found in the normal process, do one last check for any audio files in the download directory
      if (fileUrls.length === 0) {
        console.log('No files found through normal detection. Performing last-resort check for any audio files...');
        try {
          // Check for any audio files in the download directory as a last resort
          const allFiles = fs.readdirSync(downloadPath);
          const audioFiles = allFiles.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac'].includes(ext);
          });
          
          if (audioFiles.length > 0) {
            console.log(`Last resort check found ${audioFiles.length} audio files in download directory`);
            fileUrls = audioFiles.map(file => ({
              name: file,
              path: file,
              url: `/download/file/${downloadId}/${encodeURIComponent(file)}`,
              source: 'last_resort_check'
            }));
          }
        } catch (err) {
          console.error(`Error in last-resort file check: ${err.message}`);
        }
      }
      
      // Check music directory as a final fallback if still no files found
      if (fileUrls.length === 0) {
        console.log('Still no files found. Checking music directory as final fallback...');
        const musicDir = path.join(__dirname, 'music');
        if (fs.existsSync(musicDir)) {
          try {
            const musicFiles = fs.readdirSync(musicDir);
            // Get most recently modified files first (likely to be from this download)
            const recentMusicFiles = musicFiles
              .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac'].includes(ext);
              })
              .map(file => ({
                name: file,
                path: file,
                fullPath: path.join(musicDir, file),
                url: `/download/file/music/${encodeURIComponent(file)}`,
                location: 'music',
                source: 'final_fallback'
              }));
              
            // Sort by modification time (most recent first)
            recentMusicFiles.sort((a, b) => {
              const statA = fs.statSync(a.fullPath);
              const statB = fs.statSync(b.fullPath);
              return statB.mtime.getTime() - statA.mtime.getTime();
            });
            
            // Take the most recent file if available
            if (recentMusicFiles.length > 0) {
              console.log(`Final fallback found ${recentMusicFiles.length} music files, using most recent`);
              // Just use the most recent file as it's likely from this download
              fileUrls = [recentMusicFiles[0]];
              console.log(`Using most recent music file: ${fileUrls[0].name}`);
            }
          } catch (err) {
            console.error(`Error in music directory fallback check: ${err.message}`);
          }
        }
      }
      
      // Generate HTML content for the status page with download buttons
      let downloadButtonsHtml = '';
      if (fileUrls.length > 0) {
        downloadButtonsHtml = fileUrls.map(file => {
          const fileName = file.path || file.name || file.originalPath || file.actualPath || 'Download File';
          const fileSize = file.size ? `(${(file.size / (1024 * 1024)).toFixed(2)} MB)` : '';
          return `<a href="${file.url}" class="download-link" download="${fileName}">${fileName} ${fileSize}</a>`;
        }).join('<br>');
      }
      
      // Log the final state before sending response
      console.log(`Final file count: ${fileUrls.length}`);
      console.log(`Download buttons HTML generated: ${downloadButtonsHtml ? 'Yes' : 'No'}`);
      
      // Add the download buttons HTML to the response
      return res.json({ 
        status: 'complete', 
        message: 'Download complete', 
        files: fileUrls,
        downloadButtonsHtml: downloadButtonsHtml
      });
    }
  });
});

// Endpoint to check music directory for recent files
app.get('/download/check-music', (req, res) => {
  const { downloadId } = req.query;
  console.log(`\n=== MUSIC DIRECTORY CHECK ===`);
  console.log(`Music directory check requested for download ID: ${downloadId}`);
  
  const musicDir = path.join(__dirname, 'music');
  if (!fs.existsSync(musicDir)) {
    console.log(`Music directory does not exist: ${musicDir}`);
    return res.json({ files: [] });
  }
  
  try {
    const musicFiles = fs.readdirSync(musicDir);
    // Filter for audio files
    const audioFiles = musicFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac'].includes(ext);
    });
    
    // Map files to objects with metadata
    const filesWithMetadata = audioFiles.map(file => {
      const filePath = path.join(musicDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        path: file,
        url: `/download/file/music/${encodeURIComponent(file)}`,
        size: stats.size,
        mtime: stats.mtime.getTime(),
        location: 'music'
      };
    });
    
    // Sort by modification time (most recent first)
    filesWithMetadata.sort((a, b) => b.mtime - a.mtime);
    
    // Take the most recent file if available, or all files if no downloadId provided
    const filesToReturn = downloadId && filesWithMetadata.length > 0 ? [filesWithMetadata[0]] : filesWithMetadata;
    
    console.log(`Found ${filesWithMetadata.length} audio files in music directory, returning ${filesToReturn.length}`);
    return res.json({ 
      files: filesToReturn,
      downloadButtonsHtml: filesToReturn.map(file => {
        const fileSize = file.size ? `(${(file.size / (1024 * 1024)).toFixed(2)} MB)` : '';
        return `<a href="${file.url}" class="download-link" download="${file.name}">${file.name} ${fileSize}</a>`;
      }).join('<br>')
    });
  } catch (err) {
    console.error(`Error checking music directory: ${err.message}`);
    return res.json({ files: [] });
  }
});

// Endpoint to download a specific file
app.get('/download/file/:downloadId/:filename', (req, res) => {
  const { downloadId, filename } = req.params;
  const downloadDir = path.join(__dirname, 'downloads', downloadId);
  const decodedFilename = decodeURIComponent(filename);
  
  console.log(`\n=== FILE DOWNLOAD REQUEST ===`);
  console.log(`[${new Date().toISOString()}] Download request received`);
  console.log(`Download ID: ${downloadId}`);
  console.log(`Encoded filename: ${filename}`);
  console.log(`Decoded filename: ${decodedFilename}`);
  console.log(`Download directory: ${downloadDir}`);
  
  // Verify the download directory exists
  if (!fs.existsSync(downloadDir)) {
    console.log(`ERROR: Download directory does not exist: ${downloadDir}`);
    return res.status(404).json({ error: 'Download directory not found' });
  }
  
  console.log(`SUCCESS: Download directory exists`);
  
  // Log directory contents
  try {
    const dirContents = fs.readdirSync(downloadDir);
    console.log(`\n=== DIRECTORY CONTENTS ===`);
    console.log(`Files in directory (${dirContents.length} total):`);
    dirContents.forEach((file, index) => {
      try {
        const stats = fs.statSync(path.join(downloadDir, file));
        const fileSizeKB = (stats.size / 1024).toFixed(2);
        console.log(`  ${index + 1}. ${file} (${fileSizeKB} KB) - ${stats.isDirectory() ? 'Directory' : 'File'}`);
      } catch (err) {
        console.log(`  ${index + 1}. ${file} (Error getting stats: ${err.message})`);
      }
    });
  } catch (err) {
    console.error(`ERROR: Failed to read directory contents: ${err.message}`);
  }
  
  // Check if we have a file mapping
  console.log(`\n=== FILE MAPPING CHECK ===`);
  const mappingPath = path.join(downloadDir, 'file_mapping.json');
  console.log(`Looking for mapping file at: ${mappingPath}`);
  
  if (fs.existsSync(mappingPath)) {
    console.log(`SUCCESS: Found file mapping at ${mappingPath}`);
    try {
      const mappingContent = fs.readFileSync(mappingPath, 'utf8');
      console.log(`Mapping content (first 100 chars): ${mappingContent.substring(0, 100)}...`);
      
      const mapping = JSON.parse(mappingContent);
      console.log(`Parsed mapping successfully`);
      console.log(`Mapping contains ${mapping.files ? mapping.files.length : 0} file entries`);
      
      // Log all mapping entries
      if (mapping.files && mapping.files.length > 0) {
        console.log(`Mapping entries:`);
        mapping.files.forEach((entry, index) => {
          console.log(`  ${index + 1}. simpleId: ${entry.simpleId}, originalPath: ${entry.originalPath}, exists: ${entry.exists}`);
        });
      }
      
      // Look for the file in the mapping
      console.log(`\n=== LOOKING FOR FILE IN MAPPING ===`);
      console.log(`Looking for simpleId: ${decodedFilename}`);
      
      const fileEntry = mapping.files.find(entry => entry.simpleId === decodedFilename);
      if (fileEntry) {
        console.log(`SUCCESS: Found mapping entry for ${decodedFilename}`);
        console.log(`Mapped to original path: ${fileEntry.originalPath}`);
        console.log(`Actual path (if different): ${fileEntry.actualPath || 'same as original'}`);
        console.log(`Entry 'exists' flag: ${fileEntry.exists}`);
        
        // First try the actual path if it exists and is different from the original
        let filePath = null;
        if (fileEntry.actualPath && fileEntry.actualPath !== fileEntry.originalPath) {
          filePath = path.join(downloadDir, fileEntry.actualPath);
          console.log(`Trying actual path first: ${filePath}`);
          
          if (fs.existsSync(filePath)) {
            console.log(`SUCCESS: File exists at actual path`);
            return res.download(filePath);
          } else {
            console.log(`WARNING: File not found at actual path`);
          }
        }
        
        // Then try the original path from the mapping
        const mappedFilePath = path.join(downloadDir, fileEntry.originalPath);
        console.log(`Trying original path: ${mappedFilePath}`);
        
        // Check if the mapped file exists
        const mappedFileExists = fs.existsSync(mappedFilePath);
        console.log(`File exists at original path: ${mappedFileExists}`);
        
        if (mappedFileExists) {
          console.log(`SUCCESS: Sending file from original path: ${mappedFilePath}`);
          return res.download(mappedFilePath);
        } else {
          console.log(`WARNING: File not found at original path: ${mappedFilePath}`);
          
          // If neither path worked, scan the directory for any audio files
          console.log(`Scanning directory for audio files...`);
          try {
            const files = fs.readdirSync(downloadDir);
            const audioFiles = files.filter(file => 
              file.endsWith('.mp3') || file.endsWith('.flac') || file.endsWith('.m4a'));
            
            if (audioFiles.length > 0) {
              const audioFile = audioFiles[0];
              const audioFilePath = path.join(downloadDir, audioFile);
              console.log(`Found audio file: ${audioFile}`);
              console.log(`SUCCESS: Sending found audio file: ${audioFilePath}`);
              return res.download(audioFilePath);
            } else {
              console.log(`No audio files found in directory`);
            }
          } catch (err) {
            console.error(`ERROR: Failed to scan directory: ${err.message}`);
          }
          
          console.log(`Will try fallback methods...`);
        }
      } else {
        console.log(`WARNING: No mapping found for ${decodedFilename}`);
      }
    } catch (err) {
      console.error(`ERROR: Failed to parse mapping file: ${err.message}`);
    }
  } else {
    console.log(`WARNING: No file mapping found at ${mappingPath}`);
  }
  
  // If we couldn't use the mapping, fall back to direct file access
  console.log(`\n=== FALLBACK: DIRECT FILE ACCESS ===`);
  
  // First try the exact path
  let filePath = path.join(downloadDir, decodedFilename);
  console.log(`Trying exact path: ${filePath}`);
  
  // Check if the file exists at the exact path
  const exactPathExists = fs.existsSync(filePath);
  console.log(`File exists at exact path: ${exactPathExists}`);
  
  if (!exactPathExists) {
    console.log(`\n=== FALLBACK: SEARCHING BY EXTENSION ===`);
    
    // Extract file extension from the decoded filename
    const fileExt = path.extname(decodedFilename).toLowerCase();
    console.log(`File extension from request: ${fileExt}`);
    
    // If not found, try to find a file with a similar name
    try {
      const files = fs.readdirSync(downloadDir);
      
      // Look for files with matching extension
      const matchingFiles = files.filter(file => path.extname(file).toLowerCase() === fileExt);
      console.log(`Found ${matchingFiles.length} files with extension ${fileExt}:`);
      matchingFiles.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file}`);
      });
      
      if (matchingFiles.length > 0) {
        // Use the first matching file found
        filePath = path.join(downloadDir, matchingFiles[0]);
        console.log(`Using first matching file: ${filePath}`);
      } else {
        // No matching extension, try MP3 files as a last resort
        console.log(`\n=== FALLBACK: SEARCHING FOR MP3 FILES ===`);
        const mp3Files = files.filter(file => file.endsWith('.mp3'));
        console.log(`Found ${mp3Files.length} MP3 files:`);
        mp3Files.forEach((file, index) => {
          console.log(`  ${index + 1}. ${file}`);
        });
        
        if (mp3Files.length > 0) {
          // Use the first MP3 file found
          filePath = path.join(downloadDir, mp3Files[0]);
          console.log(`Using first MP3 file: ${filePath}`);
        }
      }
    } catch (err) {
      console.error(`ERROR: Failed to search for alternative files: ${err.message}`);
    }
  }
  
  // Final check if the file exists
  console.log(`\n=== FINAL FILE CHECK ===`);
  console.log(`Final file path: ${filePath}`);
  
  const finalFileExists = fs.existsSync(filePath);
  console.log(`Final file exists: ${finalFileExists}`);
  
  if (!finalFileExists) {
    console.log(`ERROR: File not found after all attempts`);
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Get file stats for logging
  try {
    const stats = fs.statSync(filePath);
    const fileSizeKB = (stats.size / 1024).toFixed(2);
    console.log(`File size: ${fileSizeKB} KB`);
    console.log(`File last modified: ${stats.mtime}`);
  } catch (err) {
    console.error(`ERROR: Failed to get file stats: ${err.message}`);
  }
  
  console.log(`SUCCESS: Sending file: ${filePath}`);
  // Send the file
  res.download(filePath, (err) => {
    if (err) {
      console.error(`ERROR: Failed to send file: ${err.message}`);
    } else {
      console.log(`File download completed successfully`);
    }
  });
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
          message: isSpotifyUrl(url) ? 'Spotify download started via Deezer' : 'Deezer download started - Processing your request...', 
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
