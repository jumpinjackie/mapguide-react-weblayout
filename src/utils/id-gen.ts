
// Needed for IE
if (!window.crypto) {
    (window as any).crypto = (window as any).msCrypto;
}
import { nanoid } from "nanoid";

export function generateId() {
    return nanoid();
}