import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/**
 * Inizializza la connessione al database e crea la tabella se non esiste.
 * @returns {Promise<Database>} L'istanza del database.
 */
export async function setupDatabase() {
  try {
    const db = await open({
      filename: './sessions.db',
      driver: sqlite3.Database
    });
    console.log('🔗 Connesso al database SQLite.');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sessionId TEXT PRIMARY KEY,
        streamId TEXT,
        whipUrl TEXT,
        whepUrl TEXT,
        isActive BOOL DEFAULT TRUE, 
        creatorIp TEXT,
        participantCount INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabella "sessions" pronta.');
    return db;
  } catch (err) {
    console.error('❌ Errore durante la configurazione del database:', err.message);
    process.exit(1);
  }
}

// --- NUOVE FUNZIONI ESPORTATE PER LA GESTIONE DELLE SESSIONI ---

/**
 * Crea una nuova sessione nel DB se non esiste.
 * @param {Database} db - L'istanza del database.
 * @param {string} sessionId - L'ID della sessione.
 */
export async function createSession(db, sessionId) {
  try {
    await db.run(
      'INSERT OR IGNORE INTO sessions (sessionId, participantCount) VALUES (?, 0)',
      sessionId
    );
    console.log(`💾 Sessione ${sessionId} creata/verificata nel DB.`);
  } catch (err) {
    console.error("Errore DB [createSession]:", err.message);
  }
}

/**
 * Recupera una sessione esistente che ha già un whipUrl.
 * @param {Database} db - L'istanza del database.
 * @param {string} sessionId - L'ID della sessione.
 * @returns {Promise<object|null>} La sessione trovata o null.
 */
export async function getSessionForWhip(db, sessionId) {
    return db.get(
        'SELECT streamId, whipUrl FROM sessions WHERE sessionId = ? AND whipUrl IS NOT NULL',
        sessionId
    );
}

/**
 * Salva i dettagli WHIP (streamId, whipUrl) per una sessione.
 * @param {Database} db - L'istanza del database.
 * @param {string} sessionId - L'ID della sessione.
 * @param {string} streamId - L'ID dello stream di Livepeer.
 * @param {string} whipUrl - L'URL WHIP.
 */
export async function saveWhipDetails(db, sessionId, streamId, whipUrl) {
  try {
    await db.run(
      'UPDATE sessions SET streamId = ?, whipUrl = ? WHERE sessionId = ?',
      [streamId, whipUrl, sessionId]
    );
    console.log(`🔗 Dati WHIP salvati per la sessione ${sessionId}.`);
  } catch (err) {
    console.error("Errore DB [saveWhipDetails]:", err.message);
  }
}

/**
 * Salva l'URL WHEP per una sessione.
 * @param {Database} db - L'istanza del database.
 * @param {string} sessionId - L'ID della sessione.
 * @param {string} whepUrl - L'URL WHEP.
 */
export async function saveWhepUrlDetails(db, sessionId, whepUrl) {
    try {
        await db.run(
            'UPDATE sessions SET whepUrl = ? WHERE sessionId = ?',
            [whepUrl, sessionId]
        );
        console.log(`🔗 URL WHEP salvato per la sessione ${sessionId}.`);
    } catch (err) {
        console.error("Errore DB [saveWhepUrlDetails]:", err.message);
    }
}

/**
 * Aggiorna il conteggio dei partecipanti e lo stato di attività di una sessione.
 * @param {Database} db - L'istanza del database.
 * @param {string} sessionId - L'ID della sessione.
 * @param {number} count - Il nuovo numero di partecipanti.
 */
export async function updateDbParticipantCount(db, sessionId, count) {
    try {
        if (count > 0) {
            await db.run('UPDATE sessions SET participantCount = ?, isActive = 1 WHERE sessionId = ?', [count, sessionId]);
        } else {
            await db.run('UPDATE sessions SET participantCount = 0, isActive = 0 WHERE sessionId = ?', [sessionId]);
        }
    } catch (err) {
        console.error("Errore DB [updateDbParticipantCount]:", err.message);
    }
}

/**
 * Recupera uno stream casuale e attivo, escludendo una sessione specifica.
 * @param {Database} db - L'istanza del database.
 * @param {string} excludeSessionId - L'ID della sessione da escludere.
 * @returns {Promise<object|null>} La sessione trovata o null.
 */
export async function getRandomActiveStream(db, excludeSessionId) {
    return db.get(
        `SELECT sessionId, whepUrl FROM sessions WHERE whepUrl IS NOT NULL AND isActive = 1 AND sessionId != ? ORDER BY RANDOM() LIMIT 1`,
        excludeSessionId
    );  
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
