package main

import (
	"bufio"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
)

const (
	sampleRate = 16000
	// A WAV header is 44 bytes; a little more allows for extra chunks.
	wavHeaderMax = 1024
)

// checkWAV reads a WAV header and says whether it is what whisper.cpp takes:
// 16-bit PCM, one channel, 16 kHz. It returns the bytes it read, to write
// out again.
func checkWAV(r io.Reader) ([]byte, error) {
	head := make([]byte, 44)
	if _, err := io.ReadFull(r, head); err != nil {
		return nil, errors.New("the recording is not a WAV file")
	}
	if string(head[0:4]) != "RIFF" || string(head[8:12]) != "WAVE" || string(head[12:16]) != "fmt " {
		return nil, errors.New("the recording is not a WAV file")
	}
	format := binary.LittleEndian.Uint16(head[20:22])
	channels := binary.LittleEndian.Uint16(head[22:24])
	rate := binary.LittleEndian.Uint32(head[24:28])
	bits := binary.LittleEndian.Uint16(head[34:36])
	if format != 1 || channels != 1 || rate != sampleRate || bits != 16 {
		return nil, errors.New("the recording must be 16-bit mono PCM at 16 kHz")
	}
	return head, nil
}

// saveWAV checks the upload and writes it to a new private folder. The caller
// removes the folder (dir is set whenever one was made, even on error).
func saveWAV(body io.Reader) (dir, path string, err error) {
	br := bufio.NewReader(body)
	head, err := checkWAV(br)
	if err != nil {
		return "", "", err
	}
	dir, err = os.MkdirTemp("", "collate-transcribe-*")
	if err != nil {
		return "", "", err
	}
	path = filepath.Join(dir, "in.wav")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		return dir, "", err
	}
	defer f.Close()
	if _, err = f.Write(head); err != nil {
		return dir, "", err
	}
	n, err := io.Copy(f, br)
	if err != nil {
		return dir, "", err
	}
	if n < sampleRate/10*2 {
		return dir, "", errors.New("the recording is too short to transcribe")
	}
	return dir, path, f.Close()
}

func removeAll(dir string) { _ = os.RemoveAll(dir) }
