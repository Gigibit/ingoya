window.addEventListener('load', () => {
    function onScreenLog(message, level = 'log') {
      const logger = document.getElementById('on-screen-logger');
        if (logger) {
            const now = new Date();
            const timeString = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry log-${level}`;
            logEntry.innerHTML = `[${timeString}] ${message}`;
            
            // Aggiunge il nuovo log in fondo al contenitore
            logger.appendChild(logEntry);
            
            // Scorre automaticamente per mostrare l'ultimo log
            logger.scrollTop = logger.scrollHeight;
        }
    }

    // --- SOVRASCRITTURA DI CONSOLE.LOG E CONSOLE.ERROR ---

    // 1. Salva una copia dei metodi originali
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    // 2. Sovrascrivi console.log
    console.log = function (...args) {
        // Converte tutti gli argomenti in una stringa per il logger on-screen
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
        onScreenLog(message, 'log');

        // Chiama il metodo originale per mantenere il comportamento nativo della console
        originalConsoleLog.apply(console, args);
    };

    // 3. Sovrascrivi console.error
    console.error = function (...args) {
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
        onScreenLog(message, 'error'); // Passa il livello 'error' per lo stile

        originalConsoleError.apply(console, args);
    };

    const screenLogger = document.createElement('div')
    screenLogger.id = 'on-screen-logger'
    document.body.appendChild(screenLogger)
})