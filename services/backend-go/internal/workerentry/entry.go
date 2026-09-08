// Package workerentry reserves process boundaries without pretending jobs run.
package workerentry

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
)

func Run(name, permission string, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(stderr)
	describe := flags.Bool("describe", false, "print the planned boundary without starting a worker")
	if err := flags.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "unexpected positional arguments")
		return 2
	}
	if !*describe {
		fmt.Fprintln(stderr, name+": worker is not implemented; use --describe to inspect the scaffold")
		return 1
	}
	if err := json.NewEncoder(stdout).Encode(map[string]any{
		"service": name, "stage": "scaffold", "implemented": false,
		"plannedPermission": permission, "signerConfigured": false, "transactionSubmission": false,
	}); err != nil {
		return 1
	}
	return 0
}
