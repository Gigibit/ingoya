function generateSessionId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // Rimosse minuscole per leggibilità
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

const codeDisplay = document.getElementById('session-code-display');
const sessionId = generateSessionId();
const joinURL = `${window.location.origin}/draw?sessionId=${sessionId}`;

// ✨ Mostra subito il codice generato
codeDisplay.textContent = sessionId;

new QRCode(document.getElementById('qrcode'), { text: joinURL, width: 200, height: 200 });
const socket = io();
socket.on('connect', () => socket.emit('create-session', sessionId));

socket.on('user-joined', () => {
    console.log('Partecipante connesso!');
    // ✨ Aggiunge la classe per il feedback visivo (bordo verde)
    codeDisplay.classList.add('connected');
});

socket.on('url-received', (url) => {
    document.body.className = 'iframe-mode';

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = '100vw';
    iframe.style.height = '100vh';
    iframe.style.border = 'none';
    document.body.innerHTML = '';
    document.body.appendChild(iframe);
});