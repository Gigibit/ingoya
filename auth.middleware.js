import dotenv from 'dotenv';
dotenv.config()

// Esempio di auth.middleware.js
import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.INGOYA_SECRET_KEY; 

export function protectRoute(req, res, next) {
    const token = req.cookies.token;

    const unauthorized = () => {
        // Controlla se il client (es. il browser) accetta una risposta HTML.
        // I browser che navigano una pagina lo fanno, le chiamate API no.
        if (req.accepts('html')) {
            // Se è una richiesta di navigazione, reindirizza alla pagina di login.
            return res.redirect('/luna');
        }
        // Altrimenti, è una richiesta API, quindi invia un errore JSON.
        return res.status(401).json({ error: 'Accesso non autorizzato.' });
    };

    if (!token) {
        return unauthorized();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next(); // L'utente è verificato, procedi.
    } catch (error) {
        return unauthorized(); // Il token non è valido.
    }
}

