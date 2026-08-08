// Eigene Datei nur fuer den Typ: migrate.ts (Node-sicher, von Tests
// importiert) darf nicht transitiv von migrationFiles.ts (nutzt Vites
// import.meta.glob) abhaengen, sonst scheitert der Typecheck unter dem
// Node-Tsconfig, das keine vite/client-Typen kennt.
export interface MigrationFile {
  file: string;
  sql: string;
}
