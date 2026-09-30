export type Field = { name: string; label: string; member: string; values: string[]; labels: string[]; choices?: string[] };
export type Section = { key: string; title: string; source: string; fields: Field[] };
export type Career = { id: string; name: string; family: string; enabled: boolean; role: string };
export type Summary = {
  loaded: boolean; doc: string; snapshot: string; careers: Career[]; missing: string[];
  tables: { key: string; file: string; className: string; title: string; rows: number | null; editable: boolean }[];
  relations: string[][];
};
export type Detail = {
  id: string; name: string; family: string; sections: Section[]; missingSkills: string[];
  skills: { id: string; name: string; ability: string; cd: string; basis: string;
    tree: { id: string; name: string; maxLevel: string }[] }[];
  creation: Record<string, string>[];
};
export type Edits = Record<string, Record<string, string[]>>;
export type ConfigRecord = { table: string; sourceId: string; targetId: string; title: string;
  groups: { title: string; fields: Field[] }[]; edits: Record<string, string[]> };
export type Draft = { edits: Edits; clone: boolean; targetId: string; operations?: ConfigRecord[] };
export type Review = {
  token: string; mode: string; clone: boolean; warnings: string[];
  plans: { path: string; sheet: string; row: number; table: string; sourceId: string; targetId: string;
    clone: boolean; changes: { member: string; column: number; slot: number; before: string; after: string }[] }[];
};
