import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  thematicBreakPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  HighlightToggle,
  BlockTypeSelect,
  CreateLink,
  ListsToggle,
  InsertTable,
  InsertThematicBreak,
  UndoRedo,
  Separator,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import './MarkdownEditor.css';

// Line numbers component that handles wrapped lines
const LineNumbers = ({ content, containerRef, scrollTop }) => {
  const [lineHeights, setLineHeights] = useState([]);
  const mirrorRef = useRef(null);

  useEffect(() => {
    if (!mirrorRef.current || !containerRef?.current) return;

    const mirror = mirrorRef.current;
    const container = containerRef.current;

    // Copy styles from textarea to mirror
    const computedStyle = window.getComputedStyle(container);
    mirror.style.width = `${container.clientWidth}px`;
    mirror.style.font = computedStyle.font;
    mirror.style.letterSpacing = computedStyle.letterSpacing;
    mirror.style.wordSpacing = computedStyle.wordSpacing;
    mirror.style.padding = computedStyle.padding;
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflowWrap = 'break-word';

    // Measure each line's height
    const lines = (content || '').split('\n');
    const heights = [];

    mirror.innerHTML = '';
    lines.forEach((line, index) => {
      const lineDiv = document.createElement('div');
      lineDiv.style.whiteSpace = 'pre-wrap';
      lineDiv.style.wordWrap = 'break-word';
      lineDiv.style.overflowWrap = 'break-word';
      // Use a zero-width space for empty lines to ensure they have height
      lineDiv.textContent = line || '\u200B';
      mirror.appendChild(lineDiv);
      heights.push(lineDiv.offsetHeight);
    });

    setLineHeights(heights);
  }, [content, containerRef]);

  // Also recalculate on resize
  useEffect(() => {
    if (!containerRef?.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (!mirrorRef.current || !containerRef?.current) return;
      const container = containerRef.current;
      mirrorRef.current.style.width = `${container.clientWidth}px`;

      // Recalculate heights
      const lines = (content || '').split('\n');
      const heights = [];
      const children = mirrorRef.current.children;
      for (let i = 0; i < children.length; i++) {
        heights.push(children[i].offsetHeight);
      }
      if (heights.length === lines.length) {
        setLineHeights(heights);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [content, containerRef]);

  const lines = (content || '').split('\n');

  return (
    <>
      {/* Hidden mirror div for measuring line heights */}
      <div
        ref={mirrorRef}
        className="line-mirror"
        aria-hidden="true"
      />
      {/* Line numbers gutter */}
      <div
        className="line-numbers-gutter"
        style={{ transform: `translateY(-${scrollTop}px)` }}
      >
        {lines.map((_, index) => (
          <div
            key={index}
            className="line-number"
            style={{
              height: lineHeights[index] ? `${lineHeights[index]}px` : undefined
            }}
          >
            {index + 1}
          </div>
        ))}
      </div>
    </>
  );
};

const MarkdownEditor = forwardRef(({
  initialContent,
  content,
  onChange,
  mode,
  onSourceSelection,
  onRenderSelection,
}, ref) => {
  const editorRef = useRef(null);
  const textareaRef = useRef(null);
  const renderContainerRef = useRef(null);
  const renderSelectionRangeRef = useRef(null);
  const prevModeRef = useRef(mode);
  const [scrollTop, setScrollTop] = useState(0);

  // Expose methods to parent component
  const restoreSelectionAfterInsert = useCallback((insertedText) => {
    if (!insertedText) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    if (renderContainerRef.current) {
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      const isInside =
        (anchorNode && renderContainerRef.current.contains(anchorNode)) ||
        (focusNode && renderContainerRef.current.contains(focusNode));
      if (!isInside) {
        return;
      }
    }

    const range = selection.getRangeAt(0);
    if (!range || !range.collapsed) return;

    const isTextNode = (node) => node && node.nodeType === Node.TEXT_NODE;

    const findFirstTextNode = (node) => {
      if (!node) return null;
      if (isTextNode(node)) return node;
      for (let i = 0; i < node.childNodes.length; i += 1) {
        const found = findFirstTextNode(node.childNodes[i]);
        if (found) return found;
      }
      return null;
    };

    const findLastTextNode = (node) => {
      if (!node) return null;
      if (isTextNode(node)) return node;
      for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
        const found = findLastTextNode(node.childNodes[i]);
        if (found) return found;
      }
      return null;
    };

    const findTextNodeNear = (container, offset) => {
      if (!container || !container.childNodes) return null;
      const count = container.childNodes.length;
      if (count === 0) return null;
      const startIndex = Math.min(Math.max(offset - 1, 0), count - 1);
      for (let i = startIndex; i >= 0; i -= 1) {
        const found = findLastTextNode(container.childNodes[i]);
        if (found) return found;
      }
      for (let i = startIndex + 1; i < count; i += 1) {
        const found = findFirstTextNode(container.childNodes[i]);
        if (found) return found;
      }
      return null;
    };

    let targetNode = range.startContainer;
    let endOffset = range.startOffset;

    if (!isTextNode(targetNode)) {
      if (isTextNode(selection.focusNode)) {
        targetNode = selection.focusNode;
        endOffset = selection.focusOffset;
      } else {
        const nearby = findTextNodeNear(targetNode, range.startOffset);
        if (nearby) {
          targetNode = nearby;
          endOffset = nearby.textContent?.length || 0;
        }
      }
    }

    if (!isTextNode(targetNode)) return;

    const textLength = targetNode.textContent?.length || 0;
    const clampedEnd = Math.min(endOffset, textLength);
    const start = Math.max(0, clampedEnd - insertedText.length);

    if (start === clampedEnd) return;

    const newRange = document.createRange();
    newRange.setStart(targetNode, start);
    newRange.setEnd(targetNode, clampedEnd);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }, []);

  useImperativeHandle(ref, () => ({
    insertText: (text, options = {}) => {
      if (mode === 'source' && textareaRef.current) {
        // Source mode - insert into textarea
        const textarea = textareaRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = content.substring(0, start);
        const after = content.substring(end);
        const newContent = before + text + after;
        onChange(newContent);
        // Restore cursor position after insertion
        setTimeout(() => {
          textarea.selectionStart = start + text.length;
          textarea.selectionEnd = start + text.length;
          textarea.focus();
        }, 0);
      } else if (mode === 'render' && editorRef.current) {
        // Render mode - insert into MDXEditor
        // Get content before insertion to compare
        const contentBefore = editorRef.current.getMarkdown();
        const selection = window.getSelection();
        const hasSelectionInEditor = Boolean(
          selection &&
            selection.rangeCount > 0 &&
            renderContainerRef.current &&
            (renderContainerRef.current.contains(selection.anchorNode) ||
              renderContainerRef.current.contains(selection.focusNode))
        );
        editorRef.current.insertMarkdown(text);

        if (options.preserveSelection) {
          setTimeout(() => {
            restoreSelectionAfterInsert(text);
          }, 0);
        }

        // Check if insertion worked (content changed)
        // Use setTimeout to allow MDXEditor to update
        setTimeout(() => {
          const contentAfter = editorRef.current.getMarkdown();
          if (contentAfter === contentBefore) {
            if (!hasSelectionInEditor) {
              // Insertion didn't work (no cursor position), append to end
              const newContent = (content || '') + text;
              onChange(newContent);
              editorRef.current.setMarkdown(newContent);
            }
          }
        }, 50);
      } else {
        // Fallback: append to end if no editor ref available
        const newContent = (content || '') + text;
        onChange(newContent);
      }
    },
    restoreRenderSelection: () => {
      if (mode !== 'render') {
        return false;
      }
      const range = renderSelectionRangeRef.current;
      if (!range) {
        return false;
      }
      const selection = window.getSelection();
      if (!selection) {
        return false;
      }
      try {
        selection.removeAllRanges();
        selection.addRange(range);
        const focusTarget = renderContainerRef.current?.querySelector('[contenteditable="true"]');
        focusTarget?.focus();
        return true;
      } catch (error) {
        return false;
      }
    },
    replaceText: (oldText, newText) => {
      if (!oldText) {
        return;
      }
      const escapedOldText = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\\\?${escapedOldText}`);
      const newContent = (content || '').replace(pattern, () => newText);
      onChange(newContent);
      if (mode === 'render' && editorRef.current) {
        editorRef.current.setMarkdown(newContent);
      }
    },
    getContent: () => content,
    // Expose textareaRef for source mode operations
    getTextareaRef: () => textareaRef,
  }), [mode, content, onChange]);

  // Sync content to MDXEditor when switching from source mode back to render mode
  // IMPORTANT: We intentionally DO NOT sync content from props to the editor during normal editing.
  // The MDXEditor maintains its own internal state, and calling setMarkdown() resets the cursor position.
  // We only sync when:
  // 1. Switching from source mode back to render mode (the editor might have stale content)
  // 2. Note changes are handled by the key prop in parent causing a full remount
  useEffect(() => {
    const switchedToRender = mode === 'render' && prevModeRef.current === 'source';
    prevModeRef.current = mode;

    if (switchedToRender && editorRef.current) {
      // User switched from source mode to render mode - sync the content
      const currentMarkdown = editorRef.current.getMarkdown();
      if (currentMarkdown !== content) {
        editorRef.current.setMarkdown(content || '');
      }
    }
    // Note: We intentionally do NOT sync on content changes during normal editing
    // because calling setMarkdown() resets the cursor position
  }, [content, mode]);

  const handleEditorChange = useCallback((newMarkdown) => {
    onChange(newMarkdown);
  }, [onChange]);

  const handleTextareaChange = useCallback((e) => {
    onChange(e.target.value);
  }, [onChange]);

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  // Handle selection events for source mode
  const handleSourceMouseUp = useCallback((e) => {
    if (onSourceSelection) {
      onSourceSelection(e, textareaRef.current);
    }
  }, [onSourceSelection]);

  const handleSourceKeyUp = useCallback((e) => {
    if (onSourceSelection && (e.shiftKey || e.key === 'Shift')) {
      onSourceSelection(e, textareaRef.current);
    }
  }, [onSourceSelection]);

  const reportRenderSelection = useCallback((event) => {
    if (!onRenderSelection) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      onRenderSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!range || range.collapsed) {
      onRenderSelection(null);
      return;
    }

    if (renderContainerRef.current) {
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      const isInside =
        (anchorNode && renderContainerRef.current.contains(anchorNode)) ||
        (focusNode && renderContainerRef.current.contains(focusNode));
      if (!isInside) {
        onRenderSelection(null);
        return;
      }
    }

    const selectedText = selection.toString();
    if (!selectedText) {
      onRenderSelection(null);
      return;
    }

    renderSelectionRangeRef.current = range.cloneRange();

    const rects = range.getClientRects();
    const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    const position = rect
      ? { x: rect.left + rect.width / 2, y: rect.top - 10 }
      : event?.clientX
        ? { x: event.clientX, y: event.clientY - 10 }
        : null;

    onRenderSelection({ text: selectedText, position });
  }, [onRenderSelection]);

  const handleRenderMouseUp = useCallback((e) => {
    // Small delay to ensure selection is finalized
    setTimeout(() => reportRenderSelection(e), 0);
  }, [reportRenderSelection]);

  const handleRenderKeyUp = useCallback((e) => {
    if (e.shiftKey || e.key === 'Shift') {
      reportRenderSelection(e);
    }
  }, [reportRenderSelection]);

  // Source mode - raw markdown textarea with line numbers
  if (mode === 'source') {
    return (
      <div className="markdown-editor source-mode">
        <div className="source-editor-container">
          <div className="line-numbers-wrapper">
            <LineNumbers
              content={content}
              containerRef={textareaRef}
              scrollTop={scrollTop}
            />
          </div>
          <textarea
            ref={textareaRef}
            className="markdown-source-textarea"
            value={content}
            onChange={handleTextareaChange}
            onScroll={handleScroll}
            onMouseUp={handleSourceMouseUp}
            onKeyUp={handleSourceKeyUp}
            placeholder="Write markdown here..."
            spellCheck="true"
          />
        </div>
      </div>
    );
  }

  // Render mode - WYSIWYG
  // Use initialContent for MDXEditor's markdown prop (used on mount)
  // The content prop is used for syncing via useEffect after edits
  return (
    <div className="markdown-editor render-mode">
      <div
        ref={renderContainerRef}
        className="mdx-editor-scroll-wrapper"
        onMouseUp={handleRenderMouseUp}
        onKeyUp={handleRenderKeyUp}
      >
        <MDXEditor
          ref={editorRef}
          className="mdx-editor-root"
          markdown={initialContent !== undefined ? initialContent : (content || '')}
          onChange={handleEditorChange}
          suppressHtmlProcessing={true}
          contentEditableClassName="mdx-editor-content"
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            tablePlugin(),
            thematicBreakPlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: 'javascript' }),
            codeMirrorPlugin({
              codeBlockLanguages: {
                js: 'JavaScript',
                javascript: 'JavaScript',
                ts: 'TypeScript',
                typescript: 'TypeScript',
                python: 'Python',
                py: 'Python',
                css: 'CSS',
                html: 'HTML',
                json: 'JSON',
                bash: 'Bash',
                sh: 'Shell',
                sql: 'SQL',
                markdown: 'Markdown',
                md: 'Markdown',
                jsx: 'JSX',
                tsx: 'TSX',
                go: 'Go',
                rust: 'Rust',
                java: 'Java',
                c: 'C',
                cpp: 'C++',
                '': 'Plain Text',
              },
            }),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <>
                  <UndoRedo />
                  <Separator />
                  <BlockTypeSelect />
                  <Separator />
                  <BoldItalicUnderlineToggles />
                  <HighlightToggle />
                  <Separator />
                  <ListsToggle />
                  <Separator />
                  <CreateLink />
                  <InsertTable />
                  <InsertThematicBreak />
                </>
              ),
            }),
          ]}
        />
      </div>
    </div>
  );
});

export default MarkdownEditor;
