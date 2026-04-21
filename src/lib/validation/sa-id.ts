// South African ID number validation.
// 13 digits: YYMMDD GSSS C A Z
//   YYMMDD = date of birth
//   G      = gender (0–4 female, 5–9 male)
//   SSS    = sequence
//   C      = citizenship (0 SA, 1 permanent resident)
//   A      = historically 8 or 9; unused now
//   Z      = Luhn checksum over the preceding 12 digits
//
// SA ID uses a Luhn variant: digits in odd positions taken as-is, and the
// concatenation of the even-position digits doubled is treated as one number
// whose digits are then summed. We implement the equivalent standard Luhn.
export function isValidSaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;

  // Date-of-birth sanity check.
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;

  // Luhn over all 13 digits.
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let n = Number(id[i]);
    if ((12 - i) % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

// Infer DOB from SA ID. Rolls the 2-digit year against today using the common
// "people alive today are ≤ 110 years old" heuristic.
export function dobFromSaId(id: string): string | null {
  if (!isValidSaId(id)) return null;
  const yy = Number(id.slice(0, 2));
  const mm = id.slice(2, 4);
  const dd = id.slice(4, 6);
  const now = new Date();
  const currentYy = now.getFullYear() % 100;
  const century = yy > currentYy ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}
