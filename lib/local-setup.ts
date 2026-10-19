export type LocalPlatform = 'windows' | 'mac' | 'linux';
// Display exact-origin commands for the user's own computer; never execute them.
export function ollamaBrowserCommand(origin: string, platform: LocalPlatform): string {
  if (!/^https?:\/\/[a-z0-9.:[\]-]+$/i.test(origin)) return '';
  if (platform === 'windows') return `$env:OLLAMA_ORIGINS="${origin}"; ollama serve`;
  if (platform === 'mac') return `launchctl setenv OLLAMA_ORIGINS '${origin}'`;
  return `OLLAMA_ORIGINS='${origin}' ollama serve`;
}
