#!/usr/bin/env python3
"""
Proper test script for deemix using available functions in this version
"""

import os
import sys
import argparse
import time
import json
import requests
from pathlib import Path

# Import the functions that are actually available
import deemix
from deemix.downloader import Downloader
from deemix import parseLink
from deemix import generateDownloadObject
from deemix.settings import load as loadSettings
from deemix.utils.localpaths import getConfigFolder
from deezer import Deezer

# Simple event listener to capture download events
class LogListener:
    def send(self, key, value=None):
        print(f"Event: {key}, Data: {value}")

def main():
    parser = argparse.ArgumentParser(description='Proper Deezer download test')
    parser.add_argument('--url', required=True, help='Deezer URL to download')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--arl', required=True, help='Deezer ARL token')
    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output, exist_ok=True)

    print(f"Testing URL: {args.url}")
    
    # Load settings
    configFolder = getConfigFolder()
    print(f"Using config folder: {configFolder}")
    settings = loadSettings(configFolder)
    
    # Modify settings for this download
    settings['downloadLocation'] = args.output
    print(f"BitRate setting: {settings.get('maxBitrate')}")
    
    # Initialize API
    dz = Deezer()
    dz.login_via_arl(args.arl)
    
    # Get session info
    try:
        session = dz.session
        print(f"Session Info:")
        print(f"  Country: {session.get('country')}")
        print(f"  License: {session.get('license')}")
        print(f"  Logged: {session.get('logged')}")
        
        # Check if premium
        if 'USER' in session:
            print(f"  User Type: {session['USER'].get('USER_TYPE')}")
            print(f"  Is Premium: {session['USER'].get('PREMIUM')}")
    except Exception as e:
        print(f"Error getting session info: {e}")
    
    # Resolve short URL if needed
    actual_url = args.url
    if 'dzr.page.link' in args.url:
        try:
            print(f"Resolving Deezer short URL...")
            response = requests.get(args.url, allow_redirects=False)
            if 'Location' in response.headers:
                actual_url = response.headers['Location']
                print(f"Resolved to: {actual_url}")
        except Exception as e:
            print(f"Error resolving short URL: {e}")
            return
    
    # Parse the link
    try:
        print(f"Parsing link: {actual_url}")
        link_info = parseLink(actual_url)
        print(f"Link info: {link_info}")
        
        link_type = link_info[1] 
        link_id = link_info[2]
        print(f"Link type: {link_type}, Link ID: {link_id}")
    except Exception as e:
        print(f"Error parsing link: {e}")
        return
    
    # Create listener for events
    listener = LogListener()
    
    try:
        # Generate the track/album/playlist item
        if link_type == 'track':
            print(f"Generating track item...")
            track = dz.api.get_track(link_id)
            print(f"Track info: {json.dumps(track, indent=2)}")
            
            # Create download object
            download_object = generateDownloadObject(dz, link_type, link_id, settings['bitrate'])
            
            # Create downloader
            downloader = Downloader(dz, [download_object], settings, listener)
            
            # Start the download
            print(f"Starting download...")
            downloader.start()
            
            # Wait for the download to complete
            while downloader.is_running():
                time.sleep(0.5)
            
            print(f"Download completed successfully")
        else:
            print(f"Non-track links not fully implemented in this test")
    except Exception as e:
        print(f"Error during download: {e}")
    
    # Check if files were actually downloaded
    found_files = []
    for root, dirs, files in os.walk(args.output):
        for file in files:
            if file.endswith('.mp3') or file.endswith('.flac'):
                found_files.append(os.path.join(root, file))
    
    if found_files:
        print(f"Downloaded files:")
        for file in found_files:
            print(f"  {file}")
    else:
        print("No audio files were found in the output directory.")
        print("Checking for error files...")
        
        # Check if we have error files
        for root, dirs, files in os.walk(args.output):
            for file in files:
                if file.endswith('.error'):
                    print(f"  Error file found: {file}")
        
        print("\nNOTE: If you're seeing 'Track not yet encoded and no alternative found!' errors,")
        print("this usually means one of the following:")
        print("1. The ARL token does not have the necessary permissions or subscription level")
        print("2. The track is not available in your region")
        print("3. The track is not available for download through the Deezer API")
        print("\nTry using a different ARL token with a premium Deezer subscription,")
        print("or try a different track that is available in your region.")

if __name__ == "__main__":
    main()
