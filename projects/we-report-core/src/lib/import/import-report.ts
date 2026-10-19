import { migrateDefinition } from '../definition/migrations';
import { ImportResult } from './common';
import { importRdlc } from './rdlc';
import { importRepx } from './repx';

/**
 * Opens a report file of any supported kind, judged by its content: a we-report definition
 * (`.wrpt.json`), a Microsoft report (`.rdlc`, `.rdl`) or a DevExpress layout (`.repx`).
 */
export function importReport(source: string, fileName = ''): ImportResult {
  const text = source.replace(/^﻿/, '').trimStart();
  const name = fileName.replace(/^.*[\/]/, '').replace(/\.(wrpt\.json|json|rdlc?|repx)$/i, '') || 'Report';
  if (text.startsWith('{')) return { report: migrateDefinition(JSON.parse(text)), warnings: [] };
  if (/<XtraReportsLayoutSerializer[\s>]/.test(text) || /\.repx$/i.test(fileName)) return importRepx(text, name);
  if (/<Report[\s>]/.test(text)) return importRdlc(text, name);
  throw new Error('Unknown report file. Supported: .wrpt.json, .rdlc / .rdl and .repx (XML).');
}
