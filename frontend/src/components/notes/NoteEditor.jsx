import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNotes } from '../../context/NotesContext';
import { useApp } from '../../context/AppContext';
import { useSelection } from '../../context/SelectionContext';
import { transcriptionApi } from '../../api/transcription';
import { useTextOperations } from '../../hooks/useTextOperations';
import NoteToolbar from './NoteToolbar';
import VoiceRecorder from './VoiceRecorder';
import MarkdownEditor from './MarkdownEditor';
import { SelectionToolbar } from '../selection';
import './NoteEditor.css';

const NoteEditor = () => {
  const { currentNote, updateNote } = useNotes();
  const { setError } = useApp();
  const {
    selectedText,
    selectionStart,
    selectionEnd,
    hasSelection,
    isToolbarVisible,
    toolbarPosition,
    activeOperation,
    operationStatus,
    updateSelection,
    clearSelection,
    hideToolbar,
  } = useSelection();

  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [editorMode, setEditorMode] = useState('render'); // 'render' (WYSIWYG) or 'source' (raw markdown)
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const textareaRef = useRef(null);
  const markdownEditorRef = useRef(null);
  const markdownDropZoneRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const lastMousePositionRef = useRef({ x: 0, y: 0 });
  const isInitializingRef = useRef(false);
  const currentNotePathRef = useRef(null);

  // Check if current note is markdown
  const isMarkdown = currentNote?.file_type === 'md';

  // Trigger save callback for useTextOperations
  const triggerSave = useCallback(
    (newContent) => {
      if (currentNote) {
        saveNote(newContent);
      }
    },
    [currentNote]
  );

  // Get the active textarea ref (either plain text or markdown source mode)
  const getActiveTextareaRef = useCallback(() => {
    if (isMarkdown) {
      if (editorMode === 'source' && markdownEditorRef.current) {
        return markdownEditorRef.current.getTextareaRef();
      }
      return null;
    }
    return textareaRef;
  }, [isMarkdown, editorMode]);

  const replaceSelectionInRender = useCallback(
    async (replacement) => {
      if (!isMarkdown || editorMode !== 'render' || !markdownEditorRef.current) {
        return;
      }
      markdownEditorRef.current.restoreRenderSelection?.();
      markdownEditorRef.current.insertText(replacement, { preserveSelection: true });
    },
    [isMarkdown, editorMode]
  );

  const { executeOperation, getAvailableOperations } = useTextOperations(
    content,
    setContent,
    getActiveTextareaRef(),
    triggerSave,
    isMarkdown && editorMode === 'render' ? replaceSelectionInRender : null
  );

  // Load note content when current note changes
  useEffect(() => {
    // CRITICAL: Cancel any pending save from the previous note
    // This prevents the race condition where old content gets saved to the new note
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    // Mark that we're initializing a new note - skip onChange calls during this time
    // This prevents MDXEditor initialization from triggering saves
    const noteChanged = currentNote?.path !== currentNotePathRef.current;
    if (noteChanged) {
      isInitializingRef.current = true;
      currentNotePathRef.current = currentNote?.path || null;
      // Allow initialization to complete before accepting onChange calls
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 100);
    }

    if (currentNote) {
      setContent(currentNote.content || '');
    } else {
      setContent('');
    }
    // Clear selection when note changes
    clearSelection();
  }, [currentNote, clearSelection]);

  // Cleanup: cancel any pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Clear selection when editor mode changes
  useEffect(() => {
    clearSelection();
  }, [editorMode, clearSelection]);


  // Auto-save functionality (debounced)
  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setContent(newContent);

    // Store cursor position
    setCursorPosition(e.target.selectionStart);

    // Clear selection when content changes (typing)
    if (hasSelection) {
      clearSelection();
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Capture the note path at the time of the change to prevent race conditions
    const notePathAtChange = currentNote?.path;

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(() => {
      // Verify the note hasn't changed before saving
      if (currentNote && currentNote.path === notePathAtChange) {
        saveNote(newContent);
      }
    }, 500); // 500ms debounce
  };

  // Handle markdown editor changes
  const handleMarkdownChange = useCallback((newContent) => {
    // Skip onChange calls during note initialization (e.g., MDXEditor mounting)
    // This prevents accidental saves of stale or intermediate content
    if (isInitializingRef.current) {
      return;
    }

    setContent(newContent);

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Capture the note path at the time of the change to prevent race conditions
    const notePathAtChange = currentNote?.path;

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(() => {
      // Double-check we're not in initialization and note hasn't changed
      if (isInitializingRef.current) {
        return;
      }
      // Use ref for reliable comparison - the closure's currentNote might be stale
      // Only save if we're still on the same note that triggered the change
      if (currentNotePathRef.current === notePathAtChange) {
        saveNote(newContent);
      }
    }, 500); // 500ms debounce
  }, [currentNote]);

  const saveNote = async (contentToSave) => {
    if (!currentNote) return;

    try {
      setIsSaving(true);
      await updateNote(currentNote.path, contentToSave);
    } catch (error) {
      setError('Failed to save note: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Get caret coordinates using mirror div technique
  const getCaretCoordinates = useCallback((textarea, position) => {
    // Create a mirror div with identical styling
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(textarea);

    // Copy all relevant styles that affect text layout
    const styleProps = [
      'font', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
      'lineHeight', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom',
      'borderLeftWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
      'boxSizing', 'width', 'wordWrap', 'whiteSpace', 'letterSpacing',
      'textIndent', 'textTransform', 'wordSpacing', 'textAlign'
    ];

    styleProps.forEach(prop => {
      mirror.style[prop] = style[prop];
    });

    // Additional positioning styles
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    mirror.style.height = 'auto';
    mirror.style.top = '0';
    mirror.style.left = '0';

    // Get textarea dimensions and scroll
    const textareaRect = textarea.getBoundingClientRect();
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;

    // Set mirror width to match textarea content width
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    mirror.style.width = `${textareaRect.width - paddingLeft - paddingRight}px`;

    // Insert text up to caret position
    const textBeforeCaret = content.substring(0, position);
    mirror.textContent = textBeforeCaret;

    // Create a marker span to measure caret position
    const marker = document.createElement('span');
    marker.textContent = '|';
    mirror.appendChild(marker);

    // Append to body temporarily
    document.body.appendChild(mirror);

    // Get marker position relative to mirror
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    // Calculate position relative to textarea
    const x = textareaRect.left + paddingLeft + (markerRect.left - mirrorRect.left) - scrollLeft;
    const y = textareaRect.top + (markerRect.top - mirrorRect.top) - scrollTop;

    // Clean up
    document.body.removeChild(mirror);

    return { x, y };
  }, [content]);

  // Handle text selection with position (for plain text editor)
  const handleSelectionChange = useCallback((position) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd, selectionDirection } = textarea;

    if (selectionStart !== selectionEnd) {
      const selectedText = content.substring(selectionStart, selectionEnd);

      // Use provided position (from mouse) or calculate from caret (keyboard)
      let toolbarPos;
      if (position) {
        // Mouse selection - use mouse coordinates (already the focus position)
        toolbarPos = position;
      } else {
        // Keyboard selection - use FOCUS position (the moving cursor)
        // If backward selection, focus is at selectionStart
        // If forward selection, focus is at selectionEnd
        const focusPosition = selectionDirection === 'backward'
          ? selectionStart
          : selectionEnd;
        toolbarPos = getCaretCoordinates(textarea, focusPosition);
      }

      updateSelection(selectionStart, selectionEnd, selectedText, toolbarPos);
    } else {
      clearSelection();
    }
  }, [content, updateSelection, clearSelection, getCaretCoordinates]);

  // Handle markdown source mode selection
  const handleMarkdownSourceSelection = useCallback((e, textarea) => {
    if (!textarea) return;

    const { selectionStart, selectionEnd, selectionDirection } = textarea;

    if (selectionStart !== selectionEnd) {
      const selectedText = content.substring(selectionStart, selectionEnd);

      // Use provided position (from mouse) or calculate from caret (keyboard)
      let toolbarPos;
      if (e.type === 'mouseup') {
        // Mouse selection - use mouse coordinates with offset
        toolbarPos = { x: e.clientX, y: e.clientY - 15 };
      } else {
        // Keyboard selection - use FOCUS position (the moving cursor)
        const focusPosition = selectionDirection === 'backward'
          ? selectionStart
          : selectionEnd;
        toolbarPos = getCaretCoordinates(textarea, focusPosition);
      }

      updateSelection(selectionStart, selectionEnd, selectedText, toolbarPos);
    } else {
      clearSelection();
    }
  }, [content, updateSelection, clearSelection, getCaretCoordinates]);

  const handleMarkdownRenderSelection = useCallback((info) => {
    if (!info || !info.text) {
      clearSelection();
      return;
    }

    const position = info.position || lastMousePositionRef.current;
    updateSelection(0, info.text.length, info.text, position);
  }, [updateSelection, clearSelection]);

  // Track mouse position
  const handleMouseMove = useCallback((e) => {
    lastMousePositionRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Handle mouse up to finalize selection
  const handleMouseUp = useCallback((e) => {
    // Store mouse position
    lastMousePositionRef.current = { x: e.clientX, y: e.clientY };
    
    // Small delay to ensure selection is complete
    setTimeout(() => {
      // Add small offset to move toolbar higher (further from click point to avoid overlapping with text)
      // ~0.5cm = ~15-20px depending on screen DPI
      handleSelectionChange({ 
        x: e.clientX, 
        y: e.clientY - 15 
      });
    }, 10);
  }, [handleSelectionChange]);

  // Handle keyboard-based selection (Shift+arrows)
  const handleKeyUp = useCallback(
    (e) => {
      if (e.shiftKey || e.key === 'Shift') {
        // Keyboard selection - use caret position
        handleSelectionChange(null);
      }
    },
    [handleSelectionChange]
  );

  // Manual save on Ctrl+S
  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (currentNote) {
        saveNote(content);
      }
    }
  };

  // Handle operation selection from toolbar
  const handleOperationSelect = useCallback(
    async (operationId, options = {}) => {
      try {
        let mergedOptions = options;
        if (operationId === 'modify') {
          const totalLength = content.length;
          let start = selectionStart;
          let end = selectionEnd;

          let canUseContext = true;
          if (isMarkdown && editorMode === 'render') {
            const matchIndex = selectedText ? content.indexOf(selectedText) : -1;
            if (matchIndex !== -1) {
              start = matchIndex;
              end = matchIndex + selectedText.length;
            } else {
              canUseContext = false;
            }
          }

          const beforeStart = Math.max(0, start - 200);
          const afterEnd = Math.min(totalLength, end + 200);
          const before = canUseContext ? content.substring(beforeStart, start) : '';
          const after = canUseContext ? content.substring(end, afterEnd) : '';

          mergedOptions = {
            ...options,
            before,
            after,
          };
        }

        await executeOperation(operationId, mergedOptions);
      } catch (error) {
        setError(`Operation failed: ${error.message}`);
      }
    },
    [
      executeOperation,
      setError,
      content,
      selectionStart,
      selectionEnd,
      selectedText,
      isMarkdown,
      editorMode,
    ]
  );

  // Insert text at cursor position
  const insertTextAtCursor = (textToInsert) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const textBefore = content.substring(0, start);
    const textAfter = content.substring(end);

    const newContent = textBefore + textToInsert + textAfter;
    setContent(newContent);

    // Update cursor position
    const newCursorPos = start + textToInsert.length;
    setTimeout(() => {
      textarea.selectionStart = newCursorPos;
      textarea.selectionEnd = newCursorPos;
      textarea.focus();
    }, 0);

    // Save immediately after insertion
    if (currentNote) {
      saveNote(newContent);
    }

    return newCursorPos;
  };

  const replacePlaceholderInContent = (text, placeholder, replacement, allowEscaped = false) => {
    if (!placeholder) return text;
    const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = allowEscaped
      ? new RegExp(`\\\\?${escapedPlaceholder}`)
      : new RegExp(escapedPlaceholder);
    return text.replace(pattern, () => replacement);
  };

  // Handle voice recording start - insert placeholder
  const handleVoiceRecordingStart = (placeholder) => {
    if (isMarkdown && markdownEditorRef.current) {
      markdownEditorRef.current.insertText(placeholder);
    } else {
      insertTextAtCursor(placeholder);
    }
  };

  // Handle transcription complete - replace placeholder with text
  const handleTranscriptionComplete = (transcribedText, placeholder) => {
    if (placeholder) {
      if (isMarkdown && markdownEditorRef.current) {
        // For markdown, use the replaceText method
        markdownEditorRef.current.replaceText(placeholder, transcribedText);
        // Also update content state and save
        setContent((prevContent) => {
          const newContent = replacePlaceholderInContent(
            prevContent,
            placeholder,
            transcribedText,
            true
          );
          if (currentNote) {
            saveNote(newContent);
          }
          return newContent;
        });
      } else {
        // Replace placeholder with transcribed text
        setContent((prevContent) => {
          const newContent = replacePlaceholderInContent(
            prevContent,
            placeholder,
            transcribedText
          );
          if (currentNote) {
            saveNote(newContent);
          }
          return newContent;
        });
      }
    } else {
      // No placeholder, just insert at cursor
      if (isMarkdown && markdownEditorRef.current) {
        markdownEditorRef.current.insertText(transcribedText);
      } else {
        insertTextAtCursor(transcribedText);
      }
    }
  };

  // Handle drop events
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset dragging state
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Capture note path at drop time to avoid stale closure during long transcriptions
    const notePathAtDrop = currentNote?.path;
    const isMarkdownAtDrop = isMarkdown;

    // For txt files: Use the existing cursor position (where user clicked before dragging)
    // Don't try to calculate from drop coordinates as it's inaccurate
    // For md files: Capture cursor position before overlay interaction
    let savedCursorPosition = cursorPosition;

    if (!isMarkdown) {
      const textarea = textareaRef.current;
      if (textarea) {
        // Save the current cursor position before any focus changes
        savedCursorPosition = textarea.selectionStart;
        textarea.focus();
        // Restore cursor position
        textarea.selectionStart = savedCursorPosition;
        textarea.selectionEnd = savedCursorPosition;
      }
    }

    for (const file of files) {
      try {
        // Handle text files
        if (file.name.endsWith('.txt')) {
          const textContent = await file.text();
          if (isMarkdownAtDrop && markdownEditorRef.current) {
            // insertText will call onChange which updates content state
            markdownEditorRef.current.insertText(textContent);
            // Save after a short delay to allow onChange to propagate
            setTimeout(() => {
              if (notePathAtDrop) {
                const latestContent = markdownEditorRef.current?.getContent() || content;
                updateNote(notePathAtDrop, latestContent).catch((err) => {
                  setError('Failed to save: ' + err.message);
                });
              }
            }, 100);
          } else {
            insertTextAtCursor(textContent);
          }
        }
        // Handle audio files
        else if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|opus|flac|webm)$/i.test(file.name)) {
          // Insert placeholder
          const placeholder = `[🎙️ Transcribing...]`;

          if (isMarkdownAtDrop && markdownEditorRef.current) {
            // insertText will call onChange which updates content state
            markdownEditorRef.current.insertText(placeholder);
            // Save after a short delay to allow onChange to propagate
            setTimeout(() => {
              if (notePathAtDrop) {
                // Get the latest content from the editor
                const latestContent = markdownEditorRef.current?.getContent() || content;
                updateNote(notePathAtDrop, latestContent).catch((err) => {
                  console.error('Failed to save placeholder:', err);
                });
              }
            }, 100);
          } else {
            insertTextAtCursor(placeholder);
          }

          setIsTranscribing(true);

          try {
            // Transcribe audio
            const result = await transcriptionApi.transcribeAudio(file);

            // Replace placeholder with transcribed text
            // Use captured notePathAtDrop to avoid stale closure issues
            setContent((prevContent) => {
              const newContent = replacePlaceholderInContent(
                prevContent,
                placeholder,
                result.text,
                isMarkdownAtDrop
              );
              // Save using captured path, not current note reference
              if (notePathAtDrop) {
                updateNote(notePathAtDrop, newContent).catch((err) => {
                  setError('Failed to save transcription: ' + err.message);
                });
              }
              return newContent;
            });

            // Also update MDXEditor if still on markdown
            if (isMarkdownAtDrop && markdownEditorRef.current) {
              markdownEditorRef.current.replaceText(placeholder, result.text);
            }
          } catch (transcriptionError) {
            // Replace placeholder with error message
            const errorText = `[Error transcribing audio]`;
            setContent((prevContent) =>
              replacePlaceholderInContent(
                prevContent,
                placeholder,
                errorText,
                isMarkdownAtDrop
              )
            );
            if (isMarkdownAtDrop && markdownEditorRef.current) {
              markdownEditorRef.current.replaceText(placeholder, errorText);
            }
            setError('Transcription failed: ' + transcriptionError.message);
          } finally {
            setIsTranscribing(false);
          }
        } else {
          setError(`Unsupported file type: ${file.name}`);
        }
      } catch (error) {
        setError(`Failed to process file ${file.name}: ${error.message}`);
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Enable drop visual feedback
    e.dataTransfer.dropEffect = 'copy';
    if (isMarkdown && !isDraggingOver) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the container entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDraggingOver(false);
    }
  };

  if (!currentNote) {
    return (
      <div className="note-editor">
        <div className="editor-placeholder">
          <p>Select a note from the sidebar or create a new one</p>
        </div>
      </div>
    );
  }

  // Get available operations for current selection
  const availableOperations = hasSelection ? getAvailableOperations() : [];

  return (
    <div className="note-editor">
      <NoteToolbar
        note={currentNote}
        isSaving={isSaving}
        isTranscribing={isTranscribing}
        isMarkdown={isMarkdown}
        editorMode={editorMode}
        onEditorModeChange={setEditorMode}
      />
      <div
        className="editor-content-container"
        onDragOver={isMarkdown ? handleDragOver : undefined}
        onDragLeave={isMarkdown ? handleDragLeave : undefined}
      >
        {isMarkdown ? (
          <div
            ref={markdownDropZoneRef}
            className="markdown-drop-zone"
          >
            <MarkdownEditor
              key={currentNote?.path}
              ref={markdownEditorRef}
              initialContent={currentNote?.content || ''}
              content={content}
              onChange={handleMarkdownChange}
              mode={editorMode}
              onSourceSelection={handleMarkdownSourceSelection}
              onRenderSelection={handleMarkdownRenderSelection}
            />
            {/* Drop overlay - captures drop events before MDXEditor */}
            {isDraggingOver && (
              <div
                className="markdown-drop-overlay"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <div className="drop-overlay-content">
                  <span>Drop audio file to transcribe</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            placeholder="Start typing or drop a file here..."
            spellCheck="true"
          />
        )}

        {/* Selection Toolbar */}
        {hasSelection && isToolbarVisible && availableOperations.length > 0 && (
          <SelectionToolbar
            position={toolbarPosition}
            operations={availableOperations}
            onOperationSelect={handleOperationSelect}
            isProcessing={operationStatus === 'pending'}
            activeOperation={activeOperation}
            onDismiss={hideToolbar}
          />
        )}

        <VoiceRecorder
          onRecordingStart={handleVoiceRecordingStart}
          onTranscriptionComplete={handleTranscriptionComplete}
          onTranscriptionStart={() => setIsTranscribing(true)}
          onTranscriptionEnd={() => setIsTranscribing(false)}
          onError={setError}
          disabled={!currentNote}
        />
      </div>
    </div>
  );
};

export default NoteEditor;
