interface SegmentOptions {
  maxChunkSize?: number;
  minChunkSize?: number;
  preserveSentences?: boolean;
  preserveContext?: boolean;
  contextOverlap?: number;
  skipTags?: Set<string>;
  inlineTags?: Set<string>;
}

interface TextSegment {
  nodes: Text[];
  text: string;
  parentElement: Element;
  topElement?: Element;
  bottomElement?: Element;
  context?: {
    before?: string;
    after?: string;
  };
  fingerprint: string;
}

interface ElementBoundaryInfo {
  isInline: boolean;
  isSkipped: boolean;
  isTranslatable: boolean;
  computedDisplay: string;
}

export class TextSegmenter {
  private options: Required<SegmentOptions>;
  private segmentCache = new WeakMap<Element, TextSegment[]>();
  private fingerprintCache = new Map<string, string>();
  
  constructor(options: SegmentOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 1000,
      minChunkSize: options.minChunkSize ?? 50,
      preserveSentences: options.preserveSentences ?? true,
      preserveContext: options.preserveContext ?? true,
      contextOverlap: options.contextOverlap ?? 100,
      skipTags: options.skipTags ?? new Set([
        'style', 'script', 'noscript', 'svg', 'img', 'video', 'audio',
        'textarea', 'input', 'button', 'select', 'option', 'iframe',
        'code', 'pre'
      ]),
      inlineTags: options.inlineTags ?? new Set([
        'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'br', 'cite',
        'code', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark',
        'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup',
        'time', 'u', 'var', 'wbr'
      ])
    };
  }
  
  segmentElement(element: Element, exclude?: Set<Element>): TextSegment[] {
    const cached = this.segmentCache.get(element);
    if (cached && !exclude) return cached;
    
    const segments = this.collectSegments(element, exclude);
    if (!exclude) {
      this.segmentCache.set(element, segments);
    }
    return segments;
  }
  
  segmentRoot(root: Element | ShadowRoot, exclude?: Set<Element>): TextSegment[] {
    const segments = this.collectSegments(root, exclude);
    if (root instanceof Element) {
      this.segmentCache.set(root, segments);
    }
    return segments;
  }
  
  private collectSegments(root: Element | ShadowRoot, exclude?: Set<Element>): TextSegment[] {
    const segments: TextSegment[] = [];
    const state = {
      currentSegment: null as TextSegment | null,
      currentSize: 0
    };
    
    const processNode = (node: Node, parentElement: Element): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        const content = text.textContent || '';
        
        if (!content.trim()) return;
        
        if (!state.currentSegment || this.shouldStartNewSegment(state.currentSize, content)) {
          if (state.currentSegment) {
            this.finalizeSegment(state.currentSegment);
            segments.push(state.currentSegment);
          }
          
          state.currentSegment = {
            nodes: [],
            text: '',
            parentElement: this.findNonInlineParent(parentElement),
            fingerprint: ''
          };
          state.currentSize = 0;
        }
        
        state.currentSegment.nodes.push(text);
        state.currentSegment.text += content;
        state.currentSize += content.length;
        
        if (!state.currentSegment.topElement) {
          state.currentSegment.topElement = parentElement;
        }
        state.currentSegment.bottomElement = parentElement;
        
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        // If this element is in the exclusion set, treat it as a hard boundary and skip its subtree
        if (exclude && exclude.has(element)) {
          if (state.currentSegment && state.currentSegment.nodes.length > 0) {
            this.finalizeSegment(state.currentSegment);
            segments.push(state.currentSegment);
            state.currentSegment = null;
            state.currentSize = 0;
          }
          return;
        }
        const boundary = this.getElementBoundaryInfo(element);
        
        if (boundary.isSkipped) {
          if (state.currentSegment && state.currentSegment.nodes.length > 0) {
            this.finalizeSegment(state.currentSegment);
            segments.push(state.currentSegment);
            state.currentSegment = null;
            state.currentSize = 0;
          }
          return;
        }
        
        if (!boundary.isInline && state.currentSegment && state.currentSegment.nodes.length > 0) {
          this.finalizeSegment(state.currentSegment);
          segments.push(state.currentSegment);
          state.currentSegment = null;
          state.currentSize = 0;
        }
        
        if (element.shadowRoot) {
          const shadowSegments = this.collectSegments(element.shadowRoot);
          segments.push(...shadowSegments);
        } else {
          for (const child of element.childNodes) {
            processNode(child, element);
          }
        }
        
        if (!boundary.isInline && state.currentSegment && state.currentSegment.nodes.length > 0) {
          this.finalizeSegment(state.currentSegment);
          segments.push(state.currentSegment);
          state.currentSegment = null;
          state.currentSize = 0;
        }
      }
    };
    
    const rootElement = root instanceof Element ? root : (root.host as Element || document.body);
    for (const child of root.childNodes) {
      processNode(child, rootElement);
    }
    
    // Finalize any remaining segment
    if (state.currentSegment && state.currentSegment.nodes.length > 0) {
      this.finalizeSegment(state.currentSegment);
      segments.push(state.currentSegment);
    }
    
    if (this.options.preserveContext) {
      this.addContextToSegments(segments);
    }
    
    return segments;
  }
  
  private shouldStartNewSegment(currentSize: number, newContent: string): boolean {
    if (currentSize === 0) return true;
    
    const totalSize = currentSize + newContent.length;
    if (totalSize > this.options.maxChunkSize) {
      if (this.options.preserveSentences) {
        const sentenceEnd = /[.!?。！？]\s*$/.test(newContent);
        if (sentenceEnd || currentSize >= this.options.maxChunkSize) {
          return true;
        }
      } else {
        return true;
      }
    }
    
    return false;
  }
  
  private getElementBoundaryInfo(element: Element): ElementBoundaryInfo {
    const tagName = element.tagName.toLowerCase();
    
    if (this.options.skipTags.has(tagName)) {
      return { isInline: false, isSkipped: true, isTranslatable: false, computedDisplay: '' };
    }
    
    if (element.classList.contains('notranslate') || 
        element.getAttribute('translate') === 'no' ||
        (element as HTMLElement).contentEditable === 'true') {
      return { isInline: false, isSkipped: true, isTranslatable: false, computedDisplay: '' };
    }
    
    const style = window.getComputedStyle(element);
    const display = style.display;
    
    const isInline = display === 'inline' || 
                     display === 'inline-block' || 
                     display === 'inline-flex' ||
                     this.options.inlineTags.has(tagName);
    
    return {
      isInline,
      isSkipped: false,
      isTranslatable: true,
      computedDisplay: display
    };
  }
  
  private findNonInlineParent(element: Element): Element {
    let current = element;
    
    while (current && current !== document.body) {
      const boundary = this.getElementBoundaryInfo(current);
      if (!boundary.isInline) {
        return current;
      }
      current = current.parentElement || current;
    }
    
    return element;
  }
  
  private finalizeSegment(segment: TextSegment): void {
    segment.text = segment.text.trim();
    segment.fingerprint = this.generateFingerprint(segment.text);
  }
  
  private addContextToSegments(segments: TextSegment[]): void {
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      if (i > 0) {
        const prevText = segments[i - 1].text;
        segment.context = segment.context || {};
        segment.context.before = prevText.slice(-this.options.contextOverlap);
      }
      
      if (i < segments.length - 1) {
        const nextText = segments[i + 1].text;
        segment.context = segment.context || {};
        segment.context.after = nextText.slice(0, this.options.contextOverlap);
      }
    }
  }
  
  private generateFingerprint(text: string): string {
    const cached = this.fingerprintCache.get(text);
    if (cached) return cached;
    
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    const fingerprint = Math.abs(hash).toString(36);
    this.fingerprintCache.set(text, fingerprint);
    return fingerprint;
  }
  
  clearCache(): void {
    this.segmentCache = new WeakMap();
    this.fingerprintCache.clear();
  }
  
  getCachedTranslation(fingerprint: string): string | undefined {
    return this.fingerprintCache.get(fingerprint);
  }
  
  setCachedTranslation(fingerprint: string, translation: string): void {
    this.fingerprintCache.set(fingerprint, translation);
  }
}
