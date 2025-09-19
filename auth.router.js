// auth.js

import express from 'express';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config()

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RP_NAME = 'InGoya';
const RP_ID = 'localhost';
const ORIGIN = `http://${RP_ID}:3000`;
const JWT_SECRET = process.env.INGOYA_SECRET_KEY;
const SALT_ROUNDS = 10;

export default function(db) {
    const router = express.Router();
    router.get('/login', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));

    // --- LOGICA PASSKEY (INVARIATA) ---
    router.post('/passkey-options', async (req, res) => {
        // ... (questa logica rimane la stessa)
    });

    router.post('/verify-passkey', async (req, res) => {
        // ... (questa logica rimane la stessa)
    });
    // --- FINE LOGICA PASSKEY ---


    // --- NUOVI ENDPOINT PER ID/PHRASE ---

    /**
     * Registra un nuovo utente usando la sua frase unica.
     * La frase viene usata sia come username che come "password" da hashare.
     */
    router.post('/register-phrase', async (req, res) => {
        const { idPhrase } = req.body;
        if (!idPhrase) return res.status(400).json({ error: 'Frase identificativa mancante.' });

        try {
            // Usiamo la frase stessa come username. In un'app reale potresti voler normalizzarla (es. lowercase).
            const username = idPhrase;
            const existingUser = await db.get('SELECT * FROM users WHERE username = ?', username);
            if (existingUser) {
                return res.status(409).json({ error: 'Questa frase è già in uso.' });
            }

            // Hashiamo la frase come se fosse una password
            const hashedPassword = await bcrypt.hash(idPhrase, SALT_ROUNDS);

            const result = await db.run(
                'INSERT INTO users (username, hashedPassword, lastIpAddress) VALUES (?, ?, ?)',
                [username, hashedPassword, req.ip]
            );

            const user = { id: result.lastID, name: username };
            const id_token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h' });

            res.cookie('token', id_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 3600000
            }).status(201).json({ success: true, message: 'Registrazione completata.' });

        } catch (error) {
            console.error("Errore /register-phrase:", error);
            res.status(500).json({ error: "Errore durante la registrazione." });
        }
    });

    /**
     * Esegue il login di un utente usando la sua frase unica.
     */
    router.post('/login-phrase', async (req, res) => {
        const { idPhrase } = req.body;
        if (!idPhrase) return res.status(400).json({ error: 'Frase identificativa mancante.' });
        try {
            // Cerchiamo l'utente usando la frase come username
            const username = idPhrase;
            const user = await db.get('SELECT * FROM users WHERE username = ?', username);

            if (!user || !user.hashedPassword) {
                // Utente non trovato o non registrato con questo metodo
                return res.status(401).json({ error: 'Frase non riconosciuta.' });
            }

            // Confrontiamo la frase fornita con l'hash salvato
            const isMatch = await bcrypt.compare(idPhrase, user.hashedPassword);

            if (isMatch) {
                await db.run('UPDATE users SET lastIpAddress = ? WHERE id = ?', [req.ip, user.id]);
                const id_token = jwt.sign({ userId: user.id, name: user.username }, JWT_SECRET, { expiresIn: '1h' });

                res.cookie('token', id_token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 3600000
                }).json({ success: true, message: 'Accesso riuscito.' });

            } else {
                // Questo caso è raro se username === idPhrase, ma è una sicurezza in più
                res.status(401).json({ error: 'Frase non valida.' });
            }
        } catch (error) {
            console.error("Errore /login-phrase:", error);
            res.status(500).json({ error: "Errore durante il login." });
        }
    });

    return router;
}