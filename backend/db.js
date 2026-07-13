const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Ensure data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Helper functions for Promises
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Initialize Database Tables
const initDatabase = async () => {
  try {
    // 1. Users Table
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff'
      )
    `);

    // 2. Switches Table
    await run(`
      CREATE TABLE IF NOT EXISTS switches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ip TEXT NOT NULL,
        status TEXT DEFAULT 'online',
        latency INTEGER DEFAULT 0,
        lastDown TEXT,
        lastUp TEXT
      )
    `);

    // 3. Network SLA Alerts Table
    await run(`
      CREATE TABLE IF NOT EXISTS network_sla (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        deviceName TEXT NOT NULL,
        deviceIp TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        formattedTime TEXT NOT NULL,
        lastDown TEXT,
        duration TEXT,
        message TEXT NOT NULL
      )
    `);

    // 4. Operations Audit Logs Table
    await run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        username TEXT NOT NULL,
        ip_address TEXT,
        action TEXT NOT NULL,
        target TEXT,
        status TEXT NOT NULL,
        message TEXT
      )
    `);

    // Seed default users if users table is empty
    const userCount = await get('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
      console.log('Seeding default admin and staff users...');
      
      const adminSalt = bcrypt.genSaltSync(12);
      const adminHash = bcrypt.hashSync('admin123', adminSalt);
      await run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', adminHash, 'admin']);

      const staffSalt = bcrypt.genSaltSync(12);
      const staffHash = bcrypt.hashSync('staff123', staffSalt);
      await run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['staff', staffHash, 'staff']);
      
      console.log('Default users seeded successfully:');
      console.log(' - Admin: admin / admin123');
      console.log(' - Staff: staff / staff123');
    } else {
      // Auto-heal plain text passwords from legacy sessions if any exist
      const users = await query('SELECT * FROM users');
      for (let u of users) {
        if (u.password && !u.password.startsWith('$2a$') && !u.password.startsWith('$2b$')) {
          console.log(`Auto-healing/Hashing plain text password for user: ${u.username}`);
          const salt = bcrypt.genSaltSync(12);
          const hash = bcrypt.hashSync(u.password, salt);
          await run('UPDATE users SET password = ? WHERE id = ?', [hash, u.id]);
        }
      }
    }

    // Seed default switches if switches table is empty (migrating from initial seed)
    const switchCount = await get('SELECT COUNT(*) as count FROM switches');
    if (switchCount.count === 0) {
      await run('INSERT INTO switches (id, name, ip, status, latency) VALUES (?, ?, ?, ?, ?)', ['sw-1', 'Core Switch 01', '192.168.200.2', 'online', 1]);
      await run('INSERT INTO switches (id, name, ip, status, latency) VALUES (?, ?, ?, ?, ?)', ['sw-2', 'Access Switch 01', '192.168.200.3', 'online', 2]);
      console.log('Default switches seeded successfully.');
    }

  } catch (error) {
    console.error('Failed to initialize database tables:', error);
  }
};

initDatabase();

module.exports = {
  db,
  query,
  run,
  get
};
