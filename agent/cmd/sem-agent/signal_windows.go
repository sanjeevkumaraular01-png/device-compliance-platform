//go:build windows

package main

import (
	"os"
	"syscall"
)

// termSignal: Ctrl+Break / console close arrive as SIGTERM on Windows.
func termSignal() os.Signal { return syscall.SIGTERM }
