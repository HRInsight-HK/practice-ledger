const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');

// 数据库配置：优先 PostgreSQL(Supabase)，其次 MongoDB，最后文件存储
const DATABASE_URL = process.env.DATABASE_URL;   // PostgreSQL (Supabase)
const MONGODB_URI = process.env.MONGODB_URI;     // MongoDB Atlas (备用)

// 修复本地网络DNS不支持SRV解析的问题（仅影响MongoDB连接）
try {
  const origServers = dns.getServers();
  dns.setServers([...new Set([...origServers, '8.8.8.8', '1.1.1.1'])]);
} catch (e) {}

// ==================== Password Utils ====================
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pwd, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return hash === verify;
}

// ==================== Default Data ====================
function getDefaultData() {
  return {
    accounts: [
      {
        id: 'A1',
        username: 'admin',
        password: hashPassword('Zz741852'),
        name: '行政专员',
        wecom: '',
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'A2',
        username: 'hr',
        password: hashPassword('Zoe20260708'),
        name: '人事专员',
        wecom: '',
        role: 'hr',
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'A3',
        username: 'manager',
        password: hashPassword('4302055540j'),
        name: '管理层',
        wecom: '',
        role: 'manager',
        active: true,
        createdAt: new Date().toISOString()
      }
    ],
    records: [],
    questionnaires: [],
    loginLogs: []
  };
}

// ==================== Storage Backend ====================
let data = null;

// PostgreSQL
let pgPool = null;
let usePostgres = false;

// MongoDB (legacy)
const DB_NAME = 'practice_ledger';
const COLL_NAME = 'appdata';
let mongoClient = null;
let useMongo = false;
let mongoHealthy = false;

// 文件存储（仅在未配置数据库时使用）
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!DATABASE_URL && !MONGODB_URI && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== PostgreSQL (Supabase) ====================
async function connectPostgres() {
  if (pgPool) return pgPool;
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('supabase.co') || DATABASE_URL.includes('render.com')
      ? { rejectUnauthorized: false }
      : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // 首次连接时创建表
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS appdata (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[DB] PostgreSQL: 表已就绪');
  } finally {
    client.release();
  }
  return pgPool;
}

// ==================== MongoDB (legacy) ====================
async function connectMongo() {
  if (mongoClient && mongoHealthy) return mongoClient;
  const { MongoClient } = require('mongodb');
  mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  mongoHealthy = true;
  return mongoClient;
}

// ==================== loadData ====================
async function loadData() {
  // 优先使用 PostgreSQL
  if (DATABASE_URL) {
    try {
      await connectPostgres();
      const result = await pgPool.query('SELECT data FROM appdata WHERE id = $1', ['main']);
      if (result.rows.length === 0) {
        console.warn('[DB] PostgreSQL: 数据不存在，初始化种子数据');
        data = getDefaultData();
        await pgPool.query(
          'INSERT INTO appdata (id, data) VALUES ($1, $2)',
          ['main', JSON.stringify(data)]
        );
        console.log('[DB] PostgreSQL: 初始化种子数据 records=0');
      } else {
        let rowData = result.rows[0].data;
        if (typeof rowData === 'string') {
          data = JSON.parse(rowData);
        } else {
          data = rowData;
        }
        console.log('[DB] PostgreSQL: 加载成功 records=' + (data.records ? data.records.length : 0));
      }
      usePostgres = true;
      return data;
    } catch (e) {
      console.error('[DB] PostgreSQL连接失败:', e.message);
      throw new Error('数据库连接失败，请稍后重试');
    }
  }

  // 备用：MongoDB
  if (MONGODB_URI) {
    try {
      await connectMongo();
      const db = mongoClient.db(DB_NAME);
      const coll = db.collection(COLL_NAME);
      const doc = await coll.findOne({ _id: 'main' });
      if (!doc) {
        console.warn('[DB] MongoDB: 文档不存在，初始化为种子数据');
        data = getDefaultData();
        await coll.insertOne({ _id: 'main', data });
        console.log('[DB] MongoDB: 初始化种子数据 records=0');
      } else {
        data = doc.data;
        console.log('[DB] MongoDB: 加载成功 records=' + (data.records ? data.records.length : 0));
      }
      useMongo = true;
      return data;
    } catch (e) {
      console.error('[DB] MongoDB连接失败:', e.message);
      mongoHealthy = false;
      throw new Error('数据库连接失败，请稍后重试');
    }
  }

  // 最后备用：文件存储
  if (!fs.existsSync(DB_FILE)) {
    data = getDefaultData();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } else {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
  console.log('[DB] 文件存储: 加载成功 records=' + (data.records ? data.records.length : 0));
  return data;
}

// ==================== saveData ====================
async function saveData() {
  if (!data) return;

  // PostgreSQL
  if (usePostgres && DATABASE_URL) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pgPool.query(
          'UPDATE appdata SET data = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(data), 'main']
        );
        return;
      } catch (e) {
        console.error(`[DB] PostgreSQL保存失败(第${attempt}次):`, e.message);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        } else {
          throw new Error('数据保存失败，请稍后重试');
        }
      }
    }
  }

  // MongoDB
  if (useMongo && MONGODB_URI) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!mongoHealthy) await connectMongo();
        const db = mongoClient.db(DB_NAME);
        const coll = db.collection(COLL_NAME);
        await coll.updateOne({ _id: 'main' }, { $set: { data } });
        return;
      } catch (e) {
        console.error(`[DB] MongoDB保存失败(第${attempt}次):`, e.message);
        mongoHealthy = false;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        } else {
          throw new Error('数据保存失败，请稍后重试');
        }
      }
    }
  }

  // 文件存储
  if (!DATABASE_URL && !MONGODB_URI) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return;
  }

  throw new Error('数据库不可用，请稍后重试');
}

function getData() {
  if (!data) {
    throw new Error('数据库尚未加载完成');
  }
  return data;
}

async function closeDb() {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    mongoHealthy = false;
  }
}

module.exports = { getData, saveData, hashPassword, verifyPassword, loadData, closeDb };
