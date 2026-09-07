//go:build !linux

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
)

func loadTracks(path string) (map[string]track, error) {
	items := map[string]track{}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return items, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), 16<<20)
	for scanner.Scan() {
		var item track
		if err := json.Unmarshal(scanner.Bytes(), &item); err != nil {
			return nil, err
		}
		if item.Deleted {
			delete(items, item.ID)
		} else {
			items[item.ID] = item
		}
	}
	return items, scanner.Err()
}

func appendTrack(path string, item track) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	return json.NewEncoder(file).Encode(item)
}
