import { DomTranslator } from '../dom-translator';

// Helper to create an element from HTML string
function el(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html.trim();
  return container.firstElementChild as HTMLElement;
}

// Simple stub translator that marks outputs for verification
const stubTranslate = async (text: string): Promise<string> => `ZH:${text}`;

// Stub language detector that treats all input as English
const stubLanguageDetector = {
  async detectLanguage(_text: string) {
    return { language: 'en', percentage: 100, isReliable: true } as const;
  },
  async isEnglish(_text: string) { return true; },
  async detectBatch(texts: string[]) { return texts.map(() => ({ language: 'en', percentage: 100, isReliable: true })); },
  async areAllEnglish(texts: string[]) { return texts.map(() => true); },
  async filterEnglishSegments<T extends { text: string }>(segments: T[]): Promise<T[]> { return segments; },
  clearCache() { /* no-op */ },
};

describe('DomTranslator.translateElement', () => {
  it('renders overlay host with translated content', async () => {
    const hostTag = 'x-test-trans';
    const rule = {
      selector: 'div',
      displayMode: 'overlay' as const,
      trigger: 'manual' as const,
      minLen: 1,
      maxLen: 10000,
      translateTitle: false,
      segmentOptions: { preserveContext: false },
    };
    const setting = {
      hostTag,
      hostClass: 'test-trans',
      reflowDebounce: 10,
      visibleThreshold: 0,
      skipTags: ['style','script','img','video','audio','textarea','input','button','select','option','iframe'],
    };

    const node = el('<div>Hello world</div>');
    document.body.appendChild(node);
    const dt = new DomTranslator(rule as any, setting as any, stubTranslate);
    (dt as any).languageDetector = stubLanguageDetector;

    // Pre-insert style marker to bypass CSS injection path on Document
    const preStyle = document.createElement('style');
    preStyle.setAttribute('data-loc-trans-css', '1');
    document.head.appendChild(preStyle);

    await dt.translateElement(node);

    const host = node.querySelector(hostTag)!;
    expect(host).toBeTruthy();
    expect(host.getAttribute('data-mode')).toBe('overlay');
    expect(host.textContent?.trim()).toBe('ZH:Hello world');
  });

  it('replaces text content in replace mode', async () => {
    const hostTag = 'x-test-trans';
    const rule = {
      selector: 'span',
      displayMode: 'replace' as const,
      trigger: 'manual' as const,
      minLen: 1,
      maxLen: 10000,
      translateTitle: false,
      segmentOptions: { preserveContext: false },
    };
    const setting = {
      hostTag,
      hostClass: 'test-trans',
      reflowDebounce: 10,
      visibleThreshold: 0,
      skipTags: ['style','script','img','video','audio','textarea','input','button','select','option','iframe'],
    };

    const node = el('<span>Hi</span>');
    document.body.appendChild(node);
    const dt = new DomTranslator(rule as any, setting as any, stubTranslate);
    (dt as any).languageDetector = stubLanguageDetector;

    // Pre-insert style marker to bypass CSS injection path on Document
    const preStyle = document.createElement('style');
    preStyle.setAttribute('data-loc-trans-css', '1');
    document.head.appendChild(preStyle);

    await dt.translateElement(node);

    // In replace mode, there should be no overlay host; text is modified in place
    expect(node.querySelector(hostTag)).toBeNull();
    expect(node.textContent).toBe('ZH:Hi');
  });
});
