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

// Queste variabili dovrebbero essere nel tuo file .env per sicurezza
const RP_NAME = 'InGoya';
const RP_ID = 'localhost'; // In produzione, questo DEVE essere il tuo dominio (es. "ingoya.art")
const ORIGIN = `http://${RP_ID}:3000`;
const JWT_SECRET = process.env.INGOYA_SECRET_KEY; 
const SALT_ROUNDS = 10;

// Esportiamo una funzione che accetta 'db' e restituisce il router
export default function(db) {
    const router = express.Router();
    router.get('/login', (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
  /**
     * Gestisce la richiesta di opzioni per la Passkey (registrazione o login).
     */
    router.post('/passkey-options', async (req, res) => {
        const { loginIdentifier } = req.body;
        if (!loginIdentifier) return res.status(400).json({ error: 'Email o username mancante.' });
        const ip = req.ip;
        try {
            const isEmail = loginIdentifier.includes('@');
            let user;

            if (isEmail) {
                user = await db.get('SELECT * FROM users WHERE email = ?', loginIdentifier);
            } else {
                user = await db.get('SELECT * FROM users WHERE username = ?', loginIdentifier);
            }

            if (!user) {
                const sql = isEmail 
                    ? 'INSERT INTO users (email, lastIpAddress) VALUES (?, ?)'
                    : 'INSERT INTO users (username, lastIpAddress) VALUES (?, ?)';
                const result = await db.run(sql, [loginIdentifier, ip]);
                user = { id: result.lastID, email: isEmail ? loginIdentifier : null, username: !isEmail ? loginIdentifier : null };
            } else {
                await db.run('UPDATE users SET lastIpAddress = ? WHERE id = ?', [ip, user.id]);
            }

            const userAuthenticators = await db.all('SELECT * FROM authenticators WHERE userId = ?', user.id);
            
            let options;
            if (userAuthenticators.length === 0) {
                options = await generateRegistrationOptions({
                    rpName: RP_NAME,
                    rpID: RP_ID,
                    userID: Buffer.from(String(user.id), 'utf-8'),
                    userName: loginIdentifier,
                    attestationType: 'none',
                    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
                });
            } else {
                options = await generateAuthenticationOptions({
                    rpID: RP_ID,
                    allowCredentials: userAuthenticators.map(auth => ({
                        id: auth.id,
                        type: 'public-key',
                        transports: auth.transports ? auth.transports.split(',') : undefined,
                    })),
                    userVerification: 'preferred',
                });
            }

            await db.run('UPDATE users SET currentChallenge = ? WHERE id = ?', [options.challenge, user.id]);
            res.json(options);

        } catch (error) {
            console.error('Errore in /passkey-options:', error);
            res.status(500).json({ error: 'Errore interno.' });
        }
    });

    /**
     * Verifica la risposta della Passkey e genera un JWT.
     */
    
    router.post('/verify-passkey', async (req, res) => {
        const { loginIdentifier, responseData } = req.body;
        if (!loginIdentifier || !responseData) return res.status(400).json({ error: 'Dati mancanti.' });
        const isEmail = loginIdentifier.includes('@');
        let user = isEmail
            ? await db.get('SELECT * FROM users WHERE email = ?', loginIdentifier)
            : await db.get('SELECT * FROM users WHERE username = ?', loginIdentifier);
        if (!user) return res.status(404).json({ error: 'Utente non trovato.' });
        try {
            const userAuthenticators = await db.all('SELECT * FROM authenticators WHERE userId = ?', user.id);
            let verification;
            if (userAuthenticators.length === 0) {
                verification = await verifyRegistrationResponse({
                    response: responseData,
                    expectedChallenge: user.currentChallenge,
                    expectedOrigin: ORIGIN,
                    expectedRPID: RP_ID,
                });
                if (verification.verified && verification.registrationInfo) {
                    const { credential: { id: credentialID, publicKey: credentialPublicKey, counter }, transports } = verification.registrationInfo;
                    if (!credentialPublicKey || !credentialID) {
                        return res.status(500).json({ error: 'Errore interno durante la registrazione.' });
                    }
                    await db.run('INSERT INTO authenticators (id, userId, credentialPublicKey, counter, transports) VALUES (?, ?, ?, ?, ?)', [credentialID, user.id, Buffer.from(credentialPublicKey).toString('base64'), counter, transports ? transports.join(',') : null]);
                } else {
                    verification.verified = false;
                }
            } else {
                const authenticator = userAuthenticators.find(auth => auth.id === responseData.id);
                if (!authenticator || !authenticator.credentialPublicKey) {
                    return res.status(404).json({ error: 'Passkey non riconosciuta o dati corrotti.' });
                }
                verification = await verifyAuthenticationResponse({
                    response: responseData,
                    expectedChallenge: user.currentChallenge,
                    expectedOrigin: ORIGIN,
                    expectedRPID: RP_ID,
                    authenticator: {
                        credentialID: authenticator.id,
                        credentialPublicKey: Buffer.from(authenticator.credentialPublicKey, 'base64'),
                        counter: authenticator.counter,
                        transports: authenticator.transports ? authenticator.transports.split(',') : undefined,
                    },
                });
                if (verification.verified) {
                    await db.run('UPDATE authenticators SET counter = ? WHERE id = ?', [verification.authenticationInfo.newCounter, authenticator.id]);
                }
            }
            if (verification.verified) {
                const id_token = jwt.sign({ userId: user.id, name: user.email || user.username }, JWT_SECRET, { expiresIn: '1h' });
                res.cookie('token', id_token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 3600000 // 1 ora
                }).json({ success: true, message: 'Accesso con Passkey riuscito.' });
            } else {
                res.status(400).json({ error: 'Verifica fallita.' });
            }
        } catch (error) {
            console.error('Errore in /verify-passkey:', error);
            res.status(500).json({ error: 'Verifica fallita.' });
        }
    });

    // --- ENDPOINT PER USERNAME/PASSWORD ---

    router.post('/register-password', async (req, res) => {
        const { loginIdentifier, password } = req.body;
        if (!loginIdentifier || !password) return res.status(400).json({ error: 'Dati mancanti.' });
        try {
            const isEmail = loginIdentifier.includes('@');
            const existingUser = isEmail
                ? await db.get('SELECT * FROM users WHERE email = ?', loginIdentifier)
                : await db.get('SELECT * FROM users WHERE username = ?', loginIdentifier);
            if (existingUser) {
                return res.status(409).json({ error: 'Utente già registrato.' });
            }
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            const sql = isEmail
                ? 'INSERT INTO users (email, hashedPassword, lastIpAddress) VALUES (?, ?, ?)'
                : 'INSERT INTO users (username, hashedPassword, lastIpAddress) VALUES (?, ?, ?)';
            const result = await db.run(sql, [loginIdentifier, hashedPassword, req.ip]);
            const user = { id: result.lastID, name: loginIdentifier };
            const id_token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
            
            // Imposta il cookie e invia la risposta
            res.cookie('token', id_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', // In produzione usare HTTPS
                sameSite: 'strict',
                maxAge: 3600000 // 1 ora in millisecondi
            }).status(201).json({ success: true, message: 'Registrazione completata.' });

        } catch (error) {
            console.error("Errore /register-password:", error);
            res.status(500).json({ error: "Errore durante la registrazione." });
        }
    });

    router.post('/login-password', async (req, res) => {
        const { loginIdentifier, password } = req.body;
        if (!loginIdentifier || !password) return res.status(400).json({ error: 'Dati mancanti.' });
        try {
            const isEmail = loginIdentifier.includes('@');
            const user = isEmail
                ? await db.get('SELECT * FROM users WHERE email = ?', loginIdentifier)
                : await db.get('SELECT * FROM users WHERE username = ?', loginIdentifier);
            if (!user || !user.hashedPassword) {
                return res.status(401).json({ error: 'Credenziali non valide o utente non registrato con password.' });
            }
            const isMatch = await bcrypt.compare(password, user.hashedPassword);
            if (isMatch) {
                await db.run('UPDATE users SET lastIpAddress = ? WHERE id = ?', [req.ip, user.id]);
                const id_token = jwt.sign({ userId: user.id, name: user.email || user.username }, JWT_SECRET, { expiresIn: '1h' });
                
                // Imposta il cookie e invia la risposta
                res.cookie('token', id_token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 3600000 // 1 ora
                }).json({ success: true, message: 'Accesso riuscito.' });

            } else {
                res.status(401).json({ error: 'Credenziali non valide.' });
            }
        } catch (error) {
            console.error("Errore /login-password:", error);
            res.status(500).json({ error: "Errore durante il login." });
        }
    });

    return router;
}

