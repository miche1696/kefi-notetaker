import apiClient from './client';

export const notesApi = {
  /**
   * List all notes or notes in a specific folder
   * @param {string} folder - Optional folder path
   * @returns {Promise} Promise with notes array
   */
  listNotes: async (folder = '') => {
    const params = folder ? { folder } : {};
    const response = await apiClient.get('/notes', { params });
    return response.data;
  },

  /**
   * Get a specific note with content
   * @param {string} notePath - Relative path to note
   * @returns {Promise} Promise with note data
   */
  getNote: async (notePath) => {
    const response = await apiClient.get(`/notes/${notePath}`);
    return response.data;
  },

  /**
   * Create a new note
   * @param {string} name - Note name
   * @param {string} folder - Folder path (empty string for root)
   * @param {string} content - Initial content
   * @param {string} fileType - File type ('txt' or 'md')
   * @returns {Promise} Promise with created note data
   */
  createNote: async (name, folder = '', content = '', fileType = 'txt') => {
    const response = await apiClient.post('/notes', {
      name,
      folder,
      content,
      file_type: fileType,
    });
    return response.data;
  },

  /**
   * Update note content
   * @param {string} notePath - Relative path to note
   * @param {string} content - New content
   * @returns {Promise} Promise with updated note data
   */
  updateNote: async (notePath, content, expectedRevision) => {
    const response = await apiClient.put(`/notes/${notePath}`, {
      content,
      expected_revision: expectedRevision,
    });
    return response.data;
  },

  getNoteById: async (noteId) => {
    const response = await apiClient.get(`/notes/id/${noteId}`);
    return response.data;
  },

  replaceMarker: async (noteId, markerToken, replacementText) => {
    const response = await apiClient.patch(`/notes/id/${noteId}/replace-marker`, {
      marker_token: markerToken,
      replacement_text: replacementText,
    });
    return response.data;
  },

  /**
   * Delete a note
   * @param {string} notePath - Relative path to note
   * @returns {Promise} Promise with success message
   */
  deleteNote: async (notePath) => {
    const response = await apiClient.delete(`/notes/${notePath}`);
    return response.data;
  },

  /**
   * Rename a note
   * @param {string} notePath - Current relative path to note
   * @param {string} newName - New name for note
   * @returns {Promise} Promise with updated note data
   */
  renameNote: async (notePath, newName) => {
    const response = await apiClient.patch(`/notes/${notePath}/rename`, {
      new_name: newName,
    });
    return response.data;
  },

  /**
   * Move a note to a different folder
   * @param {string} notePath - Current relative path to note
   * @param {string} targetFolder - Target folder path (empty string for root)
   * @returns {Promise} Promise with updated note data
   */
  moveNote: async (notePath, targetFolder) => {
    const response = await apiClient.patch(`/notes/${notePath}/move`, {
      target_folder: targetFolder,
    });
    return response.data;
  },
};
