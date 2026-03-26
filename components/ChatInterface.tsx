'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { ChatResponse, ChatMessage } from '@/app/api/chat/route';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: ChatResponse['type'];
  sql?: string;
  rowCount?: number;
  results?: Record<string, unknown>[];
  timestamp: Date;
}

interface Props {
  onHighlight?: (ids: string[]) => void;
}

const EXAMPLE_QUERIES = [
  'Which products appear in the most billing documents?',
  'Trace the full flow of billing document 91150187',
  'Find sales orders delivered but not billed',
  'Show top 10 customers by total order value',
  'Which deliveries have no associated billing document?',
];

export default function ChatInterface({ onHighlight }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hi! I\'m your Order-to-Cash intelligence assistant. Ask me anything about your orders, deliveries, billing documents, customers, or products. I\'ll query the database and give you data-backed answers.',
      type: 'direct',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSQL, setShowSQL] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const history: ChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }));

  async function sendMessage(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setInput('');
    const userMsg: Message = { role: 'user', content: msg, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history }),
      });
      const data: ChatResponse = await res.json();

      const assistantMsg: Message = {
        role: 'assistant',
        content: data.answer,
        type: data.type,
        sql: data.sql,
        rowCount: data.rowCount,
        results: data.results,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Highlight graph nodes
      if (data.highlightIds && data.highlightIds.length > 0) {
        onHighlight?.(data.highlightIds);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Network error. Please check your connection and try again.',
        type: 'error',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1e2a40] flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4f6ef7] to-[#8b5cf6] flex items-center justify-center text-white text-xs font-bold">
          AI
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Graph Intelligence</p>
          <p className="text-[11px] text-[#64748b]">Order-to-Cash Dataset</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] text-[#64748b]">Live</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`msg-animate flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] ${msg.role === 'user' ? '' : ''}`}>
              {/* Role indicator for assistant */}
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[#4f6ef7] to-[#8b5cf6] flex items-center justify-center text-[8px] font-bold text-white">AI</div>
                  <span className="text-[10px] text-[#3a4a70] font-medium uppercase tracking-wider">Assistant</span>
                  {msg.type === 'off_topic' && (
                    <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">Off-topic</span>
                  )}
                  {msg.type === 'sql' && (
                    <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">SQL</span>
                  )}
                </div>
              )}

              {/* Bubble */}
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#4f6ef7] text-white rounded-tr-sm'
                  : msg.type === 'off_topic'
                    ? 'bg-[#2a1f0a] border border-amber-500/30 text-amber-200 rounded-tl-sm'
                    : msg.type === 'error'
                      ? 'bg-[#2a0a0a] border border-red-500/30 text-red-300 rounded-tl-sm'
                      : 'bg-[#1a2035] border border-[#2a3350] text-[#cbd5e1] rounded-tl-sm'
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>

                {/* Row count badge */}
                {msg.rowCount !== undefined && (
                  <p className="mt-2 text-[11px] text-[#4f6ef7] font-medium">
                    {msg.rowCount} {msg.rowCount === 1 ? 'record' : 'records'} found
                  </p>
                )}

                {/* Results preview table */}
                {msg.results && msg.results.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-[#2a3350]">
                    <table className="chat-table">
                      <thead>
                        <tr>
                          {Object.keys(msg.results[0]).slice(0, 6).map(k => (
                            <th key={k}>{k.replace(/_/g, ' ')}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.results.slice(0, 5).map((row, ri) => (
                          <tr key={ri}>
                            {Object.values(row).slice(0, 6).map((v, vi) => (
                              <td key={vi} className="max-w-[120px] truncate">{String(v ?? '—')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {msg.results.length > 5 && (
                      <p className="text-[10px] text-[#64748b] px-3 py-1.5 border-t border-[#2a3350]">
                        showing 5 of {msg.rowCount} rows
                      </p>
                    )}
                  </div>
                )}

                {/* SQL toggle */}
                {msg.sql && (
                  <button
                    onClick={() => setShowSQL(showSQL === `${i}` ? null : `${i}`)}
                    className="mt-2 text-[11px] text-[#4f6ef7] hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <span>{showSQL === `${i}` ? '▾' : '▸'}</span>
                    {showSQL === `${i}` ? 'Hide SQL' : 'View SQL'}
                  </button>
                )}
                {showSQL === `${i}` && msg.sql && (
                  <div className="chat-code mt-2 text-[#94a3b8]">{msg.sql}</div>
                )}
              </div>

              {/* Timestamp */}
              <p suppressHydrationWarning className={`text-[10px] text-[#3a4a70] mt-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1a2035] border border-[#2a3350] rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
                <span className="text-[11px] text-[#64748b] ml-1">Analyzing…</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Example queries */}
      {messages.length <= 1 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] text-[#3a4a70] font-semibold uppercase tracking-wider mb-2">Try asking</p>
          <div className="space-y-1.5">
            {EXAMPLE_QUERIES.slice(0, 3).map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                className="w-full text-left text-xs text-[#94a3b8] bg-[#1a2035] hover:bg-[#1e2640] border border-[#2a3350] hover:border-[#4f6ef7]/50 rounded-lg px-3 py-2 transition-all duration-150"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t border-[#1e2a40]">
        <div className="flex items-end gap-2 bg-[#1a2035] border border-[#2a3350] rounded-xl px-3 py-2 focus-within:border-[#4f6ef7]/60 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about orders, deliveries, billing…"
            rows={1}
            className="flex-1 bg-transparent text-sm text-[#e2e8f0] placeholder-[#3a4a70] resize-none outline-none leading-5 max-h-28 overflow-y-auto py-1"
            style={{ scrollbarWidth: 'none' }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-lg bg-[#4f6ef7] hover:bg-[#3b5bdb] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-all duration-150 active:scale-95 mb-0.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-[#3a4a70] text-center mt-1.5">Enter to send • Shift+Enter for new line</p>
      </div>
    </div>
  );
}
