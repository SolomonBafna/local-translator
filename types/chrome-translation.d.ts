// Ambient types for Chrome's experimental Translator API
// Keep conservative to avoid breaking builds if API changes.

declare global {
  class ChromeTranslator {
    translate(text: string): Promise<string>;
    dispose?: () => Promise<void> | void;
  }

  interface TranslatorFactory {
    create(options: {
      sourceLanguage?: string; // BCP-47 language tag (e.g., 'en', 'zh-Hans')
      targetLanguage: string;
    }): Promise<ChromeTranslator>;
  }

  interface WorkerGlobalScope {
    Translator?: TranslatorFactory;
  }
  interface Window {
    Translator?: TranslatorFactory;
  }
}

export {};
