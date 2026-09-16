package readmodel

import (
	"encoding/json"
	"errors"
	"math/big"
	"reflect"
	"strconv"
	"strings"
	"tickergarden/backend/internal/deployment"
)

// AccountCandidate retains asset-level principal even without a market position.
// This is an internal candidate model; a public account API is a separate contract.
type AccountCandidate struct {
	User      string      `json:"user"`
	AssetUID  string      `json:"assetUid"`
	Vault     string      `json:"vault"`
	Deposited string      `json:"deposited"`
	Allocated string      `json:"allocated"`
	Free      string      `json:"free"`
	Source    SourceBlock `json:"source"`
}

func BuildAccountCandidate(batch deployment.ObservationBatch, assetUID, user string, assetSource, source SourceBlock) (AccountCandidate, error) {
	fail := func() (AccountCandidate, error) {
		return AccountCandidate{}, errors.New("incomplete or inconsistent account candidate")
	}
	asset, e := BuildConfigCandidate(batch, "asset", assetUID, assetSource)
	if e != nil {
		return fail()
	}
	if !candidateAddress.MatchString(user) || user == "0x"+strings.Repeat("0", 40) {
		return fail()
	}
	var v map[string]any
	for _, o := range batch.Observations {
		if o.Kind == "vaultPosition" && o.Key == assetUID+":"+user {
			v = o.Value
		}
	}
	if v == nil || !reflect.DeepEqual(v["user"], user) || !reflect.DeepEqual(v["assetUid"], assetUID) || !reflect.DeepEqual(v["vault"], asset.Values["userStockVault"]) {
		return fail()
	}
	values := []string{}
	for _, field := range []string{"deposited", "allocated", "freeBalanceOf"} {
		n, ok := candidateScalar(v[field], "uint256")
		if !ok {
			return fail()
		}
		values = append(values, n.(string))
	}
	deposited, _ := raw(values[0])
	allocated, _ := raw(values[1])
	free, _ := raw(values[2])
	if deposited.Cmp(new(big.Int).Add(allocated, free)) != 0 {
		return fail()
	}
	height, _ := strconv.ParseUint(batch.BlockNumber, 0, 64)
	sn, e := Height(source.BlockNumber)
	if e != nil || sn > height || source.ChainID != batch.ChainID || (sn == height && source.BlockHash != batch.BlockHash) {
		return fail()
	}
	encoded, e := json.Marshal(source)
	if e != nil || ValidateResponse("SourceBlock", encoded) != nil {
		return fail()
	}
	return AccountCandidate{User: user, AssetUID: assetUID, Vault: asset.Values["userStockVault"].(string), Deposited: values[0], Allocated: values[1], Free: values[2], Source: source}, nil
}
