// Small pure string / data helpers shared across the authoring modules. No I/O.

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
export const camel = (kebab) => String(kebab).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
export const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
