import { useState, useEffect } from 'react';
import { browser } from 'wxt/browser';
import { storage, StoredSettings } from '../../lib/storage';
import './App.css';

interface TabInfo {
  id: number;
  url: string;
  title: string;
}

interface TranslationSettings {
  enabled: boolean;
  displayMode: 'overlay' | 'replace';
  textDecoration: 'normal' | 'underline' | 'underline dashed' | 'underline dotted';
}

interface TranslatorCheckResponse {
  available: boolean;
  chromeVersionSupported?: boolean;
}

// Check if current page is a system page that can't be translated
const isSystemPageUrl = (url: string): boolean => {
  if (!url) return true;
  
  const systemProtocols = [
    'chrome://',
    'chrome-extension://',
    'about:',
    'moz-extension://',
    'edge://',
    'opera://',
    'brave://',
    'vivaldi://'
  ];
  
  return systemProtocols.some(protocol => url.startsWith(protocol));
};

const getSystemPageMessage = (url: string): string => {
  if (!url || url === 'about:blank') return 'Blank page - no content to translate';
  if (url.startsWith('chrome://')) return 'Chrome system page - translation not supported';
  if (url.startsWith('chrome-extension://')) return 'Extension page - translation not supported';
  if (url.startsWith('about:')) return 'System page - translation not supported';
  if (url.startsWith('moz-extension://')) return 'Firefox extension page - translation not supported';
  if (url.startsWith('edge://')) return 'Edge system page - translation not supported';
  if (url.startsWith('opera://')) return 'Opera system page - translation not supported';
  if (url.startsWith('brave://')) return 'Brave system page - translation not supported';
  if (url.startsWith('vivaldi://')) return 'Vivaldi system page - translation not supported';
  return 'System page - translation not supported';
};

function App() {
  const isMac = navigator.userAgent.toLowerCase().includes('mac');
  const modifierKey = isMac ? 'Option' : 'Alt';
  const [currentTab, setCurrentTab] = useState<TabInfo | null>(null);
  const [settings, setSettings] = useState<TranslationSettings>({
    enabled: true, // Default to enabled
    displayMode: 'overlay',
    textDecoration: 'normal',
  });
  const [isTranslatorAvailable, setIsTranslatorAvailable] = useState(false);
  const [chromeVersionSupported, setChromeVersionSupported] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSystemPage, setIsSystemPage] = useState(false);

  useEffect(() => {
    // Load settings from storage first
    storage.getSettings().then((storedSettings) => {
      setSettings(storedSettings);
    });

    // Listen for storage changes
    storage.onChanged((newSettings) => {
      setSettings(newSettings);
    });

    // Get current tab info
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) {
        const tabUrl = tabs[0].url || '';
        setCurrentTab({
          id: tabs[0].id!,
          url: tabUrl,
          title: tabs[0].title || '',
        });
        
        // Check if this is a system page
        setIsSystemPage(isSystemPageUrl(tabUrl));
        
        // Check if translator is available (skip for system pages)
        if (!isSystemPageUrl(tabUrl)) {
          browser.tabs.sendMessage(tabs[0].id!, { action: 'check_translator' })
            .then((response: TranslatorCheckResponse) => {
              setIsTranslatorAvailable(response?.available || false);
              setChromeVersionSupported(response?.chromeVersionSupported !== false);
            })
            .catch((error) => {
              console.error('Error checking translator:', error);
              setIsTranslatorAvailable(false);
              setChromeVersionSupported(true); // Assume true if can't check
            });
        } else {
          setIsTranslatorAvailable(false);
          setChromeVersionSupported(true);
        }

        // Get current settings (skip for system pages)
        if (!isSystemPageUrl(tabUrl)) {
          browser.tabs.sendMessage(tabs[0].id!, { action: 'get_settings' })
            .then((response: any) => {
              if (response?.settings) {
                setSettings(response.settings);
              }
            })
            .catch((error) => {
              console.error('Error getting settings:', error);
            });
        }
      }
    });
  }, []);

  const sendMessage = (action: string, data?: any) => {
    if (!currentTab) return;
    
    browser.tabs.sendMessage(currentTab.id, { action, ...data })
      .then((response: any) => {
        console.log('Message sent successfully:', action, response);
      })
      .catch((error) => {
        console.error('Error sending message:', error);
      });
  };

  const toggleTranslation = () => {
    const newEnabled = !settings.enabled;
    const newSettings = { ...settings, enabled: newEnabled };
    setSettings(newSettings);
    
    // Save to storage
    storage.updateSetting('enabled', newEnabled);
    
    if (currentTab) {
      browser.tabs.sendMessage(currentTab.id, { 
        action: newEnabled ? 'enable_translation' : 'disable_translation' 
      })
      .then((response: any) => {
        if (response?.message) {
          setStatusMessage(response.message);
          setTimeout(() => setStatusMessage(null), 5000);
        }
      })
      .catch((error) => {
        console.error('Error toggling translation:', error);
      });
    }
  };


  const changeDisplayMode = (mode: 'overlay' | 'replace') => {
    setSettings({ ...settings, displayMode: mode });
    storage.updateSetting('displayMode', mode);
    sendMessage('change_display_mode', { mode });
  };

  const translateAll = () => {
    if (!currentTab || isTranslating) return;
    
    setIsTranslating(true);
    browser.tabs.sendMessage(currentTab.id, { action: 'translate_all' })
      .then((response: any) => {
        console.log('Translate all sent successfully:', response);
        setTimeout(() => setIsTranslating(false), 2000);
      })
      .catch((error) => {
        console.error('Error translating all:', error);
        setIsTranslating(false);
      });
  };

  if (isSystemPage) {
    return (
      <div className="w-96 p-6 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">System Page</h2>
            <p className="text-sm text-gray-600">
              {currentTab ? getSystemPageMessage(currentTab.url) : 'Translation not supported'}
            </p>
          </div>
        </div>
        <div className="bg-orange-50 rounded-lg p-4">
          <p className="text-sm text-gray-700">
            Translation is only available on regular web pages. System pages like Chrome settings, extensions, and blank pages cannot be translated.
          </p>
          <div className="mt-3 text-xs text-gray-600">
            <p><strong>Current page:</strong> {currentTab?.url || 'Unknown'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isTranslatorAvailable) {
    return (
      <div className="w-96 p-6 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Translator Not Available</h2>
            <p className="text-sm text-gray-600">
              {!chromeVersionSupported ? 'Chrome version < 138' : 'API not enabled'}
            </p>
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-700">
            {!chromeVersionSupported 
              ? 'Your Chrome version is below 138. Please update Chrome to version 138 or higher to use the Translator API.'
              : 'The Chrome Translator API needs to be enabled:'}
          </p>
          {chromeVersionSupported && (
            <>
              <ol className="mt-3 text-sm text-gray-600 list-decimal list-inside space-y-2">
                <li>Open <code className="bg-gray-200 px-1 rounded">chrome://flags</code> in a new tab</li>
                <li>Search for "translation api"</li>
                <li>Enable <strong>"Experimental Translation API"</strong></li>
                <li>Click "Relaunch" to restart Chrome</li>
                <li>Return to this page and reload</li>
              </ol>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    browser.tabs.create({ url: 'chrome://flags/#enable-experimental-translation-api' });
                  }}
                  className="flex-1 bg-blue-500 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Open Chrome Flags
                </button>
                <button
                  onClick={() => {
                    window.location.reload();
                  }}
                  className="flex-1 bg-gray-200 text-gray-700 text-sm px-3 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-96 bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
              </svg>
              Local Translator
            </h1>
            <p className="text-sm text-blue-50 mt-1">English → 中文简体</p>
          </div>
          <button
            onClick={toggleTranslation}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              settings.enabled ? 'bg-blue-300' : 'bg-gray-400'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                settings.enabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className="px-4 pt-2">
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg px-3 py-2">
            {statusMessage}
          </div>
        </div>
      )}

      {/* Main Controls */}
      <div className="p-4 space-y-3">

        {settings.enabled && (
          <>
            {/* Display Mode */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-medium text-gray-900 mb-3">Display Mode</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => changeDisplayMode('overlay')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.displayMode === 'overlay'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Overlay
                </button>
                <button
                  onClick={() => changeDisplayMode('replace')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.displayMode === 'replace'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Replace
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                {settings.displayMode === 'overlay' 
                  ? 'Show translation below original text'
                  : 'Replace original text with translation'}
              </p>
            </div>

            {/* Translation Text Style */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-medium text-gray-900 mb-3">Text Decoration</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setSettings({ ...settings, textDecoration: 'normal' });
                    storage.updateSetting('textDecoration', 'normal');
                    sendMessage('set_text_decoration', { style: 'normal' });
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.textDecoration === 'normal'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Normal
                </button>
                <button
                  onClick={() => {
                    setSettings({ ...settings, textDecoration: 'underline' });
                    storage.updateSetting('textDecoration', 'underline');
                    sendMessage('set_text_decoration', { style: 'underline' });
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.textDecoration === 'underline'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Underline
                </button>
                <button
                  onClick={() => {
                    setSettings({ ...settings, textDecoration: 'underline dashed' });
                    storage.updateSetting('textDecoration', 'underline dashed');
                    sendMessage('set_text_decoration', { style: 'underline dashed' });
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.textDecoration === 'underline dashed'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Dashed
                </button>
                <button
                  onClick={() => {
                    setSettings({ ...settings, textDecoration: 'underline dotted' });
                    storage.updateSetting('textDecoration', 'underline dotted');
                    sendMessage('set_text_decoration', { style: 'underline dotted' });
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.textDecoration === 'underline dotted'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  Dotted
                </button>
              </div>
            </div>

            {/* Translation Actions */}
            <button
              onClick={translateAll}
              disabled={isTranslating}
              className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isTranslating ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
              )}
              <span>{isTranslating ? 'Translating...' : 'Translate Page'}</span>
            </button>
            <p className="text-xs text-gray-600 text-center">Hold {modifierKey} and click to translate paragraphs</p>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-600">
            Powered by Chrome Translator API
          </p>
          <button
            onClick={() => {
              const translatorUrl = (browser.runtime as any).getURL('translator.html');
              browser.tabs.create({ url: translatorUrl });
            }}
            className="text-xs text-blue-600 hover:text-blue-700 underline transition-colors"
          >
            Open Translator
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
