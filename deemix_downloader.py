#!/usr/bin/env python3
"""

DeeMixer Downloader Script
--------------------------
This script handles downloading from Deezer and converting Spotify URLs to Deezer URLs.
It's called by the Node.js server to handle download requests.
"""

import sys
import os
import json
import re
import argparse
import subprocess
import time
from pathlib import Path
import requests
from datetime import datetime
# Import only what we need for the CLI approach
from deezer import Deezer

def search_deezer_for_spotify(spotify_url, output_path):
    """
    Search for a Spotify track/album/playlist on Deezer and return the Deezer URL.
    """
    # Extract Spotify ID and type from URL
    spotify_type = None
    spotify_id = None
    
    if "spotify.com/track/" in spotify_url:
        spotify_type = "track"
        match = re.search(r'track/([a-zA-Z0-9]+)', spotify_url)
        if match:
            spotify_id = match.group(1)
    elif "spotify.com/album/" in spotify_url:
        spotify_type = "album"
        match = re.search(r'album/([a-zA-Z0-9]+)', spotify_url)
        if match:
            spotify_id = match.group(1)
    elif "spotify.com/playlist/" in spotify_url:
        spotify_type = "playlist"
        match = re.search(r'playlist/([a-zA-Z0-9]+)', spotify_url)
        if match:
            spotify_id = match.group(1)
    
    if not spotify_type or not spotify_id:
        error_file = os.path.join(output_path, "spotify_conversion_error.txt")
        with open(error_file, "w") as f:
            f.write(f"Could not extract type and ID from Spotify URL: {spotify_url}")
        return None
    
    # Get metadata from Spotify API (this is a simplified version, in production you'd use proper Spotify API)
    # For now, we'll just extract the name from the URL and search Deezer
    
    try:
        # Use Spotify API to get track/album/playlist name
        # This is a placeholder - in a real implementation, you would use the Spotify API
        # For now, we'll just create a search query based on the URL
        
        # Create a search query for Deezer
        search_term = spotify_id.replace("-", " ")
        
        # Search Deezer
        deezer_api_url = f"https://api.deezer.com/search?q={search_term}"
        response = requests.get(deezer_api_url)
        
        if response.status_code == 200:
            data = response.json()
            if "data" in data and len(data["data"]) > 0:
                # Get the first result
                first_result = data["data"][0]
                
                # Determine the type of result and construct the Deezer URL
                if spotify_type == "track" and "id" in first_result:
                    deezer_url = f"https://www.deezer.com/track/{first_result['id']}"
                    return deezer_url
                elif spotify_type == "album" and "album" in first_result and "id" in first_result["album"]:
                    deezer_url = f"https://www.deezer.com/album/{first_result['album']['id']}"
                    return deezer_url
                # For playlists, we'd need a different approach
        
        # If we get here, we couldn't find a match
        error_file = os.path.join(output_path, "spotify_conversion_error.txt")
        with open(error_file, "w") as f:
            f.write(f"Could not find equivalent Deezer content for Spotify URL: {spotify_url}")
        return None
    
    except Exception as e:
        error_file = os.path.join(output_path, "spotify_conversion_error.txt")
        with open(error_file, "w") as f:
            f.write(f"Error converting Spotify URL to Deezer: {str(e)}")
        return None

def check_track_availability(dz, track_id):
    """
    Check if a track is available for download in any format.
    Returns a tuple of (available, formats, error_message)
    """
    try:
        # Get track info using legacy API
        track = dz.api.get_track(track_id)
        if not track:
            return False, [], "Track not found"

        # Check if track is readable and has a valid MD5
        if not track.get('readable', False):
            return False, [], "Track is not readable"

        # Get track info from deemix API
        track_info = dz.gw.get_track_with_fallback(track_id)
        if not track_info:
            return False, [], "Could not get track info"

        # Check track availability
        track_token = track.get('track_token')
        if not track_token:
            return False, [], "No track token available"

        # Try to get track download URL
        try:
            url = dz.get_track_url(track_id, 'MP3_128')
            if url:
                return True, ['MP3_128', 'MP3_320', 'FLAC'], None
        except Exception as e:
            print(f"Error getting track URL: {e}")

        return False, [], "Track not available for download"

    except Exception as e:
        return False, [], f"Error checking availability: {str(e)}"

def check_account_status(dz):
    """
    Check the Deezer account status and permissions.
    This function is kept for backward compatibility but is no longer used
    since we're using the CLI approach.
    """
    try:
        # Try to get account info through the API
        api = dz.api
        if api:
            # Get account info
            account_info = api.get_account()
            if account_info:
                print(f"\nAccount Info:")
                print(f"Account Type: {account_info.get('USER', {}).get('OFFER_NAME')}")
                print(f"Country: {account_info.get('USER', {}).get('COUNTRY')}")
                print(f"Can Stream HQ: {account_info.get('OFFERS', {}).get('data', [{}])[0].get('CAN_STREAM_HQ')}")
                print(f"Can Download: {account_info.get('OFFERS', {}).get('data', [{}])[0].get('CAN_STREAM_OFFLINE')}")
                return True
    except Exception as e:
        print(f"\nError getting account info: {str(e)}")
        return False

def download_from_deezer(url, output_path, arl):
    """
    Download a track/album/playlist from Deezer using deemix CLI.
    """
    try:
        # Create output directory if it doesn't exist
        os.makedirs(output_path, exist_ok=True)
        
        # Create a status file to indicate download has started
        status_file = os.path.join(output_path, "download_started.txt")
        with open(status_file, "w") as f:
            f.write(f"Download started at {os.path.basename(output_path)}\n")
            f.write(f"URL: {url}\n")
        
        # Resolve short URL if needed
        actual_url = url
        if 'dzr.page.link' in url:
            try:
                print(f"Resolving Deezer short URL...")
                response = requests.get(url, allow_redirects=False)
                if 'Location' in response.headers:
                    actual_url = response.headers['Location']
                    print(f"Resolved to: {actual_url}")
            except Exception as e:
                print(f"Error resolving short URL: {e}")
                raise e
        
        # Create a temporary file to store the ARL
        arl_file = os.path.join(output_path, "arl_temp.txt")
        with open(arl_file, "w") as f:
            f.write(arl)
        
        # Read the deemix config to find the default download location
        config_file = os.path.join(os.path.dirname(__file__), 'config', 'config.json')
        default_download_location = None
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r') as f:
                    config = json.load(f)
                    default_download_location = config.get('downloadLocation')
            except Exception as e:
                print(f"Error reading config file: {e}")
        
        # If we couldn't get the default location, use a fallback
        if not default_download_location:
            default_download_location = os.path.join(os.path.dirname(__file__), 'music')
        
        print(f"Default download location: {default_download_location}")
        
        # Create the default download directory if it doesn't exist
        os.makedirs(default_download_location, exist_ok=True)
        
        # Use the deemix CLI to download the track
        # The CLI will prompt for the ARL, so we'll use a pipe to provide it
        deemix_path = os.path.join(os.path.dirname(__file__), 'deemix-env', 'bin', 'deemix')
        cmd = f"cat {arl_file} | {deemix_path} -b 320 {actual_url}"
        print(f"Running command: {cmd}")
        
        process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate()
        
        # After download completes, copy any downloaded files to our output directory
        print("\n=== FILE DISCOVERY PROCESS ===")
        print(f"[{datetime.now().isoformat()}] Searching for downloaded files")
        print(f"Default download location: {default_download_location}")
        print(f"Output path: {output_path}")
        
        # First, check if the deemix output indicates a successful download
        # Look for patterns like "Completed download of" or "Track already downloaded"
        downloaded_files = []
        track_info = {}
        
        print("\n=== DEEMIX OUTPUT ANALYSIS ===")
        print(f"Analyzing deemix output for file information")
        
        # Extract track information from output
        for line in stdout.split('\n'):
            # Look for track title and artist information
            if '::' in line and '[track_' in line:
                parts = line.split('::')[0].strip()
                track_id_parts = parts.split(']')
                if len(track_id_parts) > 1:
                    track_info['track_name'] = track_id_parts[1].strip()
            
            # Look for completed or already downloaded tracks
            if "Completed download of" in line or "Track already downloaded" in line:
                # Extract the filename from the output
                # Format is typically: [track_id] Completed download of /Artist - Title.mp3
                parts = line.split('Completed download of')
                if len(parts) > 1:
                    filename = parts[1].strip().strip('/')
                    # Look for this file in the default download location
                    for root, dirs, files in os.walk(default_download_location):
                        for file in files:
                            if file == filename or file.endswith(filename):
                                downloaded_files.append(os.path.join(root, file))
        
        # If we couldn't find files based on the output, fall back to checking for recent files
        if not downloaded_files:
            for root, dirs, files in os.walk(default_download_location):
                for file in files:
                    if file.endswith('.mp3') or file.endswith('.flac'):
                        # Check if this is a recent file (created in the last minute)
                        file_path = os.path.join(root, file)
                        file_creation_time = os.path.getctime(file_path)
                        if time.time() - file_creation_time < 60:  # If file was created in the last minute
                            downloaded_files.append(file_path)
        
        # If we still couldn't find any files, try to use the extracted track info
        # to search for matching files in the default location
        if not downloaded_files and track_info.get('track_name'):
            track_name = track_info['track_name']
            print(f"Searching for files matching track: {track_name}")
            
            # Search for files containing the track name
            for root, dirs, files in os.walk(default_download_location):
                for file in files:
                    if track_name in file and (file.endswith('.mp3') or file.endswith('.flac')):
                        print(f"Found matching file: {file}")
                        downloaded_files.append(os.path.join(root, file))
        
        # As a last resort, look for any track ID or specific track names in the output
        if not downloaded_files:
            for line in stdout.split('\n'):
                # Extract track ID from lines like [track_116914042_3]
                if '[track_' in line and ']' in line:
                    track_id = line.split('[track_')[1].split(']')[0].split('_')[0]
                    print(f"Searching for files related to track ID: {track_id}")
                    
                    # Look for any recently modified audio files
                    for root, dirs, files in os.walk(default_download_location):
                        for file in files:
                            if (file.endswith('.mp3') or file.endswith('.flac')):
                                # Check if this is a relatively recent file (created in the last day)
                                file_path = os.path.join(root, file)
                                file_creation_time = os.path.getctime(file_path)
                                if time.time() - file_creation_time < 86400:  # 24 hours
                                    print(f"Found recent audio file: {file}")
                                    downloaded_files.append(file_path)
        
        # Copy all found files to the output directory
        print("\n=== FILE COPYING PROCESS ===")
        print(f"[{datetime.now().isoformat()}] Preparing to copy files to output directory")
        
        if downloaded_files:
            print(f"SUCCESS: Found {len(downloaded_files)} files to copy")
            
            # Log detailed information about each file
            for index, src_file in enumerate(downloaded_files):
                try:
                    file_size = os.path.getsize(src_file)
                    file_size_mb = file_size / (1024 * 1024)
                    file_mtime = datetime.fromtimestamp(os.path.getmtime(src_file))
                    file_readable = os.access(src_file, os.R_OK)
                    
                    print(f"\nFile {index + 1}: {os.path.basename(src_file)}")
                    print(f"  Full path: {src_file}")
                    print(f"  Size: {file_size} bytes ({file_size_mb:.2f} MB)")
                    print(f"  Last modified: {file_mtime.isoformat()}")
                    print(f"  Is readable: {file_readable}")
                    
                    # Copy the file to our output directory
                    dest_file = os.path.join(output_path, os.path.basename(src_file))
                    print(f"  Destination: {dest_file}")
                    
                    # Check if destination already exists
                    if os.path.exists(dest_file):
                        print(f"  WARNING: Destination file already exists, will be overwritten")
                    
                    # Perform the copy operation
                    print(f"  Copying file...")
                    import shutil
                    shutil.copy2(src_file, dest_file)
                    
                    # Verify the copy was successful
                    if os.path.exists(dest_file):
                        dest_size = os.path.getsize(dest_file)
                        print(f"  SUCCESS: File copied successfully")
                        print(f"  Destination size: {dest_size} bytes")
                        if dest_size != file_size:
                            print(f"  WARNING: Source and destination file sizes don't match!")
                    else:
                        print(f"  ERROR: Copy operation failed - destination file does not exist")
                        
                except Exception as e:
                    print(f"  ERROR: Exception during file copy process: {str(e)}")
        else:
            print("ERROR: No files found to copy. This could be because:")
            print("1. The download failed")
            print("2. The file was already downloaded but we couldn't locate it")
            print("3. The deemix CLI output format has changed")
            print("4. There might be permission issues accessing the files")
            
            # Check the default download directory to see if there are any audio files at all
            print("\nPerforming emergency file scan in default download location...")
            try:
                audio_files = []
                for root, dirs, files in os.walk(default_download_location):
                    for file in files:
                        if file.endswith('.mp3') or file.endswith('.flac'):
                            audio_files.append(os.path.join(root, file))
                
                print(f"Found {len(audio_files)} total audio files in default location")
                if audio_files:
                    print("Most recent audio files:")
                    # Sort by modification time, newest first
                    audio_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
                    # Show the 5 most recent files
                    for i, file in enumerate(audio_files[:5]):
                        mtime = datetime.fromtimestamp(os.path.getmtime(file))
                        print(f"  {i+1}. {os.path.basename(file)} - Modified: {mtime.isoformat()}")
            except Exception as e:
                print(f"ERROR: Failed to perform emergency file scan: {str(e)}")
        
        # Remove the temporary ARL file
        if os.path.exists(arl_file):
            os.remove(arl_file)
        
        if process.returncode != 0:
            print(f"Error running deemix CLI: {stderr}")
            raise Exception(f"deemix CLI failed with return code {process.returncode}")
        
        # Print the output for debugging
        print(stdout)
        
        # After copying files, check what's in the output directory
        print(f"Checking output directory for audio files: {output_path}")
        output_audio_files = []
        all_files = []
        
        for root, dirs, files in os.walk(output_path):
            print(f"Walking directory: {root}")
            print(f"Found files: {files}")
            for file in files:
                all_files.append(os.path.join(root, file))
                if file.endswith('.mp3') or file.endswith('.flac'):
                    print(f"Found audio file: {file}")
                    output_audio_files.append(os.path.join(root, file))
                else:
                    print(f"Non-audio file: {file}")
        
        print(f"All files in output directory: {all_files}")
        print(f"Audio files in output directory: {output_audio_files}")
        
        if not output_audio_files:
            print("Warning: No audio files were found in the output directory.")
            # This might be a warning rather than an error, as the process completed successfully
            # but we should still check why no files were downloaded
            return False
        else:
            print(f"Downloaded {len(output_audio_files)} audio files:")
            for file in output_audio_files:
                file_size_mb = os.path.getsize(file) / (1024 * 1024)
                print(f"  - {file} ({file_size_mb:.2f} MB)")
            
            # Create a file list for the web server to use
            print("\n=== METADATA GENERATION ===")
            print(f"[{datetime.now().isoformat()}] Generating metadata for {len(output_audio_files)} audio files")
            
            files_list_path = os.path.join(output_path, "files.json")
            print(f"Metadata file will be created at: {files_list_path}")
            
            # Create detailed file metadata
            file_metadata = []
            for index, file in enumerate(output_audio_files):
                file_basename = os.path.basename(file)
                file_size = os.path.getsize(file)
                file_ext = os.path.splitext(file)[1][1:]
                file_type = "audio/" + file_ext
                
                print(f"File {index + 1}:")
                print(f"  Full path: {file}")
                print(f"  Basename: {file_basename}")
                print(f"  Size: {file_size} bytes ({file_size / (1024 * 1024):.2f} MB)")
                print(f"  Extension: {file_ext}")
                print(f"  MIME type: {file_type}")
                
                # Check if the file is readable
                try:
                    with open(file, 'rb') as f:
                        # Just read a small chunk to verify the file is accessible
                        f.read(1024)
                    print(f"  File is readable: Yes")
                    file_readable = True
                except Exception as e:
                    print(f"  File is readable: No - {str(e)}")
                    file_readable = False
                
                file_metadata.append({
                    "path": file_basename,
                    "size": file_size,
                    "type": file_type,
                    "readable": file_readable
                })
            
            files_data = {"files": file_metadata}
            
            print(f"\nCreating files.json with the following content:")
            print(json.dumps(files_data, indent=2))
            
            try:
                with open(files_list_path, "w") as f:
                    json.dump(files_data, f, indent=2)
                print(f"SUCCESS: files.json created successfully at {files_list_path}")
            except Exception as e:
                print(f"ERROR: Failed to create files.json: {str(e)}")
            
            # Verify the files.json was created correctly
            if os.path.exists(files_list_path):
                try:
                    with open(files_list_path, 'r') as f:
                        content = f.read()
                        print(f"\nVerification - files.json content:")
                        print(content)
                        # Verify the JSON is valid
                        parsed = json.loads(content)
                        print(f"JSON validation: Success - parsed {len(parsed.get('files', []))} file entries")
                except Exception as e:
                    print(f"ERROR: files.json verification failed: {str(e)}")
            else:
                print(f"ERROR: files.json was not created at {files_list_path}")
        
        # Create a success file
        success_file = os.path.join(output_path, "download_complete.txt")
        with open(success_file, "w") as f:
            f.write(f"Download completed successfully\n")
            f.write(f"URL: {url}\n")
            f.write(f"Downloaded using deemix CLI\n")
        
        return True
    except Exception as e:
        # Create an error file
        error_file = os.path.join(output_path, "download_error.txt")
        with open(error_file, "w") as f:
            f.write(f"Error downloading from Deezer: {str(e)}\n")
            f.write(f"URL: {url}\n")
        return False

def main():
    parser = argparse.ArgumentParser(description='Download from Deezer or convert Spotify URL to Deezer')
    parser.add_argument('--url', required=True, help='URL to download (Deezer or Spotify)')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--arl', required=True, help='Deezer ARL token')
    
    args = parser.parse_args()
    
    # Create output directory if it doesn't exist
    os.makedirs(args.output, exist_ok=True)
    
    # Resolve short URL if needed
    url = args.url
    if 'dzr.page.link' in url:
        try:
            print(f"Resolving Deezer short URL: {url}")
            response = requests.get(url, allow_redirects=False)
            if 'Location' in response.headers:
                url = response.headers['Location']
                print(f"Resolved to: {url}")
        except Exception as e:
            print(f"Error resolving short URL: {e}")
            error_file = os.path.join(args.output, "url_resolution_error.txt")
            with open(error_file, "w") as f:
                f.write(f"Error resolving Deezer short URL: {str(e)}\n")
                f.write(f"URL: {url}\n")
            sys.exit(1)
    
    # Check if URL is Spotify or Deezer
    if "spotify.com" in url:
        # Convert Spotify URL to Deezer URL
        print(f"Converting Spotify URL to Deezer: {url}")
        deezer_url = search_deezer_for_spotify(url, args.output)
        
        if deezer_url:
            print(f"Found equivalent Deezer URL: {deezer_url}")
            # Download from Deezer
            success = download_from_deezer(deezer_url, args.output, args.arl)
            if success:
                print("Download completed successfully")
                sys.exit(0)
            else:
                print("Download failed")
                sys.exit(1)
        else:
            print("Could not find equivalent Deezer content")
            sys.exit(1)
    elif "deezer.com" in url:
        # Download directly from Deezer
        print(f"Downloading from Deezer: {url}")
        success = download_from_deezer(url, args.output, args.arl)
        if success:
            print("Download completed successfully")
            sys.exit(0)
        else:
            print("Download failed")
            sys.exit(1)
    else:
        print(f"Unsupported URL: {args.url}")
        error_file = os.path.join(args.output, "unsupported_url_error.txt")
        with open(error_file, "w") as f:
            f.write(f"Unsupported URL: {args.url}\n")
            f.write("Only Spotify and Deezer URLs are supported\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
