import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSchemaVersionTransition } from "../scripts/openapi-versioning.mjs";

test("unchanged schemas do not require an OpenAPI version increase", () => {
  assert.doesNotThrow(() => assertSchemaVersionTransition("2.0.0", "2.0.0", false));
});

test("changed schemas require a strictly higher SemVer", () => {
  assert.throws(() => assertSchemaVersionTransition("2.0.0", "2.0.0", true), /without a version increase/);
  assert.throws(() => assertSchemaVersionTransition("2.0.0", "1.9.9", true), /without a version increase/);
  assert.doesNotThrow(() => assertSchemaVersionTransition("2.0.0", "2.0.1", true));
  assert.doesNotThrow(() => assertSchemaVersionTransition("2.0.0", "2.1.0", true));
  assert.doesNotThrow(() => assertSchemaVersionTransition("2.0.0", "3.0.0", true));
});

test("version gate rejects non-SemVer values", () => {
  assert.throws(() => assertSchemaVersionTransition("2", "2.0.1", true), /strict SemVer/);
  assert.throws(() => assertSchemaVersionTransition("2.0.0", "next", true), /strict SemVer/);
});
