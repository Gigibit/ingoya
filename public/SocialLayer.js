// Questo file è un'astrazione per gestire le funzionalità sociali
// come la reputazione, i like, le connessioni tra utenti e il matchmaking.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

//ingoya-2209e project id
export class SocialLayer {
    constructor() {
        this.userId = null;
        this.isLiked = false;
        this.likesUnsubscribe = null;
        this.likeButton = null;
        this.likeCountElement = null;
        this.unfilledHeart = null;
        this.filledHeart = null;
        this.currentStreamerSessionId = null;
        this.mainTitle = null;

        // Inizializza Firebase e Firestore
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = JSON.parse(__firebase_config);
        const app = initializeApp(firebaseConfig);
        this.db = getFirestore(app);
        this.auth = getAuth(app);
        
        console.log("SocialLayer: L'anima della piattaforma è pronta a connettere gli utenti.");
    }
    
    async init() {
        return new Promise((resolve, reject) => {
            onAuthStateChanged(this.auth, (user) => {
                if (user) {
                    this.userId = user.uid;
                    resolve();
                } else {
                    signInAnonymously(this.auth).then(() => {
                        this.userId = this.auth.currentUser.uid;
                        resolve();
                    }).catch(error => {
                        console.error("Errore nell'autenticazione anonima:", error);
                        reject(error);
                    });
                }
            });
        });
    }
    
    setupEventListeners() {
        this.likeButton = document.getElementById('like-button');
        this.likeCountElement = document.getElementById('like-count');
        this.unfilledHeart = document.querySelector('.unfilled-heart');
        this.filledHeart = document.querySelector('.filled-heart');
        this.mainTitle = document.getElementById('main-title');

        this._animateTitle()

        if (this.likeButton) {
            this.likeButton.addEventListener('click', () => this._handleLikeClick());
        }
    }

    // Metodo placeholder per la gestione dei like
    async _handleLikeClick() {
        if (!this.userId || !this.currentStreamerSessionId) {
            console.log("Impossibile mettere like: utente non autenticato o sessione non valida.");
            return;
        }

        const docRef = doc(this.db, "artifacts", "default-app-id", "public", "data", "likes", this.currentStreamerSessionId);
        
        try {
            this.isLiked = !this.isLiked;
            const likeMap = {};
            likeMap[this.userId] = this.isLiked;
            
            await setDoc(docRef, likeMap, { merge: true });

            this.updateLikesUI(this.isLiked);
            this._animateHeart();
            this._animateTitle();

        } catch (e) {
            console.error("Errore nell'aggiornamento dei like:", e);
        }
    }
    
    updateLikesUI(isLiked) {
        this.unfilledHeart.style.display = isLiked ? 'none' : 'block';
        this.filledHeart.style.display = isLiked ? 'block' : 'none';
    }


    _setupLikesListener(sessionId) {
        if (this.likesUnsubscribe) {
            this.likesUnsubscribe();
            this.isLiked = false;
        }
        
        if (sessionId.endsWith('_THEIA')) {
            this.likeCountElement.textContent = "0";
            this.updateLikesUI(false);
            return;
        }

        const docRef = doc(this.db, "artifacts", "default-app-id", "public", "data", "likes", sessionId);
        this.currentStreamerSessionId = sessionId;
        
        this.likesUnsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const likeCount = Object.values(data).filter(isLiked => isLiked).length;
                this.likeCountElement.textContent = likeCount;

                if (this.userId) {
                    this.isLiked = !!data[this.userId];
                    this.updateLikesUI(this.isLiked);
                }
            } else {
                this.likeCountElement.textContent = "0";
                this.isLiked = false;
                this.updateLikesUI(false);
            }
        }, (error) => {
            console.error("Errore nel listener dei like:", error);
        });
    }
    
    _animateHeart() {
        const heart = document.createElement('i');
        heart.className = 'fas fa-heart flying-heart';
        document.body.appendChild(heart);
        setTimeout(() => {
            heart.remove();
        }, 1500); // Rimuovi il cuore dopo la fine dell'animazione
    }

    _animateTitle() {
      if (this.mainTitle) {
        this.mainTitle.classList.remove('initial-fade-out');
        setTimeout(() => {
            this.mainTitle.classList.add('initial-fade-out');
        }, 500); // La durata dell'animazione
      }
    }

    // Metodo per avviare il listener dall'AppController
    setupLikesListener(sessionId) {
        this._setupLikesListener(sessionId);
    }
    

    // Metodo placeholder per il matchmaking tra utenti
    // TODO: implementare la logica per trovare utenti con interessi simili o nella stessa area
    async findNextUser(excludeSessionId) {
        console.log(`SocialLayer: Cercando un nuovo utente. Escludi: ${excludeSessionId}`);
        // Logica di ricerca nel database
    }

    // Metodo placeholder per aggiornare la reputazione dell'utente
    // TODO: implementare un sistema di reputazione basato su feedback o interazioni
    async updateReputation(sessionId, type) {
        console.log(`SocialLayer: Aggiornamento reputazione per ${sessionId} di tipo ${type}`);
    }
}
/* __endmodification */
