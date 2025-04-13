# DeeMixer

A web application that allows users to download media from various sources including YouTube, Spotify, and Deezer in the highest quality available.

## Features

- Simple web interface for entering URLs
- Download videos from YouTube in highest quality (video+audio)
- Download music from Spotify in FLAC format (highest quality)
- Automatic status checking and direct browser downloads
- Support for Deezer coming soon

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Configure Spotify API (optional):
   - Create a copy of `.env.example` and name it `.env`
   - Register at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
   - Create a new application to get your Client ID and Secret
   - Add your credentials to the `.env` file:
     ```
     SPOTIFY_CLIENT_ID=your_client_id_here
     SPOTIFY_CLIENT_SECRET=your_client_secret_here
     ```
4. Start the server:
   ```
   npm start
   ```
5. Open your browser and navigate to `http://localhost:3000`

## Development

- Run tests:
  ```
  npm test
  ```

## Technologies Used

- Node.js
- Express
- youtube-dl-exec for YouTube downloads in highest quality
- spotifydl-core for Spotify downloads in FLAC format
- dotenv for environment variable management
- Jest and Supertest for testing

## License

ISC
