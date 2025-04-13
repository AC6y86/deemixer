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
        print("Checking for downloaded files in the default location...")
        audio_files = []
        for root, dirs, files in os.walk(default_download_location):
            for file in files:
                if file.endswith('.mp3') or file.endswith('.flac'):
                    # Check if this is a recent file (created in the last minute)
                    file_path = os.path.join(root, file)
                    file_creation_time = os.path.getctime(file_path)
                    if time.time() - file_creation_time < 60:  # If file was created in the last minute
                        audio_files.append(file_path)
        
        if audio_files:
            print(f"Found {len(audio_files)} recently downloaded audio files")
            for src_file in audio_files:
                # Copy the file to our output directory
                dest_file = os.path.join(output_path, os.path.basename(src_file))
                print(f"Copying {src_file} to {dest_file}")
                import shutil
                shutil.copy2(src_file, dest_file)
        
        # Remove the temporary ARL file
        if os.path.exists(arl_file):
            os.remove(arl_file)
        
        if process.returncode != 0:
            print(f"Error running deemix CLI: {stderr}")
            raise Exception(f"deemix CLI failed with return code {process.returncode}")
        
        # Print the output for debugging
        print(stdout)
        
        # Check if any audio files were downloaded
        audio_files = []
        for root, dirs, files in os.walk(output_path):
            for file in files:
                if file.endswith('.mp3') or file.endswith('.flac'):
                    audio_files.append(os.path.join(root, file))
        
        if not audio_files:
            print("Warning: No audio files were found in the output directory.")
            # This might be a warning rather than an error, as the process completed successfully
            # but we should still check why no files were downloaded
        else:
            print(f"Downloaded {len(audio_files)} audio files:")
            for file in audio_files:
                file_size_mb = os.path.getsize(file) / (1024 * 1024)
                print(f"  - {file} ({file_size_mb:.2f} MB)")
        
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
