package readmodel

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

type validationKey struct {
	chain  uint64
	digest [32]byte
}

const validationCacheLimit = 32

// Cache only the proof that these exact bytes passed schema and cross-field
// validation for this chain. Never cache journal freshness, canonicality or
// identity observations, and never return a shared decoded snapshot.
func (s *Store) parsePersisted(payload []byte, expected string) (Snapshot, error) {
	sum := sha256.Sum256(payload)
	if hex.EncodeToString(sum[:]) != expected {
		return Snapshot{}, errors.New("persisted snapshot checksum mismatch")
	}
	key := validationKey{s.ChainID, sum}
	s.validationMu.Lock()
	known := s.validated[key]
	s.validationMu.Unlock()
	if known {
		return decodeSnapshot(payload)
	}
	snapshot, err := Parse(payload, s.ChainID)
	if err != nil {
		return Snapshot{}, err
	}
	s.validationMu.Lock()
	defer s.validationMu.Unlock()
	if s.validated == nil {
		s.validated = make(map[validationKey]bool)
	}
	if !s.validated[key] {
		if len(s.validationOrder) == validationCacheLimit {
			delete(s.validated, s.validationOrder[0])
			s.validationOrder = s.validationOrder[1:]
		}
		s.validated[key] = true
		s.validationOrder = append(s.validationOrder, key)
	}
	return snapshot, nil
}
