// Minimal test globals to allow type-checking without a runner.
// Replace with Vitest/Node test types when a runner is added.
declare const describe: (name: string, fn: () => void | Promise<void>) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const test: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: any;

