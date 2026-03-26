'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import ChatInterface from '@/components/ChatInterface';
import { GraphNode, NODE_COLORS } from '@/lib/graph-types';

// ForceGraph must be client-only
const GraphVisualization = dynamic(() => import('@/components/GraphVisualization'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#0a0e1a]">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#4f6ef7] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[#94a3b8] text-sm">Initializing graph engine…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; label: string; type: string; subtitle: string }>>([]);
  const [graphStats, setGraphStats] = useState<Record<string, number> | null>(null);

  // Fetch stats for the header
  useEffect(() => {
    fetch('/api/graph?max=200')
      .then(r => r.json())
      .then(d => { if (d.stats) setGraphStats(d.stats); })
      .catch(() => {});
  }, []);

  const handleHighlight = useCallback((ids: string[]) => {
    setHighlightIds(ids);
  }, []);

  const handleNodeSelect = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const res = await fetch(`/api/graph-data?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setSearchResults(data.results || []);
  }, []);

  const focusNode = useCallback((id: string) => {
    setFocusId(id);
    setSearchResults([]);
    setSearchQuery('');
  }, []);

  const resetFocus = useCallback(() => {
    setFocusId(null);
    setHighlightIds([]);
    setSelectedNode(null);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#0a0e1a] overflow-hidden">
      {/* Top navigation */}
      <header className="flex items-center gap-4 px-5 h-12 border-b border-[#1e2a40] bg-[#0d1117] z-20 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#4f6ef7] to-[#8b5cf6] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" />
              <circle cx="4" cy="18" r="2" /><circle cx="20" cy="18" r="2" />
              <line x1="6" y1="7" x2="10" y2="10.5" /><line x1="18" y1="7" x2="14" y2="10.5" />
              <line x1="6" y1="17" x2="10" y2="13.5" /><line x1="18" y1="17" x2="14" y2="13.5" />
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">Order-to-Cash</span>
          <span className="text-[#3a4a70] text-sm">/</span>
          <span className="text-[#64748b] text-sm">Knowledge Graph</span>
        </div>

        {/* Search */}
        <div className="relative ml-4">
          <div className="flex items-center gap-2 bg-[#1a2035] border border-[#2a3350] rounded-lg px-3 py-1.5 w-64 focus-within:border-[#4f6ef7]/50 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search entities…"
              className="bg-transparent text-xs text-[#cbd5e1] placeholder-[#3a4a70] outline-none w-full"
            />
          </div>

          {/* Search dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-[#111827] border border-[#2a3350] rounded-xl shadow-2xl overflow-hidden z-30">
              {searchResults.map(r => (
                <button
                  key={r.id}
                  onClick={() => focusNode(r.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#1a2035] text-left transition-colors"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{
                    background: r.type === 'customer' ? '#06b6d4' : r.type === 'sales_order' ? '#4f6ef7' : r.type === 'billing' ? '#f59e0b' : '#10b981'
                  }} />
                  <div>
                    <p className="text-xs text-[#e2e8f0] font-medium">{r.label}</p>
                    <p className="text-[10px] text-[#64748b]">{r.subtitle || r.type}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Focus breadcrumb */}
        {focusId && (
          <div className="flex items-center gap-2 bg-[#4f6ef7]/20 border border-[#4f6ef7]/40 rounded-lg px-3 py-1">
            <span className="text-xs text-[#4f6ef7]">Focused: {focusId}</span>
            <button onClick={resetFocus} className="text-[#4f6ef7] hover:text-white text-sm leading-none">×</button>
          </div>
        )}

        {/* Compact stat badges in header */}
        {graphStats && (
          <div className="flex items-center gap-1.5 ml-4">
            {Object.entries(graphStats).map(([key, val]) => {
              const typeKey = key === 'sales_orders' ? 'sales_order' : key === 'billing_documents' ? 'billing' : key === 'journal_entries' ? 'journal' : key;
              return (
                <div key={key} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1a2035]/60 border border-[#2a3350]/60 whitespace-nowrap"
                  style={{ color: (NODE_COLORS as Record<string, string>)[typeKey] || '#94a3b8' }}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: (NODE_COLORS as Record<string, string>)[typeKey] || '#94a3b8' }} />
                  {val.toLocaleString()} {key.replace(/_/g, ' ')}
                </div>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <a
            href="https://github.com"
            target="_blank"
            className="text-[#64748b] hover:text-white text-xs flex items-center gap-1 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>

          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs text-[#64748b] hover:text-white bg-[#1a2035] border border-[#2a3350] rounded-lg px-3 py-1.5 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="18" rx="1" />
            </svg>
            {sidebarOpen ? 'Hide' : 'Show'} Chat
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Graph panel */}
        <div className="flex-1 min-w-0 relative">
          <GraphVisualization
            highlightIds={highlightIds}
            onNodeSelect={handleNodeSelect}
            focusId={focusId}
          />

          {/* Expand/focus hint when node selected */}
          {selectedNode && !focusId && (
            <div className="absolute bottom-14 right-3 z-10">
              <button
                onClick={() => focusNode(selectedNode.id)}
                className="text-xs bg-[#4f6ef7] hover:bg-[#3b5bdb] text-white px-3 py-2 rounded-lg shadow-lg transition-colors"
              >
                Expand {selectedNode.label} →
              </button>
            </div>
          )}
        </div>

        {/* Chat sidebar */}
        {sidebarOpen && (
          <div className="w-[340px] flex-shrink-0 border-l border-[#1e2a40] flex flex-col overflow-hidden">
            <ChatInterface onHighlight={handleHighlight} />
          </div>
        )}
      </div>
    </div>
  );
}
