import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getMaintenanceRunnerDescriptor,
  MAINTENANCE_RUNNER_DESCRIPTOR,
} from "../src/index.ts";

test("declares a non-privileged V2 maintenance boundary", () => {
  assert.deepEqual(getMaintenanceRunnerDescriptor(), {
    executionSpecId: "V2-EXEC-3",
    status: "scaffold",
    privileged: false,
    transactionSubmissionImplemented: false,
  });
  assert.equal(Object.isFrozen(MAINTENANCE_RUNNER_DESCRIPTOR), true);
});
