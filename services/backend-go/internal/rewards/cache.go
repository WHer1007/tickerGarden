package rewards

import (
	"encoding/json"
	"sync"
	"tickergarden/backend/internal/deployment"
)

// One bounded entry per Store. Bytes prevent callers from mutating the verified
// result. The key includes exact PostgreSQL visibility and server identity, not
// merely a block hash or a TTL. Never use this for snapshots with local writes.
type verifiedCache struct {
	mu      sync.Mutex
	key     string
	payload []byte
	hits    uint64
}

func (c *verifiedCache) get(key string) ([]deployment.StateObservation, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if key == "" || key != c.key {
		return nil, false
	}
	var rows []deployment.StateObservation
	if json.Unmarshal(c.payload, &rows) != nil {
		return nil, false
	}
	c.hits++
	return rows, true
}
func (c *verifiedCache) put(key string, rows []deployment.StateObservation) {
	raw, e := json.Marshal(rows)
	if e != nil || len(raw) > 16<<20 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.key = key
	c.payload = raw
}
