// src/utils/phone.js
// THE single Indian-mobile normalizer/validator. Extracted so every create-user
// path shares one implementation instead of the three that had drifted
// (auth.js normalizePhone, users.js attendant `clean.startsWith('91')`,
// superadmin.js `storedPhone`). See docs/drift-audit.md.

// Normalize to +91XXXXXXXXXX.
const normalizePhone = (raw) => {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');       // strip everything non-digit
  if (digits.length === 10) return `+91${digits}`;     // plain 10-digit
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;      // 91XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0'))  return `+91${digits.slice(1)}`; // 0XXXXXXXXXX
  return `+91${digits.slice(-10)}`;                    // fallback — take last 10
};

// True if `raw` reduces to a valid 10-digit Indian mobile (starts 6-9).
const validatePhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  const ten = digits.length === 10 ? digits
    : digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0')  ? digits.slice(1)
    : digits.slice(-10);
  return /^[6-9]\d{9}$/.test(ten);
};

module.exports = { normalizePhone, validatePhone };
