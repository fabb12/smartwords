function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function bytes(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
async function masterKey(secret: string) {
  if (!secret || secret.length < 32) throw new Error('Archivio chiavi non configurato.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function seal(value: string, master: string, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await masterKey(master), new TextEncoder().encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function unseal(value: string, master: string, owner: string) {
  const [iv, encrypted] = value.split('.');
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: new TextEncoder().encode(owner) }, await masterKey(master), bytes(encrypted));
  return new TextDecoder().decode(clear);
}
