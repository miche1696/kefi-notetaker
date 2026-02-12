const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export async function traceEvent(event, data = {}) {
  if (event === 'trace.client') {
    return;
  }
  try {
    await fetch(`${API_URL}/api/trace/client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }),
      keepalive: true,
    });
  } catch (error) {
    // Tracing must never break the app.
  }
}
