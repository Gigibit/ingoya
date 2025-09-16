
window.addEventListener('load', ()=>{}
const canvas = document.getElementById('theia-canvas');
const ctx = canvas.getContext('2d');

// Imposta la dimensione del canvas a schermo intero
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Array per contenere tutte le particelle
let particles = [];
let audioContext, analyser, source, dataArray;

// --- Classe Particella ---
// Definisce come ogni singola particella si comporta e appare
class Particle {
    constructor(x, y, color, speed, direction) {
        this.x = x;
        this.y = y;
        // Calcola la velocità basandosi su direzione e rapidità
        this.vx = Math.cos(direction) * speed;
        this.vy = Math.sin(direction) * speed;
        this.color = color;
        this.size = 2 + Math.random() * 4;
        this.life = 80 + Math.random() * 50; // Durata in frame
        this.initialLife = this.life;
    }

    // Aggiorna la posizione e la vita della particella
    update() {
        this.x += this.vx;
        this.y += this.vy;
        
        // Simula un po' di frizione per rallentare le particelle
        this.vx *= 0.98;
        this.vy *= 0.98;

        this.life--;
    }

    // Disegna la particella sul canvas
    draw() {
        ctx.save();
        // L'opacità diminuisce man mano che la particella "invecchia"
        ctx.globalAlpha = Math.max(0, this.life / this.initialLife);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        
        // Aggiunge un effetto di bagliore (glow) per un look più bello
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 15;
        
        ctx.fill();
        ctx.restore();
    }
}


// --- Funzione di Analisi Audio ---
// Controlla le frequenze e crea particelle in base ai picchi
function analyzeAudio() {
    if (!analyser) return;

    analyser.getByteFrequencyData(dataArray);

    // Calcola la media per le diverse gamme di frequenza
    const bass = getFrequencyRangeAverage(0, 5);       // Frequenze basse
    const mids = getFrequencyRangeAverage(6, 30);      // Frequenze medie
    const treble = getFrequencyRangeAverage(50, 100);  // Frequenze alte

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Se c'è un colpo di basso, crea un'esplosione dal centro
    if (bass > 180) { // Soglia per i bassi (puoi regolarla)
        const particleCount = 15;
        const angleIncrement = (Math.PI * 2) / particleCount;
        for (let i = 0; i < particleCount; i++) {
            const speed = 2 + Math.random() * 5;
            // Usa colori sul magenta/viola per i bassi
            const color = `hsl(${280 + Math.random() * 40}, 100%, 60%)`;
            particles.push(new Particle(centerX, centerY, color, speed, i * angleIncrement));
        }
    }

    // Per le frequenze medie, crea particelle casuali
    if (mids > 100) { // Soglia per i medi
        const speed = 1 + Math.random() * 3;
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        // Usa colori ciano/blu per i medi
        const color = `hsl(${180 + Math.random() * 40}, 90%, 55%)`;
        particles.push(new Particle(x, y, color, speed, Math.random() * Math.PI * 2));
    }
    
    // Per gli alti, crea piccole "scintille"
    if (treble > 80) { // Soglia per gli alti
        const speed = 2 + Math.random() * 2;
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
         // Usa colori gialli/bianchi per gli alti
        const color = `hsl(60, 100%, ${70 + Math.random() * 30}%)`;
        const particle = new Particle(x, y, color, speed, Math.random() * Math.PI * 2);
        particle.size = 1 + Math.random() * 2; // Le scintille sono più piccole
        particles.push(particle);
    }
}

// Funzione helper per calcolare la media di un range di frequenze
function getFrequencyRangeAverage(low, high) {
    let sum = 0;
    for (let i = low; i <= high; i++) {
        sum += dataArray[i];
    }
    return sum / (high - low + 1);
}


// --- Loop di Animazione Principale ---
function animate() {
    // Chiama se stessa per il prossimo frame
    requestAnimationFrame(animate);

    // Disegna un rettangolo nero semitrasparente per creare l'effetto scia
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Analizza l'audio
    analyzeAudio();
    
    // Aggiorna e disegna ogni particella, e rimuovi quelle "morte"
    particles = particles.filter(p => {
        if (p.life > 0) {
            p.update();
            p.draw();
            return true;
        }
        return false;
    });
}

// --- Funzione di Inizializzazione Audio ---
async function initAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        // Nascondi il pulsante e avvia l'animazione
        animate();

    } catch (err) {
        console.error('Errore nell\'accesso al microfono:', err);
        alert('È necessario consentire l\'accesso al microfono per usare il visualizzatore.');
    }
}


// Gestisci il ridimensionamento della finestra
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});
window.theiaSoul = initAudio
})