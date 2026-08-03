const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

function getDefaultData() {
  return {
    accounts: [
      {
        id: 'A1',
        username: 'admin',
        password: hashPassword('admin123'),
        name: '行政专员',
        wecom: '',
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'A2',
        username: 'hr',
        password: hashPassword('hraaa'),
        name: '人事专员',
        wecom: '',
        role: 'hr',
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'A3',
        username: 'manager',
        password: hashPassword('HRDaaa'),
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

let data = null;

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    data = getDefaultData();
    saveData();
  } else {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
  return data;
}

function saveData() {
  if (!data) return;
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getData() {
  if (!data) loadData();
  return data;
}

module.exports = { getData, saveData, hashPassword, verifyPassword, loadData };
