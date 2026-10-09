import initSqlJs, { type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { importApkg, type ApkgImportOptions, type ApkgSummary } from "./apkg";

let sqlPromise: Promise<SqlJsStatic> | null = null;

const loadSql = (): Promise<SqlJsStatic> => {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl }).catch((err: unknown) => {
    sqlPromise = null;
    throw err;
  });
  return sqlPromise;
};

/** Browser entry point: lazily loads the SQLite WASM engine, then imports the file. */
export const importApkgFile = async (file: File, opts: ApkgImportOptions): Promise<ApkgSummary> => {
  const [sql, buffer] = await Promise.all([loadSql(), file.arrayBuffer()]);
  return importApkg(new Uint8Array(buffer), sql, opts);
};
