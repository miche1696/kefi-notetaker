import axios from 'axios';
import apiClient from './client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export const transcriptionJobsApi = {
  create: async ({ audioFile, noteId, markerToken, launchSource = 'drop' }) => {
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('note_id', noteId);
    formData.append('marker_token', markerToken);
    formData.append('launch_source', launchSource);

    const response = await axios.post(
      `${API_URL}/api/transcription/jobs`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response.data;
  },

  list: async () => {
    const response = await apiClient.get('/transcription/jobs');
    return response.data;
  },

  get: async (jobId) => {
    const response = await apiClient.get(`/transcription/jobs/${jobId}`);
    return response.data;
  },

  cancel: async (jobId) => {
    const response = await apiClient.post(`/transcription/jobs/${jobId}/cancel`);
    return response.data;
  },

  resume: async (jobId) => {
    const response = await apiClient.post(`/transcription/jobs/${jobId}/resume`);
    return response.data;
  },

  resumeInterrupted: async () => {
    const response = await apiClient.post('/transcription/jobs/resume-interrupted');
    return response.data;
  },
};
