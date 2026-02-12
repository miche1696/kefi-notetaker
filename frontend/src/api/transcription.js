import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export const transcriptionApi = {
  /**
   * Upload and transcribe audio file
   * @param {File} audioFile - Audio file to transcribe
   * @param {Function} onProgress - Optional progress callback
   * @returns {Promise} Promise with transcription data
   */
  transcribeAudio: async (audioFile, onProgress = null) => {
    const formData = new FormData();
    formData.append('audio', audioFile);

    const config = {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          onProgress(percentCompleted);
        }
      },
    };

    const response = await axios.post(
      `${API_URL}/api/transcription/audio`,
      formData,
      config
    );

    return response.data;
  },

  /**
   * Get supported audio formats
   * @returns {Promise} Promise with supported formats
   */
  getSupportedFormats: async () => {
    const response = await axios.get(`${API_URL}/api/transcription/formats`);
    return response.data;
  },
};
