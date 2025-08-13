/// <reference path="../types/chrome-translation.d.ts" />
import { DomTranslator } from '../lib/dom-translator';
import { browser } from 'wxt/browser';
import { storage } from '../lib/storage';

// Message types for communication with popup
interface Message {
  action: string;
  mode?: 'overlay' | 'replace';
  style?: 'normal' | 'underline' | 'underline dashed' | 'underline dotted';
}

// Check if Chrome version meets minimum requirement
function isChromeVersionSupported(): boolean {
  try {
    const userAgent = navigator.userAgent;
    const chromeMatch = userAgent.match(/Chrome\/(\d+)\./);
    if (!chromeMatch) return false;
    
    const majorVersion = parseInt(chromeMatch[1], 10);
    return majorVersion >= 138;
  } catch {
    return false;
  }
}

// Get Chrome version for debugging
function getChromeVersion(): string {
  const match = navigator.userAgent.match(/Chrome\/([\d.]+)/);
  return match ? match[1] : 'unknown';
}

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    console.log('[LocalTranslator] Content script starting');
    console.log('[LocalTranslator] Chrome version:', getChromeVersion());
    
    // Check Chrome version first
    if (!isChromeVersionSupported()) {
      console.warn('[LocalTranslator] Chrome version < 138, Translator API not supported');
      return;
    }
    
    if (!('Translator' in self)) {
      console.warn('[LocalTranslator] Translator API not available despite Chrome ≥138');
      console.warn('[LocalTranslator] Please enable the Experimental Translation API:');
      console.warn('[LocalTranslator] 1. Go to chrome://flags');
      console.warn('[LocalTranslator] 2. Search for "translation api"');
      console.warn('[LocalTranslator] 3. Enable "Experimental Translation API"');
      console.warn('[LocalTranslator] 4. Restart Chrome');
      return;
    }

    let chromeTranslator: ChromeTranslator | null = null;
    let creatingTranslator: Promise<ChromeTranslator> | null = null;
    let domTranslator: DomTranslator | null = null;
    let altClickEnabled = false;
    let altClickHandler: ((e: MouseEvent) => void) | null = null;

    // Create translator (must be called from a user gesture)
    const createTranslator = async () => {
      if (chromeTranslator || creatingTranslator) return creatingTranslator;
      creatingTranslator = self.Translator!.create({
        // Let Chrome auto-detect the source language when available
        sourceLanguage: 'auto',
        targetLanguage: 'zh-Hans',
      }).then((tr) => {
        chromeTranslator = tr;
        console.log('[LocalTranslator] Chrome Translator initialized');
        return tr;
      }).catch((err) => {
        console.error('[LocalTranslator] Failed to create translator:', err);
        throw err;
      }).finally(() => {
        creatingTranslator = null;
      });
      return creatingTranslator;
    };

    // Translation function for DomTranslator
    const translateText = async (text: string): Promise<string> => {
      try {
        if (!chromeTranslator) return '';
        const result = await chromeTranslator.translate(text);
        return result || '';
      } catch (err) {
        console.error('[LocalTranslator] Translation error:', err);
        return '';
      }
    };

    // Initialize DOM translation for full page
    const initDomTranslation = async (translateAll: boolean = false) => {
      // Get stored settings
      const storedSettings = await storage.getSettings();
      // Configuration for DOM translation
      const rule = {
        // Target common content selectors
        selector: [
          'article',
          'main',
          '.content',
          '.post-content',
          '.entry-content',
          '.article-body',
          '.markdown-body',
          '[role="article"]',
          '.story-body',
          '.post-body',
          'section.content',
          'p',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'li',
          'td',
          'th',
          'blockquote',
          'figcaption',
          'div.text',
          'div.content',
          'span.text'
        ].join('; '),
        
        // Preserve important elements
        keepSelector: 'img; a; button; code; pre; input; textarea; video; iframe; svg',
        
        // Common technical terms to preserve
        terms: [
          'JavaScript,JavaScript',
          'TypeScript,TypeScript',
          'Node.js,Node.js',
          'React,React',
          'Vue,Vue',
          'Angular,Angular',
          'HTML,HTML',
          'CSS,CSS',
          'API,API',
          'HTTP,HTTP',
          'HTTPS,HTTPS',
          'URL,URL',
          'JSON,JSON',
          'XML,XML',
          'SQL,SQL',
          'Git,Git',
          'GitHub,GitHub',
          'npm,npm',
          'webpack,webpack',
          'Docker,Docker',
          'Kubernetes,Kubernetes',
          'Python,Python',
          'Java,Java',
          'C++,C++',
          'Go,Go',
          'Rust,Rust',
          'Linux,Linux',
          'Windows,Windows',
          'macOS,macOS',
          'iOS,iOS',
          'Android,Android'
        ].join(';'),
        
        displayMode: storedSettings.displayMode,
        trigger: translateAll ? 'open' as const : 'manual' as const,
        textDecoration: storedSettings.textDecoration,
        minLen: 10,
        maxLen: 5000,
        translateTitle: false,
        
        // New segmentation options for intelligent splitting
        segmentOptions: {
          maxChunkSize: 800,  // Optimal size for translation quality
          minChunkSize: 30,   // Minimum meaningful text
          preserveSentences: true,  // Keep sentences intact
          preserveContext: true,    // Add context for better translation
        },
      };

      const setting = {
        hostTag: 'x-local-trans',
        hostClass: 'lt-translation',
        reflowDebounce: 300,  // Faster response to DOM changes
        visibleThreshold: 0.1,
        skipTags: [
          'style', 'script', 'noscript', 'svg', 'img', 'video', 'audio',
          'textarea', 'input', 'button', 'select', 'option', 'iframe',
          'code', 'pre', 'x-local-trans', 'math', 'object', 'embed'
        ],
      };

      if (domTranslator) {
        domTranslator.unregister();
      }
      
      domTranslator = new DomTranslator(rule, setting, translateText);
      domTranslator.register();
      console.log('[LocalTranslator] DOM translation registered', translateAll ? '(translate all)' : '(manual mode)');
    };

    // Cleanup on page hide
    window.addEventListener('pagehide', () => {
      if (domTranslator) {
        domTranslator.unregister();
        domTranslator = null;
      }
    }, { once: true });


    // Alt/Option click paragraph translation (one-shot, no observers)
    const onAltClick = async (e: MouseEvent) => {
      // Check if Option/Alt key is pressed
      if (!e.altKey) return;
      
      // Prevent default behavior
      e.preventDefault();
      e.stopPropagation();
      
      // Find the closest translatable element
      const target = e.target as HTMLElement;
      const translatableSelectors = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'figcaption', 'article', 'section', 'div'];
      
      let elementToTranslate: HTMLElement | null = null;
      for (const selector of translatableSelectors) {
        if (target.matches(selector)) {
          elementToTranslate = target;
          break;
        }
        const closest = target.closest(selector);
        if (closest) {
          elementToTranslate = closest as HTMLElement;
          break;
        }
      }
      
      if (!elementToTranslate) return;
      
      // Ensure translator is ready
      if (!chromeTranslator) {
        try {
          await createTranslator();
        } catch (err) {
          console.error('[LocalTranslator] Failed to create translator:', err);
          return;
        }
      }
      
      // Check if element already has translation
      const existingTranslation = elementToTranslate.querySelector('x-local-trans');
      if (existingTranslation) {
        // Remove translation if it exists
        existingTranslation.remove();
        console.log('[LocalTranslator] Removed translation');
        return;
      }
      
      // Create a temporary DomTranslator for one-shot translation
      const tempRule = {
        selector: '', // Direct node translation; selector unused
        keepSelector: 'img; a; button; code; pre; input; textarea; video; iframe; svg',
        displayMode: 'overlay' as const,
        trigger: 'manual' as const,
        textDecoration: 'normal' as const,
        minLen: 1,
        maxLen: 10000,
        translateTitle: false,
        segmentOptions: {
          maxChunkSize: 500,  // Smaller chunks for paragraph translation
          minChunkSize: 1,
          preserveSentences: true,
          preserveContext: false,  // No context needed for single paragraphs
        },
      };

      const tempSetting = {
        hostTag: 'x-local-trans',
        hostClass: 'lt-translation',
        reflowDebounce: 100,  // Fast response for one-shot translation
        visibleThreshold: 0.1,
        skipTags: [
          'style', 'script', 'noscript', 'svg', 'img', 'video', 'audio',
          'textarea', 'input', 'button', 'select', 'option', 'iframe',
          'code', 'pre', 'x-local-trans', 'math', 'object', 'embed'
        ],
      };

      // Perform one-shot translation without registering observers
      const tempTranslator = new DomTranslator(tempRule, tempSetting, translateText);
      await tempTranslator.translateElement(elementToTranslate);

      console.log('[LocalTranslator] Translated paragraph on Alt+Click');
    };

    const enableAltClick = () => {
      if (altClickEnabled) return;
      altClickHandler = (e) => onAltClick(e);
      document.addEventListener('click', altClickHandler, true);
      altClickEnabled = true;
    };

    const disableAltClick = () => {
      if (!altClickEnabled) return;
      if (altClickHandler) {
        document.removeEventListener('click', altClickHandler, true);
      }
      altClickHandler = null;
      altClickEnabled = false;
    };


    console.log('[LocalTranslator] Content script initialized');
    
    // Auto-enable translation if stored setting is true
    try {
      const settings = await storage.getSettings();
      if (settings.enabled) {
        console.log('[LocalTranslator] Auto-enabling translation from stored settings');
        // Initialize translator first
        createTranslator()
          .catch(() => {
            console.log('[LocalTranslator] Initial translator creation failed, will retry on gesture');
            return null;
          })
          .finally(() => {
            // Initialize DOM translation in manual mode
            initDomTranslation(false).then(() => {
              console.log('[LocalTranslator] Translation auto-enabled');
              enableAltClick();
            });
          });
      }
    } catch (error) {
      console.error('[LocalTranslator] Failed to load settings:', error);
    }

    // Message handler for popup communication
    browser.runtime.onMessage.addListener((message: Message, _sender: any, sendResponse: any) => {
      console.log('[LocalTranslator] Received message:', message);
      
      switch (message.action) {
        case 'check_translator': {
          sendResponse({ 
            available: 'Translator' in self,
            chromeVersionSupported: isChromeVersionSupported(),
            chromeVersion: getChromeVersion()
          });
          return;
        }
        
        case 'get_settings': {
          // Get settings from storage instead of from domTranslator
          storage.getSettings().then((storedSettings) => {
            sendResponse({
              settings: {
                enabled: domTranslator !== null,
                displayMode: storedSettings.displayMode,
                textDecoration: storedSettings.textDecoration,
              },
            });
          });
          return true; // Async response
        }
        
        case 'enable_translation': {
          // 可能需要用户手势；即使失败也先注册 DOM 翻译，后续手势会触发翻译生效
          createTranslator()
            .catch(() => {
              console.log('[LocalTranslator] Translator creation failed, will retry on user gesture');
              return null;
            })
            .finally(async () => {
              // Initialize in manual mode (no auto-translate)
              await initDomTranslation(false);
              console.log('[LocalTranslator] Manual translation mode enabled via popup');
              enableAltClick();
              sendResponse({ 
                success: true, 
                translatorReady: !!chromeTranslator,
                message: 'Hold Option/Alt and click to translate paragraphs'
              });
            });
          return true; // 异步响应
        }
        
        case 'disable_translation': {
          if (domTranslator) {
            domTranslator.unregister();
            domTranslator = null;
            console.log('[LocalTranslator] DOM translation disabled via popup');
          }
          disableAltClick();
          sendResponse({ success: true });
          return;
        }
        
        case 'toggle_style': {
          if (domTranslator) {
            domTranslator.toggleStyle();
            console.log('[LocalTranslator] Translation style toggled via popup');
          }
          sendResponse({ success: true });
          return;
        }
        
        case 'set_text_decoration': {
          if (domTranslator && message.style) {
            domTranslator.setStyle(message.style);
            console.log('[LocalTranslator] Text decoration set to:', message.style);
          }
          sendResponse({ success: true });
          return;
        }
        
        case 'change_display_mode': {
          if (domTranslator && message.mode) {
            domTranslator.updateRule({ displayMode: message.mode });
            console.log('[LocalTranslator] Display mode changed to:', message.mode);
          }
          sendResponse({ success: true });
          return;
        }
        
        case 'translate_all': {
          // Translate all content on the page
          createTranslator()
            .catch(() => {
              console.log('[LocalTranslator] Failed to create translator, trying anyway');
              return null;
            })
            .finally(async () => {
              // If domTranslator doesn't exist, create it first
              if (!domTranslator) {
                await initDomTranslation(false); // Initialize in manual mode
              }
              
              // Now translate all collected targets
              if (domTranslator) {
                domTranslator.translateAll();
                console.log('[LocalTranslator] Triggered translation of all content');
              }
              
              sendResponse({ success: true, message: 'Translating all content...' });
            });
          return true; // Async response
        }
        
        default: {
          sendResponse({ error: 'Unknown action' });
          return;
        }
      }
    });

    // Dispose translator and cleanup on pagehide
    window.addEventListener('pagehide', async () => {
      disableAltClick();
      if (domTranslator) {
        domTranslator.unregister();
        domTranslator = null;
      }
      try {
        await chromeTranslator?.dispose?.();
      } catch (e) {
        console.warn('[LocalTranslator] Translator dispose failed:', e);
      } finally {
        chromeTranslator = null;
      }
    }, { once: true });
  },
});
