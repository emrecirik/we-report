import { CURRENT_DEFINITION_VERSION, ReportDefinition } from './report-definition';

type Migration = (definition: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades a version-n definition to version n+1. Never edit a shipped entry;
 * add the next one and a fixture test that loads a file of the previous version.
 */
const MIGRATIONS: Record<number, Migration> = {};

export class DefinitionVersionError extends Error {}

/** Upgrades a parsed `*.wrpt.json` of any released version to the current version. */
export function migrateDefinition(input: unknown): ReportDefinition {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DefinitionVersionError('A report definition must be a JSON object.');
  }
  let definition = input as Record<string, unknown>;
  let version = definition['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DefinitionVersionError('The report definition has no valid "version".');
  }
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
  return definition as unknown as ReportDefinition;
}
