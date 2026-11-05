export interface DownloadSlots {
  take(client: string): (() => void) | null;
  active(): number;
}

export function createDownloadSlots(maxTotal: number, maxPerClient: number): DownloadSlots {
  const perClient = new Map<string, number>();
  let total = 0;

  function release(client: string): void {
    total -= 1;
    const count = (perClient.get(client) || 1) - 1;
    if (count <= 0) {
      perClient.delete(client);
    } else {
      perClient.set(client, count);
    }
  }

  return {
    take(client) {
      const current = perClient.get(client) || 0;
      if (total >= maxTotal || current >= maxPerClient) {
        return null;
      }
      total += 1;
      perClient.set(client, current + 1);
      let released = false;
      return () => {
        if (!released) {
          released = true;
          release(client);
        }
      };
    },
    active: () => total,
  };
}
