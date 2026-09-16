// Shared by the TypeScript-owned OpenAPI generator and compatibility callers.
const parse = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`OpenAPI version must be strict SemVer: ${version}`);
  return match.slice(1).map(Number);
};

export function assertSchemaVersionTransition(previousVersion, nextVersion, schemaChanged) {
  const previous = parse(previousVersion);
  const next = parse(nextVersion);
  if (!schemaChanged) return;
  const increased = next[0] > previous[0] || next[0] === previous[0] && (
    next[1] > previous[1] || next[1] === previous[1] && next[2] > previous[2]
  );
  if (!increased) throw new Error(`OpenAPI schema changed without a version increase (${previousVersion} -> ${nextVersion})`);
}
