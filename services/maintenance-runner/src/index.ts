export const MAINTENANCE_RUNNER_DESCRIPTOR = Object.freeze({
  executionSpecId: "V2-EXEC-3" as const,
  status: "scaffold" as const,
  privileged: false as const,
  transactionSubmissionImplemented: false as const,
});

export function getMaintenanceRunnerDescriptor(): typeof MAINTENANCE_RUNNER_DESCRIPTOR {
  return MAINTENANCE_RUNNER_DESCRIPTOR;
}

if (process.argv[1]?.endsWith("/index.js") || process.argv[1]?.endsWith("/index.ts")) {
  process.stdout.write(`${JSON.stringify(MAINTENANCE_RUNNER_DESCRIPTOR)}\n`);
}
