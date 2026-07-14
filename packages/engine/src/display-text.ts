const DISPLAY_LIMIT = 40;

export function boundedDisplayText(value: string): string {
  return [...value].slice(0, DISPLAY_LIMIT).join('');
}

export function boundedPrefixedDisplay(prefix: string, value: string): string {
  return prefix + [...value].slice(0, DISPLAY_LIMIT - [...prefix].length).join('');
}

export function boundedSuffixedDisplay(value: string, suffix: string): string {
  return [...value].slice(0, DISPLAY_LIMIT - [...suffix].length).join('') + suffix;
}
