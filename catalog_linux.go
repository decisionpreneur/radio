//go:build linux

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"os"
	"sort"
	"strings"
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
		} else if strings.TrimSpace(item.Smarttag) != "" {
			items[item.ID] = applyPathIdentity(item)
		}
	}
	return items, scanner.Err()
}

func replaceTrackIndex(path string, items map[string]track) (returnErr error) {
	if len(items) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	file, err := os.OpenFile(path, os.O_RDWR, 0o600)
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
	if err := file.Truncate(0); err != nil {
		return err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	ids := make([]string, 0, len(items))
	for id := range items {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	encoder := json.NewEncoder(file)
	for _, id := range ids {
		if err := encoder.Encode(items[id]); err != nil {
			return err
		}
	}
	return nil
}

func loadPlaylists(path string) (state playlistStore, returnErr error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return playlistStore{}, nil
	}
	if err != nil {
		return playlistStore{}, err
	}
	defer func() {
		if err := file.Close(); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_SH); err != nil {
		return playlistStore{}, err
	}
	defer func() {
		if err := syscall.Flock(int(file.Fd()), syscall.LOCK_UN); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	err = json.NewDecoder(file).Decode(&state)
	if errors.Is(err, io.EOF) {
		return playlistStore{}, nil
	}
	return state, err
}

func writePlaylists(path string, state playlistStore) (returnErr error) {
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
	return json.NewEncoder(file).Encode(state)
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
