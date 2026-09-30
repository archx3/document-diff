package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// whisperCLI transcribes with whisper.cpp's command-line program, one word per
// segment (so each word has its own time).
type whisperCLI struct {
	bin     string
	model   string
	threads int
}

// The parts of whisper.cpp's JSON output that are used.
type whisperJSON struct {
	Transcription []struct {
		Offsets struct {
			From int `json:"from"`
			To   int `json:"to"`
		} `json:"offsets"`
		Text string `json:"text"`
	} `json:"transcription"`
}

func (w whisperCLI) Transcribe(ctx context.Context, wavPath, lang string) (Transcript, error) {
	out := filepath.Join(filepath.Dir(wavPath), "out")
	cmd := exec.CommandContext(ctx, w.bin,
		"-m", w.model,
		"-f", wavPath,
		"-l", lang,
		"-t", strconv.Itoa(w.threads),
		// One word per segment, split on words rather than tokens.
		"-ml", "1", "-sow",
		"-oj", "-of", out,
		"-np",
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return Transcript{}, fmt.Errorf("%s: %w: %s", w.bin, err, lastLine(stderr.String()))
	}
	raw, err := os.ReadFile(out + ".json")
	if err != nil {
		return Transcript{}, err
	}
	return parseWhisper(raw)
}

// parseWhisper makes a transcript of whisper.cpp's JSON: words with their times,
// leaving out the markers it puts in for silence and noise ([BLANK_AUDIO], (music) …).
func parseWhisper(raw []byte) (Transcript, error) {
	var j whisperJSON
	if err := json.Unmarshal(raw, &j); err != nil {
		return Transcript{}, err
	}
	t := Transcript{Words: []Word{}}
	var text strings.Builder
	for _, seg := range j.Transcription {
		word := strings.TrimSpace(seg.Text)
		if word == "" || isMarker(word) {
			continue
		}
		// A segment that doesn't start with a space goes on the word before it (a split word, or its punctuation).
		if n := len(t.Words); n > 0 && !strings.HasPrefix(seg.Text, " ") {
			last := &t.Words[n-1]
			last.Text += word
			last.End = float64(seg.Offsets.To) / 1000
			text.WriteString(word)
			continue
		}
		if text.Len() > 0 {
			text.WriteByte(' ')
		}
		text.WriteString(word)
		t.Words = append(t.Words, Word{Text: word, Start: float64(seg.Offsets.From) / 1000, End: float64(seg.Offsets.To) / 1000})
	}
	t.Text = text.String()
	return t, nil
}

func isMarker(s string) bool {
	return (strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]")) || (strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")"))
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return lines[len(lines)-1]
}
