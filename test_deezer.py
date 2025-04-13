#!/usr/bin/env python3
"""
Deezer Integration Test
----------------------
This script tests the deemix library with a Deezer URL.
"""

import os
import sys
import json
import argparse
from pathlib import Path
import requests
import traceback

# Import deemix libraries
from deezer import Deezer
import deemix
from deemix.settings import load as loadSettings
from deemix.downloader import Downloader
from deemix.types.DownloadObjects import Single, Collection

def test_deezer_url(url, output_path, arl):
    """
    Test downloading from a Deezer URL using deemix.
    """
    print(f"Testing Deezer URL: {url}")
    
    # Create output directory if it doesn't exist
    os.makedirs(output_path, exist_ok=True)
    
    try:
        # If it's a short URL, resolve it first
        if "dzr.page.link" in url:
            print("Resolving Deezer short URL...")
            response = requests.head(url, allow_redirects=True)
            if response.status_code == 200:
                resolved_url = response.url
                print(f"Resolved to: {resolved_url}")
                url = resolved_url
            else:
                print(f"Failed to resolve Deezer short URL. Status code: {response.status_code}")
                return False
        
        # Initialize Deezer API
        print("Initializing Deezer API...")
        dz = Deezer()
        dz.login_via_arl(arl)
        
        # Check if login was successful
        if not dz.logged_in:
            print("Failed to log in with the provided ARL token")
            return False
        
        print("Successfully logged in to Deezer")
        
        # Print user info to help debug ARL token issues
        try:
            user_info = dz.api.get_user()
            print(f"Logged in as: {user_info.get('name', 'Unknown')}")
            print(f"User ID: {user_info.get('id', 'Unknown')}")
            print(f"Country: {user_info.get('country', 'Unknown')}")
            print(f"Subscription type: {user_info.get('type', 'Unknown')}")
        except Exception as e:
            print(f"Warning: Could not get user info: {str(e)}")
        
        # Parse the link
        print(f"Parsing link: {url}")
        link_info = deemix.parseLink(url)
        print(f"Link info: {link_info}")
        
        if not link_info:
            print(f"Couldn't recognize the link: {url}")
            return False
        
        # Load settings
        print("Loading settings...")
        settings = loadSettings()
        settings['downloadLocation'] = output_path
        settings['tracknameTemplate'] = '%artist% - %title%'
        settings['albumTracknameTemplate'] = '%number% - %title%'
        settings['playlistTracknameTemplate'] = '%position% - %artist% - %title%'
        settings['createPlaylistFolder'] = True
        settings['createArtistFolder'] = True
        settings['createAlbumFolder'] = True
        settings['createSingleFolder'] = False
        settings['quality'] = 'FLAC'
        settings['fallbackQuality'] = True
        
        # Create a listener class to handle events
        class LogListener:
            def send(self, name, data=None):
                print(f"Event: {name}, Data: {data}")
        
        # Initialize the downloader with proper download objects
        print("Initializing downloader...")
        listener = LogListener()
        
        # Get the link type and ID
        # deemix.parseLink returns a tuple: (full_url, type, id)
        _, link_type, link_id = link_info
        
        print(f"Link type: {link_type}, Link ID: {link_id}")
        
        # Start the download based on link type
        if link_type == 'track':
            print("Downloading track...")
            # Get track info
            track = dz.api.get_track(link_id)
            print(f"Track info: {json.dumps(track, indent=2)}")
            
            # Create proper Single download object
            download_obj = Single({
                'type': 'track',
                'id': link_id,
                'bitrate': 3,  # MP3_320
                'title': track['title'],
                'artist': track['artist']['name'],
                'cover': track.get('album', {}).get('cover_xl', ''),
                'explicit': track.get('explicit_lyrics', False),
                'single': {
                    'trackAPI': track,
                    'albumAPI': track.get('album', {}),
                    'artistAPI': track.get('artist', {})
                }
            })
            
            # Initialize downloader with the proper object
            downloader = Downloader(dz, download_obj, settings, listener)
            downloader.start()
            
        elif link_type == 'album':
            print("Downloading album...")
            # Get album info
            album = dz.api.get_album(link_id)
            print(f"Album info: {json.dumps(album, indent=2)}")
            
            # Create proper Collection download object
            download_obj = Collection({
                'type': 'album',
                'id': link_id,
                'bitrate': 3,  # MP3_320
                'title': album['title'],
                'artist': album.get('artist', {}).get('name', 'Various Artists'),
                'cover': album.get('cover_xl', ''),
                'explicit': album.get('explicit_lyrics', False),
                'collection': {
                    'albumAPI': album,
                    'artistAPI': album.get('artist', {})
                }
            })
            
            # Initialize downloader with the proper object
            downloader = Downloader(dz, download_obj, settings, listener)
            downloader.start()
            
        elif link_type == 'playlist':
            print("Downloading playlist...")
            # Get playlist info
            playlist = dz.api.get_playlist(link_id)
            print(f"Playlist info: {json.dumps(playlist, indent=2)}")
            
            # Create proper Collection download object
            download_obj = Collection({
                'type': 'playlist',
                'id': link_id,
                'bitrate': 3,  # MP3_320
                'title': playlist['title'],
                'artist': playlist.get('creator', {}).get('name', 'Various Artists'),
                'cover': playlist.get('picture_xl', ''),
                'explicit': False,
                'collection': {
                    'playlistAPI': playlist
                }
            })
            
            # Initialize downloader with the proper object
            downloader = Downloader(dz, download_obj, settings, listener)
            downloader.start()
        else:
            print(f"Unsupported link type: {link_type}")
            return False
        
        print("Download completed successfully")
        
        # Check if any files were actually downloaded
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
            return True
        else:
            print("No audio files were found in the output directory.")
            print("Checking for error files...")
            error_files = [f for f in os.listdir(output_path) if f.endswith('.txt') and 'error' in f]
            for error_file in error_files:
                with open(os.path.join(output_path, error_file), 'r') as f:
                    print(f"Content of {error_file}:")
                    print(f.read())
            
            print("\nNOTE: If you're seeing 'Track not yet encoded and no alternative found!' errors,")
            print("this usually means one of the following:")
            print("1. The ARL token does not have the necessary permissions or subscription level")
            print("2. The track is not available in your region")
            print("3. The track is not available for download through the Deezer API")
            print("\nTry using a different ARL token with a premium Deezer subscription,")
            print("or try a different track that is available in your region.")
            return False
    except Exception as e:
        print(f"Error: {str(e)}")
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser(description='Test downloading from Deezer')
    parser.add_argument('--url', required=True, help='Deezer URL to test')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--arl', required=True, help='Deezer ARL token')
    
    args = parser.parse_args()
    
    success = test_deezer_url(args.url, args.output, args.arl)
    
    if success:
        print("Test completed successfully")
        sys.exit(0)
    else:
        print("Test failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
