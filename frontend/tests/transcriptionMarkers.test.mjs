import assert from 'node:assert/strict';
import { buildMarkerCandidates, replaceMarkerInText } from '../src/utils/transcriptionMarkers.js';

const RAW = '[[tx:abc-123:Transcription ongoing...]]';
const TRANSCRIPT = 'hello transcript';

const testRawMarkerReplacement = () => {
  const input = `before ${RAW} after`;
  const result = replaceMarkerInText(input, RAW, TRANSCRIPT);
  assert.equal(result.replaced, true);
  assert.equal(result.output, `before ${TRANSCRIPT} after`);
};

const testEscapedLeftBracketsReplacement = () => {
  const escaped = '\\[\\[tx:abc-123:Transcription ongoing...]]';
  const input = `before ${escaped} after`;
  const result = replaceMarkerInText(input, RAW, TRANSCRIPT);
  assert.equal(result.replaced, true);
  assert.equal(result.output, `before ${TRANSCRIPT} after`);
};

const testFullyEscapedReplacement = () => {
  const escaped = '\\[\\[tx:abc-123:Transcription ongoing...\\]\\]';
  const input = `before ${escaped} after`;
  const result = replaceMarkerInText(input, RAW, TRANSCRIPT);
  assert.equal(result.replaced, true);
  assert.equal(result.output, `before ${TRANSCRIPT} after`);
};

const testNoReplacement = () => {
  const input = 'before marker-missing after';
  const result = replaceMarkerInText(input, RAW, TRANSCRIPT);
  assert.equal(result.replaced, false);
  assert.equal(result.output, input);
};

const testCandidateGeneration = () => {
  const candidates = buildMarkerCandidates(RAW);
  assert.ok(candidates.includes(RAW));
  assert.ok(candidates.some((candidate) => candidate.includes('\\[\\[')));
};

const main = () => {
  testRawMarkerReplacement();
  testEscapedLeftBracketsReplacement();
  testFullyEscapedReplacement();
  testNoReplacement();
  testCandidateGeneration();
  console.log('transcription marker tests OK');
};

main();
