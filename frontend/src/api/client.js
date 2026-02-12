import axios from 'axios';
import { traceEvent } from './trace';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const apiClient = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method.toUpperCase()} ${config.url}`);
    if (!config.url?.includes('/trace/client')) {
      traceEvent('api.request', {
        method: config.method,
        url: config.url,
        params: config.params,
        data: config.data,
      });
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    if (!response.config?.url?.includes('/trace/client')) {
      traceEvent('api.response', {
        method: response.config.method,
        url: response.config.url,
        status: response.status,
        data: response.data,
      });
    }
    return response;
  },
  (error) => {
    if (error.response) {
      console.error('API Error:', error.response.data);
      traceEvent('api.response', {
        method: error.config?.method,
        url: error.config?.url,
        status: error.response?.status,
        data: error.response?.data,
        error: true,
      });
    } else if (error.request) {
      console.error('Network Error:', error.message);
      traceEvent('api.response', {
        method: error.config?.method,
        url: error.config?.url,
        error: true,
        message: error.message,
      });
    } else {
      console.error('Error:', error.message);
      traceEvent('api.response', {
        error: true,
        message: error.message,
      });
    }
    return Promise.reject(error);
  }
);

export default apiClient;
