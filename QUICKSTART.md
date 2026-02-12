# Quick Start Guide

## First Time Setup

### 1. Install Backend Dependencies

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Download Whisper model (only needed once)
python -c "import whisper; whisper.load_model('base')"
```

### 2. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

## Running the App

### Option 1: Single Command (Recommended) ⭐

From the project root directory:

```bash
./start.sh
```

**That's it!** The script will:
- ✅ Start both backend and frontend servers
- ✅ Show you the URLs
- ✅ Handle shutdown gracefully when you press **Ctrl+C**

### Option 2: Stop Servers

If you need to stop the servers:

```bash
./stop.sh
```

Or just press **Ctrl+C** in the terminal where `start.sh` is running.

## URLs

Once running, open your browser to:
- **App**: http://localhost:5173
- **Backend API**: http://localhost:5001

## Logs

If you started with `./start.sh`, logs are saved to:
- `backend.log` - Backend server logs
- `frontend.log` - Frontend server logs

## Troubleshooting

### Port Already in Use

If port 5001 is in use (e.g., by AirPlay on macOS):

1. Edit the root `.env` and set `FLASK_PORT=5001` (or another port)
2. Edit `frontend/.env` and update `VITE_API_URL` to match
3. Edit `frontend/vite.config.js` proxy target to match

### Dependencies Not Installed

If the script says dependencies are missing:

```bash
# Backend
cd backend
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### Whisper Model Not Found

```bash
cd backend
source venv/bin/activate
python -c "import whisper; whisper.load_model('base')"
```

## Features to Try

1. **Click "welcome" note** in the sidebar to see the welcome message
2. **Create a new folder** with "+ New Folder"
3. **Create a new note** with "+ New Note"
4. **Type in the editor** - it auto-saves
5. **Drag a .txt file** onto a folder to create a note
6. **Drag an audio file** (.mp3, .wav, etc.) for transcription!

Enjoy! 🎉
