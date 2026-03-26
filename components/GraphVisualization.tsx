'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { NODE_COLORS, NODE_LABELS, GraphNode, GraphData } from '@/lib/graph-types';

interface Props {
  highlightIds?: string[];
  onNodeSelect?: (node: GraphNode) => void;
  focusId?: string | null;
}

export default function GraphVisualization({ highlightIds = [], onNodeSelect, focusId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ForceGraph, setForceGraph] = useState<unknown>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });


  useEffect(() => {
    import('react-force-graph-2d').then(m => setForceGraph(() => m.default));
  }, []);


  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);


  useEffect(() => {
    setLoading(true);
    const url = focusId ? `/api/graph?focus=${encodeURIComponent(focusId)}` : '/api/graph?max=200';
    fetch(url)
      .then(r => r.json())
      .then(d => { setGraphData(d); setLoading(false); })
      .catch(() => { setError('Failed to load graph'); setLoading(false); });
  }, [focusId]);

  const nodeCanvasObject = useCallback(
    (node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as unknown as GraphNode & { x: number; y: number };
      const isHighlighted = highlightIds.includes(n.id);
      const isSelected = selectedNode?.id === n.id;
      const size = ((n.val || 3) * 2.5) + (isHighlighted ? 3 : 0) + (isSelected ? 4 : 0);
      const color = NODE_COLORS[n.type] || '#888';


      if (isHighlighted || isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, size + 5, 0, 2 * Math.PI);
        ctx.fillStyle = color + '40';
        ctx.fill();
      }


      ctx.beginPath();
      ctx.arc(n.x, n.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? '#ffffff' : color;
      ctx.fill();


      ctx.beginPath();
      ctx.arc(n.x, n.y, size, 0, 2 * Math.PI);
      ctx.strokeStyle = isHighlighted ? '#ffffff' : color + 'aa';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();


      if (globalScale > 1.5 || isSelected || isHighlighted) {
        const label = n.label.length > 16 ? n.label.slice(0, 14) + '…' : n.label;
        ctx.font = `${isSelected ? 600 : 400} ${11 / globalScale}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(232,234,246,0.9)';
        ctx.fillText(label, n.x, n.y + size + 2 / globalScale);
      }
    },
    [highlightIds, selectedNode]
  );

  const handleNodeClick = useCallback((node: Record<string, unknown>) => {
    const n = node as unknown as GraphNode;
    setSelectedNode(prev => prev?.id === n.id ? null : n);
    onNodeSelect?.(n);
  }, [onNodeSelect]);

  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of highlightIds) ids.add(id);
    if (selectedNode?.id) ids.add(selectedNode.id);
    return ids;
  }, [highlightIds, selectedNode?.id]);

  const { nodeVisibilitySet, linkVisibilitySet } = useMemo(() => {
    if (!graphData) return { nodeVisibilitySet: null as Set<string> | null, linkVisibilitySet: null as Set<string> | null };

    if (activeIds.size === 0) {
      return { nodeVisibilitySet: null, linkVisibilitySet: null };
    }

    const nodeSet = new Set<string>();
    const linkSet = new Set<string>();

    for (const l of graphData.links) {
      const s = l.source;
      const t = l.target;
      const isActiveEndpoint = activeIds.has(s) || activeIds.has(t);
      if (!isActiveEndpoint) continue;
      nodeSet.add(s);
      nodeSet.add(t);

      linkSet.add(`${s}__${t}__${l.label}`);
    }


    activeIds.forEach(id => nodeSet.add(id));
    return { nodeVisibilitySet: nodeSet, linkVisibilitySet: linkSet };
  }, [graphData, activeIds]);

  const getRelationshipColor = useCallback((label?: string) => {
    const rel = (label || '').toLowerCase();
    if (rel.includes('placed')) return '#60a5fa';
    if (rel.includes('fulfilled')) return '#22c55e';
    if (rel.includes('billed_as') || rel.includes('billed')) return '#f59e0b';
    if (rel.includes('recorded')) return '#ef4444';
    if (rel.includes('ordered_product')) return '#8b5cf6';
    if (rel.includes('delivered_product')) return '#10b981';
    if (rel.includes('billed_product')) return '#f59e0b';
    return '#94a3b8';
  }, []);

  const nodeVisibility = useCallback(
    (node: Record<string, unknown>) => {
      if (!nodeVisibilitySet) return true;
      const n = node as unknown as GraphNode;
      return nodeVisibilitySet.has(n.id);
    },
    [nodeVisibilitySet]
  );

  const linkVisibility = useCallback(
    (link: Record<string, unknown>) => {
      if (!linkVisibilitySet) return true;
      const l = link as { source?: string; target?: string; label?: string };
      const s = String(l.source ?? '');
      const t = String(l.target ?? '');
      const label = String(l.label ?? '');
      return linkVisibilitySet.has(`${s}__${t}__${label}`);
    },
    [linkVisibilitySet]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0a0e1a]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#4f6ef7] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#94a3b8] text-sm">Building knowledge graph…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0a0e1a]">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0a0e1a] overflow-hidden">



      <div className="absolute bottom-3 left-3 z-10 bg-[#111827]/90 border border-[#2a3350] rounded-xl p-3 backdrop-blur-sm">
        <p className="text-[10px] text-[#64748b] font-semibold uppercase tracking-wider mb-2">Entity Types</p>
        <div className="space-y-1">
          {Object.entries(NODE_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: NODE_COLORS[type as GraphNode['type']] }} />
              <span className="text-xs text-[#94a3b8]">{label}</span>
            </div>
          ))}
        </div>
      </div>


      {selectedNode && (
        <div className="absolute top-3 right-3 z-10 w-72 bg-[#111827]/95 border border-[#2a3350] rounded-xl p-4 backdrop-blur-sm shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: NODE_COLORS[selectedNode.type] }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: NODE_COLORS[selectedNode.type] }}>
                {NODE_LABELS[selectedNode.type]}
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-[#64748b] hover:text-white text-lg leading-none w-5 h-5 flex items-center justify-center"
            >
              ×
            </button>
          </div>
          <p className="text-white font-semibold text-sm mb-3 truncate">{selectedNode.label}</p>
          {graphData && (
            <p className="text-[10px] text-[#64748b] mb-2">
              Connections: {graphData.links.filter(l => l.source === selectedNode.id || l.target === selectedNode.id).length}
            </p>
          )}
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {Object.entries(selectedNode.data).map(([k, v]) => {
              if (v === null || v === undefined || v === 'null' || v === '') return null;
              return (
                <div key={k} className="flex justify-between gap-2 text-xs">
                  <span className="text-[#64748b] capitalize flex-shrink-0">
                    {k.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[#94a3b8] truncate text-right">{String(v)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ForceGraph && graphData && (
        // @ts-ignore
        <ForceGraph
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#0a0e1a"
          nodeLabel={(node: Record<string, unknown>) => {
            const n = node as unknown as GraphNode;
            return `${NODE_LABELS[n.type]}: ${n.label}`;
          }}
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => 'replace'}
          nodeVisibility={nodeVisibility}
          onNodeClick={handleNodeClick}
          linkLabel={(link: Record<string, unknown>) => {
            const l = link as { label?: string; source?: string; target?: string };
            const label = l.label ?? '';
            const source = l.source ?? '';
            const target = l.target ?? '';
            return label ? `${label}` : `${source} → ${target}`;
          }}
          linkVisibility={linkVisibility}
          linkColor={(link: Record<string, unknown>) => {
            const l = link as { label?: string };
            return `${getRelationshipColor(l.label)}33`;
          }}
          linkWidth={(link: Record<string, unknown>) => {
            const l = link as { source?: string; target?: string; label?: string };
            const s = String(l.source ?? '');
            const t = String(l.target ?? '');
            const label = String(l.label ?? '');
            const emphasized = nodeVisibilitySet ? (nodeVisibilitySet.has(s) && nodeVisibilitySet.has(t)) : false;
            return emphasized ? 1.5 : 1;
          }}
          linkCurvature={() => 0.15}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={(link: Record<string, unknown>) => {
            const l = link as { label?: string };
            return `${getRelationshipColor(l.label)}88`;
          }}
          cooldownTicks={80}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          enableZoomInteraction
          enablePanInteraction
        />
      )}


      <div className="absolute bottom-3 right-3 z-10 text-[10px] text-[#3a4a70]">
        Click node to inspect • Scroll to zoom • Drag to pan
      </div>
    </div>
  );
}
