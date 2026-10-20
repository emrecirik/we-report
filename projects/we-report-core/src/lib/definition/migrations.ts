import { CURRENT_DEFINITION_VERSION, ReportDefinition } from './report-definition';
import { sanitizeDefinition } from './sanitize';

type Migration = (definition: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades a version-n definition to version n+1. Never edit a shipped entry;
 * add the next one and a fixture test that loads a file of the previous version.
 */
const MIGRATIONS: Record<number, Migration> = {};

export class DefinitionVersionError extends Error {}

/** Sub-reports inside sub-reports: deeper files are refused (they are untrusted). */
const MAX_DEPTH = 5;

/** Upgrades a parsed `*.wrpt.json` of any released version to the current version. */
export function migrateDefinition(input: unknown, depth = 0): ReportDefinition {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DefinitionVersionError('A report definition must be a JSON object.');
  }
  let definition = input as Record<string, unknown>;
  let version = definition['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DefinitionVersionError('The report definition has no valid "version".');
  }
  const original = version;
  if (version > CURRENT_DEFINITION_VERSION) {
    throw new DefinitionVersionError(
      `The report was saved by a newer we-report (format ${version}); this version reads up to ${CURRENT_DEFINITION_VERSION}.`,
    );
  }
  while (version < CURRENT_DEFINITION_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new DefinitionVersionError(`No migration from format ${version}.`);
    }
    definition = { ...migrate(definition), version: version + 1 };
    version++;
  }
  return migrateSubreports(sanitizeDefinition(definition), original, depth) as unknown as ReportDefinition;
}

/** Sub-reports were saved with the report around them: they migrate from its version. */
function migrateSubreports(definition: Record<string, unknown>, version: number, depth: number): Record<string, unknown> {
  const bands = definition['bands'];
  const isSubreport = (c: unknown): c is { report: object } =>
    (c as { type?: unknown })?.type === 'subreport' && typeof (c as { report?: unknown }).report === 'object' && (c as { report?: unknown }).report !== null;
  if (!Array.isArray(bands) || !bands.some((b) => Array.isArray(b?.controls) && b.controls.some(isSubreport))) return definition;
  if (depth >= MAX_DEPTH) throw new DefinitionVersionError('Sub-reports are nested too deeply.');
  return {
    ...definition,
    bands: bands.map((band) =>
      Array.isArray(band?.controls)
        ? { ...band, controls: band.controls.map((c: unknown) => (isSubreport(c) ? { ...c, report: migrateDefinition({ ...c.report, version }, depth + 1) } : c)) }
        : band,
    ),
  };
}
