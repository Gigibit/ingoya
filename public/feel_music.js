document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('youtube-url');
    const summarizeBtn = document.getElementById('summarize-btn');
    const resultDiv = document.getElementById('prompt');
    const loader = document.getElementById('loader');

    summarizeBtn.addEventListener('click', async () => {
        const youtubeUrl = urlInput.value.trim();
        if (!youtubeUrl) {
            resultDiv.textContent = "Per favore, inserisci un URL.";
            return;
        }

        // Reset UI
        resultDiv.textContent = '';
        loader.style.display = 'block';
        summarizeBtn.disabled = true;

        try {
            const response = await fetch('/summarize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ youtubeUrl }),
            });

            const data = await response.json();

            if (!response.ok) {
                // Se la risposta non è OK, usa il messaggio di errore dal server
                throw new Error(data.error || 'Qualcosa è andato storto.');
            }

            resultDiv.textContent = data.summary;
            handleUpdateParams()

        } catch (error) {
            console.error('Errore durante la richiesta:', error);
            resultDiv.textContent = `Errore: ${error.message}`;
        } finally {
            // Ripristina la UI in ogni caso
            loader.style.display = 'none';
            summarizeBtn.disabled = false;
        }
    });
});