#!/usr/bin/env python3
"""
Patch for deemix Track.py to handle missing track_token_expire field
"""

import os
import sys
import traceback

def patch_track_py():
    """
    Patch the Track.py file to handle missing track_token_expire field
    """
    track_py_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 
                                "deemix-env/lib/python3.12/site-packages/deemix/types/Track.py")
    
    if not os.path.exists(track_py_path):
        print(f"Error: Track.py file not found at {track_py_path}")
        return False
    
    # Read the current content
    with open(track_py_path, 'r') as f:
        content = f.read()
    
    # Check if already patched
    if "# Patched to handle missing field" in content:
        print("Track.py is already patched.")
        return True
    
    # Replace the problematic lines
    replacements = [
        ("        self.trackTokenExpiration = trackAPI['track_token_expire']", 
         "        self.trackTokenExpiration = trackAPI.get('track_token_expire', 0)  # Patched to handle missing field"),
        ("        self.mediaVersion = trackAPI['media_version']", 
         "        self.mediaVersion = trackAPI.get('media_version', 0)  # Patched to handle missing field"),
        ("        self.filesizes = trackAPI['filesizes']", 
         "        self.filesizes = trackAPI.get('filesizes', {})  # Patched to handle missing field"),
        ("        self.trackToken = trackAPI['track_token']", 
         "        self.trackToken = trackAPI.get('track_token', '')  # Patched to handle missing field"),
        ("        self.MD5 = trackAPI.get('md5_origin')", 
         "        self.MD5 = trackAPI.get('md5_origin', '')  # Patched to handle missing field")
    ]
    
    patched_content = content
    for old_line, new_line in replacements:
        if old_line in patched_content:
            patched_content = patched_content.replace(old_line, new_line)
        else:
            print(f"Warning: Could not find line to patch: {old_line}")
    
    # Backup the original file
    backup_path = track_py_path + ".backup"
    with open(backup_path, 'w') as f:
        f.write(content)
    print(f"Created backup at {backup_path}")
    
    # Write the patched content
    with open(track_py_path, 'w') as f:
        f.write(patched_content)
    
    print(f"Successfully patched {track_py_path}")
    return True

if __name__ == "__main__":
    try:
        if patch_track_py():
            print("Patch applied successfully!")
            sys.exit(0)
        else:
            print("Failed to apply patch.")
            sys.exit(1)
    except Exception as e:
        print(f"Error: {str(e)}")
        traceback.print_exc()
        sys.exit(1)
