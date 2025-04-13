#!/usr/bin/env python3
"""
Simple test script to download from Deezer using the command line interface
"""

import os
import sys
import argparse
from pathlib import Path

from deemix.app.cli import downloadLink
from deemix.utils.localpaths import getConfigFolder
from deemix.settings import load as loadSettings

def main():
    parser = argparse.ArgumentParser(description='Test Deezer download with simple approach')
    parser.add_argument('--url', required=True, help='Deezer URL to download')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--arl', required=True, help='Deezer ARL token')
    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output, exist_ok=True)

    # Load settings from config
    configFolder = getConfigFolder()
    print(f"Using config folder: {configFolder}")
    settings = loadSettings(configFolder)
    
    # Print important settings
    print(f"BitRate setting: {settings.get('maxBitrate')}")
    print(f"Download location: {settings.get('downloadLocation')}")
    
    # Override download location with our output
    original_location = settings.get('downloadLocation')
    settings['downloadLocation'] = args.output
    
    # Save modified settings to ensure they're used
    with open(os.path.join(configFolder, 'config.json'), 'r') as f:
        current_config = f.read()
    print(f"Backing up original config...")
    with open(os.path.join(configFolder, 'config.json.bak'), 'w') as f:
        f.write(current_config)
    
    # Write new config with our output path
    import json
    with open(os.path.join(configFolder, 'config.json'), 'w') as f:
        json.dump(settings, f, indent=2)
    
    try:
        print(f"Downloading from {args.url} to {args.output}...")
        # Try different bitrates explicitly
        bitrates = ["MP3_128", "MP3_320", "FLAC"]
        success = False
        
        for bitrate in bitrates:
            try:
                print(f"Trying download with bitrate {bitrate}...")
                downloadLink(args.url, args.arl, args.output, bitrate)
                success = True
                print(f"Download with {bitrate} succeeded!")
                break
            except Exception as e:
                print(f"Failed with bitrate {bitrate}: {str(e)}")
        
        if not success:
            print("All bitrate attempts failed")
    finally:
        # Restore original config
        print(f"Restoring original config...")
        with open(os.path.join(configFolder, 'config.json.bak'), 'r') as f:
            original_config = f.read()
        with open(os.path.join(configFolder, 'config.json'), 'w') as f:
            f.write(original_config)
    
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
