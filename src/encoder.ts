export function textToBase64(s: string) : string {
    return bytesToBase64(new TextEncoder().encode(s));
}

function bytesToBase64(bytes: Uint8Array) {
    const binString = Array.from(bytes, (byte) =>
        String.fromCodePoint(byte),
    ).join('');
    return btoa(binString);
}

export function base64ToText(base64: string) : string {
    return new TextDecoder().decode(base64ToBytes(base64));
}

function base64ToBytes(base64: string) : Uint8Array {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m:string) => m.codePointAt(0) || 0);
}
