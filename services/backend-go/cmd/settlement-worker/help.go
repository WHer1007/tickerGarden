package main

import "io"

const settlementWorkerHelp = `settlement-worker provides planning, observation, signing, submission, and execution-evidence primitives.

Planning and observation:
  --request INPUT.json | --plan INPUT.json
  --observed-request INPUT.json --manifest DEPLOYMENT.json
  --observed-plan INPUT.json --manifest DEPLOYMENT.json
  --preview INPUT.json --manifest DEPLOYMENT.json
  --observe-state INPUT.json --manifest DEPLOYMENT.json
  --quote INPUT.json --manifest DEPLOYMENT.json
  --reference-check INPUT.json --manifest DEPLOYMENT.json [--record] [--evidence-dir DIR]
  --fetch-reference-check INPUT.json --manifest DEPLOYMENT.json [--record] [--evidence-dir DIR]
  --auto-reference-check INPUT.json --manifest DEPLOYMENT.json [--record] [--evidence-dir DIR]
  --check-history SCOPE.json

Intent, signing, and work:
  --prepare-intent SCOPE_AND_JOB.json | --intent SCOPE_AND_JOB.json
  --sign SCOPE_AND_JOB.json | --signed SCOPE_AND_JOB.json | --import-signed RECOVERY.json
  --enqueue WORK.json --manifest DEPLOYMENT.json
  --work-once SCOPE.json | --work-run SCOPE.json

Submission and receipt evidence:
  --submit SUBMISSION.json | --submission SUBMISSION.json
  --observe-receipt RECEIPT.json | --receipt-history RECEIPT.json
  --receipt-events RECEIPT.json
  --receipt-trace RECEIPT.json
  --receipt-gauge-storage RECEIPT.json
  --receipt-liabilities RECEIPT.json
  --receipt-creator-storage RECEIPT.json
  --receipt-accounting RECEIPT.json
  --record-execution-evidence EVIDENCE.json
  --execution-evidence EVIDENCE.json
  --execution-evidence-history EVIDENCE.json

--describe reports capability state. These commands are separate primitives; they do not claim a fully automatic execution state machine. The service reports executionImplemented=false and transactionSubmission=false until the corresponding end-to-end orchestration and runtime configuration are verified.
`

func writeHelp(out io.Writer) error {
	_, err := io.WriteString(out, settlementWorkerHelp)
	return err
}
