#!/usr/bin/env python3
"""
Test script that mimics how deemix GUI works to download a track
"""

import os
import sys
import re
import json
from pathlib import Path
import time
import argparse

from deezer import Deezer
from deemix.utils.localpaths import getConfigFolder
from deemix.settings import load as loadSettings
from deemix.downloader import Downloader
from deemix.utils import generateDownloadObject
from deemix.utils import formatListener
from deemix.itemgen import generateItems, GenerationError

class LogListener:
    def send(self, key, value=None):
        print(f"Event: {key}, Data: {value}")

def main():
    parser = argparse.ArgumentParser(description='Test Deezer download with GUI-like approach')
    parser.add_argument('--url', required=True, help='Deezer URL to download')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--arl', required=True, help='Deezer ARL token')
    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output, exist_ok=True)

    # Load settings from the same config folder as the GUI
    configFolder = getConfigFolder()
    print(f"Using config folder: {configFolder}")
    settings = loadSettings(configFolder)
    
    # Override the download path with our specified output
    settings['downloadLocation'] = args.output
    print(f"BitRate setting: {settings.get('maxBitrate')}")
    
    # Initialize the same objects the GUI uses
    dz = Deezer()
    listener = LogListener()
    downloadObjects = []
    
    # Login with ARL
    print(f"Logging in with ARL...")
    dz.login_via_arl(args.arl)
    print(f"Login successful")
    
    # Try to get account info
    try:
        user = dz.user
        if user:
            print(f"User data: {user}")
    except Exception as e:
        print(f"Could not get user info: {e}")
    
    try:
        session = dz.session
        if session:
            print(f"Session info:")
            print(f"  License: {session.get('license_token', 'None')}")
            print(f"  Logged in: {session.get('logged', False)}")
            print(f"  Country: {session.get('country', 'Unknown')}")
    except Exception as e:
        print(f"Could not get session info: {e}")
        
    # Generate download object from URL (just like GUI does)
    try:
        print(f"Generating items for URL: {args.url}")
        items = generateItems(dz, args.url, settings['fallbackSearch'])
        for item in items:
            downloadObject = generateDownloadObject(dz, item, settings['bitrate'])
            downloadObjects.append(downloadObject)
    except GenerationError as e:
        print(f"Error generating items: {e}")
        return
    except Exception as e:
        print(f"Unexpected error generating items: {e}")
        return
    
    if not downloadObjects:
        print("No download objects were generated")
        return
    
    # Create and configure downloader
    downloader = Downloader(dz, downloadObjects, settings, listener)
    
    # Start the downloader
    print(f"Starting download...")
    downloader.start()
    downloader.downloadAll()
    
    # Wait for downloads to complete
    while downloader.is_running():
        time.sleep(1)
    
    print("Download process complete")
    
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
        print("No audio files were downloaded")

if __name__ == "__main__":
    main()
