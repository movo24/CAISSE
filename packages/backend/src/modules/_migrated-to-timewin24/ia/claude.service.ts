import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface ClaudeChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * ClaudeService – wrapper isolé autour du SDK Anthropic.
 *
 * - Initialise le client si ANTHROPIC_API_KEY est défini
 * - Expose isAvailable() pour vérifier la configuration
 * - Gère les erreurs API (rate-limit, timeout, clé invalide)
 */
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private client: Anthropic | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey && apiKey.length > 0) {
      this.client = new Anthropic({ apiKey });
      this.logger.log('Claude AI service initialized');
    } else {
      this.logger.warn(
        'ANTHROPIC_API_KEY not configured – Claude AI features disabled',
      );
    }
  }

  /** Vérifie si la clé API est configurée */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Envoie un message à Claude et retourne la réponse complète.
   *
   * @param systemPrompt – Contexte système (rôle, données magasin, règles)
   * @param messages     – Historique de conversation
   * @returns            – Texte de la réponse + usage tokens
   */
  async chat(
    systemPrompt: string,
    messages: ClaudeChatMessage[],
  ): Promise<ClaudeResponse> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Service IA non configure. Ajoutez ANTHROPIC_API_KEY dans le fichier .env',
      );
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const text =
        response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n') || '';

      const usage = {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };

      this.logger.debug(
        `Claude response: ${usage.inputTokens} input + ${usage.outputTokens} output tokens`,
      );

      return { text, usage };
    } catch (error: any) {
      // Rate limit
      if (error?.status === 429) {
        this.logger.warn('Claude API rate limit reached');
        throw new ServiceUnavailableException(
          'Limite de requetes IA atteinte. Reessayez dans quelques secondes.',
        );
      }

      // Authentication error
      if (error?.status === 401) {
        this.logger.error('Claude API key invalid');
        throw new ServiceUnavailableException(
          'Cle API Claude invalide. Verifiez ANTHROPIC_API_KEY.',
        );
      }

      // Billing / credit balance error
      if (error?.status === 400 && error?.message?.includes('credit balance')) {
        this.logger.error('Anthropic account has insufficient credits');
        throw new ServiceUnavailableException(
          'Credits Anthropic insuffisants. Rechargez votre compte sur console.anthropic.com.',
        );
      }

      // Generic error
      this.logger.error(`Claude API error: ${error.message}`, error.stack);
      throw new ServiceUnavailableException(
        'Erreur du service IA. Reessayez plus tard.',
      );
    }
  }
}
