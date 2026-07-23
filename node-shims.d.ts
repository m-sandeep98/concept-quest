// Ambient type shims for the Node built-ins that vite.config.ts uses. Lives in a declaration
// file (no imports/exports) so these are fresh AMBIENT module declarations, not augmentations
// — which lets the config TS project (tsconfig.node.json) type-check without an @types/node
// dependency. Scoped to that project only; the app project (tsconfig.json → "src") never sees it.

declare module "node:fs" {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  export function statSync(p: string): { isFile(): boolean };
  export function existsSync(p: string): boolean;
  export function readFileSync(p: string, encoding: "utf8"): string;
  export function readdirSync(p: string, opts: { withFileTypes: true }): Dirent[];
}

declare module "node:path" {
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
  export function dirname(p: string): string;
  export function relative(from: string, to: string): string;
}
