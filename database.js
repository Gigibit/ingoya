import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/**
 * Inizializza la connessione al database e crea la tabella se non esiste.
 * @returns {Promise<Database>} L'istanza del database.
 */
export async function setupDatabase() {
  try {
    const db = await open({
      filename: './database.db', // Un unico file di database per l'app
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

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            hashedPassword TEXT,
            currentChallenge TEXT,
            lastIpAddress TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS authenticators (
            id TEXT PRIMARY KEY,
            userId INTEGER NOT NULL,
            credentialPublicKey TEXT NOT NULL,
            counter INTEGER NOT NULL,
            transports TEXT,
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        ip TEXT PRIMARY KEY,
        count INTEGER DEFAULT 1,
        lastRequestAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabelle del database pronte.');
    return db;
  } catch (err) {
    console.error('❌ Errore durante la configurazione del database:', err.message);
    process.exit(1);
  }
}

/**
 * Recupera la sessione Theia personale di un utente.
 * @param {Database} db - L'istanza del database.
 * @param {string} theiaSessionId - L'ID completo della sessione Theia da cercare (es. "ABCDEF_THEIA").
 */
export async function getOrCreateTheiaSession(db, theiaSessionId) {
    // Assicura che la sessione esista e sia attiva, creandola se necessario.
    await db.run(
        'INSERT OR IGNORE INTO sessions (sessionId, isActive, participantCount) VALUES (?, 1, 1)',
        theiaSessionId
    );
    await db.run(
        'UPDATE sessions SET isActive = 1 WHERE sessionId = ?',
        theiaSessionId
    );

    // Ora recupera e restituisce i dati della sessione.
    return db.get(
        `SELECT sessionId, whepUrl FROM sessions WHERE sessionId = ?`,
        theiaSessionId
    );
}

/**
 * Crea una nuova sessione nel DB se non esiste, o la riattiva se era inattiva.
 * @param {Database} db - L'istanza del database.
 * @param {string} sessionId - L'ID della sessione.
 */
export async function createSession(db, sessionId) {
  try {
    // 1. Inserisce la sessione se non esiste, con isActive=1 di default.
    await db.run(
      'INSERT OR IGNORE INTO sessions (sessionId, participantCount, isActive) VALUES (?, 0, 1)',
      sessionId
    );

    // 2. Forza lo stato ad "attivo" per riattivare una sessione che era inattiva.
    await db.run(
      'UPDATE sessions SET isActive = 1 WHERE sessionId = ?',
      sessionId
    );
    console.log(`💾 Sessione ${sessionId} creata o riattivata nel DB.`);
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
 * Recupera una sessione esistente che ha già un whepUrl.
 * @param {Database} db - L'istanza del database.
 * @param {string} sessionId - L'ID della sessione.
 * @returns {Promise<object|null>} La sessione trovata o null.
 */
export async function getSessionForWhep(db, sessionId) {
    return db.get(
        'SELECT streamId, whepUrl FROM sessions WHERE sessionId = ? AND whepUrl IS NOT NULL',
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
 * Trova una richiesta per IP o ne crea una nuova, incrementando il contatore.
 * Questa funzione utilizza un'operazione "upsert" (INSERT ON CONFLICT)
 * che è atomica e più efficiente rispetto a un approccio SELECT-then-INSERT/UPDATE.
 *
 * @param {object} db - L'istanza del database aperta con 'sqlite'.
 * @param {string} ip - L'indirizzo IP da cercare o creare.
 * @returns {Promise<object>} Un oggetto con l'ip e il conteggio aggiornato (es. { ip: '127.0.0.1', count: 5 }).
 */
export async function findOrCreateRequest(db, ip) {
  const upsertQuery = `
    INSERT INTO requests (ip, count, lastRequestAt)
    VALUES (?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(ip) DO UPDATE SET
      count = count + 1,
      lastRequestAt = CURRENT_TIMESTAMP;
  `;

  try {
    // 1. Esegui l'operazione di "upsert".
    // Questa singola query gestisce sia il caso di creazione che di aggiornamento.
    await db.run(upsertQuery, ip);

    // 2. Dopo l'operazione, recupera il record aggiornato per restituirlo.
    const result = await db.get('SELECT ip, count FROM requests WHERE ip = ?', ip);
    return result;

  } catch (err) {
    console.error("❌ Errore in findOrCreateRequest:", err.message);
    // Rilancia l'errore per permettere al chiamante di gestirlo se necessario.
    throw err;
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
        // Le sessioni Theia non vengono disattivate
        if (sessionId.endsWith('_THEIA')) return;
        await db.run('UPDATE sessions SET participantCount = 0, isActive = 0 WHERE sessionId = ? OR sessionId = ?', [sessionId, sessionId + '_THEIA']);
    } catch (err) {
        console.error("Errore DB [updateDbParticipantCount]:", err.message);
    }
}

/**
 * Recupera uno stream di un utente umano casuale e attivo, escludendo una sessione specifica.
 * @param {Database} db - L'istanza del database.
 * @param {string} excludeSessionId - L'ID della sessione da escludere.
 * @returns {Promise<object|null>} La sessione trovata o null.
 */
export async function getRandomActiveStream(db, excludeSessionId) {
    return db.get(
        `SELECT sessionId, whepUrl FROM sessions 
         WHERE whepUrl IS NOT NULL 
         AND isActive = 1 
         AND sessionId != ? 
         AND sessionId NOT LIKE '%\\_THEIA'
         ORDER BY RANDOM() LIMIT 1`,
        excludeSessionId
    );
}

export async function getStreamIdBySessionId(db, sessionId) {
  try {
    const result = await db.get('SELECT streamId FROM sessions WHERE sessionId = ?', sessionId);
    console.log(JSON.stringify(result))
    return result ? result.streamId : null;
  } catch (err) {
    console.error("Errore DB [getStreamIdBySessionId]:", err.message);
    throw err;
  }
}

