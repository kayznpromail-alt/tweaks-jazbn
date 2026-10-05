/** Literal documentation and source placeholders are not credential values.
 * Configured credentials are always matched separately, including these words. */
function placeholder(value: string): boolean {
  const token = value.replace(/[.,;:)]+$/, "");
  return /^(?:\$?\{[^\r\n]{1,256}\}|<[A-Za-z_][A-Za-z0-9_ -]*>|\$(?:env:)?[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|%[svdq]|process\.env\.[A-Za-z_][A-Za-z0-9_]*|YOUR_[A-Z_]+)$/.test(token);
}

export function redactRecognizableSecrets(text: string, marker = "[redacted]"): string {
  return text
    .replace(/\bbearer[ \t]+(\$\{[^}\r\n]{1,256}\}|\{\{?[^}\r\n]{1,256}\}\}?|[^\s"'`\\]+)/gi, (match, value: string) =>
      placeholder(value) || /^(?:tokens?|authentication|authorization|scheme|headers?|auth)[.,;:)]*$/i.test(value) ? match : marker)
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, marker)
    .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g, marker)
    .replace(/https?:\/\/[^\s/]+:[^\s/]+@/gi, marker)
    .replace(/[?&](?:api_?key|token|secret|password)=(\$\{[^}\r\n]{1,256}\}|\{\{?[^}\r\n]{1,256}\}\}?|[^\s&"'`\\]+)/gi, (match, value: string) => placeholder(value) ? match : marker);
}

export const hasRecognizableSecret = (text: string): boolean => redactRecognizableSecrets(text) !== text;
