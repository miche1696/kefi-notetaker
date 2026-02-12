#!/bin/bash

# Stop all running servers for the Note-Taking App

echo "Stopping all servers..."

# Load backend port from root .env (single source of truth)
BACKEND_PORT="${FLASK_PORT:-}"
if [ -z "$BACKEND_PORT" ] && [ -f ".env" ]; then
    BACKEND_PORT=$(grep -E '^[[:space:]]*FLASK_PORT=' .env | tail -n 1 | cut -d '=' -f2- | tr -d '[:space:]')
fi
BACKEND_PORT=${BACKEND_PORT:-5001}

# Kill backend by actual configured port
BACKEND_PIDS=$(lsof -ti :$BACKEND_PORT 2>/dev/null)
if [ -n "$BACKEND_PIDS" ]; then
    echo "$BACKEND_PIDS" | xargs kill -9 2>/dev/null
    echo "✓ Backend stopped (port $BACKEND_PORT)"
else
    echo "  Backend not running on port $BACKEND_PORT"
fi

# Kill frontend by port 5173 (Vite dev server)
FRONTEND_PIDS=$(lsof -ti :5173 2>/dev/null)
if [ -n "$FRONTEND_PIDS" ]; then
    echo "$FRONTEND_PIDS" | xargs kill -9 2>/dev/null
    echo "✓ Frontend stopped (port 5173)"
else
    echo "  Frontend not running"
fi

echo "Done!"
