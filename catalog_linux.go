//go:build linux

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"syscall"
)

func loadTracks(path string) (items map[string]track, returnErr error) {
	items = map[string]track{}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return items, nil
	}
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := file.Close(); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_SH); err != nil {
		return nil, err
	}
	defer func() {
		if err := syscall.Flock(int(file.Fd()), syscall.LOCK_UN); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
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
			items[item.ID] = applyPathIdentity(item)
		}
	}
	return items, scanner.Err()
}

func loadPlaylists(path string) (items map[string]playlist, returnErr error) {
	items = map[string]playlist{}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return items, nil
	}
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := file.Close(); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_SH); err != nil {
		return nil, err
	}
	defer func() {
		if err := syscall.Flock(int(file.Fd()), syscall.LOCK_UN); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), 64<<20)
	for scanner.Scan() {
		var item playlist
		if err := json.Unmarshal(scanner.Bytes(), &item); err != nil {
			return nil, err
		}
		items[playlistKey(item)] = item
	}
	return items, scanner.Err()
}

func writePlaylists(path string, items map[string]playlist) (returnErr error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if err := file.Close(); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer func() {
		if err := syscall.Flock(int(file.Fd()), syscall.LOCK_UN); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	encoder := json.NewEncoder(file)
	for _, key := range keys {
		if err := encoder.Encode(items[key]); err != nil {
			return err
		}
	}
	return nil
}

func appendTrack(path string, item track) (returnErr error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if err := file.Close(); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer func() {
		if err := syscall.Flock(int(file.Fd()), syscall.LOCK_UN); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	return json.NewEncoder(file).Encode(item)
}
