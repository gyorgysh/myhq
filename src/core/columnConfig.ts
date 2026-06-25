import { loadJson, saveJson } from "./jsonStore.js";
import { audit } from "./audit.js";

const FILE = "columnConfig.json";

export interface ColumnDef {
  id: string;
  name: string;
  order: number;
}

interface ColumnFile {
  version: 1;
  columns: ColumnDef[];
}

const DEFAULTS: ColumnDef[] = [
  { id: "backlog", name: "Planned", order: 0 },
  { id: "doing", name: "In Progress", order: 1 },
  { id: "done", name: "Done", order: 2 },
];

function load(): ColumnDef[] {
  const f = loadJson<ColumnFile>(FILE, { version: 1, columns: DEFAULTS });
  if (!f.columns || f.columns.length === 0) return DEFAULTS;
  return [...f.columns].sort((a, b) => a.order - b.order);
}

function persist(cols: ColumnDef[]): void {
  saveJson<ColumnFile>(FILE, { version: 1, columns: cols });
}

export function listColumns(): ColumnDef[] {
  return load();
}

export function getColumnIds(): string[] {
  return load().map((c) => c.id);
}

export function isValidColumn(id: string): boolean {
  return load().some((c) => c.id === id);
}

export function renameColumn(id: string, name: string): ColumnDef | undefined {
  const cols = load();
  const col = cols.find((c) => c.id === id);
  if (!col) return undefined;
  col.name = name.trim() || col.name;
  persist(cols);
  audit("column.rename", { id, name });
  return col;
}

export function addColumn(name: string): ColumnDef {
  const cols = load();
  // Derive a slug id from the name (lowercase, spaces to dashes, strip special chars).
  const baseId = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32) || `col-${Date.now()}`;
  // Ensure unique id.
  let id = baseId;
  let n = 2;
  while (cols.some((c) => c.id === id)) id = `${baseId}-${n++}`;
  const col: ColumnDef = { id, name: name.trim() || "New column", order: cols.length };
  cols.push(col);
  persist(cols);
  audit("column.add", { id, name });
  return col;
}

export function removeColumn(id: string): boolean {
  const cols = load();
  const next = cols.filter((c) => c.id !== id);
  if (next.length === cols.length) return false;
  // Re-number order.
  next.forEach((c, i) => { c.order = i; });
  persist(next);
  audit("column.remove", { id });
  return true;
}

export function reorderColumns(orderedIds: string[]): ColumnDef[] {
  const cols = load();
  const byId = new Map(cols.map((c) => [c.id, c]));
  const reordered = orderedIds.flatMap((id) => {
    const c = byId.get(id);
    return c ? [c] : [];
  });
  reordered.forEach((c, i) => { c.order = i; });
  persist(reordered);
  return reordered;
}
