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
from pathlib import Path
import requests
from deemix.app.cli import downloadLink

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

def download_from_deezer(url, output_path, arl):
    """
    Download a track/album/playlist from Deezer using deemix.
    """
    try:
        # Create output directory if it doesn't exist
        os.makedirs(output_path, exist_ok=True)
        
        # Create a status file to indicate download has started
        status_file = os.path.join(output_path, "download_started.txt")
        with open(status_file, "w") as f:
            f.write(f"Download started at {os.path.basename(output_path)}\n")
            f.write(f"URL: {url}\n")
        
        # Call deemix to download the content
        downloadLink(url, arl, output_path, quality="FLAC")
        
        # Create a success file
        success_file = os.path.join(output_path, "download_complete.txt")
        with open(success_file, "w") as f:
            f.write(f"Download completed successfully\n")
            f.write(f"URL: {url}\n")
        
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
    
    # Check if URL is Spotify or Deezer
    if "spotify.com" in args.url:
        # Convert Spotify URL to Deezer URL
        print(f"Converting Spotify URL to Deezer: {args.url}")
        deezer_url = search_deezer_for_spotify(args.url, args.output)
        
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
    elif "deezer.com" in args.url:
        # Download directly from Deezer
        print(f"Downloading from Deezer: {args.url}")
        success = download_from_deezer(args.url, args.output, args.arl)
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
