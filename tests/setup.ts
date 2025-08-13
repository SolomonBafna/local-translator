// Vitest setup: provide a predictable getComputedStyle and minor DOM shims if needed.

// Map common tags to display values for segmentation logic
const INLINE_TAGS = new Set([
  'a','abbr','acronym','b','bdi','bdo','big','br','cite','code','data','del','dfn','em','i','ins','kbd','mark','q','s','samp','small','span','strong','sub','sup','time','u','var','wbr'
]);

const BLOCK_FALLBACK = 'block';

// Override getComputedStyle to return consistent values
// @ts-ignore
globalThis.window.getComputedStyle = (el: Element) => {
  const tag = (el as any).localName?.toLowerCase?.() || '';
  const display = INLINE_TAGS.has(tag) ? 'inline' : BLOCK_FALLBACK;
  return {
    display,
    visibility: 'visible',
    opacity: '1',
  } as any;
};

// Ensure replaceChildren exists for happy-dom older versions
if (!(Element.prototype as any).replaceChildren) {
  (Element.prototype as any).replaceChildren = function (...nodes: any[]) {
    this.innerHTML = '';
    nodes.forEach((n) => {
      if (n && (n as any).nodeType === 11 && 'childNodes' in n) {
        // DocumentFragment
        Array.from((n as any).childNodes).forEach((c: any) => this.appendChild(c));
      } else if (n) {
        this.appendChild(n);
      }
    });
  };
}

