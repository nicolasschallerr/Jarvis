// CSV para abrir en Excel o Google Sheets.
//
// - Comillas dobles para los valores con coma, comillas o saltos de línea.
// - Un valor que empieza con = + - @ (o tabulación) lo interpretaría una planilla como una fórmula: se antepone un
//   apóstrofo ("inyección de fórmulas"). Los datos vienen de personas externas (nombres, notas), así que importa.
// - UTF-8 con marca de orden de bytes (BOM) para que Excel muestre bien las tildes y la ñ.
// - Fin de línea CRLF, como pide el formato.

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Los números negativos de verdad no son fórmulas: se dejan.
  if (FORMULA_START.test(text) && !(typeof value === "number" && Number.isFinite(value))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
