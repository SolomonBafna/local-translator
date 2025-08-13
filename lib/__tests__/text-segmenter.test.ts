import { TextSegmenter } from '../text-segmenter';

// Helper to create an element from HTML string
function el(html: string): Element {
  const container = document.createElement('div');
  container.innerHTML = html.trim();
  return container.firstElementChild as Element;
}

describe('TextSegmenter', () => {
  it('merges inline text across inline elements into one segment', () => {
    const segmenter = new TextSegmenter();
    const root = el('<p>Hello <span>world</span>!</p>');
    const segs = segmenter.segmentElement(root);

    expect(segs.length).toBe(1);
    expect(segs[0].text).toBe('Hello world!');
    expect(segs[0].nodes.length).toBeGreaterThanOrEqual(2); // includes nested text nodes
    expect(segs[0].parentElement.tagName).toBe('P');
  });

  it('creates separate segments across block boundaries', () => {
    const segmenter = new TextSegmenter();
    const root = el('<div><p>First paragraph.</p><p>Second paragraph.</p></div>');
    const segs = segmenter.segmentElement(root as Element);

    expect(segs.length).toBe(2);
    expect(segs[0].text).toBe('First paragraph.');
    expect(segs[1].text).toBe('Second paragraph.');
  });

  it('skips content inside skipTags (e.g., code, pre)', () => {
    const segmenter = new TextSegmenter();
    const root = el('<div>Hello <code>NO</code> world</div>');
    const segs = segmenter.segmentElement(root as Element);

    // Might split around skipped tags; ensure combined text excludes skipped content
    const combined = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    expect(combined).toBe('Hello world');
    expect(combined.includes('NO')).toBe(false);
  });

  it('respects exclude set to avoid collecting specific subtrees', () => {
    const segmenter = new TextSegmenter();
    const root = el('<div>Hello <em>excluded</em> world</div>') as Element;
    const exclude = new Set<Element>();
    const em = root.querySelector('em')!;
    exclude.add(em);

    const segs = segmenter.segmentElement(root, exclude);
    const combined = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    expect(combined).toBe('Hello world');
    expect(combined.includes('excluded')).toBe(false);
  });

  it('adds before/after context between adjacent segments when preserveContext is enabled', () => {
    const segmenter = new TextSegmenter({ preserveContext: true, contextOverlap: 100 });
    const root = el('<div><p>First block of text.</p><p>Second block follows.</p></div>');
    const segs = segmenter.segmentElement(root as Element);

    expect(segs.length).toBe(2);
    expect(segs[0].context?.after).toBe('Second block follows.');
    expect(segs[1].context?.before).toBe('First block of text.');
  });

  it('produces stable fingerprints for identical text', () => {
    const segmenter = new TextSegmenter();
    const root = el('<div><p>Same text</p><p>Same text</p></div>');
    const segs = segmenter.segmentElement(root as Element);

    expect(segs.length).toBe(2);
    expect(segs[0].fingerprint).toBe(segs[1].fingerprint);
  });
});
