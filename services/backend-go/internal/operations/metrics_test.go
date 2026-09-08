package operations

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestPipelineMetrics(t *testing.T) {
	for _, mode := range []string{"healthy", "missing", "invalid label", "duplicate", "negative count", "RPC"} {
		t.Run(mode, func(t *testing.T) {
			now := time.Unix(1800000000, 0)
			s := healthyStatus(now, Stage{Name: "journal", Height: u64(105), Canonical: true}, Stage{Name: "discovery", Height: u64(100), Canonical: true}, Stage{Name: "projection", Height: u64(99), Canonical: true}, Stage{Name: "publication", Height: u64(98), Canonical: true})
			s.ChainID = 46630
			if mode == "missing" {
				s.Stages[2].Height = nil
				s.PrincipalMissing = nil
			}
			s = Evaluate(s, u64(100), 5, time.Hour)
			switch mode {
			case "invalid label":
				s.Stages[0].Name = "secret-wallet"
			case "duplicate":
				s.Stages = append(s.Stages, s.Stages[0])
			case "negative count":
				s.PrincipalFailed = i(-1)
			case "RPC":
				s.RPC = &RPCStatus{ObservedAt: now, IdentityVerified: true, LatestBlock: "106", FinalizedBlock: "100"}
			}
			data, e := Metrics(s)
			valid := mode == "healthy" || mode == "missing" || mode == "RPC"
			if (e == nil) != valid {
				t.Fatal(mode, e)
			}
			if !valid {
				if len(data) != 0 {
					t.Fatal("partial metrics")
				}
				return
			}
			text := string(data)
			if strings.Contains(text, "secret") || strings.Contains(text, "genesis") || strings.Contains(text, "0x") {
				t.Fatal(text)
			}
			if mode == "missing" {
				if !strings.Contains(text, `stage_present{chain_id="46630",stage="projection"} 0`) || strings.Contains(text, `stage_height{chain_id="46630",stage="projection"}`) || strings.Contains(text, "pipeline_principal_missing_probes") {
					t.Fatal("missing became zero", text)
				}
			}
			if tool := os.Getenv("TG_TEST_PROMTOOL"); tool != "" {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				command := exec.CommandContext(ctx, tool, "check", "metrics")
				command.Stdin = bytes.NewReader(data)
				out, e := command.CombinedOutput()
				if e != nil || strings.TrimSpace(string(out)) != "" {
					t.Fatal(e, string(out))
				}
			}
		})
	}
}

func TestStatusPrometheusRequiresDatabase(t *testing.T) {
	var out, errOut bytes.Buffer
	code := Run(context.Background(), []string{"--once", "--prometheus"}, func(string) string { return "" }, &out, &errOut)
	if code != 1 || out.Len() != 0 || !strings.Contains(errOut.String(), "TG_STATUS_DATABASE_URL") {
		t.Fatal(code, out.String(), errOut.String())
	}
}

func TestReceiptRootMetric(t *testing.T) {
	for _, count := range []*int{nil, i(0), i(7), i(-1)} {
		s := healthyStatus(time.Now(), Stage{Name: "journal"}, Stage{Name: "discovery"}, Stage{Name: "projection"}, Stage{Name: "publication"})
		s.ChainID = 46630
		s.ReceiptRootMissing = count
		raw, err := Metrics(s)
		if count != nil && *count < 0 {
			if err == nil {
				t.Fatal("negative backlog")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		prefix := "tickergarden_pipeline_receipt_root_missing_blocks{chain_id=\"46630\"} "
		if count == nil {
			if strings.Contains(string(raw), prefix) {
				t.Fatal("unknown became zero")
			}
		} else if !strings.Contains(string(raw), prefix+strconv.Itoa(*count)+"\n") {
			t.Fatal(string(raw))
		}
	}
}
