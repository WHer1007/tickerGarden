package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
	"time"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	flags := flag.NewFlagSet("verify-deployment", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	coreFlag := flags.Bool("core-bindings", false, "verify core deployment bindings")
	bootstrapFile := flags.String("bootstrap", "", "verify committed staged-deployment receipt history")
	route := flags.String("market-route", "", "observe canonical PoolKey, route and graduated bindings")
	identity := flags.String("market-identity", "", "observe canonical token name, symbol, URI and deployment time")
	discover := flags.String("discover-block", "", "discover creations in a finalized block (hex quantity)")
	if flags.Parse(os.Args[1:]) != nil || flags.NArg() != 1 || ((*identity != "" && *discover != "") || (*route != "" && (*identity != "" || *discover != ""))) {
		return errors.New("usage: verify-deployment [--core-bindings] [--discover-block BLOCK_HEX | --market-identity MARKET_ID | --market-route MARKET_ID] MANIFEST.json")
	}
	core := *coreFlag || *discover != ""
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	f, e := os.Open(flags.Arg(0))
	if e != nil {
		return errors.New("cannot open deployment manifest")
	}
	defer f.Close()
	data, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if e != nil {
		return errors.New("cannot read deployment manifest")
	}
	manifest, e := deployment.Parse(data)
	if e != nil {
		return e
	}
	if manifest.ChainID != cfg.ChainID {
		return errors.New("manifest and configured chain differ")
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	block, e := rpc.Header(ctx, "finalized")
	if e != nil {
		return e
	}
	if *bootstrapFile != "" {
		if manifest.Bootstrap == nil || *route != "" || *identity != "" || *discover != "" {
			return errors.New("bootstrap verification requires a committed bootstrap scope")
		}
		finalHeight, err := block.Height()
		if err != nil || finalHeight < manifest.Bootstrap.BusinessStartBlock {
			return errors.New("bootstrap is not finalized")
		}
		start, err := rpc.Header(ctx, fmt.Sprintf("0x%x", manifest.Bootstrap.BusinessStartBlock))
		if err != nil {
			return err
		}
		f, err := os.Open(*bootstrapFile)
		if err != nil {
			return errors.New("cannot open bootstrap evidence")
		}
		defer f.Close()
		raw, err := io.ReadAll(io.LimitReader(f, deployment.MaxBootstrapBytes+1))
		if err != nil {
			return errors.New("cannot read bootstrap evidence")
		}
		if err = deployment.VerifyBootstrap(ctx, rpc, manifest, start, raw); err != nil {
			return err
		}
		if _, err = deployment.VerifyCoreBindings(ctx, rpc, manifest, start); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "deployment_bootstrap_verified", "chainId": manifest.ChainID, "deploymentStartBlock": manifest.Bootstrap.DeploymentStartBlock, "businessStartBlock": manifest.Bootstrap.BusinessStartBlock, "evidenceHash": manifest.Bootstrap.EvidenceHash, "transactionSubmission": false})
	}
	if *route != "" {
		observation, err := deployment.ObserveMarketRoute(ctx, rpc, manifest, block, *route)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "market_route_observed", "observation": observation, "transactionSubmission": false, "protocolBindingsVerified": false})
	}
	if *identity != "" {
		observation, err := deployment.ObserveMarketIdentity(ctx, rpc, manifest, block, *identity)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "market_identity_observed", "observation": observation, "transactionSubmission": false})
	}
	if *discover != "" {
		height, err := chainrpc.Quantity(*discover)
		finalizedHeight, finalErr := block.Height()
		if err != nil || finalErr != nil || height > finalizedHeight {
			return errors.New("discovery requires a canonical finalized block quantity")
		}
		block, err = rpc.Header(ctx, *discover)
		if err != nil {
			return err
		}
		if block.Number != *discover {
			return errors.New("discovery block number mismatch")
		}
		markets, err := deployment.DiscoverBlock(ctx, rpc, manifest, block)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{
			"status": "markets_discovered", "chainId": manifest.ChainID,
			"blockNumber": block.Number, "blockHash": block.Hash, "markets": markets,
			"coreBindingsVerified": true, "protocolBindingsVerified": false, "transactionSubmission": false,
		})
	}
	status := "runtime_identities_verified"
	if core {
		_, e = deployment.VerifyCoreBindings(ctx, rpc, manifest, block)
		status = "core_runtime_bindings_verified"
	} else {
		_, e = deployment.Verify(ctx, rpc, manifest, block)
	}
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": status, "blockNumber": block.Number, "blockHash": block.Hash, "contracts": len(manifest.Contracts), "coreBindingsVerified": core, "protocolBindingsVerified": false, "transactionSubmission": false})
}
