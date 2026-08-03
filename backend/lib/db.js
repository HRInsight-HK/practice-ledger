const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'practice_ledger';
const COLL_NAME = 'appdata';

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
let mongoClient = null;
let useMongo = false;

// File-based fallback
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function loadData() {
  if (MONGODB_URI) {
    try {
      const { MongoClient } = require('mongodb');
      mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      await mongoClient.connect();
      const db = mongoClient.db(DB_NAME);
      const coll = db.collection(COLL_NAME);
      const doc = await coll.findOne({ _id: 'main' });
      if (!doc) {
        data = getDefaultData();
        await coll.insertOne({ _id: 'main', data });
        console.log('[DB] MongoDB: 初始化种子数据');
      } else {
        data = doc.data;
        console.log('[DB] MongoDB: 加载成功, records=' + (data.records ? data.records.length : 0));
      }
      useMongo = true;
      return data;
    } catch (e) {
      console.error('[DB] MongoDB连接失败，降级为文件存储:', e.message);
      mongoClient = null;
    }
  }

  // File-based fallback
  if (!fs.existsSync(DB_FILE)) {
    data = getDefaultData();
    saveFileSync();
  } else {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
  console.log('[DB] 文件存储: 加载成功, records=' + (data.records ? data.records.length : 0));
  return data;
}

async function saveData() {
  if (!data) return;
  if (useMongo && mongoClient) {
    try {
      const db = mongoClient.db(DB_NAME);
      const coll = db.collection(COLL_NAME);
      await coll.updateOne({ _id: 'main' }, { $set: { data } });
      return;
    } catch (e) {
      console.error('[DB] MongoDB保存失败，降级为文件存储:', e.message);
    }
  }
  saveFileSync();
}

function saveFileSync() {
  if (!data) return;
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getData() {
  if (!data) {
    // 同步fallback：如果MongoDB还没加载完，用文件或种子数据
    if (fs.existsSync(DB_FILE)) {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      data = getDefaultData();
      saveFileSync();
    }
  }
  return data;
}

async function closeDb() {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
  }
}

module.exports = { getData, saveData, hashPassword, verifyPassword, loadData, closeDb };
