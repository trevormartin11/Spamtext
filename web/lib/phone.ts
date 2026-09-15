/** Normalize a phone number / short code the way the pipeline stores it. */
export function normalizePhone(raw: string): string {
  const s = raw.trim();
  const digits = s.replace(/[^\d+]/g, "");
  // short codes: 5-6 digits, no country code
  if (/^\d{4,6}$/.test(digits)) return digits;
  let d = digits.replace(/\+/g, "");
  if (d.length === 10) d = "1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  if (d.length > 11) return "+" + d;
  // alphanumeric sender IDs or email-to-SMS gateways: keep as-is (lowercased)
  return s.toLowerCase();
}

export function isShortCode(phone: string): boolean {
  return /^\d{4,6}$/.test(phone);
}

export function isE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone);
}

export function prettyPhone(phone: string): string {
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}
