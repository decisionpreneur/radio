//go:build linux

package main

import (
	"fmt"
	"os"
	"syscall"
)

func openAnonymousFile(directory string) (*os.File, error) {
	const oTmpfile = 0x410000
	fd, err := syscall.Open(directory, oTmpfile|syscall.O_RDWR|syscall.O_CLOEXEC, 0o600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "radio-index-audio")
	if file == nil {
		syscall.Close(fd)
		return nil, fmt.Errorf("create unnamed indexing file")
	}
	return file, nil
}
