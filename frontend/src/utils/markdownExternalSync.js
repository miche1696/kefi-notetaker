export const shouldSyncExternalMarkdown = ({
  mode,
  switchedToRender,
  content,
  lastEditorMarkdown,
}) => {
  if (mode !== 'render') {
    return false;
  }
  if (switchedToRender) {
    return true;
  }
  return (content || '') !== (lastEditorMarkdown || '');
};
