// database.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function setupDatabase() {
  try {
    const db = await open({
      filename: './sessions.db',
      driver: sqlite3.Database
    });

    console.log('🔗 Connesso al database SQLite.');

    // --- MODIFICATO: Aggiunta la colonna 'url' ---
    // La colonna 'url' può essere NULL all'inizio, finché non viene condiviso.
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sessionId TEXT PRIMARY KEY,
        url TEXT,
        isActive BOOL DEFAULT TRUE, 
        creatorIp INTEGER DEFAULT NULL,
        participantCount INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Tabella "sessions" pronta con campo URL.');

    return db;
  } catch (err) {
    console.error('❌ Errore durante la configurazione del database:', err.message);
    process.exit(1);
  }
}