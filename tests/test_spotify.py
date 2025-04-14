#!/usr/bin/env python3
"""
Spotify Integration Test
----------------------
This script tests the Spotify download functionality with a Spotify URL.
"""

import os
import sys
import json
import argparse
import requests
import traceback
from pathlib import Path

def test_spotify_url(url, output_path):
    """
    Test downloading from a Spotify URL.
    
    Args:
        url: Spotify URL to test
        output_path: Directory to save downloaded files
    
    Returns:
        success: True if download was successful, False otherwise
    """
    print(f"Testing Spotify URL: {url}")
    
    # Create output directory if it doesn't exist
    os.makedirs(output_path, exist_ok=True)
    
    try:
        # If it's a short URL, resolve it first
        if "spotify.link" in url:
            print("Resolving Spotify short URL...")
            response = requests.head(url, allow_redirects=True)
            if response.status_code == 200:
                resolved_url = response.url
                print(f"Resolved to: {resolved_url}")
                url = resolved_url
            else:
                print(f"Failed to resolve Spotify short URL. Status code: {response.status_code}")
                return False
        
        # Extract track ID from URL
        track_id = None
        if "track/" in url:
            parts = url.split("track/")
            if len(parts) > 1:
                track_id = parts[1].split("?")[0]
                print(f"Extracted Spotify track ID: {track_id}")
        
        if not track_id:
            print("Failed to extract track ID from URL")
            return False
        
        # Create a marker file to indicate download started
        start_file = os.path.join(output_path, "download_started.txt")
        with open(start_file, "w") as f:
            f.write(f"Download started for Spotify track: {url}\nTrack ID: {track_id}\n")
        
        # In a real implementation, we would use a Spotify API client here
        # For this test, we'll simulate the download process
        
        print("Simulating Spotify download process...")
        print("Searching for track on music services...")
        print("Finding best quality source...")
        
        # Check if the download was successful by looking for audio files
        print("\nChecking for downloaded files...")
        downloaded_files = []
        for root, dirs, files in os.walk(output_path):
            for file in files:
                if file.endswith(('.mp3', '.flac', '.m4a')):
                    downloaded_files.append(os.path.join(root, file))
        
        if downloaded_files:
            print(f"Found {len(downloaded_files)} downloaded audio files:")
            for file in downloaded_files:
                print(f"  - {file}")
                # Get file size
                file_size = os.path.getsize(file)
                print(f"    Size: {file_size / (1024*1024):.2f} MB")
            
            # Create a files.json to record the downloaded files
            files_json = {
                "files": [
                    {
                        "path": os.path.basename(file),
                        "size": os.path.getsize(file)
                    } for file in downloaded_files
                ]
            }
            
            with open(os.path.join(output_path, "files.json"), "w") as f:
                json.dump(files_json, f, indent=2)
            
            return True
        else:
            print("No audio files were found in the output directory.")
            
            # Create an error file to indicate download failed
            error_file = os.path.join(output_path, "download_error.txt")
            with open(error_file, "w") as f:
                f.write("Download failed. No audio files found.\n")
                f.write("This could be due to:\n")
                f.write("1. The track is not available for download\n")
                f.write("2. The Spotify integration is not yet fully implemented\n")
            
            print("\nNOTE: Spotify integration is currently being developed.")
            print("The full Spotify download functionality will be available in a future update.")
            return False
            
    except Exception as e:
        print(f"Error: {str(e)}")
        traceback.print_exc()
        
        # Create an error file to record the exception
        error_file = os.path.join(output_path, "download_error.txt")
        with open(error_file, "w") as f:
            f.write(f"Download failed with error: {str(e)}\n")
            f.write(traceback.format_exc())
        
        return False

def main():
    parser = argparse.ArgumentParser(description='Test downloading from Spotify')
    parser.add_argument('--url', required=True, help='Spotify URL to test')
    parser.add_argument('--output', required=True, help='Output directory')
    
    args = parser.parse_args()
    
    success = test_spotify_url(args.url, args.output)
    
    if success:
        print("Test completed successfully")
        sys.exit(0)
    else:
        print("Test failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
