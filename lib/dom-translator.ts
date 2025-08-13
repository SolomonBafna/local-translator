import { TextSegmenter } from './text-segmenter';
import { getLanguageDetector } from './language-detector';

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
  textDecoration?: 'normal' | 'underline' | 'underline dashed' | 'underline dotted';
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
  hostClass?: string;
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
  private languageDetector = getLanguageDetector();

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
      textDecoration: rule.textDecoration ?? 'normal',
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
      hostClass: setting.hostClass ?? 'kt-translation',
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
    this.languageDetector.clearCache();
  }

  updateRule(patch: Partial<Rule>): void {
    Object.assign(this.rule, patch);
    this._retranslate();
  }

  toggleStyle(): void {
    const styles: Array<'normal' | 'underline' | 'underline dashed' | 'underline dotted'> = ['normal', 'underline', 'underline dashed', 'underline dotted'];
    const currentIndex = styles.indexOf(this.rule.textDecoration);
    const nextIndex = (currentIndex + 1) % styles.length;
    this.setStyle(styles[nextIndex]);
  }

  setStyle(style: 'normal' | 'underline' | 'underline dashed' | 'underline dotted'): void {
    this.rule.textDecoration = style;
    this.rootSet.forEach((root) => {
      root.querySelectorAll(`${this.setting.hostTag}, .${this.setting.hostClass}`).forEach((host) => {
        (host as HTMLElement).setAttribute('data-decoration', style);
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
    // Ensure minimal CSS is present for the node's root (Document or ShadowRoot).
    const root = (node.getRootNode && (node.getRootNode() as Document | ShadowRoot)) || document;
    this._ensureCssFor(root);
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
    
    // 1) 基于 selector 初步收集
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
    
    // Helper：检测元素"直属文本"（不含子孙）
    const hasDirectText = (el: Element): boolean => {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
          return true;
        }
      }
      return false;
    };

    const nodesSet = new Set(nodes);
    const skip = new Set(this.setting.skipTags);

    // 2) 补充：包含直属文本的祖先容器（从已命中节点向上回溯一次）
    const containerCandidates: Element[] = [];
    nodes.forEach(el => {
      let parent = el.parentElement;
      while (parent) {
        if (!nodesSet.has(parent) && !skip.has(parent.localName) && hasDirectText(parent)) {
          containerCandidates.push(parent);
          nodesSet.add(parent);
          break;
        }
        parent = parent.parentElement;
      }
    });
    nodes.push(...containerCandidates);

    // 2b) 新增：直接文本块捕获
    // 捕捉"未被 selector 命中且没有任何元素子节点、但自身拥有可见直属文本的块级元素"（典型如 <div>纯文本</div>）
    try {
      const walker = document.createTreeWalker(
        root as unknown as Node,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node: Node) => {
            const el = node as Element;
            // 去重与跳过标签
            if (nodesSet.has(el)) return NodeFilter.FILTER_SKIP;
            if (skip.has(el.localName)) return NodeFilter.FILTER_SKIP;

            // 可见性与显示类型（忽略 inline/contents，避免内联碎片）
            const style = (el.ownerDocument?.defaultView || window).getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return NodeFilter.FILTER_SKIP;
            }
            if (style.display === 'inline' || style.display === 'contents') {
              return NodeFilter.FILTER_SKIP;
            }

            // 必须：无任何元素子节点
            let hasElementChild = false;
            for (const ch of el.childNodes) {
              if (ch.nodeType === Node.ELEMENT_NODE) { hasElementChild = true; break; }
            }
            if (hasElementChild) return NodeFilter.FILTER_SKIP;

            // 必须：存在直属文本
            if (!hasDirectText(el)) return NodeFilter.FILTER_SKIP;

            return NodeFilter.FILTER_ACCEPT;
          }
        } as any
      );
      let walkNode: Node | null;
      while ((walkNode = walker.nextNode())) {
        const el = walkNode as Element;
        nodes.push(el);
        nodesSet.add(el);
      }
    } catch {
      // 忽略潜在的 TreeWalker 兼容性问题
    }

    // 3) 过滤：可见性/跳过标签/去重/避免过度嵌套
    return nodes.filter(n => {
      // 基于计算样式的过滤
      const style = window.getComputedStyle(n);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      // 已包含翻译宿主则跳过
      if (n.matches(this.setting.hostTag) || n.querySelector(this.setting.hostTag)) {
        return false;
      }
      // 跳过 skipTags
      if (skip.has(n.localName)) return false;
      // 跳过无文本的自定义元素外壳
      if (n.tagName.includes('-') && !n.shadowRoot && !n.textContent?.trim()) {
        return false;
      }
      // 避免嵌套选择：仅当自身拥有直属文本时才保留"包含其他已选节点"的容器
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
    
    // 使用新的分段器进行智能切分
    // 为了只翻译容器的直属文本，排除其内部再次匹配到的目标节点
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
      // 不排除自身
      excludeSet.delete(node);
    } catch {
      // 容错：选择器异常时不排除
      excludeSet.clear();
    }

    const segments = this.textSegmenter.segmentElement(node, excludeSet.size ? excludeSet : undefined);
    if (segments.length === 0) return;
    
    // Filter segments by length
    let validSegments = segments.filter(seg => {
      const len = seg.text.length;
      return len >= this.rule.minLen && len <= this.rule.maxLen;
    });
    if (validSegments.length === 0) return;
    
    // Filter to keep only English segments
    validSegments = await this.languageDetector.filterEnglishSegments(validSegments);
    if (validSegments.length === 0) {
      console.log('[DomTranslator] No English text detected, skipping translation');
      return;
    }
    
    const transId = Math.random().toString(36).slice(2, 10);
    cache.lastId = transId;
    this.targetMap.set(node, cache);
    
    try {
      // 翻译（带缓存/并发去重）
      const translationPromises = validSegments.map(async (segment) => {
        const cached = this.translationCache.get(segment.fingerprint);
        if (cached) {
          return { segment, translation: cached };
        }
        if (this.translatingFingerprints.has(segment.fingerprint)) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const again = this.translationCache.get(segment.fingerprint);
          if (again) {
            return { segment, translation: again };
          }
        }
        this.translatingFingerprints.add(segment.fingerprint);
        try {
          let textToTranslate = segment.text;
          if (segment.context?.before) textToTranslate = `...${segment.context.before} ${textToTranslate}`;
          if (segment.context?.after)  textToTranslate = `${textToTranslate} ${segment.context.after}...`;
          const translation = await this.translate(textToTranslate);
          let cleanTranslation = translation;
          if (segment.context?.before) cleanTranslation = cleanTranslation.replace(/^[^\s]*\s*/, '');
          if (segment.context?.after)  cleanTranslation = cleanTranslation.replace(/\s*[^\s]*$/, '');
          this.translationCache.set(segment.fingerprint, cleanTranslation);
          return { segment, translation: cleanTranslation };
        } finally {
          this.translatingFingerprints.delete(segment.fingerprint);
        }
      });
      
      const results = await Promise.all(translationPromises);
      if (this.targetMap.get(node)?.lastId !== transId) {
        // 已有更晚一次渲染，放弃当前结果
        return;
      }
      
      if (this.rule.displayMode === 'replace') {
        // 直接替换原文本
        results.forEach(({ segment, translation }) => {
          segment.nodes.forEach((textNode, index) => {
            const portionSize = Math.ceil(translation.length / segment.nodes.length);
            const start = index * portionSize;
            const portion = translation.slice(start, start + portionSize);
            textNode.textContent = portion;
          });
        });
      } else {
        // Overlay：若节点内包含嵌套目标（如子级 p），把 host 放到"最后一个直属文本节点之后"
        const selectors = this.rule.selector.split(';').map(s => s.trim()).filter(Boolean);
        let hasNestedTargets = false;
        for (const sel of selectors) {
          if (!sel) continue;
          if (sel.includes('::shadow::')) {
            const [outer, inner] = sel.split('::shadow::').map(s => s.trim());
            if (outer && inner) {
              node.querySelectorAll(outer).forEach(el => {
                const sr = (el as Element).shadowRoot;
                if (sr && sr.querySelector(inner)) hasNestedTargets = true;
              });
            }
          } else {
            if (node.querySelector(sel)) { hasNestedTargets = true; }
          }
          if (hasNestedTargets) break;
        }

        // Helper：获取最后一个直属 Text 节点
        const getLastDirectTextNode = (el: Element): Text | null => {
          let last: Text | null = null;
          el.childNodes.forEach(ch => {
            if (ch.nodeType === Node.TEXT_NODE) {
              const t = ch as Text;
              if ((t.textContent || '').trim()) last = t;
            }
          });
          return last;
        };

        const host = document.createElement(this.setting.hostTag);
        host.setAttribute('data-decoration', this.rule.textDecoration);
        host.setAttribute('data-mode', this.rule.displayMode);

        if (hasNestedTargets) {
          const lastDirect = getLastDirectTextNode(node);
          if (lastDirect) {
            node.insertBefore(host, lastDirect.nextSibling);
          } else {
            node.appendChild(host);
          }
        } else {
          node.appendChild(host);
        }

        // 拼装翻译内容
        const frag = document.createDocumentFragment();
        results.forEach(({ translation }) => {
          frag.appendChild(document.createTextNode(translation + ' '));
        });
        // 二次校验是否过期
        if (this.targetMap.get(node)?.lastId !== transId) {
          host.remove();
          return;
        }
        host.replaceChildren(frag);
      }
    } catch (err) {
      console.warn('[DomTranslator] Translation failed:', err);
      // overlay 下 host 在上面才创建，这里无需额外移除
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

    const hostSel = `${this.setting.hostTag}, .${this.setting.hostClass}`;
    const css = `
      ${hostSel}[data-mode="overlay"] {
        display: block;
        margin-top: 0.25em;
        line-height: inherit;
      }
      ${hostSel}[data-mode="replace"] {
        display: inline;
        line-height: inherit;
      }
      ${hostSel}[data-decoration="normal"] {
        text-decoration: none;
      }
      ${hostSel}[data-decoration="underline"] {
        text-decoration: underline;
      }
      ${hostSel}[data-decoration="underline dashed"] {
        text-decoration: underline dashed;
      }
      ${hostSel}[data-decoration="underline dotted"] {
        text-decoration: underline dotted;
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
    
    // Only translate if title is in English
    const isEnglish = await this.languageDetector.isEnglish(this._origTitle);
    if (!isEnglish) {
      console.log('[DomTranslator] Title is not in English, skipping translation');
      return;
    }
    
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
