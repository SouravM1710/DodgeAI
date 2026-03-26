import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'otc.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_id TEXT PRIMARY KEY,
      customer_name TEXT,
      city TEXT,
      country TEXT,
      region TEXT,
      industry TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id TEXT PRIMARY KEY,
      product_name TEXT,
      product_group TEXT,
      base_unit TEXT,
      price REAL,
      currency TEXT
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      sales_order_id TEXT PRIMARY KEY,
      customer_id TEXT,
      order_date TEXT,
      requested_delivery_date TEXT,
      net_value REAL,
      currency TEXT,
      sales_org TEXT,
      distribution_channel TEXT,
      division TEXT,
      order_type TEXT,
      status TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    );

    CREATE TABLE IF NOT EXISTS sales_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_order_id TEXT,
      item_number TEXT,
      product_id TEXT,
      quantity REAL,
      unit TEXT,
      net_value REAL,
      currency TEXT,
      plant TEXT,
      FOREIGN KEY (sales_order_id) REFERENCES sales_orders(sales_order_id),
      FOREIGN KEY (product_id) REFERENCES products(product_id)
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      delivery_id TEXT PRIMARY KEY,
      sales_order_id TEXT,
      customer_id TEXT,
      delivery_date TEXT,
      actual_delivery_date TEXT,
      plant TEXT,
      shipping_point TEXT,
      total_weight REAL,
      weight_unit TEXT,
      status TEXT,
      FOREIGN KEY (sales_order_id) REFERENCES sales_orders(sales_order_id),
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    );

    CREATE TABLE IF NOT EXISTS delivery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id TEXT,
      item_number TEXT,
      product_id TEXT,
      quantity REAL,
      unit TEXT,
      sales_order_id TEXT,
      sales_order_item TEXT,
      FOREIGN KEY (delivery_id) REFERENCES deliveries(delivery_id)
    );

    CREATE TABLE IF NOT EXISTS billing_documents (
      billing_id TEXT PRIMARY KEY,
      sales_order_id TEXT,
      delivery_id TEXT,
      customer_id TEXT,
      billing_date TEXT,
      net_value REAL,
      tax_amount REAL,
      total_amount REAL,
      currency TEXT,
      billing_type TEXT,
      status TEXT,
      FOREIGN KEY (sales_order_id) REFERENCES sales_orders(sales_order_id),
      FOREIGN KEY (delivery_id) REFERENCES deliveries(delivery_id),
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    );

    CREATE TABLE IF NOT EXISTS billing_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      billing_id TEXT,
      item_number TEXT,
      product_id TEXT,
      quantity REAL,
      unit TEXT,
      net_value REAL,
      FOREIGN KEY (billing_id) REFERENCES billing_documents(billing_id)
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      journal_id TEXT PRIMARY KEY,
      billing_id TEXT,
      company_code TEXT,
      fiscal_year TEXT,
      accounting_document TEXT,
      gl_account TEXT,
      reference_document TEXT,
      cost_center TEXT,
      profit_center TEXT,
      transaction_currency TEXT,
      amount_transaction_currency REAL,
      company_code_currency TEXT,
      amount_company_code_currency REAL,
      posting_date TEXT,
      document_date TEXT,
      accounting_document_type TEXT,
      accounting_document_item TEXT,
      FOREIGN KEY (billing_id) REFERENCES billing_documents(billing_id)
    );


    CREATE INDEX IF NOT EXISTS idx_so_customer ON sales_orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_del_so ON deliveries(sales_order_id);
    CREATE INDEX IF NOT EXISTS idx_bill_so ON billing_documents(sales_order_id);
    CREATE INDEX IF NOT EXISTS idx_bill_del ON billing_documents(delivery_id);
    CREATE INDEX IF NOT EXISTS idx_je_bill ON journal_entries(billing_id);
    CREATE INDEX IF NOT EXISTS idx_je_ref ON journal_entries(reference_document);
  `);
}

export const SCHEMA_DESCRIPTION = `
Database schema for Order-to-Cash system:

TABLE customers:
  customer_id (PK), customer_name, city, country, region, industry, created_at

TABLE products:
  product_id (PK), product_name, product_group, base_unit, price, currency

TABLE sales_orders:
  sales_order_id (PK), customer_id (FK→customers), order_date, requested_delivery_date,
  net_value, currency, sales_org, distribution_channel, division, order_type, status

TABLE sales_order_items:
  id, sales_order_id (FK→sales_orders), item_number, product_id (FK→products),
  quantity, unit, net_value, currency, plant

TABLE deliveries:
  delivery_id (PK), sales_order_id (FK→sales_orders), customer_id (FK→customers),
  delivery_date, actual_delivery_date, plant, shipping_point, total_weight, weight_unit, status

TABLE delivery_items:
  id, delivery_id (FK→deliveries), item_number, product_id, quantity, unit,
  sales_order_id, sales_order_item

TABLE billing_documents:
  billing_id (PK), sales_order_id (FK→sales_orders), delivery_id (FK→deliveries),
  customer_id (FK→customers), billing_date, net_value, tax_amount, total_amount,
  currency, billing_type, status

TABLE billing_items:
  id, billing_id (FK→billing_documents), item_number, product_id, quantity, unit, net_value

TABLE journal_entries:
  journal_id (PK), billing_id (FK→billing_documents), company_code, fiscal_year,
  accounting_document, gl_account, reference_document, cost_center, profit_center,
  transaction_currency, amount_transaction_currency, company_code_currency,
  amount_company_code_currency, posting_date, document_date,
  accounting_document_type, accounting_document_item

KEY RELATIONSHIPS:
- customers → sales_orders (1:many via customer_id)
- sales_orders → sales_order_items (1:many via sales_order_id)
- sales_orders → deliveries (1:many via sales_order_id)
- deliveries → billing_documents (1:many via delivery_id)
- sales_orders → billing_documents (1:many via sales_order_id)
- billing_documents → journal_entries (1:many via billing_id OR reference_document=billing_id)
- products appear in sales_order_items, delivery_items, billing_items

BUSINESS FLOW: Customer → Sales Order → Delivery → Billing Document → Journal Entry
`;
