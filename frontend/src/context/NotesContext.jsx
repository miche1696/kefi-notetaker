import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { notesApi } from '../api/notes';
import { foldersApi } from '../api/folders';

const NotesContext = createContext(null);

export const useNotes = () => {
  const context = useContext(NotesContext);
  if (!context) {
    throw new Error('useNotes must be used within NotesProvider');
  }
  return context;
};

export const NotesProvider = ({ children }) => {
  const [notes, setNotes] = useState([]);
  const [folderTree, setFolderTree] = useState(null);
  const [currentNote, setCurrentNote] = useState(null);
  const [bootstrapStatus, setBootstrapStatus] = useState('idle'); // idle | loading | ready | error
  const [bootstrapError, setBootstrapError] = useState(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [bootstrapRetryInMs, setBootstrapRetryInMs] = useState(null);
  const retryTimeoutRef = useRef(null);
  const bootstrapAttemptRef = useRef(0);

  const clearRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback((delayMs, retryFn) => {
    clearRetry();
    setBootstrapRetryInMs(delayMs);
    retryTimeoutRef.current = setTimeout(() => {
      retryFn();
    }, delayMs);
  }, [clearRetry]);

  // Fetch folder tree on mount
  const refreshFolders = useCallback(async () => {
    try {
      const tree = await foldersApi.getFolderTree();
      setFolderTree(tree);
    } catch (error) {
      console.error('Error fetching folder tree:', error);
      throw error;
    }
  }, []);

  // Fetch all notes
  const refreshNotes = useCallback(async (folder = '') => {
    try {
      const response = await notesApi.listNotes(folder);
      setNotes(response.notes || []);
    } catch (error) {
      console.error('Error fetching notes:', error);
      throw error;
    }
  }, []);

  // Create note
  const createNote = useCallback(async (name, folderPath = '', content = '', fileType = 'txt') => {
    try {
      const note = await notesApi.createNote(name, folderPath, content, fileType);
      await refreshFolders();
      await refreshNotes();
      return note;
    } catch (error) {
      console.error('Error creating note:', error);
      throw error;
    }
  }, [refreshFolders, refreshNotes]);

  // Update note content
  // IMPORTANT: We do NOT update currentNote here because:
  // 1. The local component state already has the latest content
  // 2. Updating currentNote triggers re-renders that reset MDXEditor cursor position
  // 3. We also skip refreshNotes() since content changes don't affect the notes list
  const updateNote = useCallback(async (notePath, content, expectedRevision) => {
    try {
      const revisionToUse = expectedRevision ?? currentNote?.revision ?? 1;
      const note = await notesApi.updateNote(notePath, content, revisionToUse);
      // Only update the content in currentNote without replacing the entire object
      // This avoids triggering re-renders that would reset editor state
      if (currentNote && currentNote.path === note.path) {
        // Update only the content field, preserving reference stability
        currentNote.content = content;
        currentNote.revision = note.revision;
        currentNote.id = note.id;
      }
      // Skip refreshNotes() - content changes don't affect the folder tree or note list
      return note;
    } catch (error) {
      console.error('Error updating note:', error);
      throw error;
    }
  }, [currentNote]);

  // Delete note
  const deleteNote = useCallback(async (notePath) => {
    try {
      await notesApi.deleteNote(notePath);
      // Clear current note if it was the deleted one
      // Compare paths by stripping extensions since folder tree paths have extensions
      // but currentNote.path (from getNote) does not
      const stripExtension = (p) => p?.replace(/\.(txt|md)$/, '') || '';
      setCurrentNote(prev => {
        if (!prev) return null;
        return stripExtension(prev.path) === stripExtension(notePath) ? null : prev;
      });
      await refreshFolders();
      await refreshNotes();
    } catch (error) {
      console.error('Error deleting note:', error);
      throw error;
    }
  }, [refreshFolders, refreshNotes]);

  // Rename note
  const renameNote = useCallback(async (notePath, newName) => {
    try {
      const note = await notesApi.renameNote(notePath, newName);
      // Update currentNote if it's the one being renamed
      if (currentNote && currentNote.path === notePath) {
        setCurrentNote(note);
      }
      await refreshFolders();
      await refreshNotes();
      return note;
    } catch (error) {
      console.error('Error renaming note:', error);
      throw error;
    }
  }, [currentNote, refreshFolders, refreshNotes]);

  // Move note
  const moveNote = useCallback(async (notePath, targetFolder) => {
    try {
      const note = await notesApi.moveNote(notePath, targetFolder);
      // Update currentNote if it's the one being moved
      if (currentNote && currentNote.path === notePath) {
        setCurrentNote(note);
      }
      await refreshFolders();
      await refreshNotes();
      return note;
    } catch (error) {
      console.error('Error moving note:', error);
      throw error;
    }
  }, [currentNote, refreshFolders, refreshNotes]);

  // Get note
  const getNote = useCallback(async (notePath) => {
    try {
      const note = await notesApi.getNote(notePath);
      setCurrentNote(note);
      return note;
    } catch (error) {
      console.error('Error fetching note:', error);
      throw error;
    }
  }, []);

  const getNoteById = useCallback(async (noteId) => {
    try {
      const note = await notesApi.getNoteById(noteId);
      setCurrentNote(note);
      return note;
    } catch (error) {
      console.error('Error fetching note by id:', error);
      throw error;
    }
  }, []);

  // Create folder
  const createFolder = useCallback(async (name, parentPath = '') => {
    try {
      const result = await foldersApi.createFolder(name, parentPath);
      await refreshFolders();
      return result;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }, [refreshFolders]);

  // Rename folder
  const renameFolder = useCallback(async (folderPath, newName) => {
    try {
      const result = await foldersApi.renameFolder(folderPath, newName);
      await refreshFolders();
      return result;
    } catch (error) {
      console.error('Error renaming folder:', error);
      throw error;
    }
  }, [refreshFolders]);

  // Delete folder
  const deleteFolder = useCallback(async (folderPath, recursive = false) => {
    try {
      await foldersApi.deleteFolder(folderPath, recursive);
      // Clear current note if it was inside the deleted folder
      setCurrentNote(prev => {
        if (prev && prev.path && prev.path.startsWith(folderPath + '/')) {
          return null;
        }
        return prev;
      });
      await refreshFolders();
      await refreshNotes();
    } catch (error) {
      console.error('Error deleting folder:', error);
      throw error;
    }
  }, [refreshFolders, refreshNotes]);

  // Move folder
  const moveFolder = useCallback(async (folderPath, targetFolder) => {
    try {
      const result = await foldersApi.moveFolder(folderPath, targetFolder);
      await refreshFolders();
      await refreshNotes();
      return result;
    } catch (error) {
      console.error('Error moving folder:', error);
      throw error;
    }
  }, [refreshFolders, refreshNotes]);

  // Initialize: load folder tree and notes
  const loadInitialData = useCallback(async ({ resetAttempt = false } = {}) => {
    clearRetry();
    setBootstrapStatus('loading');
    setBootstrapError(null);

    if (resetAttempt) {
      bootstrapAttemptRef.current = 0;
      setBootstrapAttempt(0);
      setBootstrapRetryInMs(null);
    }

    try {
      await Promise.all([refreshFolders(), refreshNotes()]);
      bootstrapAttemptRef.current = 0;
      setBootstrapAttempt(0);
      setBootstrapRetryInMs(null);
      setBootstrapStatus('ready');
    } catch (error) {
      bootstrapAttemptRef.current += 1;
      const attempt = bootstrapAttemptRef.current;
      setBootstrapAttempt(attempt);
      setBootstrapStatus('error');
      setBootstrapError(error);

      const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 10000);
      scheduleRetry(delayMs, loadInitialData);
    }
  }, [clearRetry, refreshFolders, refreshNotes, scheduleRetry]);

  useEffect(() => {
    loadInitialData();
    return () => {
      clearRetry();
    };
  }, [clearRetry, loadInitialData]);

  const retryBootstrap = useCallback(() => loadInitialData({ resetAttempt: true }), [loadInitialData]);

  const value = {
    notes,
    folderTree,
    currentNote,
    setCurrentNote,
    createNote,
    updateNote,
    deleteNote,
    renameNote,
    moveNote,
    getNote,
    getNoteById,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
    refreshNotes,
    refreshFolders,
    bootstrapStatus,
    bootstrapError,
    bootstrapAttempt,
    bootstrapRetryInMs,
    retryBootstrap,
  };

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
};
