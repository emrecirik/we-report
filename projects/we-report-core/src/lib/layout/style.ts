import { DEFAULT_STYLE } from '../definition/blank-report';
import { BorderStyle, ReportDefinition, ReportStyle } from '../definition/report-definition';

export type ResolvedStyle = typeof DEFAULT_STYLE & { backgroundColor?: string; border?: BorderStyle };

/** default style ← report's `default` style ← named style ← per-control overrides. */
export function resolveStyle(definition: ReportDefinition, name?: string, overrides?: ReportStyle): ResolvedStyle {
  const named = name && name !== 'default' ? definition.styles[name] : undefined;
  return { ...DEFAULT_STYLE, ...definition.styles['default'], ...named, ...overrides };
}
