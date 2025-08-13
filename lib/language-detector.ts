import { browser } from 'wxt/browser';

export interface LanguageDetectionResult {
  language: string;
  percentage: number;
  isReliable: boolean;
}

export interface DetectionOptions {
  minConfidence?: number; // Minimum confidence percentage (0-100)
  cacheResults?: boolean; // Whether to cache detection results
}

export class LanguageDetector {
  private cache = new Map<string, LanguageDetectionResult>();
  private readonly ENGLISH_CODE = 'en';
  private readonly MIN_CONFIDENCE = 95; // Hardcoded 80% confidence for English detection

  constructor() {
    // No options needed - English-only detection is hardcoded
  }

  /**
   * Detect the language of the given text using Chrome's i18n API
   */
  async detectLanguage(text: string): Promise<LanguageDetectionResult | null> {
    if (!text || text.trim().length < 10) {
      return null;
    }

    // Check cache first
    const cacheKey = this.getCacheKey(text);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // Use Chrome's i18n.detectLanguage API
      const result = await browser.i18n.detectLanguage(text);
      
      if (!result || !result.isReliable || !result.languages || result.languages.length === 0) {
        return null;
      }

      // Get the primary detected language
      const primaryLang = result.languages[0];
      
      const detection: LanguageDetectionResult = {
        language: primaryLang.language,
        percentage: primaryLang.percentage,
        isReliable: result.isReliable,
      };

      // Always cache the result
      this.cache.set(cacheKey, detection);

      return detection;
    } catch (error) {
      console.warn('[LanguageDetector] Detection failed:', error);
      return null;
    }
  }

  /**
   * Check if the text is in English with sufficient confidence
   */
  async isEnglish(text: string): Promise<boolean> {
    const result = await this.detectLanguage(text);
    
    if (!result || !result.isReliable) {
      // Fail open: if detection fails, allow translation
      return true;
    }

    // Check if detected language is English and meets confidence threshold
    return (
      result.language === this.ENGLISH_CODE &&
      result.percentage >= this.MIN_CONFIDENCE
    );
  }

  /**
   * Batch detect languages for multiple text segments
   */
  async detectBatch(texts: string[]): Promise<(LanguageDetectionResult | null)[]> {
    return Promise.all(texts.map(text => this.detectLanguage(text)));
  }

  /**
   * Check if multiple texts are all in English
   */
  async areAllEnglish(texts: string[]): Promise<boolean[]> {
    return Promise.all(texts.map(text => this.isEnglish(text)));
  }

  /**
   * Clear the detection cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Filter segments to keep only English text
   */
  async filterEnglishSegments<T extends { text: string }>(segments: T[]): Promise<T[]> {
    const detectionPromises = segments.map(async (segment) => {
      const isEng = await this.isEnglish(segment.text);
      return { segment, isEnglish: isEng };
    });

    const results = await Promise.all(detectionPromises);
    return results
      .filter(({ isEnglish }) => isEnglish)
      .map(({ segment }) => segment);
  }

  /**
   * Get cache key for text (using first 100 chars for efficiency)
   */
  private getCacheKey(text: string): string {
    const normalized = text.trim().toLowerCase();
    return normalized.length > 100 ? normalized.substring(0, 100) : normalized;
  }

  /**
   * Detect page's primary language based on sample text
   */
  async detectPageLanguage(sampleTexts: string[]): Promise<string | null> {
    if (sampleTexts.length === 0) return null;

    // Combine sample texts for better detection
    const combinedText = sampleTexts
      .filter(t => t && t.trim().length > 10)
      .slice(0, 10) // Limit to first 10 samples
      .join(' ')
      .substring(0, 1000); // Limit total length

    const result = await this.detectLanguage(combinedText);
    return result?.isReliable ? result.language : null;
  }
}

// Singleton instance for shared use
let detectorInstance: LanguageDetector | null = null;

export function getLanguageDetector(): LanguageDetector {
  if (!detectorInstance) {
    detectorInstance = new LanguageDetector();
  }
  return detectorInstance;
}