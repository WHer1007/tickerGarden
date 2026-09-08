package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func cli(t *testing.T, args ...string) (string, error) {
	c := exec.Command(os.Args[0], "-test.run=TestCLIHelper")
	c.Env = []string{"LANE_STATUS_HELPER=1", "LANE_ARGS=" + strings.Join(args, " ")}
	b, e := c.CombinedOutput()
	return string(b), e
}
func TestCLIHelper(t *testing.T) {
	if os.Getenv("LANE_STATUS_HELPER") != "1" {
		return
	}
	os.Args = []string{"lane-status"}
	os.Args = append(os.Args, strings.Fields(os.Getenv("LANE_ARGS"))...)
	main()
}
func TestDescribeWithoutEnvironment(t *testing.T) {
	o, e := cli(t, "--describe")
	if e != nil || !strings.Contains(o, "lane-status-v1") {
		t.Fatalf("%v %s", e, o)
	}
}
func TestMissingOnceRejected(t *testing.T) {
	o, e := cli(t)
	if e == nil || strings.Contains(o, "postgres://") || strings.Contains(o, "password") {
		t.Fatalf("%v %s", e, o)
	}
}
func TestInvalidDSNSanitized(t *testing.T) {
	c := exec.Command(os.Args[0], "-test.run=^TestCLIHelper$")
	c.Env = []string{"LANE_STATUS_HELPER=1", "LANE_ARGS=--once", "TG_CHAIN_ID=421614", "TG_ACTIVITY_START_BLOCK=10", "TG_MANIFEST_HASH=0x" + strings.Repeat("a", 64), "TG_PROJECTOR_VERSION=event-facts-v1", "TG_STATUS_DATABASE_URL=postgres://user:supersecret@localhost:invalid/database"}
	b, err := c.CombinedOutput()
	o := string(b)
	if err == nil || !strings.Contains(o, "invalid database configuration") || strings.Contains(o, "supersecret") || strings.Contains(o, "postgres://") {
		t.Fatalf("expected sanitized database failure: %v %s", err, o)
	}
}
