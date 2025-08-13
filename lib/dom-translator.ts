import { TextSegmenter } from './text-segmenter';

interface Rule {
  selector: string;
  keepSelector?: string;
  terms?: string;
  displayMode?: 'overlay' | 'replace';
  trigger?: 'scroll' | 'open' | 'hover' | 'manual';
  hoverKey?: 'alt' | 'ctrl' | 'shift';
  minLen?: number;
  maxLen?: number;
  selectStyle?: string;
  parentStyle?: string;
  textStyle?: 'fuzzy' | 'dashline';
  onRenderStart?: (el: Element, rawText: string) => void;
  onRemove?: (el: Element) => void;
  translateTitle?: boolean;
  segmentOptions?: {
    maxChunkSize?: number;
    minChunkSize?: number;
    preserveSentences?: boolean;
    preserveContext?: boolean;
  };
}

interface Setting {
  reflowDebounce?: number;
  visibleThreshold?: number;
  skipTags?: string[];
  hostTag?: string;
}

interface Cache {
  snapshot?: string;
  htmlBackup?: string;
  lastId?: string;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms = 200): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

export class DomTranslator {
  private rule: Required<Omit<Rule, 'keepSelector' | 'terms' | 'selectStyle' | 'parentStyle' | 'onRenderStart' | 'onRemove' | 'hoverKey' | 'segmentOptions'>> & Pick<Rule, 'keepSelector' | 'terms' | 'selectStyle' | 'parentStyle' | 'onRenderStart' | 'onRemove' | 'hoverKey' | 'segmentOptions'>;
  private setting: Required<Setting>;
  private translate: (text: string) => Promise<string>;
  private rootSet = new Set<Document | ShadowRoot>();
  private targetMap = new Map<Element, Cache>();
  private io?: IntersectionObserver;
  private mo?: MutationObserver;
  private _origTitle?: string;
  private _origAttachShadow?: typeof HTMLElement.prototype.attachShadow;
  private _retranslate: () => void;
  private _isUpdating = false;
  private textSegmenter: TextSegmenter;
  private translationCache = new Map<string, string>();
  private translatingFingerprints = new Set<string>();

  constructor(rule: Rule, setting: Setting, translate: (text: string) => Promise<string>) {
    this.rule = {
      selector: rule.selector,
      keepSelector: rule.keepSelector,
      terms: rule.terms,
      displayMode: rule.displayMode ?? 'overlay',
      trigger: rule.trigger ?? 'scroll',
      hoverKey: rule.hoverKey,
      minLen: rule.minLen ?? 2,
      maxLen: rule.maxLen ?? 8000,
      selectStyle: rule.selectStyle,
      parentStyle: rule.parentStyle,
      textStyle: rule.textStyle ?? 'fuzzy',
      onRenderStart: rule.onRenderStart,
      onRemove: rule.onRemove,
      translateTitle: rule.translateTitle ?? false,
      segmentOptions: rule.segmentOptions,
    };

    this.setting = {
      reflowDebounce: setting.reflowDebounce ?? 300,
      visibleThreshold: setting.visibleThreshold ?? 0.1,
      skipTags: setting.skipTags ?? [
        'style', 'script', 'svg', 'img', 'video', 'audio',
        'textarea', 'input', 'button', 'select', 'option', 'iframe'
      ],
      hostTag: setting.hostTag ?? 'x-kt-trans',
    };

    this.translate = translate;
    
    const skipTagsSet = new Set(this.setting.skipTags);
    this.textSegmenter = new TextSegmenter({
      maxChunkSize: rule.segmentOptions?.maxChunkSize ?? rule.maxLen ?? 1000,
      minChunkSize: rule.segmentOptions?.minChunkSize ?? rule.minLen ?? 50,
      preserveSentences: rule.segmentOptions?.preserveSentences ?? true,
      preserveContext: rule.segmentOptions?.preserveContext ?? true,
      skipTags: skipTagsSet,
    });
    
    this._retranslate = debounce(() => {
      if (this._isUpdating) return;
      this._isUpdating = true;
      try {
        this.unregister();
        this.register();
      } finally {
        this._isUpdating = false;
      }
    }, this.setting.reflowDebounce);
    
    this._patchAttachShadow();
  }

  register(): void {
    console.log('[DomTranslator] Registering');
    this._ensureCssFor(document);
    this._scanAll(document);
    this._observeRoots();
    
    if (this.rule.trigger === 'open') {
      this.targetMap.forEach((_, node) => this._render(node));
    }
    
    if (this.rule.translateTitle) {
      this._translateTitle();
    }
  }

  unregister(): void {
    console.log('[DomTranslator] Unregistering');
    this.io?.disconnect();
    this.mo?.disconnect();
    this._restoreAll();
    this._restoreTitle();
    this.rootSet.clear();
    this.targetMap.clear();
    this.textSegmenter.clearCache();
    this.translationCache.clear();
    this.translatingFingerprints.clear();
  }

  updateRule(patch: Partial<Rule>): void {
    Object.assign(this.rule, patch);
    this._retranslate();
  }

  toggleStyle(): void {
    const next = this.rule.textStyle === 'fuzzy' ? 'dashline' : 'fuzzy';
    this.rule.textStyle = next;
    this.rootSet.forEach((root) => {
      root.querySelectorAll(this.setting.hostTag).forEach((host) => {
        (host as HTMLElement).setAttribute('data-style', next);
      });
    });
  }

  collectTargets(): Element[] {
    const targets: Element[] = [];
    this.rootSet.forEach(root => {
      const collected = this._collectTargets(root, this.rule.selector);
      targets.push(...collected);
    });
    return targets;
  }

  render(node: Element): void {
    this._render(node);
  }

  // Translate a single element without registering observers or scanning.
  async translateElement(node: Element): Promise<void> {
    // Ensure minimal CSS is present for the current document root.
    this._ensureCssFor(document);
    await this._render(node);
  }

  translateAll(): void {
    console.log('[DomTranslator] Translating all targets');
    this.targetMap.forEach((_, node) => this._render(node));
  }

  private _scanAll(root: Document | ShadowRoot): void {
    this.rootSet.add(root);
    this._ensureCssFor(root);
    
    const targets = this._collectTargets(root, this.rule.selector);
    
    targets.forEach(node => {
      if (!this.targetMap.has(node)) {
        this.targetMap.set(node, {});
        
        if (this.rule.trigger === 'scroll') {
          this._observeVisible(node);
        } else if (this.rule.trigger === 'hover') {
          this._bindHover(node);
        }
        
        if (this.rule.selectStyle) {
          (node as HTMLElement).style.cssText += this.rule.selectStyle;
        }
        if (this.rule.parentStyle && node.parentElement) {
          node.parentElement.style.cssText += this.rule.parentStyle;
        }
      }
    });
    
    // Enhanced Shadow DOM detection for web components
    this._discoverShadowRoots(root);
  }
  
  private _discoverShadowRoots(root: Document | ShadowRoot): void {
    const walker = document.createTreeWalker(
      root as Node,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const element = node as Element;
          // Check for shadow root or custom elements that might have shadow DOM
          if (element.shadowRoot || element.tagName.includes('-')) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    
    let node;
    while (node = walker.nextNode()) {
      const element = node as Element;
      if (element.shadowRoot && !this.rootSet.has(element.shadowRoot)) {
        this._scanAll(element.shadowRoot);
      }
    }
  }

  private _collectTargets(root: Document | ShadowRoot, selectorSpec: string): Element[] {
    const nodes: Element[] = [];
    const selectors = selectorSpec.split(';').map(s => s.trim()).filter(Boolean);
    
    selectors.forEach(sel => {
      if (sel.includes('::shadow::')) {
        const [outer, inner] = sel.split('::shadow::').map(s => s.trim());
        root.querySelectorAll(outer).forEach(el => {
          if (el.shadowRoot) {
            el.shadowRoot.querySelectorAll(inner).forEach(n => nodes.push(n));
          }
        });
      } else {
        root.querySelectorAll(sel).forEach(n => nodes.push(n));
      }
    });
    
    // Helper to detect direct text at this node level (not counting descendants)
    const hasDirectText = (el: Element): boolean => {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
          return true;
        }
      }
      return false;
    };

    // Use computed styles for better filtering
    return nodes.filter(n => {
      // Check if element should be skipped based on computed styles
      const style = window.getComputedStyle(n);
      
      // Skip invisible elements
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      
      // Skip elements with translation host already
      if (n.matches(this.setting.hostTag) || n.querySelector(this.setting.hostTag)) {
        return false;
      }
      
      // Skip based on tag name if it's in skip list
      const skip = new Set(this.setting.skipTags);
      if (skip.has(n.localName)) return false;
      
      // Skip custom elements that are likely components
      if (n.tagName.includes('-') && !n.shadowRoot && !n.textContent?.trim()) {
        return false;
      }
      
      // Avoid nested selections, but keep containers that have their own direct text
      // If n contains other selected nodes, keep n only if it has direct text to translate
      const containsOther = nodes.some(m => m !== n && n.contains(m));
      if (!containsOther) return true;
      return hasDirectText(n);
    });
  }

  private _observeVisible(node: Element): void {
    if (!this.io) {
      this.io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.io!.unobserve(entry.target);
            this._render(entry.target);
          }
        });
      }, { threshold: this.setting.visibleThreshold });
    }
    this.io.observe(node);
  }

  private _bindHover(node: Element): void {
    const key = this.rule.hoverKey;
    let removed = false;
    
    const onEnter = (ev: Event) => {
      if (removed) return;
      const ok = !key || (ev as MouseEvent)[`${key}Key` as keyof MouseEvent];
      if (ok) {
        removed = true;
        node.removeEventListener('mouseenter', onEnter);
        node.removeEventListener('mouseleave', onLeave);
        this._render(node);
      }
    };
    
    const onLeave = () => {};
    
    node.addEventListener('mouseenter', onEnter);
    node.addEventListener('mouseleave', onLeave);
  }

  private async _render(node: Element): Promise<void> {
    // 清理所有旧的 host，避免重复渲染堆叠
    node.querySelectorAll(this.setting.hostTag).forEach((h) => h.remove());
    
    const cache = this.targetMap.get(node) || {};
    const raw = (node as HTMLElement).innerText?.trim() || '';
    if (!raw) return;
    
    if (this.rule.displayMode === 'replace' && !cache.htmlBackup) {
      cache.htmlBackup = node.innerHTML;
    }
    
    this.rule.onRenderStart?.(node, raw);
    
    // Use the new text segmenter for intelligent splitting
    // Exclude nested target elements so containers only translate their direct text
    const excludeSet = new Set<Element>();
    try {
      const selectors = this.rule.selector.split(';').map(s => s.trim()).filter(Boolean);
      selectors.forEach(sel => {
        if (!sel) return;
        if (sel.includes('::shadow::')) {
          const [outer] = sel.split('::shadow::').map(s => s.trim());
          if (outer) node.querySelectorAll(outer).forEach(e => excludeSet.add(e));
        } else {
          node.querySelectorAll(sel).forEach(e => excludeSet.add(e));
        }
      });
      // Do not exclude the node itself
      excludeSet.delete(node);
    } catch {
      // Best effort; on selector errors, proceed without exclusions
      excludeSet.clear();
    }

    const segments = this.textSegmenter.segmentElement(node, excludeSet.size ? excludeSet : undefined);
    if (segments.length === 0) return;
    
    // Filter segments by size
    const validSegments = segments.filter(seg => {
      const len = seg.text.length;
      return len >= this.rule.minLen && len <= this.rule.maxLen;
    });
    
    if (validSegments.length === 0) return;
    
    const host = document.createElement(this.setting.hostTag);
    host.setAttribute('data-style', this.rule.textStyle);
    node.appendChild(host);
    
    const transId = Math.random().toString(36).slice(2, 10);
    cache.lastId = transId;
    this.targetMap.set(node, cache);
    
    try {
      // Process segments with caching and batching
      const translationPromises = validSegments.map(async (segment) => {
        // Check cache first
        const cached = this.translationCache.get(segment.fingerprint);
        if (cached) {
          return { segment, translation: cached };
        }
        
        // Check if already translating
        if (this.translatingFingerprints.has(segment.fingerprint)) {
          // Wait a bit and check cache again
          await new Promise(resolve => setTimeout(resolve, 100));
          const cached = this.translationCache.get(segment.fingerprint);
          if (cached) {
            return { segment, translation: cached };
          }
        }
        
        // Mark as translating
        this.translatingFingerprints.add(segment.fingerprint);
        
        try {
          // Add context if available
          let textToTranslate = segment.text;
          if (segment.context?.before) {
            textToTranslate = `...${segment.context.before} ${textToTranslate}`;
          }
          if (segment.context?.after) {
            textToTranslate = `${textToTranslate} ${segment.context.after}...`;
          }
          
          const translation = await this.translate(textToTranslate);
          
          // Extract the main translation (remove context markers)
          let cleanTranslation = translation;
          if (segment.context?.before) {
            cleanTranslation = cleanTranslation.replace(/^[^\s]*\s*/, '');
          }
          if (segment.context?.after) {
            cleanTranslation = cleanTranslation.replace(/\s*[^\s]*$/, '');
          }
          
          // Cache the translation
          this.translationCache.set(segment.fingerprint, cleanTranslation);
          
          return { segment, translation: cleanTranslation };
        } finally {
          this.translatingFingerprints.delete(segment.fingerprint);
        }
      });
      
      const results = await Promise.all(translationPromises);
      
      if (this.targetMap.get(node)?.lastId !== transId) {
        host.remove();
        return;
      }
      
      // Build the final translated content
      const frag = document.createDocumentFragment();
      
      if (this.rule.displayMode === 'replace') {
        // Replace mode: update text nodes in place
        results.forEach(({ segment, translation }) => {
          segment.nodes.forEach((textNode, index) => {
            // Distribute translation across original text nodes
            const portionSize = Math.ceil(translation.length / segment.nodes.length);
            const start = index * portionSize;
            const portion = translation.slice(start, start + portionSize);
            textNode.textContent = portion;
          });
        });
        host.remove();
      } else {
        // Overlay mode: build new content
        results.forEach(({ translation }) => {
          frag.appendChild(document.createTextNode(translation + ' '));
        });
        host.replaceChildren(frag);
      }
    } catch (err) {
      console.warn('[DomTranslator] Translation failed:', err);
      host.remove();
    }
  }

  private _buildPlaceholders(node: Element): { q: string; keeps: string[] } {
    const keeps: string[] = [];
    const keepParts = (this.rule.keepSelector || '').split('::shadow::').map(s => s?.trim());
    const normalizeList = (s?: string) => (s || '').split(';').map(x => x.trim()).filter(Boolean).join(', ');
    const matchSel = normalizeList(keepParts[0]);
    const subSel = normalizeList(keepParts[1]);
    
    let text = '';
    
    node.childNodes.forEach(child => {
      if (child.nodeType === 1) {
        const el = child as Element;
        const hit = (matchSel && el.matches?.(matchSel)) || 
                   (subSel && el.querySelector?.(subSel));
        
        if (hit) {
          if (el.tagName === 'IMG') {
            const img = el as HTMLImageElement;
            img.style.width = `${img.width}px`;
            img.style.height = `${img.height}px`;
          }
          text += `[${keeps.length}]`;
          keeps.push(el.outerHTML);
        } else {
          text += el.textContent ?? '';
        }
      } else {
        text += child.textContent ?? '';
      }
    });
    
    let q = text || (node as HTMLElement).innerText || '';
    
    if (this.rule.terms) {
      const terms = this.rule.terms.split(/\n|;|；/).map(s => s.trim()).filter(Boolean);
      terms.forEach(line => {
        const [pat, rep = ''] = line.split(',').map(s => s?.trim() || '');
        if (!pat) return;

        // Escape regex metacharacters to treat patterns as literals
        const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escapeRegExp(pat), 'g');
        q = q.replace(re, () => {
          const ph = `[${keeps.length}]`;
          keeps.push(`<i class="kt-term">${rep}</i>`);
          return ph;
        });
      });
    }
    
    if (q.includes('\n')) {
      q = q.replaceAll('\n', ' ');
    }
    
    return { q, keeps };
  }

  private _observeRoots(): void {
    this.mo = new MutationObserver(mutations => {
      if (this._isUpdating) return;
      
      const addedElements = new Set<Element>();
      const removedElements = new Set<Element>();
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(n => {
            if (n.nodeType === 1) {
              const el = n as Element;
              // Skip our own elements
              if (el.id === 'kt-trans-css' || 
                  el.matches?.(this.setting.hostTag) || 
                  el.querySelector?.(this.setting.hostTag)) {
                return;
              }
              addedElements.add(el);
              
              // Check for shadow roots in added elements
              if (el.shadowRoot) {
                this._scanAll(el.shadowRoot);
              }
            }
          });
          
          mutation.removedNodes.forEach(n => {
            if (n.nodeType === 1) {
              removedElements.add(n as Element);
            }
          });
        } else if (mutation.type === 'attributes') {
          // Handle dynamic shadow root attachments
          const target = mutation.target as Element;
          if (target.shadowRoot && !this.rootSet.has(target.shadowRoot)) {
            this._scanAll(target.shadowRoot);
          }
        }
      }
      
      // Clean up removed elements from cache
      removedElements.forEach(el => {
        this.targetMap.delete(el);
      });
      
      // Process new elements if meaningful changes detected
      if (addedElements.size > 0) {
        // Batch process after a short delay to avoid excessive re-scanning
        clearTimeout(this._batchTimer);
        this._batchTimer = setTimeout(() => {
          addedElements.forEach(el => {
            const targets = this._collectTargets(el.getRootNode() as Document | ShadowRoot, this.rule.selector);
            targets.forEach(target => {
              if (!this.targetMap.has(target)) {
                this.targetMap.set(target, {});
                if (this.rule.trigger === 'scroll') {
                  this._observeVisible(target);
                } else if (this.rule.trigger === 'hover') {
                  this._bindHover(target);
                } else if (this.rule.trigger === 'open') {
                  this._render(target);
                }
              }
            });
          });
        }, 100);
      }
    });
    
    this.rootSet.forEach(root => {
      this.mo!.observe(root, { 
        childList: true, 
        subtree: true,
        attributes: true,
        attributeFilter: ['shadowroot'] // Watch for shadow root changes
      });
    });
  }
  
  private _batchTimer?: ReturnType<typeof setTimeout>;

  private _restoreAll(): void {
    this.targetMap.forEach((cache, node) => {
      const host = node.querySelector(this.setting.hostTag);
      if (host) {
        host.remove();
      }
      
      if (this.rule.displayMode === 'replace' && cache.htmlBackup) {
        node.innerHTML = cache.htmlBackup;
      }
      
      this.rule.onRemove?.(node);
    });
  }

  private _patchAttachShadow(): void {
    if (!this._origAttachShadow) {
      this._origAttachShadow = HTMLElement.prototype.attachShadow;
      const self = this;
      
      HTMLElement.prototype.attachShadow = function(init: ShadowRootInit) {
        const root = self._origAttachShadow!.apply(this, [init]);
        
        // Defer processing to allow component initialization
        requestAnimationFrame(() => {
          if (self.rootSet.size > 0) { // Only if translator is active
            self.rootSet.add(root);
            self._ensureCssFor(root);
            self._scanAll(root);
          }
        });
        
        return root;
      };
    }
  }

  // 原方法改为仅代理到新的注入逻辑
  private _injectMinimalCssOnce(): void {
    this._ensureCssFor(document);
  }
  
  // 新增：在 Document 与各 ShadowRoot 中各自注入一次样式
  private _ensureCssFor(root: Document | ShadowRoot): void {
    const has =
      (root as Document | ShadowRoot).querySelector?.('style[data-kt-trans-css]') ||
      (root instanceof Document && root.getElementById('kt-trans-css'));
    if (has) return;
    
    const css = `
      ${this.setting.hostTag} {
        display: block;
        margin-top: 0.25em;
        line-height: inherit;
      }
      ${this.setting.hostTag}[data-style="fuzzy"] {
        filter: blur(0.2px);
        opacity: 0.92;
      }
      ${this.setting.hostTag}[data-style="dashline"] {
        border-top: 1px dashed currentColor;
        padding-top: 0.25em;
      }
      .kt-term {
        font-style: normal;
        font-weight: 600;
      }
    `;
    
    const style = document.createElement('style');
    style.textContent = css;
    style.setAttribute('data-kt-trans-css', '1');
    
    if (root instanceof Document) {
      style.id = 'kt-trans-css';
      root.head.appendChild(style);
    } else {
      root.appendChild(style);
    }
  }
  
  // 新增：将翻译文本与占位符安全合并为 DOM 片段，避免注入
  private _buildFragmentFromTranslated(text: string, keeps: string[]): DocumentFragment {
    const frag = document.createDocumentFragment();
    const re = /\[(\d+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const idx = Number(m[1]);
      const html = keeps[idx] ?? '';
      if (html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        frag.appendChild(tpl.content.cloneNode(true));
      } else {
        // 占位符缺失时按普通文本处理，保证可恢复
        frag.appendChild(document.createTextNode(m[0]));
      }
      last = re.lastIndex;
    }
    
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    return frag;
  }

  private async _translateTitle(): Promise<void> {
    if (this._origTitle) return;
    
    this._origTitle = document.title;
    try {
      const translated = await this.translate(this._origTitle);
      if (translated) {
        document.title = `${translated} | ${this._origTitle}`;
      }
    } catch (err) {
      console.warn('[DomTranslator] Title translation failed:', err);
    }
  }

  private _restoreTitle(): void {
    if (this._origTitle != null) {
      document.title = this._origTitle;
      this._origTitle = undefined;
    }
  }
}
