const NAME_PART = /^[\p{L}\p{M}][\p{L}\p{M}'?.-]*(?: [\p{L}\p{M}][\p{L}\p{M}'?.-]*)*$/u;

function cleanPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeLegalNameParts(firstName, lastName) {
  const first = cleanPart(firstName);
  const last = cleanPart(lastName);
  if (!first || !last || first.length > 80 || last.length > 120) return null;
  if (!NAME_PART.test(first) || !NAME_PART.test(last)) return null;
  return { firstName: first, lastName: last, fullName: `${first} ${last}` };
}

export function legalNameFromUser(user) {
  const fullName = cleanPart(user?.full_name || user?.name || '');
  const parts = fullName.split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return normalizeLegalNameParts(parts[0], parts.slice(1).join(' '));
}
