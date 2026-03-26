/**
 * Seed script: walks data/raw/ recursively, reads all .jsonl and .csv files,
 * maps them to the correct table by folder/filename keywords, and ingests
 * into SQLite with fuzzy field matching.
 *
 * Run with: npx tsx scripts/seed.ts
 *
 * Supported layout examples:
 *   data/raw/SalesOrder/sales_order_header.jsonl
 *   data/raw/SalesOrder/sales_order_items.jsonl
 *   data/raw/Delivery/delivery.jsonl
 *   data/raw/BillingDocument/billing.jsonl
 *   data/raw/JournalEntry/journal_entry.jsonl
 *   data/raw/customers.csv   ← flat files also work
 */

import Database from 'better-sqlite3';
import { parse as parseCsv } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { initSchema } from '../lib/db';

const DB_PATH = path.join(process.cwd(), 'data', 'otc.db');
const RAW_DIR = path.join(process.cwd(), 'data', 'raw');

// ─── Bootstrap DB ─────────────────────────────────────────────────────────────

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('🗑  Removed existing database');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // disabled during seed - re-enabled at end
initSchema(db);
console.log('✅ Schema initialized\n');

// ─── File discovery ───────────────────────────────────────────────────────────

interface DiscoveredFile {
  /** Absolute path to the file */
  filepath: string;
  /** Relative path from RAW_DIR, e.g. "SalesOrder/header.jsonl" */
  relpath: string;
  /** Lowercase version of the full relative path for keyword matching */
  lower: string;
  ext: 'jsonl' | 'csv';
}

function walkDir(dir: string, base: string = dir): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, base));
    } else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.ndjson')) {
      const relpath = path.relative(base, full);
      results.push({ filepath: full, relpath, lower: relpath.toLowerCase().replace(/\\/g, '/'), ext: 'jsonl' });
    } else if (entry.name.endsWith('.csv')) {
      const relpath = path.relative(base, full);
      results.push({ filepath: full, relpath, lower: relpath.toLowerCase().replace(/\\/g, '/'), ext: 'csv' });
    }
  }
  return results;
}

const allFiles = walkDir(RAW_DIR);
console.log(`📁 Discovered ${allFiles.length} data file(s):`);
allFiles.forEach(f => console.log(`   ${f.relpath}`));
console.log('');

// ─── Readers ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function readJsonl(filepath: string): Row[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const rows: Row[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      console.warn(`   ⚠️  Skipping malformed line in ${path.basename(filepath)}`);
    }
  }
  return rows;
}

function readCsvFile(filepath: string): Row[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Row[];
}

function readFile(f: DiscoveredFile): Row[] {
  return f.ext === 'jsonl' ? readJsonl(f.filepath) : readCsvFile(f.filepath);
}

// ─── Field helpers ────────────────────────────────────────────────────────────

/** Normalize a key for fuzzy matching: lowercase, strip spaces/underscores/dashes */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_\-\.]/g, '');
}

/**
 * Find a field value in a row by trying multiple candidate names.
 * Works with nested objects too — e.g. candidates like "header.SalesOrder"
 * will drill into row.header.SalesOrder.
 */
function col(row: Row, ...candidates: string[]): string | null {
  // First try flat keys
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    // Direct normalized match on flat keys
    const found = keys.find(k => norm(k) === norm(candidate));
    if (found !== undefined) {
      const val = row[found];
      if (val === null || val === undefined) continue;
      return String(val);
    }
    // Try dotted path e.g. "SalesOrderHeader.SalesOrder"
    if (candidate.includes('.')) {
      const parts = candidate.split('.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cur: any = row;
      let ok = true;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur) {
          cur = cur[p];
        } else {
          ok = false; break;
        }
      }
      if (ok && cur !== null && cur !== undefined) return String(cur);
    }
  }

  // If the row itself has nested objects, search one level deep
  for (const candidate of candidates) {
    for (const key of keys) {
      const val = row[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const nested = val as Row;
        const nestedKeys = Object.keys(nested);
        const found = nestedKeys.find(k => norm(k) === norm(candidate));
        if (found !== undefined && nested[found] !== null && nested[found] !== undefined) {
          return String(nested[found]);
        }
      }
    }
  }

  return null;
}

function safe(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '' || s === 'N/A' || s === 'null' || s === 'undefined') return null;
  return s;
}

function safeNum(val: string | null | undefined): number | null {
  if (!val) return null;
  const s = String(val).replace(/,/g, '').trim();
  if (!s || s === 'N/A' || s === 'null') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ─── File classifier ──────────────────────────────────────────────────────────

/**
 * Classify a file into an entity type based on folder name + filename keywords.
 * Returns null if it doesn't match any known entity.
 */
type EntityType =
  | 'customers'
  | 'products'
  | 'sales_orders'
  | 'sales_order_items'
  | 'deliveries'
  | 'delivery_items'
  | 'billing_documents'
  | 'billing_items'
  | 'journal_entries';

const ENTITY_KEYWORDS: Record<EntityType, string[]> = {
  customers:          ['customer', 'cust', 'client', 'soldto', 'sold_to', 'partner'],
  products:           ['product', 'material', 'sku', 'article', 'item_master'],
  sales_orders:       ['salesorder', 'sales_order', 'purchaseorder', 'purchase_order', 'order_header', 'soheader'],
  sales_order_items:  ['salesorderitem', 'order_item', 'soitem', 'orderline', 'order_line', 'poitem'],
  deliveries:         ['deliver', 'shipment', 'dispatch', 'outbounddelivery', 'delivery_header'],
  delivery_items:     ['deliveryitem', 'delivery_item', 'shipitem'],
  billing_documents:  ['billing', 'invoice', 'billingdoc', 'billing_doc', 'billdoc', 'invoicedoc'],
  // Dataset uses `billing_document_items/*` naming, so include `billingdocumentitem(s)` too.
  billing_items:      ['billingitem', 'billing_item', 'invoiceitem', 'invoice_item', 'billingdocumentitem', 'billingdocumentitems'],
  journal_entries:    ['journal', 'journalentry', 'accounting', 'ledger', 'glentry', 'gl_entry', 'financ', 'accountingdoc'],
};

function classifyFile(f: DiscoveredFile): EntityType | null {
  // Some source files share keywords with richer "header" files but do not contain
  // the same fields (e.g. schedule lines overwrite header fields because we use
  // INSERT OR REPLACE). Skip those to preserve referential data.
  const rel = f.lower;
  if (rel.includes('sales_order_schedule_lines')) return null;
  // Cancellations may miss reference fields needed to populate delivery/sales order links.
  if (rel.includes('billing_document_cancellations')) return null;

  // Use the full relative path (folder + filename) for matching
  const searchStr = f.lower.replace(/[\/\\_\-\.]/g, '');

  // Score each entity type by how many of its keywords appear in the path
  let bestType: EntityType | null = null;
  let bestScore = 0;

  for (const [entity, keywords] of Object.entries(ENTITY_KEYWORDS) as [EntityType, string[]][]) {
    let score = 0;
    for (const kw of keywords) {
      if (searchStr.includes(kw.toLowerCase().replace(/[_\-]/g, ''))) {
        // Longer keyword = more specific = higher score
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = entity;
    }
  }

  // Require minimum match confidence
  return bestScore >= 4 ? bestType : null;
}

// ─── Group files by entity ────────────────────────────────────────────────────

const entityFiles: Record<EntityType, DiscoveredFile[]> = {
  customers: [], products: [], sales_orders: [], sales_order_items: [],
  deliveries: [], delivery_items: [], billing_documents: [], billing_items: [],
  journal_entries: [],
};

for (const f of allFiles) {
  const entity = classifyFile(f);
  if (entity) {
    entityFiles[entity].push(f);
    console.log(`   📎 ${f.relpath}  →  ${entity}`);
  } else {
    console.log(`   ❓ ${f.relpath}  →  (unrecognized, skipping)`);
  }
}
console.log('');

function loadEntity(entity: EntityType): Row[] {
  const files = entityFiles[entity];
  if (files.length === 0) return [];
  const all: Row[] = [];
  for (const f of files) {
    const rows = readFile(f);
    console.log(`   📄 ${f.relpath}: ${rows.length} rows`);
    if (rows.length > 0) {
      const sample = rows[0];
      const keys = Object.keys(sample);
      console.log(`      Fields: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ` … (+${keys.length - 8} more)` : ''}`);
    }
    all.push(...rows);
  }
  return all;
}

// ─── Customers ────────────────────────────────────────────────────────────────

{
  console.log('👤 Customers');
  const rows = loadEntity('customers');
  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO customers (customer_id, customer_name, city, country, region, industry, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const id = col(r, 'CustomerID', 'Customer', 'SoldToParty', 'customerid', 'customerno', 'soldtoparty', 'customer', 'id');
        if (!id) continue;
        stmt.run(
          safe(id),
          safe(col(r, 'CustomerName', 'Name', 'CompanyName', 'customername', 'name', 'companyname')),
          safe(col(r, 'City', 'city')),
          safe(col(r, 'Country', 'CountryCode', 'country', 'countrycode')),
          safe(col(r, 'Region', 'SalesRegion', 'SalesDistrict', 'region', 'salesregion')),
          safe(col(r, 'Industry', 'IndustrySector', 'industry', 'industrysector')),
          safe(col(r, 'CreatedAt', 'CreatedDate', 'CreatedOn', 'createdat', 'createddate')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);
  } else {
    console.log('   ⚠️  No customer files found\n');
  }
}

// ─── Products ─────────────────────────────────────────────────────────────────

{
  console.log('📦 Products');
  const rows = loadEntity('products');
  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO products (product_id, product_name, product_group, base_unit, price, currency)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const id = col(r, 'Material', 'Product', 'MaterialID', 'ProductID', 'SKU', 'materialid', 'productid', 'material', 'sku');
        if (!id) continue;
        stmt.run(
          safe(id),
          safe(col(r, 'MaterialDescription', 'ProductName', 'Description', 'MaterialName', 'materialdescription', 'productname', 'description', 'name')),
          safe(col(r, 'MaterialGroup', 'ProductGroup', 'Category', 'materialgroup', 'productgroup', 'category')),
          safe(col(r, 'BaseUnit', 'UnitOfMeasure', 'Unit', 'UOM', 'baseunit', 'unit', 'uom')),
          safeNum(col(r, 'Price', 'UnitPrice', 'Rate', 'price', 'unitprice')),
          safe(col(r, 'Currency', 'currency')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);
  } else {
    console.log('   ⚠️  No product files found\n');
  }
}

// ─── Sales Orders ─────────────────────────────────────────────────────────────

{
  console.log('📋 Sales Orders');
  const rows = loadEntity('sales_orders');
  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO sales_orders
      (sales_order_id, customer_id, order_date, requested_delivery_date, net_value, currency,
       sales_org, distribution_channel, division, order_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const id = col(r,
          'SalesOrder', 'SalesOrderID', 'OrderNumber', 'PurchaseOrder',
          'salesorder', 'salesorderid', 'ordernumber', 'orderid', 'ponumber',
        );
        if (!id) continue;
        stmt.run(
          safe(id),
          safe(col(r, 'SoldToParty', 'CustomerID', 'Customer', 'soldtoparty', 'customerid', 'customerno')),
          safe(col(r, 'CreationDate', 'OrderDate', 'DocumentDate', 'creationdate', 'orderdate', 'documentdate')),
          safe(col(r, 'RequestedDeliveryDate', 'DeliveryDate', 'requesteddeliverydate', 'deliverydate')),
          safeNum(col(r, 'NetValue', 'OrderValue', 'TotalValue', 'Amount', 'netvalue', 'ordervalue', 'amount')),
          safe(col(r, 'DocumentCurrency', 'Currency', 'documentcurrency', 'currency')),
          safe(col(r, 'SalesOrganization', 'SalesOrg', 'salesorganization', 'salesorg')),
          safe(col(r, 'DistributionChannel', 'distributionchannel')),
          safe(col(r, 'Division', 'division')),
          safe(col(r, 'SalesDocumentType', 'OrderType', 'DocumentType', 'ordertype', 'documenttype')),
          safe(col(r, 'OverallStatus', 'Status', 'OrderStatus', 'overallstatus', 'status')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);
  } else {
    console.log('   ⚠️  No sales order files found\n');
  }
}

// ─── Sales Order Items ────────────────────────────────────────────────────────

{
  console.log('📝 Sales Order Items');
  const rows = loadEntity('sales_order_items');
  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO sales_order_items (sales_order_id, item_number, product_id, quantity, unit, net_value, currency, plant)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const soId = col(r, 'SalesOrder', 'SalesOrderID', 'OrderNumber', 'salesorder', 'salesorderid', 'ordernumber');
        if (!soId) continue;
        stmt.run(
          safe(soId),
          safe(col(r, 'SalesOrderItem', 'ItemNumber', 'LineItem', 'Position', 'salesorderitem', 'itemnumber', 'lineitem', 'position')),
          safe(col(r, 'Material', 'Product', 'MaterialID', 'ProductID', 'material', 'productid', 'sku')),
          safeNum(col(r, 'OrderQuantity', 'Quantity', 'Qty', 'orderquantity', 'quantity', 'qty')),
          safe(col(r, 'OrderQuantityUnit', 'Unit', 'UOM', 'unit', 'uom')),
          safeNum(col(r, 'NetValue', 'LineValue', 'Amount', 'netvalue', 'linevalue', 'amount')),
          safe(col(r, 'TransactionCurrency', 'Currency', 'currency')),
          safe(col(r, 'Plant', 'plant')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);
  } else {
    console.log('   ⚠️  No SO item files found\n');
  }
}

// ─── Deliveries ───────────────────────────────────────────────────────────────

{
  console.log('🚚 Deliveries');
  const rows = loadEntity('deliveries');
  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO deliveries
      (delivery_id, sales_order_id, customer_id, delivery_date, actual_delivery_date,
       plant, shipping_point, total_weight, weight_unit, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const id = col(r,
          'DeliveryDocument', 'Delivery', 'DeliveryID', 'OutboundDelivery', 'DeliveryNumber',
          'deliverydocument', 'delivery', 'deliveryid', 'outbounddelivery', 'deliverynumber',
        );
        if (!id) continue;
        stmt.run(
          safe(id),
          safe(col(r, 'SalesOrder', 'ReferenceSDDocument', 'ReferenceOrder', 'salesorder', 'salesorderid', 'referenceorder')),
          safe(col(r, 'SoldToParty', 'CustomerID', 'Customer', 'soldtoparty', 'customerid')),
          safe(col(r, 'PlannedGoodsIssueDate', 'DeliveryDate', 'ScheduledDate', 'plannedgoodsissuedate', 'deliverydate')),
          safe(col(r, 'ActualGoodsMovementDate', 'GoodsIssueDate', 'ActualDeliveryDate', 'ShipDate', 'actualgoodsmovementdate', 'goodsissuedate', 'actualdeliverydate')),
          safe(col(r, 'DeliveryDocumentBySupplyingPlant', 'Plant', 'SupplyingPlant', 'plant')),
          safe(col(r, 'ShippingPoint', 'shippingpoint')),
          safeNum(col(r, 'TotalGrossWeight', 'TotalWeight', 'Weight', 'totalgrossweight', 'totalweight', 'weight')),
          safe(col(r, 'WeightUnit', 'weightunit')),
          safe(col(r, 'OverallSDProcessStatus', 'DeliveryStatus', 'Status', 'overallsdprocessstatus', 'status')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);
  } else {
    console.log('   ⚠️  No delivery files found\n');
  }
}

// ─── Delivery Items ───────────────────────────────────────────────────────────

{
  console.log('📦 Delivery Items');
  const rows = loadEntity('delivery_items');
  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO delivery_items (delivery_id, item_number, product_id, quantity, unit, sales_order_id, sales_order_item)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const delId = col(r, 'DeliveryDocument', 'Delivery', 'deliverydocument', 'delivery', 'deliveryid');
        if (!delId) continue;

        // In the raw dataset, delivery_items references the originating sales order + sales order item,
        // but does not directly contain `material`. We'll resolve product_id after sales_order_items is loaded.
        const salesOrderIdRaw = col(r, 'referenceSdDocument', 'ReferenceSdDocument', 'ReferenceSDDocument', 'salesorder', 'salesorderid');
        const salesOrderItemRaw = col(r, 'referenceSdDocumentItem', 'ReferenceSdDocumentItem', 'ReferenceSDDocumentItem', 'salesorderitem', 'itemnumber');
        const salesOrderItemNorm = salesOrderItemRaw ? salesOrderItemRaw.replace(/^0+/, '') : null;

        stmt.run(
          safe(delId),
          safe(col(r, 'DeliveryDocumentItem', 'ItemNumber', 'deliverydocumentitem', 'itemnumber')),
          null,
          safeNum(col(r, 'ActualDeliveryQuantity', 'Quantity', 'actualdeliveryquantity', 'quantity')),
          safe(col(r, 'DeliveryQuantityUnit', 'Unit', 'unit')),
          safe(salesOrderIdRaw),
          safe(salesOrderItemNorm),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);

    // Resolve delivery_items.product_id by joining back to sales_order_items using:
    // delivery_items.sales_order_id + delivery_items.sales_order_item (normalized).
    db.exec(`
      UPDATE delivery_items
      SET product_id = (
        SELECT soi.product_id
        FROM sales_order_items soi
        WHERE soi.sales_order_id = delivery_items.sales_order_id
          AND soi.item_number = delivery_items.sales_order_item
        LIMIT 1
      )
      WHERE product_id IS NULL
        AND sales_order_id IS NOT NULL
        AND sales_order_item IS NOT NULL;
    `);

    // Populate deliveries.sales_order_id and deliveries.customer_id from delivery_items and sales_orders.
    db.exec(`
      UPDATE deliveries
      SET sales_order_id = (
        SELECT MIN(di.sales_order_id)
        FROM delivery_items di
        WHERE di.delivery_id = deliveries.delivery_id
          AND di.sales_order_id IS NOT NULL
      );
    `);

    db.exec(`
      UPDATE deliveries
      SET customer_id = (
        SELECT so.customer_id
        FROM sales_orders so
        WHERE so.sales_order_id = deliveries.sales_order_id
      )
      WHERE deliveries.sales_order_id IS NOT NULL;
    `);
  } else {
    console.log('   ℹ️  No delivery item files found (optional)\n');
  }
}

// ─── Billing Documents ────────────────────────────────────────────────────────

{
  console.log('🧾 Billing Documents');
  const rows = loadEntity('billing_documents');
  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO billing_documents
      (billing_id, sales_order_id, delivery_id, customer_id, billing_date,
       net_value, tax_amount, total_amount, currency, billing_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const id = col(r,
          'BillingDocument', 'BillingID', 'InvoiceID', 'Invoice', 'InvoiceNumber',
          'billingdocument', 'billingid', 'invoiceid', 'invoice', 'invoicenumber',
        );
        if (!id) continue;
        stmt.run(
          safe(id),
          safe(col(r, 'SalesOrder', 'ReferenceSDDocument', 'salesorder', 'salesorderid', 'referenceorder')),
          safe(col(r, 'ReferenceDocument', 'DeliveryDocument', 'Delivery', 'referencedocument', 'deliveryid', 'delivery')),
          safe(col(r, 'SoldToParty', 'CustomerID', 'Customer', 'soldtoparty', 'customerid')),
          safe(col(r, 'BillingDocumentDate', 'BillingDate', 'InvoiceDate', 'DocumentDate', 'billingdocumentdate', 'billingdate', 'invoicedate', 'documentdate')),
          safeNum(col(r, 'NetAmount', 'NetValue', 'netamount', 'netvalue')),
          safeNum(col(r, 'TaxAmount', 'Tax', 'taxamount', 'tax')),
          safeNum(col(r, 'TotalNetAmount', 'GrossAmount', 'TotalAmount', 'totalnetamount', 'grossamount', 'totalamount')),
          safe(col(r, 'TransactionCurrency', 'DocumentCurrency', 'Currency', 'transactioncurrency', 'documentcurrency', 'currency')),
          safe(col(r, 'BillingDocumentType', 'BillingType', 'DocumentType', 'billingdocumenttype', 'billingtype', 'documenttype')),
          safe(col(r, 'BillingDocumentProcessingStatus', 'Status', 'status')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);
  } else {
    console.log('   ⚠️  No billing document files found\n');
  }
}

// ─── Billing Items ────────────────────────────────────────────────────────────

{
  console.log('🧾 Billing Items');
  const rows = loadEntity('billing_items');
  if (rows.length > 0) {
    // We use `billing_document_items.referenceSdDocument` to link billing_documents back to deliveries and/or sales orders.
    // Those reference fields are not persisted in `billing_items`, so we cache them here for a post-insert update.
    const billingRefsByBill = new Map<string, Set<string>>();

    const stmt = db.prepare(`
      INSERT INTO billing_items (billing_id, item_number, product_id, quantity, unit, net_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const billId = col(r, 'BillingDocument', 'BillingID', 'billingdocument', 'billingid', 'invoiceid');
        if (!billId) continue;
        const billKey = safe(billId);
        if (!billKey) continue;

        const ref = col(
          r,
          'referenceSdDocument',
          'ReferenceSdDocument',
          'ReferenceSDDocument',
          'referencedocument',
          'referencedsdocument'
        );
        if (ref) {
          if (!billingRefsByBill.has(billKey)) billingRefsByBill.set(billKey, new Set());
          billingRefsByBill.get(billKey)!.add(ref);
        }

        stmt.run(
          billKey,
          safe(col(r, 'BillingDocumentItem', 'ItemNumber', 'billingdocumentitem', 'itemnumber')),
          safe(col(r, 'Material', 'Product', 'material', 'productid')),
          safeNum(col(r, 'BillingQuantity', 'Quantity', 'billingquantity', 'quantity')),
          safe(col(r, 'BillingQuantityUnit', 'Unit', 'billingquantityunit', 'unit')),
          safeNum(col(r, 'NetAmount', 'NetValue', 'netamount', 'netvalue')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);

    // Update billing_documents foreign keys (sales_order_id / delivery_id) using cached references.
    const deliveryIdSet = new Set(
      db.prepare(`SELECT delivery_id FROM deliveries`).all().map((r: { delivery_id: string }) => String(r.delivery_id))
    );
    const salesOrderIdSet = new Set(
      db.prepare(`SELECT sales_order_id FROM sales_orders`).all().map((r: { sales_order_id: string }) => String(r.sales_order_id))
    );

    const updateBilling = db.prepare(`
      UPDATE billing_documents
      SET sales_order_id = ?,
          delivery_id = ?
      WHERE billing_id = ?
    `);

    for (const [billId, refs] of billingRefsByBill.entries()) {
      let deliveryId: string | null = null;
      let salesOrderId: string | null = null;

      for (const ref of refs) {
        if (!deliveryId && deliveryIdSet.has(ref)) deliveryId = ref;
        if (!salesOrderId && salesOrderIdSet.has(ref)) salesOrderId = ref;
        if (deliveryId && salesOrderId) break;
      }

      updateBilling.run(salesOrderId, deliveryId, billId);
    }

    // If billing_documents got a delivery_id but not a sales_order_id, fill it from deliveries.
    db.exec(`
      UPDATE billing_documents
      SET sales_order_id = (
        SELECT d.sales_order_id
        FROM deliveries d
        WHERE d.delivery_id = billing_documents.delivery_id
      )
      WHERE sales_order_id IS NULL
        AND delivery_id IS NOT NULL;
    `);
  } else {
    console.log('   ℹ️  No billing item files found (optional)\n');
  }
}

// ─── Journal Entries ──────────────────────────────────────────────────────────

{
  console.log('📊 Journal Entries');
  const rows = loadEntity('journal_entries');
  if (rows.length > 0) {
    let counter = 0;
    const stmt = db.prepare(`
      INSERT INTO journal_entries
      (journal_id, billing_id, company_code, fiscal_year, accounting_document, gl_account,
       reference_document, cost_center, profit_center, transaction_currency,
       amount_transaction_currency, company_code_currency, amount_company_code_currency,
       posting_date, document_date, accounting_document_type, accounting_document_item)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        const jeId = col(r, 'AccountingDocument', 'JournalEntryID', 'JournalID', 'accountingdocument', 'journalentryid') || `je_${++counter}`;
        const billingRef = col(r,
          'ReferenceDocument', 'BillingDocument', 'BillingID', 'Reference',
          'referencedocument', 'billingdocument', 'billingid', 'reference',
        );
        stmt.run(
          safe(jeId),
          safe(billingRef),
          safe(col(r, 'CompanyCode', 'Company', 'companycode', 'company')),
          safe(col(r, 'FiscalYear', 'Year', 'fiscalyear', 'year')),
          safe(col(r, 'AccountingDocument', 'AccountingDocumentNumber', 'accountingdocument', 'accountingdocumentnumber')),
          safe(col(r, 'GLAccount', 'AccountNumber', 'Account', 'glaccount', 'glaccountnumber', 'account')),
          safe(billingRef),
          safe(col(r, 'CostCenter', 'costcenter')),
          safe(col(r, 'ProfitCenter', 'profitcenter')),
          safe(col(r, 'TransactionCurrency', 'Currency', 'transactioncurrency', 'currency')),
          safeNum(col(r, 'AmountInTransactionCurrency', 'Amount', 'amountintransactioncurrency', 'amount')),
          safe(col(r, 'CompanyCodeCurrency', 'LocalCurrency', 'companycodecurrency', 'localcurrency')),
          safeNum(col(r, 'AmountInCompanyCodeCurrency', 'LocalAmount', 'amountincompanycodecurrency', 'localamount')),
          safe(col(r, 'PostingDate', 'postingdate')),
          safe(col(r, 'DocumentDate', 'documentdate')),
          safe(col(r, 'AccountingDocumentType', 'DocumentType', 'accountingdocumenttype', 'documenttype')),
          safe(col(r, 'AccountingDocumentItem', 'LineItem', 'accountingdocumentitem', 'lineitem')),
        );
      }
    });
    insertMany(rows);
    console.log(`   ✅ ${rows.length} rows processed\n`);
  } else {
    console.log('   ⚠️  No journal entry files found\n');
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('─'.repeat(50));
console.log('📈 Final row counts:');
const tables = [
  'customers', 'products', 'sales_orders', 'sales_order_items',
  'deliveries', 'delivery_items', 'billing_documents', 'billing_items', 'journal_entries',
];
for (const t of tables) {
  try {
    const count = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
    const bar = '█'.repeat(Math.min(Math.ceil(count / 50), 30));
    console.log(`   ${t.padEnd(25)} ${String(count).padStart(6)}  ${bar}`);
  } catch (e) {
    console.log(`   ${t}: error — ${e}`);
  }
}

// Re-enable FK enforcement now that all data is loaded
db.pragma('foreign_keys = ON');

// Quick sanity check — warn about orphaned rows but don't fail
console.log('\n🔍 Referential integrity check:');
const checks = [
  { label: 'SO items → sales_orders',      sql: "SELECT COUNT(*) as c FROM sales_order_items WHERE sales_order_id NOT IN (SELECT sales_order_id FROM sales_orders)" },
  { label: 'deliveries → sales_orders',    sql: "SELECT COUNT(*) as c FROM deliveries WHERE sales_order_id IS NOT NULL AND sales_order_id NOT IN (SELECT sales_order_id FROM sales_orders)" },
  { label: 'billing → sales_orders',       sql: "SELECT COUNT(*) as c FROM billing_documents WHERE sales_order_id IS NOT NULL AND sales_order_id NOT IN (SELECT sales_order_id FROM sales_orders)" },
  { label: 'journal → billing_documents',  sql: "SELECT COUNT(*) as c FROM journal_entries WHERE billing_id IS NOT NULL AND billing_id NOT IN (SELECT billing_id FROM billing_documents)" },
];
for (const { label, sql } of checks) {
  try {
    const orphans = (db.prepare(sql).get() as { c: number }).c;
    console.log('   ' + label.padEnd(35) + ' ' + (orphans === 0 ? '✅ OK' : '⚠️  ' + orphans + ' orphans (data gap, not an error)'));
  } catch { /* skip */ }
}

db.close();
console.log('\n🎉 Seed complete!');
