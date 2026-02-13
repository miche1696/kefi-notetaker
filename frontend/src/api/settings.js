import apiClient from './client';

export const settingsApi = {
  get: async () => {
    const response = await apiClient.get('/settings');
    return response.data;
  },

  update: async (payload) => {
    const response = await apiClient.put('/settings', payload);
    return response.data;
  },
};
