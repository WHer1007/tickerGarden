package tokendetail

import "fmt"

// ConfiguredDune keeps indexer-only deployments independent of saved credentials.
// Dune polling requires an explicit mode as well as a complete query/key pair.
func ConfiguredDune(mode, queryID, key string) (*Dune, error) {
	switch mode {
	case "", "indexer":
		return nil, nil
	case "dune-first":
		return NewDune(queryID, key)
	default:
		return nil, fmt.Errorf("TG_TOKEN_DETAIL_SOURCE must be indexer or dune-first")
	}
}
