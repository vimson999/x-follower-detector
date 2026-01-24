/**
 * License Validation Utility (Offline)
 * Uses a checksum-based algorithm to verify keys.
 */

const SECRET_SALT = "X-FOLLOW-PRO-SECRET-2026"; // MUST MATCH PYTHON SCRIPT

/**
 * Simple SHA-256 equivalent for Browser (using SubtleCrypto)
 * Or a simpler hash for performance. We'll use a basic logic here.
 */
async function calculateChecksum(text) {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 4).toUpperCase();
}

/**
 * Validates a key format: XFP-XXXX-YYYY
 */
export async function validateLicenseKey(key) {
    if (!key || typeof key !== 'string') return false;
    
    const parts = key.trim().toUpperCase().split('-');
    if (parts.length !== 3 || parts[0] !== 'XFP') return false;
    
    const randomPart = parts[1];
    const providedChecksum = parts[2];
    
    const expectedChecksum = await calculateChecksum(SECRET_SALT + randomPart);
    
    return providedChecksum === expectedChecksum;
}
