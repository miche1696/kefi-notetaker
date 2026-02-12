# Note-Taking App with Audio Transcription

A simple, Apple Notes-like application with local audio transcription using Whisper 3.

## Features

- 📝 **Plain text editing** with standard keyboard shortcuts (Ctrl+C, Ctrl+V, Ctrl+Z)
- 📁 **Nested folder organization** with drag-and-drop support
- 🎙️ **Audio transcription** using local Whisper model
- 📄 **Drag & drop files**:
  - Drop text files on folders to create new notes
  - Drop text files in editor to insert at cursor position
  - Drop audio files for instant transcription
- 💾 **Auto-save** functionality (500ms debounce)
- 🎨 **Clean, minimal UI** inspired by Apple Notes

## Tech Stack

**Backend:**
- Python 3.x
- Flask (REST API)
- OpenAI Whisper (local audio transcription)
- File-based storage

**Frontend:**
- React 18
- Vite (build tool)
- Context API (state management)
- Axios (HTTP client)

## Prerequisites

- Python 3.8 or higher
- Node.js 16 or higher
- npm or yarn
- FFmpeg (required for Whisper audio processing)

### Install FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## Installation

### 1. Clone the Repository

```bash
cd /Users/michelegionfriddo/Projects/PROJECT_ME
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Download Whisper model (first time only - this may take a few minutes)
python -c "import whisper; whisper.load_model('base')"

# Create necessary directories (if not already created)
mkdir -p ../notes ../uploads
```

### 3. Frontend Setup

```bash
# Navigate to frontend directory (from project root)
cd frontend

# Install dependencies
npm install
```

## Running the Application

### Quick Start (Recommended)

Use the provided startup script to launch both servers with a single command:

```bash
./start.sh
```

This will:
- ✅ Start the backend server (Flask + Whisper)
- ✅ Start the frontend server (Vite + React)
- ✅ Display server URLs and status
- ✅ Handle graceful shutdown with **Ctrl+C**

**To stop:** Press `Ctrl+C` or run `./stop.sh`

### Manual Start (Alternative)

You can also run the servers manually in separate terminals:

#### Terminal 1 - Backend

```bash
cd backend
source venv/bin/activate  # Activate virtual environment
python app.py
```

The backend will start on `http://localhost:5001`

#### Terminal 2 - Frontend

```bash
cd frontend
npm run dev
```

The frontend will start on `http://localhost:5173`

Open your browser to `http://localhost:5173` to use the application.

## Usage

### Creating Notes

1. Click "**+ New Note**" button in the header
2. A new note will be created in the current folder
3. Start typing in the editor

### Organizing with Folders

1. Click "**+ New Folder**" to create a folder
2. Click on folders in the sidebar to expand/collapse
3. Notes are displayed inline within folders

### Drag & Drop Files

**Create New Note (Drop on Folder Tree):**
- Drag a `.txt` file onto a folder → Creates new note with file content
- Drag an audio file onto a folder → Transcribes and creates new note

**Insert Content (Drop in Editor):**
- Drag a `.txt` file into the editor → Inserts content at cursor position
- Drag an audio file into the editor → Shows `[🎙️ Transcribing...]` placeholder, then inserts transcribed text

### Audio Transcription

**Supported formats:** `.mp3`, `.wav`, `.m4a`, `.ogg`, `.opus`, `.flac`, `.webm` (including WhatsApp `.opus` audio exports)

1. Drag an audio file onto the editor or folder
2. Wait for transcription (shown with loading indicator)
3. Transcribed text appears automatically

### Keyboard Shortcuts

- **Ctrl+S** (or Cmd+S on Mac): Manual save
- **Ctrl+C, Ctrl+V, Ctrl+Z**: Standard copy, paste, undo (native textarea functionality)
- **Escape**: Close modals

### Auto-Save

Notes are automatically saved 500ms after you stop typing.

## Project Structure

```
PROJECT_ME/
├── backend/
│   ├── app.py                 # Flask application
│   ├── config.py              # Configuration
│   ├── requirements.txt       # Python dependencies
│   ├── api/                   # REST API endpoints
│   ├── services/              # Business logic
│   └── models/                # Data models
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── api/               # API client
│       ├── components/        # React components
│       ├── context/           # State management
│       └── styles/            # CSS styles
├── notes/                     # Notes storage (user data)
└── uploads/                   # Temporary audio uploads
```

## Configuration

### Backend (root .env)

```bash
FLASK_ENV=development
FLASK_PORT=5001
NOTES_DIR=../notes
UPLOADS_DIR=../uploads
WHISPER_MODEL=base            # Options: tiny, base, small, medium, large
MAX_AUDIO_SIZE_MB=100
```

**Whisper Models:**
- `tiny`: Fastest, least accurate
- `base`: Good balance (recommended)
- `small`: Better accuracy, slower
- `medium`: High accuracy, much slower
- `large`: Best accuracy, very slow (requires powerful GPU)

### Frontend (.env)

```bash
VITE_API_URL=http://localhost:5001
```

## API Endpoints

### Notes

- `GET /api/notes` - List all notes
- `GET /api/notes/<path>` - Get note content
- `POST /api/notes` - Create note
- `PUT /api/notes/<path>` - Update note
- `DELETE /api/notes/<path>` - Delete note
- `PATCH /api/notes/<path>/rename` - Rename note

### Folders

- `GET /api/folders` - Get folder tree
- `POST /api/folders` - Create folder
- `PATCH /api/folders/<path>/rename` - Rename folder
- `DELETE /api/folders/<path>` - Delete folder

### Transcription

- `POST /api/transcription/audio` - Upload and transcribe audio
- `GET /api/transcription/formats` - Get supported formats
- Supported upload extensions include `.opus` (WhatsApp audio exports)

## Troubleshooting

### Whisper Model Download Issues

If the Whisper model fails to download:

```bash
cd backend
source venv/bin/activate
python -c "import whisper; whisper.load_model('base', download_root='./models')"
```

### FFmpeg Not Found

Ensure FFmpeg is installed and in your PATH:

```bash
ffmpeg -version
```

### Port Already in Use

If port 5001 or 5173 is already in use, update the configuration:

**Backend:** Change `FLASK_PORT` in root `.env`

**Frontend:** Change `port` in `frontend/vite.config.js`

### CORS Errors

Ensure the backend is running and the `VITE_API_URL` in `frontend/.env` matches your backend URL.

## Future Enhancements

The application is designed to be easily extensible:

- Rich text editor (TipTap/Slate)
- Markdown support
- Tags and labels
- Full-text search
- Cloud sync (Google Drive, Dropbox)
- Themes (dark mode)
- Export to PDF/HTML
- AI features (summarization, auto-tagging)
- Collaboration and real-time editing

## License

MIT License - See LICENSE file for details

## Author

Built with Claude Code

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
