import React, { useState } from 'react';
import { useNotes } from '../../context/NotesContext';
import { useApp } from '../../context/AppContext';
import './NoteItem.css';

const NoteItem = ({ note, level = 0, onClearRootDragOver }) => {
  const { getNote, currentNote, deleteNote } = useNotes();
  const { setError } = useApp();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const isSelected = currentNote && currentNote.path === note.path;

  const handleClick = async (e) => {
    // Don't select note if clicking on delete button area
    if (e.target.closest('.note-actions')) {
      return;
    }
    try {
      await getNote(note.path);
    } catch (error) {
      console.error('Error loading note:', error);
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    if (isConfirming) {
      // Second click - execute deletion
      handleDeleteConfirm();
    } else {
      // First click - show confirmation
      setIsConfirming(true);
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      await deleteNote(note.path);
      setIsConfirming(false);
    } catch (error) {
      setError('Failed to delete note: ' + error.message);
      setIsConfirming(false);
    }
  };

  const handleCancelDelete = (e) => {
    e.stopPropagation();
    setIsConfirming(false);
  };

  const handleDragStart = (e) => {
    setIsDragging(true);
    // Set data transfer with note information
    e.dataTransfer.setData('application/note', JSON.stringify({
      path: note.path,
      name: note.name,
    }));
    e.dataTransfer.effectAllowed = 'move';
    // Set drag image to be the element itself
    e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Clear root drag-over highlight since we're now over a note
    if (onClearRootDragOver) {
      onClearRootDragOver();
    }
  };

  const indentStyle = {
    paddingLeft: `${level * 16 + 8}px`, // Extra indent for notes under folders
  };

  return (
    <div
      className={`note-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={indentStyle}
      onClick={handleClick}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
    >
      <span className="note-icon">📄</span>
      <div className="note-info">
        <span className="note-name">{note.name}</span>
      </div>
      <div className="note-actions">
        {isConfirming ? (
          <>
            <button
              className="delete-button confirm"
              onClick={handleDeleteClick}
              title="Click again to confirm deletion"
            >
              Sure?
            </button>
            <button
              className="delete-cancel-button"
              onClick={handleCancelDelete}
              title="Cancel deletion"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            className="delete-button"
            onClick={handleDeleteClick}
            title="Delete note"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};

export default NoteItem;
