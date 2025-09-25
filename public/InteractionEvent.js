export class InteractionEvent {
    static dispatch(detail) {
        if (typeof detail === 'string'){
            detail = { type: detail }
        }
        const event = new CustomEvent("userInteraction", { detail });
        document.dispatchEvent(event)
    }
    static dispatchCustom(type, detail) {
        const event = new CustomEvent(type, { detail });
        document.dispatchEvent(event)
    }
}