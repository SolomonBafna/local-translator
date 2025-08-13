/// <reference path="../../types/chrome-translation.d.ts" />
import { useState, useEffect, useRef } from 'react';

interface Language {
  code: 'zh-Hans' | 'en';
  name: string;
  flag: string;
}

const languages: Language[] = [
  { code: 'zh-Hans', name: '中文简体', flag: '🇨🇳' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
];

interface TranslatorState {
  sourceLanguage: Language;
  targetLanguage: Language;
  sourceText: string;
  translatedText: string;
  isTranslating: boolean;
  error: string | null;
}

function TranslatorApp() {
  const [state, setState] = useState<TranslatorState>({
    sourceLanguage: languages[1], // English
    targetLanguage: languages[0], // Chinese
    sourceText: '',
    translatedText: '',
    isTranslating: false,
    error: null,
  });

  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const targetTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chromeTranslatorRef = useRef<ChromeTranslator | null>(null);
  const [isTranslatorReady, setIsTranslatorReady] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const initializationAttempted = useRef(false);

  // Check if Chrome version meets minimum requirement
  const isChromeVersionSupported = (): boolean => {
    try {
      const userAgent = navigator.userAgent;
      const chromeMatch = userAgent.match(/Chrome\/(\d+)\./);
      if (!chromeMatch) return false;
      
      const majorVersion = parseInt(chromeMatch[1], 10);
      return majorVersion >= 138;
    } catch {
      return false;
    }
  };

  // Initialize translator function
  const initTranslator = async (isUserGesture = false) => {
    console.log('Initializing translator...', { 
      isUserGesture, 
      source: state.sourceLanguage.code, 
      target: state.targetLanguage.code 
    });
    
    setIsTranslatorReady(false);
    setNeedsUserGesture(false);
    
    if (!isChromeVersionSupported()) {
      setState(prev => ({ ...prev, error: 'Chrome version 138 or higher required' }));
      return false;
    }

    if (!('Translator' in self)) {
      setState(prev => ({ 
        ...prev, 
        error: 'Chrome Translator API not available. Please enable "Experimental Translation API" in chrome://flags' 
      }));
      return false;
    }

    try {
      // Dispose of existing translator if it exists
      if (chromeTranslatorRef.current) {
        try {
          await chromeTranslatorRef.current.dispose?.();
        } catch (e) {
          console.warn('Failed to dispose translator:', e);
        }
        chromeTranslatorRef.current = null;
      }

      // Create translator for the current language pair
      console.log('Creating translator with params:', {
        sourceLanguage: state.sourceLanguage.code,
        targetLanguage: state.targetLanguage.code,
      });
      
      const translator = await self.Translator!.create({
        sourceLanguage: state.sourceLanguage.code,
        targetLanguage: state.targetLanguage.code,
      });
      
      console.log('Translator created successfully:', translator);
      chromeTranslatorRef.current = translator;
      setIsTranslatorReady(true);
      setState(prev => ({ ...prev, error: null }));
      initializationAttempted.current = true;
      return true;
    } catch (err: any) {
      console.error('Failed to create translator:', err);
      console.error('Error details:', {
        message: err?.message,
        stack: err?.stack,
        name: err?.name,
      });
      
      // Check if the error is due to needing a user gesture
      if (err?.message?.includes('user gesture') || err?.message?.includes('user activation') || !isUserGesture) {
        setNeedsUserGesture(true);
        setState(prev => ({ 
          ...prev, 
          error: 'Click the "Initialize Translator" button to start' 
        }));
      } else {
        setState(prev => ({ 
          ...prev, 
          error: `Failed to initialize translator: ${err?.message || 'Unknown error'}` 
        }));
      }
      setIsTranslatorReady(false);
      return false;
    }
  };

  // Try to initialize on mount (might fail if user gesture is required)
  useEffect(() => {
    if (!initializationAttempted.current) {
      initTranslator(false);
    }
  }, []); // Only run once on mount

  // Re-initialize when language changes (only if already initialized)
  useEffect(() => {
    if (isTranslatorReady && initializationAttempted.current) {
      initTranslator(false);
    }
  }, [state.sourceLanguage.code, state.targetLanguage.code]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chromeTranslatorRef.current) {
        try {
          chromeTranslatorRef.current.dispose?.();
        } catch (e) {
          console.warn('Failed to dispose translator on cleanup:', e);
        }
      }
    };
  }, []);

  const translateText = async (text: string): Promise<string> => {
    if (!chromeTranslatorRef.current) {
      throw new Error('Translator not initialized');
    }

    const result = await chromeTranslatorRef.current.translate(text);
    return result || '';
  };

  const handleTranslate = async () => {
    if (!state.sourceText.trim()) return;
    
    // If translator is not ready, try to initialize it with user gesture
    if (!isTranslatorReady || !chromeTranslatorRef.current) {
      const initialized = await initTranslator(true);
      if (!initialized) {
        return; // Error message already set in initTranslator
      }
    }

    setState(prev => ({ ...prev, isTranslating: true, error: null }));

    try {
      const translated = await translateText(state.sourceText);
      setState(prev => ({ ...prev, translatedText: translated }));
    } catch (err) {
      console.error('Translation failed:', err);
      setState(prev => ({ ...prev, error: 'Translation failed. Please try again.' }));
    } finally {
      setState(prev => ({ ...prev, isTranslating: false }));
    }
  };

  const handleSwapLanguages = () => {
    setState(prev => ({
      ...prev,
      sourceLanguage: prev.targetLanguage,
      targetLanguage: prev.sourceLanguage,
      sourceText: prev.translatedText,
      translatedText: prev.sourceText,
    }));
  };

  const handleSourceLanguageChange = (language: Language) => {
    const newTargetLanguage = language.code === 'zh-Hans' ? languages[1] : languages[0];
    setState(prev => ({
      ...prev,
      sourceLanguage: language,
      targetLanguage: newTargetLanguage,
      translatedText: '', // Clear translation when language changes
      error: null, // Clear any errors
    }));
  };

  const handleTargetLanguageChange = (language: Language) => {
    const newSourceLanguage = language.code === 'zh-Hans' ? languages[1] : languages[0];
    setState(prev => ({
      ...prev,
      sourceLanguage: newSourceLanguage,
      targetLanguage: language,
      translatedText: '', // Clear translation when language changes
      error: null, // Clear any errors
    }));
  };

  const handleCopyTranslation = async () => {
    if (state.translatedText) {
      try {
        await navigator.clipboard.writeText(state.translatedText);
        // Could add a toast notification here
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  };

  const handleClear = () => {
    setState(prev => ({
      ...prev,
      sourceText: '',
      translatedText: '',
    }));
    sourceTextareaRef.current?.focus();
  };

  const handleSourceTextChange = (text: string) => {
    setState(prev => ({ ...prev, sourceText: text }));
  };

  // Auto-translate with debouncing
  useEffect(() => {
    // Only auto-translate if translator is ready and there's text
    if (state.sourceText.trim() && !state.isTranslating && isTranslatorReady) {
      const timeoutId = setTimeout(async () => {
        if (!state.sourceText.trim() || !chromeTranslatorRef.current) return;

        setState(prev => ({ ...prev, isTranslating: true, error: null }));

        try {
          const translated = await translateText(state.sourceText);
          setState(prev => ({ ...prev, translatedText: translated, isTranslating: false }));
        } catch (err) {
          console.error('Auto-translation failed:', err);
          // Don't show error for auto-translation failures, just clear the translation
          setState(prev => ({ ...prev, translatedText: '', isTranslating: false }));
        }
      }, 1000); // Debounce translation by 1 second
      
      return () => clearTimeout(timeoutId);
    }
  }, [state.sourceText, state.isTranslating, isTranslatorReady]);

  // Show error screen if translator is not available
  if (state.error && (state.error.includes('version') || state.error.includes('not available'))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Translator Not Available</h2>
              <p className="text-sm text-gray-600">{state.error}</p>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-700 mb-3">To use the translator:</p>
            <ol className="text-sm text-gray-600 list-decimal list-inside space-y-2">
              <li>Make sure you're using Chrome 138 or higher</li>
              <li>Open <code className="bg-gray-200 px-1 rounded">chrome://flags</code></li>
              <li>Search for "translation api"</li>
              <li>Enable <strong>"Experimental Translation API"</strong></li>
              <li>Click "Relaunch" to restart Chrome</li>
              <li>Return to this page and reload</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
            Local Translator
          </h1>
          <p className="text-blue-100 mt-1">Chinese ⇄ English Translation</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-4">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Language Selectors */}
          <div className="flex items-center border-b border-gray-200 bg-gray-50">
            <div className="flex-1 p-4">
              <select
                value={state.sourceLanguage.code}
                onChange={(e) => {
                  const lang = languages.find(l => l.code === e.target.value);
                  if (lang) handleSourceLanguageChange(lang);
                }}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSwapLanguages}
              className="p-3 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
              title="Swap languages"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>

            <div className="flex-1 p-4">
              <select
                value={state.targetLanguage.code}
                onChange={(e) => {
                  const lang = languages.find(l => l.code === e.target.value);
                  if (lang) handleTargetLanguageChange(lang);
                }}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Translation Areas */}
          <div className="flex flex-col lg:flex-row">
            {/* Source Text Area */}
            <div className="flex-1 p-4 border-r border-gray-200">
              <div className="relative">
                <textarea
                  ref={sourceTextareaRef}
                  value={state.sourceText}
                  onChange={(e) => handleSourceTextChange(e.target.value)}
                  placeholder={`Enter text in ${state.sourceLanguage.name}...`}
                  className="w-full h-64 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">
                    {state.sourceText.length} characters
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={handleClear}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Target Text Area */}
            <div className="flex-1 p-4 bg-gray-50">
              <div className="relative">
                <textarea
                  ref={targetTextareaRef}
                  value={state.translatedText}
                  readOnly
                  placeholder={`Translation will appear in ${state.targetLanguage.name}...`}
                  className="w-full h-64 p-3 border border-gray-300 rounded-lg resize-none bg-white"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">
                    {state.translatedText.length} characters
                  </span>
                  <div className="flex gap-2">
                    {state.translatedText && (
                      <button
                        onClick={handleCopyTranslation}
                        className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Translation Button and Status */}
          <div className="border-t border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {needsUserGesture && !isTranslatorReady ? (
                  <button
                    onClick={() => initTranslator(true)}
                    className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Initialize Translator
                  </button>
                ) : (
                  <button
                    onClick={handleTranslate}
                    disabled={!state.sourceText.trim() || state.isTranslating}
                    className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                  >
                    {state.isTranslating ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Translating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                        </svg>
                        Translate
                      </>
                    )}
                  </button>
                )}
                {!isTranslatorReady && !state.error && (
                  <p className="text-amber-600 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Initializing translator...
                  </p>
                )}
                {state.error && (
                  <p className="text-red-600 text-sm">{state.error}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">
                  Powered by Chrome Translator API
                </p>
                {isTranslatorReady && (
                  <span className="text-xs text-green-600">✓ Ready</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default TranslatorApp;
