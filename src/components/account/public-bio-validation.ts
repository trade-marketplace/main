export const BIO_LIMIT = 300;

export function bioError(value: string): string | null {
  if (/\p{Cc}/u.test(value)) return "Use plain text without control characters.";
  if (Array.from(value.trim()).length > BIO_LIMIT) return "Keep your bio to 300 characters.";
  return null;
}
