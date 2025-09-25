// o gioia, ch'io conobbi, esser amato amando!
import { SocialLayer } from './SocialLayer.js';
import { ConnectionManager } from './ConnectionManager.js';
import { UiController } from './UiController.js';

class AppController {
    constructor() {
        this.MOCK = false;

        // Inizializza le classi di servizio
        this.socialLayer = new SocialLayer();
        this.connectionManager = new ConnectionManager(this.MOCK, this.socialLayer);
        this.uiController = new UiController(this.connectionManager);
        
        // Inietta le dipendenze tra le classi
        this.connectionManager.uiController = this.uiController;
        this.uiController.socialLayer = this.socialLayer;
        
        this._init();
    }

    async _init() {
        // Verifica l'autenticazione prima di avviare tutto il resto
        const isAuthenticated = await this.connectionManager.verifyAuthentication();
        if (!isAuthenticated) {
            console.log("Verifica fallita. Inizializzazione dell'app interrotta.");
            return;
        }

        // Inizializza i moduli
        await this.socialLayer.init();
        this.socialLayer.setupEventListeners();
        this.uiController.setupEventListeners();
        console.log("✅ Autenticazione riuscita. Avvio dell'applicazione...");
        this.connectionManager.setupSocket();
        
        // Avvia l'esperienza iniziale
        this.connectionManager.main();
        this.uiController.setSessionId(this.connectionManager.sessionId);
    }
}

window.addEventListener('DOMContentLoaded', () => new AppController());
