/** WebSocket endpoint of the game server (same origin as the page; proxied in development). */
export function socketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
