package operations

import (
	"fmt"
	"os"
	"path/filepath"
)

func validMetricsPath(path string) bool {
	return filepath.IsAbs(path) && filepath.Ext(path) == ".prom"
}

// writeMetricsFile keeps the old report until a complete replacement is ready.
// Temporary files are in the target directory and never have a .prom suffix.
func writeMetricsFile(path string, report Status) error {
	if !validMetricsPath(path) {
		return fmt.Errorf("invalid metrics path")
	}
	data, err := Metrics(report)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".backend-status-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, err = f.Write(data); err != nil {
		return err
	}
	if err = f.Chmod(0644); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
