
export interface GraphNode {
  id: string;
  label: string;
  type: 'customer' | 'sales_order' | 'delivery' | 'billing' | 'journal' | 'product';
  data: Record<string, unknown>;
  val?: number;
  color?: string;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  color?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
  stats: {
    customers: number;
    sales_orders: number;
    deliveries: number;
    billing_documents: number;
    journal_entries: number;
    products: number;
  };
}

export const NODE_COLORS: Record<GraphNode['type'], string> = {
  customer:    '#06b6d4',
  sales_order: '#4f6ef7',
  delivery:    '#10b981',
  billing:     '#f59e0b',
  journal:     '#ef4444',
  product:     '#8b5cf6',
};

export const NODE_LABELS: Record<GraphNode['type'], string> = {
  customer:    'Customer',
  sales_order: 'Sales Order',
  delivery:    'Delivery',
  billing:     'Billing Doc',
  journal:     'Journal Entry',
  product:     'Product',
};
