#!/bin/bash

# Note-Taking App Startup Script
# Starts both backend (Flask) and frontend (Vite) servers
# Press Ctrl+C to stop both

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Load backend port from root .env (single source of truth)
BACKEND_PORT="${FLASK_PORT:-}"
if [ -z "$BACKEND_PORT" ] && [ -f ".env" ]; then
    BACKEND_PORT=$(grep -E '^[[:space:]]*FLASK_PORT=' .env | tail -n 1 | cut -d '=' -f2- | tr -d '[:space:]')
fi
BACKEND_PORT=${BACKEND_PORT:-5001}

# Store PIDs of background processes
BACKEND_PID=""
FRONTEND_PID=""

# Cleanup function - kills processes by port (handles Flask reloader children)
cleanup() {
    echo -e "\n${YELLOW}Shutting down servers...${NC}"

    # Kill backend by port (catches main process + reloader)
    BACKEND_PIDS=$(lsof -ti :"$BACKEND_PORT" 2>/dev/null)
    if [ -n "$BACKEND_PIDS" ]; then
        echo -e "${BLUE}Stopping backend (port $BACKEND_PORT)${NC}"
        echo "$BACKEND_PIDS" | xargs kill -9 2>/dev/null || true
    fi

    # Kill frontend by port
    FRONTEND_PIDS=$(lsof -ti :5173 2>/dev/null)
    if [ -n "$FRONTEND_PIDS" ]; then
        echo -e "${BLUE}Stopping frontend (port 5173)${NC}"
        echo "$FRONTEND_PIDS" | xargs kill -9 2>/dev/null || true
    fi

    # Wait a moment for cleanup
    sleep 1

    echo -e "${GREEN}✓ Servers stopped${NC}"
    exit 0
}

# Set trap to catch Ctrl+C and call cleanup
trap cleanup SIGINT SIGTERM

# Print header
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Note-Taking App with Audio Transcription  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

# Create backup of notes folder
echo -e "${BLUE}Creating backup of notes folder...${NC}"

# Generate timestamp in format: YYYYMMDD_HHMMSS
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="notes_backup/notes_${TIMESTAMP}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Copy notes folder contents to backup
if [ -d "notes" ]; then
    cp -r notes/* "$BACKUP_DIR/" 2>/dev/null || true
    echo -e "${GREEN}✓ Backup created: $BACKUP_DIR${NC}"
else
    echo -e "${YELLOW}Warning: notes directory not found, skipping backup${NC}"
fi

echo ""

# Check if backend directory exists
if [ ! -d "backend" ]; then
    echo -e "${RED}Error: backend directory not found${NC}"
    echo "Please run this script from the PROJECT_ME directory"
    exit 1
fi

# Check if frontend directory exists
if [ ! -d "frontend" ]; then
    echo -e "${RED}Error: frontend directory not found${NC}"
    echo "Please run this script from the PROJECT_ME directory"
    exit 1
fi

# Start Backend
echo -e "${BLUE}Starting backend server...${NC}"
cd backend

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Virtual environment not found. Creating...${NC}"
    if command -v python3.11 >/dev/null 2>&1; then
        python3.11 -m venv venv
    else
        python3 -m venv venv
    fi
fi

# Validate Python version inside venv (Whisper/Torch need <=3.11)
source venv/bin/activate
PYTHON_VERSION=$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
if [ "$PYTHON_VERSION" != "3.11" ] && [ "$PYTHON_VERSION" != "3.10" ]; then
    echo -e "${RED}Error: backend venv uses Python ${PYTHON_VERSION}.${NC}"
    echo -e "${YELLOW}Please recreate backend/venv with Python 3.11 or 3.10.${NC}"
    echo -e "${YELLOW}Example:${NC} /opt/homebrew/bin/python3.11 -m venv backend/venv${NC}"
    exit 1
fi
# Start Flask
python app.py > ../backend.log 2>&1 &
BACKEND_PID=$!

cd ..
sleep 2

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}✗ Backend failed to start${NC}"
    echo "Check backend.log for errors"
    exit 1
fi

echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
echo -e "  ${BLUE}→ http://localhost:$BACKEND_PORT${NC}"

# Start Frontend
echo -e "${BLUE}Starting frontend server...${NC}"
cd frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Dependencies not installed. Running npm install...${NC}"
    npm install
fi

# Start Vite
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!

cd ..
sleep 2

# Check if frontend started successfully
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${RED}✗ Frontend failed to start${NC}"
    echo "Check frontend.log for errors"
    cleanup
    exit 1
fi

echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"
echo -e "  ${BLUE}→ http://localhost:5173${NC}"

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Both servers are running!${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC} http://localhost:5173"
echo -e "  ${BLUE}Backend:${NC}  http://localhost:$BACKEND_PORT"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
