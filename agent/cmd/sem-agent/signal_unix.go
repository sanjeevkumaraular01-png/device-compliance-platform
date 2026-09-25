//go:build !windows

package main

import (
	"os"
	"syscall"
)

func termSignal() os.Signal { return syscall.SIGTERM }
