//go:build !linux

package main

import (
	"fmt"
	"os"
)

func openAnonymousFile(string) (*os.File, error) {
	return nil, fmt.Errorf("indexing requires Linux O_TMPFILE")
}
