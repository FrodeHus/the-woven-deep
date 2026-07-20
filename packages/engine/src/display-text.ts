const DISPLAY_LIMIT = 40;
const EMPTY_DISPLAY_LABEL = 'Unknown';

function cleanedDisplayText(value: string, emptyLabel = EMPTY_DISPLAY_LABEL): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .normalize('NFC');
  return cleaned.length === 0 ? emptyLabel : cleaned;
}

export function boundedDisplayText(value: string): string {
  return [...cleanedDisplayText(value)].slice(0, DISPLAY_LIMIT).join('');
}

export function boundedPrefixedDisplay(prefix: string, value: string): string {
  const safePrefix = cleanedDisplayText(prefix, '');
  const prefixPoints = [...safePrefix].slice(0, DISPLAY_LIMIT);
  return (
    prefixPoints.join('') +
    [...cleanedDisplayText(value)].slice(0, DISPLAY_LIMIT - prefixPoints.length).join('')
  );
}

export function boundedSuffixedDisplay(value: string, suffix: string): string {
  const suffixPoints = [...cleanedDisplayText(suffix, '')].slice(-DISPLAY_LIMIT);
  return (
    [...cleanedDisplayText(value)].slice(0, DISPLAY_LIMIT - suffixPoints.length).join('') +
    suffixPoints.join('')
  );
}
