// ── pos-ai/gemini-client.ts ─────────────────────────────────────
// Singleton Gemini client with retry, timeout, error handling
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { POS_AI_CONFIG } from './config';

@Injectable()
export class GeminiClientService implements OnModuleInit {
  private readonly logger = new Logger('POS-AI:Gemini');
  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;

  onModuleInit() {
    if (!POS_AI_CONFIG.geminiAvailable) {
      this.logger.warn('GEMINI_API_KEY not set — Gemini features disabled');
      return;
    }
    try {
      this.client = new GoogleGenerativeAI(POS_AI_CONFIG.geminiApiKey);
      this.model = this.client.getGenerativeModel({ model: POS_AI_CONFIG.geminiModel });
      this.logger.log(`Gemini client initialized (model: ${POS_AI_CONFIG.geminiModel})`);
    } catch (err) {
      this.logger.error('Failed to initialize Gemini client', err);
      this.client = null;
      this.model = null;
    }
  }

  /** Is the Gemini client ready? */
  isAvailable(): boolean {
    return this.client !== null && this.model !== null;
  }

  /** Get the raw GoogleGenerativeAI instance */
  getClient(): GoogleGenerativeAI | null {
    return this.client;
  }

  /** Get the configured GenerativeModel */
  getModel(): GenerativeModel | null {
    return this.model;
  }

  /**
   * Send a prompt to Gemini with retry + timeout
   */
  async generate(prompt: string, systemInstruction?: string): Promise<string | null> {
    if (!this.isAvailable()) {
      this.logger.warn('Gemini not available — skipping generate()');
      return null;
    }

    for (let attempt = 0; attempt <= POS_AI_CONFIG.maxRetries; attempt++) {
      try {
        const model = systemInstruction
          ? this.client!.getGenerativeModel({
              model: POS_AI_CONFIG.geminiModel,
              systemInstruction,
            })
          : this.model!;

        const result = await Promise.race([
          model.generateContent(prompt),
          this.timeout(POS_AI_CONFIG.requestTimeoutMs),
        ]);

        if (!result) throw new Error('Gemini request timed out');

        const text = (result as any).response?.text?.() || '';
        this.logger.debug(`Gemini response (${text.length} chars, attempt ${attempt + 1})`);
        return text;
      } catch (err: any) {
        const status = err?.status || err?.httpStatusCode;
        const msg = err?.message || String(err);

        if (status === 429) {
          this.logger.warn(`Gemini rate limit (attempt ${attempt + 1}/${POS_AI_CONFIG.maxRetries + 1})`);
        } else if (status === 401 || status === 403) {
          this.logger.error('Gemini auth error — check GEMINI_API_KEY');
          return null; // don't retry auth errors
        } else {
          this.logger.error(`Gemini error (attempt ${attempt + 1}): ${msg}`);
        }

        if (attempt < POS_AI_CONFIG.maxRetries) {
          await this.sleep(POS_AI_CONFIG.retryDelayMs * (attempt + 1));
        }
      }
    }

    this.logger.error('Gemini: all retries exhausted');
    return null;
  }

  /**
   * Test the Gemini connection with a trivial prompt
   */
  async testConnection(): Promise<{ connected: boolean; model: string; response?: string; error?: string }> {
    if (!this.isAvailable()) {
      return {
        connected: false,
        model: POS_AI_CONFIG.geminiModel,
        error: 'GEMINI_API_KEY not set or client initialization failed',
      };
    }

    try {
      const response = await this.generate('Réponds uniquement "OK" si tu fonctionnes.');
      return {
        connected: !!response,
        model: POS_AI_CONFIG.geminiModel,
        response: response || undefined,
        error: response ? undefined : 'Empty response from Gemini',
      };
    } catch (err: any) {
      return {
        connected: false,
        model: POS_AI_CONFIG.geminiModel,
        error: err.message || String(err),
      };
    }
  }

  private timeout(ms: number): Promise<null> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
