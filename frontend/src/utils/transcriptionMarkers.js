export const buildMarkerCandidates = (markerToken) => {
  if (!markerToken) return [];

  const candidates = [
    markerToken,
    markerToken.replace('[[', '\\[\\['),
    markerToken.replace('[[', '\\[\\[').replace(']]', '\\]\\]'),
    markerToken.replace(/\[/g, '\\[').replace(/\]/g, '\\]'),
  ];

  return [...new Set(candidates)];
};

export const replaceMarkerInText = (input, markerToken, replacementText) => {
  const text = input ?? '';
  for (const candidate of buildMarkerCandidates(markerToken)) {
    if (!text.includes(candidate)) continue;
    return {
      replaced: true,
      matchedMarker: candidate,
      output: text.replace(candidate, replacementText),
    };
  }
  return {
    replaced: false,
    matchedMarker: null,
    output: text,
  };
};
