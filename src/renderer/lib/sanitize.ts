/**
 * Browser-side HTML sanitizer using DOMParser.
 * Mirrors src/main/security/index.ts sanitizeHtml() — same allow-list.
 *
 * SECURITY: This MUST be used before injecting any AI output into the DOM.
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'EM', 'CODE', 'PRE', 'SPAN', 'DIV',
  'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'A', 'B', 'I', 'BLOCKQUOTE',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'rel']),
  CODE: new Set(['class']),
  PRE: new Set(['class']),
  SPAN: new Set(['class']),
  DIV: new Set(['class']),
  H1: new Set(['class']),
  H2: new Set(['class']),
  H3: new Set(['class']),
};

export function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') return '';
  // Pre-strip script/style/template content before parsing, because
  // jsdom (used in tests) keeps script text content as plain text after parsing.
  // In real browsers <script> body would be escaped, but doing this pre-strip
  // is also defense-in-depth against any parser quirks.
  const preStripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  const doc = new DOMParser().parseFromString(preStripped, 'text/html');
  walkAndStrip(doc.body);
  return doc.body.innerHTML;
}

function walkAndStrip(node: Node): void {
  let child = node.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toUpperCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: replace element with its children, keep text content
        while (el.firstChild) node.insertBefore(el.firstChild, el);
        node.removeChild(el);
        child = next;
        continue;
      }
      // Strip all non-allowed attributes
      const allowedAttrs = ALLOWED_ATTRS[tag] || new Set<string>();
      const toRemove: string[] = [];
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i].name.toLowerCase();
        if (!allowedAttrs.has(attr)) {
          toRemove.push(el.attributes[i].name);
        }
      }
      toRemove.forEach((a) => el.removeAttribute(a));
      // Validate href on <a>
      if (tag === 'A') {
        const href = el.getAttribute('href') || '';
        if (!/^(https?:|mailto:|#|\/)/i.test(href)) {
          el.removeAttribute('href');
        }
        // Force safe rel on external links
        if (href.startsWith('http')) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
      }
      walkAndStrip(el);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      node.removeChild(child);
    }
    child = next;
  }
}
