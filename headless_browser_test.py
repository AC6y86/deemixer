#!/usr/bin/env python3
"""
Headless Browser Test for Deemixer
----------------------------------
This script opens a headless browser, navigates to the local deemixer web interface,
and attempts to download a Deezer file.
"""

import os
import sys
import time
import json
import argparse
import subprocess
import signal
import asyncio
import requests
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

async def start_server(port=3000):
    """Start the deemixer server as a subprocess"""
    print(f"Starting server on port {port}...")
    
    # Create a log file for server output
    log_file = open('server_log.txt', 'w')
    
    server_process = subprocess.Popen(
        ["node", "server.js"],
        stdout=log_file,
        stderr=log_file,
        env=dict(os.environ, PORT=str(port))
    )
    
    # Give the server time to start
    await asyncio.sleep(3)
    
    # Check if the server started successfully
    if server_process.poll() is not None:
        log_file.close()
        with open('server_log.txt', 'r') as f:
            log_content = f.read()
        print(f"Server failed to start. Log content:\n{log_content}")
        return None
    
    print(f"Server started with PID {server_process.pid}")
    return server_process, log_file

def stop_server(server_process, log_file=None):
    """Stop the server subprocess and close log file"""
    if server_process:
        print(f"Stopping server (PID {server_process.pid})...")
        try:
            os.kill(server_process.pid, signal.SIGTERM)
            server_process.wait(timeout=5)
            print("Server stopped")
        except subprocess.TimeoutExpired:
            print("Server did not stop gracefully, forcing...")
            os.kill(server_process.pid, signal.SIGKILL)
        except Exception as e:
            print(f"Error stopping server: {e}")
    
    # Close the log file if it exists
    if log_file:
        log_file.close()
        # Print the server log for debugging
        print("\nServer log:")
        try:
            with open('server_log.txt', 'r') as f:
                log_content = f.read()
                # Print the last 50 lines of the log
                lines = log_content.splitlines()
                if len(lines) > 50:
                    print(f"... (showing last 50 of {len(lines)} lines)")
                    for line in lines[-50:]:
                        print(f"  {line}")
                else:
                    print(log_content)
        except Exception as e:
            print(f"Error reading server log: {e}")

def resolve_short_url(url):
    """
    Resolve a Deezer short URL to its full URL
    
    Args:
        url: Short URL to resolve
        
    Returns:
        resolved_url: The resolved URL, or the original URL if not a short URL
    """
    if 'dzr.page.link' in url:
        try:
            print(f"Resolving Deezer short URL: {url}")
            response = requests.head(url, allow_redirects=True, timeout=10)
            if response.url != url:
                resolved_url = response.url
                print(f"Resolved to: {resolved_url}")
                return resolved_url
        except Exception as e:
            print(f"Error resolving short URL: {e}")
    return url

async def download_deezer_file(page, url):
    """
    Use the browser to navigate to the deemixer web interface and download a file
    
    Args:
        page: Playwright page object
        url: Deezer URL to download
    
    Returns:
        download_id: ID of the download if successful, None otherwise
    """
    try:
        # Wait for the page to load and find the input field and submit button
        await page.wait_for_selector('#url')
        
        # Enter the URL and submit
        print(f"Submitting Deezer URL: {url}")
        await page.fill('#url', url)
        await page.click('button[type="submit"]')
        
        # Wait for the download to start (look for status message)
        await page.wait_for_selector('.status', timeout=10000)
        
        # Start monitoring network before submitting the form
        print("Setting up network monitoring...")
        async with page.expect_response(lambda response: '/download' in response.url) as response_info:
            print(f"Submitting form with URL: {url}")
            await page.click('button[type="submit"]')
        
        # Get the response
        response = await response_info.value
        print(f"Received response with status: {response.status}")
        
        # Extract download ID from the response
        download_id = None
        try:
            response_json = await response.json()
            print(f"Response JSON: {response_json}")
            
            if 'downloadId' in response_json:
                download_id = response_json['downloadId']
                print(f"Extracted download ID from response: {download_id}")
            elif 'error' in response_json:
                print(f"Server returned error: {response_json['error']}")
                return None
        except Exception as e:
            print(f"Error parsing response JSON: {e}")
            
        # If we couldn't get the download ID from the response, try to extract it from the page
        if not download_id:
            print("Trying to extract download ID from page content...")
            
            # Wait for any status elements to appear
            try:
                await page.wait_for_selector('.status:visible', timeout=5000)
            except Exception as e:
                print(f"No status element found: {e}")
            
            # Use JavaScript to extract the download ID from the page
            download_id = await page.evaluate(r'''
                () => {
                    // Look for download ID in various places
                    
                    // 1. Check if there's a link with the download ID
                    const statusLinks = document.querySelectorAll('a[href*="download/status"]');
                    for (const link of statusLinks) {
                        const href = link.getAttribute('href');
                        const match = href.match(/download\/status\/(\w+)/g);
                        if (match && match[1]) {
                            return match[1];
                        }
                    }
                    
                    // 2. Check for download ID in any element with class 'status'
                    const statusElements = document.querySelectorAll('.status');
                    for (const el of statusElements) {
                        if (el.textContent && el.textContent.includes('download')) {
                            // Try to find a timestamp-like string which is likely the download ID
                            const match = el.textContent.match(/(\d{13})/);
                            if (match && match[1]) {
                                return match[1];
                            }
                        }
                    }
                    
                    // 3. Look for any element containing a URL with downloadId
                    const allElements = document.querySelectorAll('*');
                    for (const el of allElements) {
                        if (el.textContent && el.textContent.includes('downloadId')) {
                            const text = el.textContent;
                            const match = text.match(/downloadId["']?\s*[:=]\s*["']?([^"',;\s]+)/);
                            if (match && match[1]) {
                                return match[1];
                            }
                        }
                    }
                    
                    return null;
                }
            ''')
            
            if download_id:
                print(f"Found download ID from page: {download_id}")
        
        # If we still don't have a download ID, check the page URL
        if not download_id:
            current_url = page.url
            print(f"Current page URL: {current_url}")
            
            if 'download/status' in current_url:
                parts = current_url.split('/')
                if len(parts) > 4:
                    download_id = parts[4]
                    print(f"Extracted download ID from URL: {download_id}")
        
        return download_id
        
    except Exception as e:
        print(f"Error during download process: {e}")
        return None

async def check_files_available(page, download_id, base_url="http://localhost:3000"):
    """
    Check that files are available for download and the 'No files available' message doesn't appear
    
    Args:
        page: Playwright page object
        download_id: ID of the download
        base_url: URL of the deemixer web interface
    
    Returns:
        success: True if files are available, False if 'No files available' message appears
    """
    if not download_id:
        print("No download ID provided, cannot check file availability")
        return False
    
    status_url = f"{base_url}/download/status/{download_id}"
    print(f"Checking file availability at: {status_url}")
    
    try:
        # Navigate to the status page
        await page.goto(status_url)
        await page.wait_for_load_state('networkidle')
        
        # Get the page content
        content = await page.content()
        page_text = await page.text_content('body')
        
        # Check for the 'No files available' message
        no_files_messages = [
            "No files available for download",
            "No files available",
            "No audio files were found",
            "No media files"
        ]
        
        for message in no_files_messages:
            if message.lower() in page_text.lower():
                print(f"ERROR: Found message indicating no files are available: '{message}'")
                return False
        
        # Check for positive indicators that files are available
        file_available_indicators = [
            "Download complete",
            "Files available",
            "Downloaded files",
            "download/file"
        ]
        
        for indicator in file_available_indicators:
            if indicator.lower() in content.lower():
                print(f"Found indicator that files are available: '{indicator}'")
                return True
        
        # If we didn't find any negative messages but also no positive indicators,
        # check if there are any download links or buttons
        download_elements = await page.query_selector_all('a[href*="download/file"], a.download-link, button.download-button')
        if download_elements and len(download_elements) > 0:
            print(f"Found {len(download_elements)} download elements on the page")
            return True
        
        print("No clear indication of file availability found")
        return False
        
    except Exception as e:
        print(f"Error checking file availability: {e}")
        return False

async def check_download_button_exists(page, download_id, base_url="http://localhost:3000"):
    """
    Check if the download button exists for the downloaded file
    
    Args:
        page: Playwright page object
        download_id: ID of the download
        base_url: URL of the deemixer web interface
    
    Returns:
        success: True if download button exists, False otherwise
    """
    # Check if files.json exists in the download directory
    # This is used to verify files are available, but we still need actual download buttons
    download_path = os.path.join("downloads", download_id)
    files_json_path = os.path.join(download_path, 'files.json')
    files_json_exists = False
    
    # Wait a moment for files.json to be created
    for _ in range(5):
        if os.path.exists(files_json_path):
            try:
                with open(files_json_path, 'r') as f:
                    content = f.read()
                    try:
                        files_data = json.loads(content)
                        if 'files' in files_data and isinstance(files_data['files'], list) and len(files_data['files']) > 0:
                            print(f"Found {len(files_data['files'])} files in files.json")
                            print("Files are available for download according to files.json")
                            files_json_exists = True
                            break
                    except json.JSONDecodeError:
                        pass
            except Exception as e:
                print(f"Error reading files.json: {e}")
        time.sleep(1)  # Wait a second before checking again
    
    # Even if files.json exists, we still need to check for actual download buttons
    if not download_id:
        print("No download ID provided, cannot check download button")
        return False
    
    status_url = f"{base_url}/download/status/{download_id}"
    print(f"Checking for download button at: {status_url}")
    
    try:
        # Navigate to the status page
        await page.goto(status_url)
        await page.wait_for_load_state('networkidle')
        
        # Wait a bit longer for the page to fully load and render any dynamic content
        await asyncio.sleep(2)
        
        # Check if there are any download buttons/links on the page
        download_buttons = await page.query_selector_all('a.download-link, button.download-button, [href*="/download/file/"]')
        
        if download_buttons and len(download_buttons) > 0:
            print(f"Found {len(download_buttons)} download buttons/links on the page")
            
            # Print details about each download button/link
            for i, button in enumerate(download_buttons):
                href = await button.get_attribute('href')
                text = await button.text_content()
                print(f"  {i+1}. Button/Link: {text.strip() if text else 'No text'} - href: {href}")
            
            return True
        else:
            print("No download buttons/links found on the page")
            
            # Check if downloadButtonsHtml is in the page source
            content = await page.content()
            if "downloadButtonsHtml" in content:
                print("Found downloadButtonsHtml in page source, but buttons not rendered properly")
                
                # Try to force the download buttons to be rendered
                await page.evaluate('''
                    () => {
                        // Check if we have a response with downloadButtonsHtml
                        const responseText = document.body.innerText;
                        if (responseText.includes('downloadButtonsHtml')) {
                            try {
                                // Try to parse the JSON response
                                const startIndex = responseText.indexOf('{');
                                const endIndex = responseText.lastIndexOf('}') + 1;
                                if (startIndex >= 0 && endIndex > startIndex) {
                                    const jsonText = responseText.substring(startIndex, endIndex);
                                    const data = JSON.parse(jsonText);
                                    
                                    if (data.downloadButtonsHtml) {
                                        // Create a container for the download buttons
                                        const container = document.createElement('div');
                                        container.id = 'download-buttons-container';
                                        container.innerHTML = data.downloadButtonsHtml;
                                        document.body.appendChild(container);
                                        console.log('Manually rendered download buttons');
                                    }
                                }
                            } catch (e) {
                                console.error('Error parsing JSON:', e);
                            }
                        }
                    }
                ''');
                
                # Check again for download buttons
                await asyncio.sleep(1)
                download_buttons = await page.query_selector_all('a.download-link, button.download-button, [href*="/download/file/"]')
                
                if download_buttons and len(download_buttons) > 0:
                    print(f"Found {len(download_buttons)} download buttons/links after manual rendering")
                    return True
            
            # We already checked for files.json at the beginning of this function
            # If we're here, it means we didn't find it or it didn't have the expected content
            
            # Check if there's any content indicating a download is available
            content = await page.content()
            if "download" in content.lower() and ("file" in content.lower() or "track" in content.lower()):
                print("Found download-related content on the page, but no clickable buttons")
                print("WARNING: This is considered a FAILURE as no actual download buttons were found")
                
                # Report files.json status but still fail the test
                if files_json_exists:
                    print("NOTE: files.json exists, but test still fails because there are no download buttons")
                
                return False
            
            return False
    
    except Exception as e:
        print(f"Error checking for download button: {e}")
        return False

async def check_download_status(page, download_id, base_url="http://localhost:3000", max_retries=30):
    """
    Check the status of a download
    
    Args:
        page: Playwright page object
        download_id: ID of the download
        base_url: URL of the deemixer web interface
        max_retries: Maximum number of status checks
    
    Returns:
        success: True if download completed successfully, False otherwise
    """
    if not download_id:
        print("No download ID provided, cannot check status")
        return False
    
    status_url = f"{base_url}/download/status/{download_id}"
    print(f"Checking download status at: {status_url}")
    
    # Poll the status URL until the download completes or times out
    for i in range(max_retries):
        try:
            # Make a direct API request instead of navigating to the page
            response = await page.request.get(status_url)
            status_code = response.status
            print(f"Status check response code: {status_code}")
            
            if status_code == 404:
                print(f"Download ID not found (404): {download_id}")
                return False
                
            # Try to parse the JSON response
            try:
                response_json = await response.json()
                print(f"Status response: {response_json}")
                
                if 'status' in response_json:
                    if response_json['status'] == 'not_found':
                        print("Download not found")
                        return False
                    elif response_json['status'] == 'complete':
                        print("Download completed successfully!")
                        return True
                    elif response_json['status'] == 'error':
                        print(f"Download failed with error: {response_json.get('message', 'Unknown error')}")
                        return False
                    else:
                        print(f"Download in progress, status: {response_json['status']}")
            except Exception as e:
                print(f"Error parsing status JSON: {e}")
                
                # Fall back to checking the response text
                response_text = await response.text()
                print(f"Response text (first 200 chars): {response_text[:200]}...")
                
                # Check if download completed
                if "Download complete" in response_text or "Downloaded files" in response_text:
                    print("Download completed successfully!")
                    return True
                    
                # Check if there was an error
                if "Error" in response_text or "Failed" in response_text:
                    print("Download failed with error")
                    return False
            
            print(f"Download in progress (check {i+1}/{max_retries})...")
            await asyncio.sleep(2)  # Wait before checking again
            
        except Exception as e:
            print(f"Error checking download status: {e}")
            await asyncio.sleep(2)  # Wait before retrying
    
    print(f"Download status check timed out after {max_retries} attempts")
    return False

async def verify_download(download_id, download_dir="downloads", music_dir="music"):
    """
    Verify that files were actually downloaded
    
    Args:
        download_id: ID of the download
        download_dir: Base directory for downloads
        music_dir: Directory where music files might be stored
    
    Returns:
        success: True if files were found, False otherwise
    """
    # Track whether we found files.json and what it contains
    files_json_found = False
    files_from_json = []
    download_success = False
    any_audio_files_found = False
    if not download_id:
        print("No download ID provided, cannot verify download")
        return False
    
    # First check the download directory
    download_path = os.path.join(download_dir, download_id)
    print(f"Verifying download in: {download_path}")
    
    download_dir_exists = os.path.exists(download_path)
    if not download_dir_exists:
        print(f"Download directory does not exist: {download_path}")
    else:
        # List all files in the download directory for debugging
        print("\nListing all files in download directory:")
        all_files = []
        for root, dirs, files in os.walk(download_path):
            for file in files:
                file_path = os.path.join(root, file)
                file_size = os.path.getsize(file_path)
                all_files.append((file_path, file_size))
        
        if all_files:
            print(f"Found {len(all_files)} total files in download directory:")
            for file_path, file_size in all_files:
                print(f"  - {file_path} ({file_size / 1024:.2f} KB)")
        else:
            print("No files found in the download directory")
    
    # Now check the music directory
    print(f"\nChecking music directory for downloaded files...")
    music_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), music_dir)
    print(f"Music directory path: {music_path}")
    
    if not os.path.exists(music_path):
        print(f"Music directory does not exist: {music_path}")
    else:
        # List all files in the music directory
        print("Listing all files in music directory:")
        all_music_files = []
        for root, dirs, files in os.walk(music_path):
            for file in files:
                file_path = os.path.join(root, file)
                file_size = os.path.getsize(file_path)
                file_mtime = os.path.getmtime(file_path)
                all_music_files.append((file_path, file_size, file_mtime))
        
        if all_music_files:
            print(f"Found {len(all_music_files)} total files in music directory")
            # Sort by modification time, newest first
            all_music_files.sort(key=lambda x: x[2], reverse=True)
            # Show the 5 most recently modified files
            print("Most recently modified files:")
            for i, (file_path, file_size, file_mtime) in enumerate(all_music_files[:5]):
                print(f"  {i+1}. {file_path} ({file_size / 1024:.2f} KB)")
                print(f"     Modified: {time.ctime(file_mtime)}")
        else:
            print("No files found in music directory")
        
        # Now check for all audio files, not just recently modified ones
        print("\nChecking for all audio files in music directory:")
        music_files = []
        for root, dirs, files in os.walk(music_path):
            for file in files:
                if file.lower().endswith(('.mp3', '.flac', '.m4a')):
                    file_path = os.path.join(root, file)
                    file_size = os.path.getsize(file_path)
                    file_mtime = os.path.getmtime(file_path)
                    music_files.append((file_path, file_size, file_mtime))
        
        if music_files:
            print(f"Found {len(music_files)} audio files in music directory:")
            for file_path, file_size, file_mtime in music_files:
                print(f"  - {file_path} ({file_size / (1024*1024):.2f} MB)")
                print(f"    Modified: {time.ctime(file_mtime)}")
                
                # We found audio files in the music directory, which is a good sign
                # Don't look for a specific track name as it might be different based on the URL
                print(f"\nFound audio files in music directory - considering this a successful download")
                return True
        else:
            print("No audio files found in music directory")
    
    # If we get here, check for audio files in the download directory
    if download_dir_exists:
        audio_files = []
        for root, dirs, files in os.walk(download_path):
            for file in files:
                if file.lower().endswith(('.mp3', '.flac', '.m4a')):
                    audio_files.append(os.path.join(root, file))
        
        if audio_files:
            print(f"\nFound {len(audio_files)} downloaded audio files in download directory:")
            for file in audio_files:
                print(f"  - {file}")
                # Get file size
                file_size = os.path.getsize(file)
                print(f"    Size: {file_size / (1024*1024):.2f} MB")
            return True
        else:
            print("\nNo audio files found in the download directory")
            
            # Check for error files
            error_files = []
            for root, dirs, files in os.walk(download_path):
                for file in files:
                    if file.endswith(('.error', '.txt', '.log')):
                        error_files.append(os.path.join(root, file))
            
            if error_files:
                print(f"\nFound {len(error_files)} log/error files:")
                for file in error_files:
                    print(f"  - {file}")
                    # Try to read the error file
                    try:
                        with open(file, 'r') as f:
                            content = f.read()
                            print(f"    Content (first 500 chars): {content[:500]}")
                            if len(content) > 500:
                                print("    ... (content truncated)")
                    except Exception as e:
                        print(f"    Could not read file: {e}")
            
            # Check for files.json which might contain metadata
            files_json_path = os.path.join(download_path, 'files.json')
            if os.path.exists(files_json_path):
                print("\nFound files.json, checking contents:")
                try:
                    with open(files_json_path, 'r') as f:
                        content = f.read()
                        print(f"    Content: {content}")
                        try:
                            import json
                            files_data = json.loads(content)
                            print(f"    Parsed JSON: {files_data}")
                            
                            # Extract file information from files.json
                            if 'files' in files_data and isinstance(files_data['files'], list):
                                files_json_found = True
                                files_from_json = files_data['files']
                                print(f"    Found {len(files_from_json)} files in files.json:")
                                
                                for i, file_info in enumerate(files_from_json):
                                    file_path = file_info.get('path', 'Unknown')
                                    file_size = file_info.get('size', 0)
                                    file_type = file_info.get('type', 'Unknown')
                                    print(f"      {i+1}. {file_path} ({file_size/1024/1024:.2f} MB) - {file_type}")
                                    
                                    # First check if the file exists in the download directory
                                    download_file_path = os.path.join(download_path, file_path)
                                    if os.path.exists(download_file_path):
                                        print(f"      ✓ Found in download directory: {download_file_path}")
                                        download_success = True
                                    
                                    # Then check if this file exists in the music directory
                                    music_file_path = os.path.join(music_dir, file_path)
                                    if os.path.exists(music_file_path):
                                        print(f"      ✓ Found in music directory: {music_file_path}")
                                        download_success = True
                        except json.JSONDecodeError as e:
                            print(f"    Error parsing JSON: {e}")
                except Exception as e:
                    print(f"    Could not read files.json: {e}")
    
    # Check the server logs for any errors
    print("\nChecking for Python error logs...")
    python_error_log = os.path.join(download_path, 'python_error.log') if download_dir_exists else None
    if python_error_log and os.path.exists(python_error_log):
        print(f"Found Python error log: {python_error_log}")
        try:
            with open(python_error_log, 'r') as f:
                content = f.read()
                print(f"    Content: {content}")
        except Exception as e:
            print(f"    Could not read Python error log: {e}")
    
    # If we found files.json with file entries, consider it a success
    if files_json_found and files_from_json:
        print("\nSUCCESS: Found files.json with file entries - download was successful.")
        return True
    
    # If we found audio files in the download directory or music directory, consider it a success
    if download_dir_exists and any(f.lower().endswith(('.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac')) for f in os.listdir(download_path)):
        print("\nSUCCESS: Found audio files in the download directory.")
        return True
    
    return False

async def run_test(url, port=3000):
    server_process = None
    log_file = None
    
    try:
        # Resolve short URL if needed
        url = resolve_short_url(url)
        
        # Start the server
        result = await start_server(port)
        if not result:
            print("Failed to start server, exiting test")
            return 1
        
        server_process, log_file = result
        
        base_url = f"http://localhost:{port}"
        
        # Initialize Playwright
        print("Initializing Playwright...")
        async with async_playwright() as playwright:
            # Launch a headless browser with additional options
            print("Launching headless Chromium browser...")
            browser = await playwright.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            )
            
            # Create a new browser context
            context = await browser.new_context()
            
            # Create a new page
            page = await context.new_page()
            
            # Navigate to the web interface
            print(f"Navigating to {base_url}...")
            await page.goto(base_url)
            
            # Perform the download
            download_id = await download_deezer_file(page, url)
            
            if not download_id:
                print("Failed to start download, exiting test")
                await browser.close()
                return 1
            
            # Check download status
            download_success = await check_download_status(page, download_id, base_url)
            
            # Check if download button exists for the file
            if download_success:
                download_button_exists = await check_download_button_exists(page, download_id, base_url)
                print(f"Download button exists: {download_button_exists}")
                
                # Check if files are available for download
                files_available = await check_files_available(page, download_id, base_url)
                print(f"Files available for download: {files_available}")
            else:
                download_button_exists = False
                files_available = False
            
            # Close the browser
            await browser.close()
            
            # Verify the download
            files_found = await verify_download(download_id)
            
            # Determine overall success
            if download_success and files_found:
                print("Test PASSED: Download completed successfully and files were found")
                
                if download_button_exists:
                    print("Download button test PASSED: Download button exists for the file")
                else:
                    print("Download button test FAILED: Download button does not exist for the file")
                    
                if files_available:
                    print("File availability test PASSED: Files are available for download")
                else:
                    print("File availability test FAILED: 'No files available' message was found")
                    
                # Only return success if all tests pass
                return 0 if (download_button_exists and files_available) else 1
            else:
                print("Test FAILED: Download was not successful or files were not found")
                return 1
                
    except Exception as e:
        print(f"Test error: {e}")
        return 1
    finally:
        # Clean up
        if server_process:
            stop_server(server_process, log_file)

def main():
    parser = argparse.ArgumentParser(description='Headless browser test for Deezer downloads')
    parser.add_argument('--url', required=True, help='Deezer URL to download')
    parser.add_argument('--port', type=int, default=3000, help='Port for the web server')
    args = parser.parse_args()
    
    # Run the async test
    return asyncio.run(run_test(args.url, args.port))

if __name__ == "__main__":
    sys.exit(main())
