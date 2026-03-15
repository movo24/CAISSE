import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  FileText,
  TrendingUp,
  Package,
  Users,
  Loader2,
  Bot,
  User,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { iaApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

// ── Types ───────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  isError?: boolean;
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  reportType: string;
}

// ── Quick Actions Config ────────────────────────────────────────────────

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'daily',
    label: 'Synthese du jour',
    description: 'Resume complet des ventes, produits et paiements',
    icon: FileText,
    reportType: 'daily_summary',
  },
  {
    id: 'weekly',
    label: 'Analyse semaine',
    description: 'Tendances, evolution du CA et plan d\'action',
    icon: TrendingUp,
    reportType: 'weekly_analysis',
  },
  {
    id: 'products',
    label: 'Performance produits',
    description: 'Top/flop produits, stock et opportunites',
    icon: Package,
    reportType: 'product_performance',
  },
  {
    id: 'cashiers',
    label: 'Analyse caissiers',
    description: 'Classement equipe, efficacite et formation',
    icon: Users,
    reportType: 'cashier_analysis',
  },
];

// ── Suggestions ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Quel est mon chiffre d\'affaires cette semaine ?',
  'Quels produits devrais-je mettre en promo ?',
  'Y a-t-il des anomalies dans les ventes ?',
  'Comment optimiser mon stock ?',
];

// ── Simple Markdown Renderer ────────────────────────────────────────────
// Renders markdown-like text without external dependencies

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="list-disc pl-5 my-2 space-y-1">
          {listItems.map((item, i) => (
            <li key={i} className="text-sm text-gray-700">
              <InlineFormat text={item} />
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      flushList();
      continue;
    }

    // H2: ## Title
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={key++} className="text-base font-bold text-gray-900 mt-5 mb-2 pb-1.5 border-b border-indigo-100">
          <InlineFormat text={trimmed.slice(3)} />
        </h2>
      );
      continue;
    }

    // H3: ### Title
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={key++} className="text-sm font-bold text-gray-800 mt-4 mb-1.5">
          <InlineFormat text={trimmed.slice(4)} />
        </h3>
      );
      continue;
    }

    // H1: # Title
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h1 key={key++} className="text-lg font-bold text-gray-900 mt-4 mb-2">
          <InlineFormat text={trimmed.slice(2)} />
        </h1>
      );
      continue;
    }

    // List item: - text or * text or 1. text
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*]\s/, '').replace(/^\d+\.\s/, '');
      listItems.push(itemText);
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={key++} className="text-sm text-gray-700 my-2 leading-relaxed">
        <InlineFormat text={trimmed} />
      </p>
    );
  }

  flushList();

  return <div>{elements}</div>;
}

// Inline formatting: **bold**, *italic*, `code`
function InlineFormat({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Code: `text`
    const codeMatch = remaining.match(/`(.+?)`/);

    // Find earliest match
    const boldIdx = boldMatch?.index ?? Infinity;
    const codeIdx = codeMatch?.index ?? Infinity;

    if (boldIdx === Infinity && codeIdx === Infinity) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    if (boldIdx <= codeIdx && boldMatch) {
      if (boldIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, boldIdx)}</span>);
      parts.push(<strong key={key++} className="font-bold text-indigo-600">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldIdx + boldMatch[0].length);
    } else if (codeMatch) {
      if (codeIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, codeIdx)}</span>);
      parts.push(
        <code key={key++} className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-xs font-mono">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeIdx + codeMatch[0].length);
    }
  }

  return <>{parts}</>;
}

// ── Component ───────────────────────────────────────────────────────────

export function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { restoreSession } = useAuthStore();

  // ── Auth: restore session from localStorage (login required via /login) ──
  useEffect(() => {
    restoreSession();
    const existingToken = localStorage.getItem('accessToken');
    setAuthReady(!!existingToken);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (
    role: 'user' | 'assistant',
    content: string,
    opts?: { isLoading?: boolean; isError?: boolean },
  ): string => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setMessages((prev) => [
      ...prev,
      {
        id,
        role,
        content,
        timestamp: new Date(),
        isLoading: opts?.isLoading,
        isError: opts?.isError,
      },
    ]);
    return id;
  };

  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    );
  };

  // ── Send a chat message ────────────────────────────────────────────

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    addMessage('user', content.trim());
    setInput('');
    setIsLoading(true);

    const assistantId = addMessage('assistant', '', { isLoading: true });

    try {
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await iaApi.chat({ message: content.trim(), history });

      updateMessage(assistantId, {
        content: res.data.response,
        isLoading: false,
      });
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        'Impossible de contacter l\'assistant IA. Verifiez que le backend est demarre.';

      updateMessage(assistantId, {
        content: errorMsg,
        isLoading: false,
        isError: true,
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  // ── Generate a specific report ─────────────────────────────────────

  const generateReport = async (action: QuickAction) => {
    if (isLoading) return;

    addMessage('user', `Genere un rapport : ${action.label}`);
    setIsLoading(true);

    const assistantId = addMessage('assistant', '', { isLoading: true });

    try {
      const res = await iaApi.generateReport({ reportType: action.reportType });

      updateMessage(assistantId, {
        content: res.data.report,
        isLoading: false,
      });
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        'Erreur lors de la generation du rapport.';

      updateMessage(assistantId, {
        content: errorMsg,
        isLoading: false,
        isError: true,
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  // ── Keyboard handler ───────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  const hasMessages = messages.length > 0;

  // Wait for auth before rendering
  if (!authReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-400">
          <Loader2 size={24} className="animate-spin" />
          <span className="text-sm">Connexion en cours...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-8 py-5 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="text-white" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Assistant IA</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Analyse intelligente de vos donnees commerciales — Powered by Claude
            </p>
          </div>
        </div>
      </header>

      {/* ── Content Area ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!hasMessages ? (
          /* ── Welcome Screen ──────────────────────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 overflow-y-auto">
            {/* Logo */}
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center mb-6 shadow-xl shadow-indigo-500/20">
              <Bot className="text-white" size={40} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Bonjour ! Comment puis-je vous aider ?
            </h2>
            <p className="text-gray-500 text-sm mb-10 max-w-lg text-center">
              Je peux analyser vos donnees de vente, vous fournir des rapports detailles
              et vous recommander des actions concretes pour ameliorer vos performances.
            </p>

            {/* Quick Actions */}
            <div className="w-full max-w-3xl mb-10">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
                Rapports rapides
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      onClick={() => generateReport(action)}
                      disabled={isLoading}
                      className="group flex items-start gap-4 px-5 py-4 bg-white border border-gray-200 rounded-2xl hover:border-indigo-300 hover:shadow-md transition-all duration-200 disabled:opacity-50 text-left"
                    >
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-100 transition-colors">
                        <Icon size={20} className="text-indigo-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {action.label}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {action.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Suggestions */}
            <div className="w-full max-w-3xl">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
                Suggestions
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    disabled={isLoading}
                    className="px-4 py-2 bg-white border border-gray-200 rounded-full text-xs text-gray-700 hover:border-indigo-300 hover:text-indigo-600 transition-all disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Messages ────────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="max-w-4xl mx-auto space-y-5">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {/* Avatar (assistant only) */}
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0 mt-1">
                      <Sparkles className="text-white" size={14} />
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    className={`max-w-[75%] rounded-2xl px-5 py-4 ${
                      message.role === 'user'
                        ? 'bg-indigo-500 text-white'
                        : message.isError
                          ? 'bg-red-50 border border-red-200'
                          : 'bg-white border border-gray-200 shadow-sm'
                    }`}
                  >
                    {message.isLoading ? (
                      <div className="flex items-center gap-2 text-gray-400">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Generation en cours...</span>
                      </div>
                    ) : message.isError ? (
                      <div className="flex items-start gap-2">
                        <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700">{message.content}</p>
                      </div>
                    ) : message.role === 'assistant' ? (
                      <SimpleMarkdown text={message.content} />
                    ) : (
                      <p className="text-sm leading-relaxed">{message.content}</p>
                    )}

                    {/* Timestamp */}
                    {!message.isLoading && (
                      <p
                        className={`text-[10px] mt-2 ${
                          message.role === 'user'
                            ? 'text-white/50'
                            : 'text-gray-400'
                        }`}
                      >
                        {message.timestamp.toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>

                  {/* Avatar (user only) */}
                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-xl bg-gray-800 flex items-center justify-center flex-shrink-0 mt-1">
                      <User className="text-white" size={14} />
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* ── Quick Actions Bar (when in chat) ───────────────────────── */}
        {hasMessages && (
          <div className="px-8 pb-2 flex-shrink-0">
            <div className="max-w-4xl mx-auto flex gap-2 overflow-x-auto pb-1">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    onClick={() => generateReport(action)}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    <Icon size={13} />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Input Bar ──────────────────────────────────────────────── */}
        <div className="bg-white border-t border-gray-200 px-8 py-4 flex-shrink-0">
          <div className="max-w-4xl mx-auto flex gap-3">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Posez votre question sur les performances du magasin..."
                disabled={isLoading}
                className="w-full px-5 py-3.5 pr-12 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all disabled:opacity-50"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Zap size={16} className="text-gray-300" />
              </div>
            </div>
            <button
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
              className="px-5 py-3.5 bg-indigo-500 text-white rounded-2xl hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100 flex items-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
          <p className="text-center text-[10px] text-gray-300 mt-2 max-w-4xl mx-auto">
            Les reponses sont generees par IA et peuvent contenir des erreurs. Verifiez les donnees critiques.
          </p>
        </div>
      </div>
    </div>
  );
}
