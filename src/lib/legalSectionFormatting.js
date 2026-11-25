// Split the active policy text at known topic boundaries. Fall back to the
// original Markdown when a new policy version changes those boundaries.
export function getLegalSectionBullets(markdown, boundaries, copyEdits = []) {
  if (!boundaries) return null;
  if (/^\s*(?:[-*+] |\d+\. |#)/m.test(markdown)) return null;

  const starts = [0];
  for (const [, anchor] of boundaries.slice(1)) {
    const index = markdown.indexOf(anchor, starts.at(-1) + 1);
    if (index < 0) return null;
    starts.push(index);
  }

  return boundaries.map(([label], index) => {
    let text = markdown.slice(starts[index], starts[index + 1]).trim();
    for (const [original, replacement] of copyEdits) {
      text = text.replace(original, replacement).trim();
    }
    return { label, text };
  });
}
