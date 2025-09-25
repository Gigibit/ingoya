import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/**
 * Inizializza la connessione al database e crea le tabelle se non esistono.
 */
export async function setupDatabase() {
  try {
    const db = await open({
      filename: './database.db',
      driver: sqlite3.Database
    });
    console.log('🔗 Connesso al database SQLite.');
    await db.exec(`CREATE TABLE IF NOT EXISTS sessions ( sessionId TEXT PRIMARY KEY, streamId TEXT, whipUrl TEXT, whepUrl TEXT, isActive BOOL DEFAULT TRUE, creatorIp TEXT, participantCount INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS users ( id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, email TEXT UNIQUE, hashedPassword TEXT, currentChallenge TEXT, lastIpAddress TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS authenticators ( id TEXT PRIMARY KEY, userId INTEGER NOT NULL, credentialPublicKey TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT, FOREIGN KEY (userId) REFERENCES users(id) )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS requests ( ip TEXT PRIMARY KEY, count INTEGER DEFAULT 1, lastRequestAt DATETIME DEFAULT CURRENT_TIMESTAMP )`);
    console.log('✅ Tabelle del database pronte.');
    return db;
  } catch (err) {
    console.error('❌ Errore durante la configurazione del database:', err.message);
    process.exit(1);
  }
}

/**
 * Recupera o crea la sessione Theia personale di un utente.
 */
export async function getOrCreateTheiaSession(db, theiaSessionId) {
    await db.run('INSERT OR IGNORE INTO sessions (sessionId, isActive, participantCount) VALUES (?, 1, 1)', theiaSessionId);
    await db.run('UPDATE sessions SET isActive = 1 WHERE sessionId = ?', theiaSessionId);
    return db.get(`SELECT sessionId, whepUrl FROM sessions WHERE sessionId = ?`, theiaSessionId);
}

/**
 * Crea una nuova sessione nel DB o la riattiva.
 */
export async function createSession(db, sessionId) {
  try {
    await db.run('INSERT OR IGNORE INTO sessions (sessionId, participantCount, isActive) VALUES (?, 0, 1)', sessionId);
    await db.run('UPDATE sessions SET isActive = 1 WHERE sessionId = ?', sessionId);
  } catch (err) {
    console.error("Errore DB [createSession]:", err.message);
  }
}

/**
 * Recupera una sessione esistente che ha già un whipUrl.
 */
export async function getSessionForWhip(db, sessionId) {
    return db.get('SELECT streamId, whipUrl FROM sessions WHERE sessionId = ? AND whipUrl IS NOT NULL', sessionId);
}

/**
 * Recupera una sessione esistente che ha già un whepUrl.
 */
export async function getSessionForWhep(db, sessionId) {
    return db.get('SELECT streamId, whepUrl FROM sessions WHERE sessionId = ? AND whepUrl IS NOT NULL', sessionId);
}

/**
 * Salva i dettagli WHIP per una sessione.
 */
export async function saveWhipDetails(db, sessionId, streamId, whipUrl) {
  try {
    await db.run('UPDATE sessions SET streamId = ?, whipUrl = ? WHERE sessionId = ?', [streamId, whipUrl, sessionId]);
  } catch (err) {
    console.error("Errore DB [saveWhipDetails]:", err.message);
  }
}

/**
 * Salva l'URL WHEP per una sessione.
 */
export async function saveWhepUrlDetails(db, sessionId, whepUrl) {
    try {
        await db.run('UPDATE sessions SET whepUrl = ? WHERE sessionId = ?', [whepUrl, sessionId]);
    } catch (err) {
        console.error("Errore DB [saveWhepUrlDetails]:", err.message);
    }
}

/**
 * Trova o crea una richiesta per IP, incrementando il contatore.
 */
export async function findOrCreateRequest(db, ip) {
  const upsertQuery = `INSERT INTO requests (ip, count, lastRequestAt) VALUES (?, 1, CURRENT_TIMESTAMP) ON CONFLICT(ip) DO UPDATE SET count = count + 1, lastRequestAt = CURRENT_TIMESTAMP;`;
  try {
    await db.run(upsertQuery, ip);
    return await db.get('SELECT ip, count FROM requests WHERE ip = ?', ip);
  } catch (err) {
    console.error("❌ Errore in findOrCreateRequest:", err.message);
    throw err;
  }
}

/**
 * Aggiorna il conteggio dei partecipanti e lo stato di attività di una sessione.
 */
export async function updateDbParticipantCount(db, sessionId, count) {
    try {
        if (sessionId.endsWith('_THEIA')) return;
        // La logica di disattivazione ora è più semplice e gestita dalla disconnessione
        const isActive = count > 0;
        await db.run('UPDATE sessions SET participantCount = ?, isActive = ? WHERE sessionId = ?', [count, isActive, sessionId]);
        if (!isActive) {
            // Disattiva anche la Theia associata se l'utente si disconnette
            await db.run('UPDATE sessions SET isActive = 0 WHERE sessionId = ?', `${sessionId}_THEIA`);
        }

    } catch (err) {
        console.error("Errore DB [updateDbParticipantCount]:", err.message);
    }
}

/**
 * Recupera uno stream di un utente umano casuale e attivo, escludendo una sessione.
 */
export async function getRandomActiveStream(db, excludeSessionId) {
    return db.get(`SELECT sessionId, whepUrl FROM sessions WHERE whepUrl IS NOT NULL AND isActive = 1 AND sessionId != ? AND sessionId NOT LIKE '%\\_THEIA' ORDER BY RANDOM() LIMIT 1`, excludeSessionId);
}

export async function getStreamIdBySessionId(db, sessionId) {
  try {
    const result = await db.get('SELECT streamId FROM sessions WHERE sessionId = ?', sessionId);
    return result ? result.streamId : null;
  } catch (err) {
    console.error("Errore DB [getStreamIdBySessionId]:", err.message);
    throw err;
  }
}

/**
 * Chiude tutte le sessioni settando isActive = 0.
 */
export async function closeEverySession(db) {
  try {
    await db.run('UPDATE sessions SET isActive = 0');
    console.log('🛑 Tutte le sessioni sono state chiuse (isActive = 0).');
  } catch (err) {
    console.error("Errore DB [closeEverySession]:", err.message);
    throw err;
  }
}


/**
 * Elimina tutte le sessioni dal database.
 */
export async function clearSessions(db) {
  try {
    await db.run('DELETE FROM sessions');
    console.log('🧹 Tutte le sessioni sono state eliminate dal database.');
  } catch (err) {
    console.error("Errore DB [clearSessions]:", err.message);
    throw err;
  }
}