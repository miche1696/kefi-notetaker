import assert from 'node:assert/strict';
import { shouldSyncExternalMarkdown } from '../src/utils/markdownExternalSync.js';

{
  const result = shouldSyncExternalMarkdown({
    mode: 'render',
    switchedToRender: false,
    content: 'new content from backend',
    lastEditorMarkdown: 'old content with marker',
  });
  assert.equal(result, true, 'render mode should sync when external content changed');
}

{
  const result = shouldSyncExternalMarkdown({
    mode: 'render',
    switchedToRender: false,
    content: 'same content',
    lastEditorMarkdown: 'same content',
  });
  assert.equal(result, false, 'render mode should not sync while typing unchanged content');
}

{
  const result = shouldSyncExternalMarkdown({
    mode: 'render',
    switchedToRender: true,
    content: 'source mode latest',
    lastEditorMarkdown: 'stale render value',
  });
  assert.equal(result, true, 'switching source->render should force sync');
}

{
  const result = shouldSyncExternalMarkdown({
    mode: 'source',
    switchedToRender: false,
    content: 'anything',
    lastEditorMarkdown: 'anything else',
  });
  assert.equal(result, false, 'source mode sync is handled by controlled textarea');
}

console.log('markdown external sync tests OK');
