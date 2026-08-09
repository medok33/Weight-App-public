export interface Counter {
  name: string;
  value: number;
  labels: Record<string, string>;
}

export function createCounter(name: string) {
  const values = new Map<string, Counter>();
  return {
    increment(labels: Record<string, string> = {}): void {
      const key = JSON.stringify(labels);
      const current = values.get(key) ?? { name, value: 0, labels };
      current.value += 1;
      values.set(key, current);
    },
    snapshot(): Counter[] {
      return [...values.values()].map((counter) => ({ ...counter, labels: { ...counter.labels } }));
    },
  };
}
