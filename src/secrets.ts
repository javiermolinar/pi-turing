/** Conservative credential tripwires, not a substitute for reviewing disclosures. */
export function rejectSecrets(text: string): void {
  if (/\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|\b[a-z][\w+.-]*:\/\/[^\s/:]+:[^\s@]{8,}@/i.test(text)) throw new Error("Possible credentials in selected context; redact the file before attaching it");
  if (/-----BEGIN [^-\n]*(?:PRIVATE KEY|OPENSSH)[^-\n]*-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:api[_-]?key|password|secret|access[_-]?token)["']?\s*[=:]\s*["']?[^\s"']{16,}/i.test(text)) throw new Error("Possible credentials in selected context; redact the file before attaching it");
}
