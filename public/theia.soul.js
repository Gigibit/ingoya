/**
 * Crea una visualizzazione fluida reattiva a uno stream audio
 * e la espone come un MediaStream video.
 * Versione "headless" e snella dello script di Pavel Dobryakov.
 */
export class TheiaSoul {
       constructor() { }
       getStream(){
            const canvas = document.getElementById('fluidCanvas') || document.getElementsByTagName('canvas')[0];
            return canvas.captureStream(15)
       }

}
