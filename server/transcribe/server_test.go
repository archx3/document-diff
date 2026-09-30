package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// fakeTranscriber answers without whisper.cpp, and remembers what it was given.
type fakeTranscriber struct {
	path string
	lang string
}

func (f *fakeTranscriber) Transcribe(_ context.Context, path, lang string) (Transcript, error) {
	f.path, f.lang = path, lang
	if _, err := os.Stat(path); err != nil {
		return Transcript{}, err
	}
	return Transcript{Text: "hello there", Words: []Word{{"hello", 0, 0.4}, {"there", 0.5, 0.9}}}, nil
}

func wav(seconds float64, rate uint32, channels uint16) []byte {
	n := int(seconds * float64(rate))
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+n*2*int(channels)))
	b.WriteString("WAVEfmt ")
	_ = binary.Write(&b, binary.LittleEndian, uint32(16))
	_ = binary.Write(&b, binary.LittleEndian, uint16(1))
	_ = binary.Write(&b, binary.LittleEndian, channels)
	_ = binary.Write(&b, binary.LittleEndian, rate)
	_ = binary.Write(&b, binary.LittleEndian, rate*uint32(channels)*2)
	_ = binary.Write(&b, binary.LittleEndian, channels*2)
	_ = binary.Write(&b, binary.LittleEndian, uint16(16))
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(n*2*int(channels)))
	b.Write(make([]byte, n*2*int(channels)))
	return b.Bytes()
}

func testServer(t *testing.T) (*server, *fakeTranscriber) {
	t.Helper()
	f := &fakeTranscriber{}
	cfg := config{Model: "models/ggml-base.bin", Workers: 1, Origins: []string{"http://localhost:4174"}, MaxSeconds: 60}
	return newServer(cfg, f), f
}

func TestTranscribes(t *testing.T) {
	s, f := testServer(t)
	req := httptest.NewRequest("POST", "/v1/transcribe?lang=en", bytes.NewReader(wav(1, 16000, 1)))
	req.Header.Set("Origin", "http://localhost:4174")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var got Transcript
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || len(got.Words) != 2 || got.Text != "hello there" {
		t.Fatalf("got %+v (%v)", got, err)
	}
	if f.lang != "en" {
		t.Errorf("lang %q", f.lang)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:4174" {
		t.Errorf("no CORS header")
	}
	// Nothing is kept.
	if _, err := os.Stat(f.path); !os.IsNotExist(err) {
		t.Errorf("the recording was left at %s", f.path)
	}
}

func TestRefuses(t *testing.T) {
	s, _ := testServer(t)
	cases := []struct {
		name   string
		body   []byte
		origin string
		query  string
		status int
	}{
		{"another origin", wav(1, 16000, 1), "https://example.com", "", http.StatusForbidden},
		{"not a WAV", []byte(strings.Repeat("x", 100)), "", "", http.StatusBadRequest},
		{"the wrong rate", wav(1, 44100, 1), "", "", http.StatusBadRequest},
		{"stereo", wav(1, 16000, 2), "", "", http.StatusBadRequest},
		{"too long", wav(61, 16000, 1), "", "", http.StatusRequestEntityTooLarge},
		{"a strange language", wav(1, 16000, 1), "", "?lang=../x", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/v1/transcribe"+c.query, bytes.NewReader(c.body))
			if c.origin != "" {
				req.Header.Set("Origin", c.origin)
			}
			rec := httptest.NewRecorder()
			s.ServeHTTP(rec, req)
			if rec.Code != c.status {
				t.Fatalf("status %d, want %d: %s", rec.Code, c.status, rec.Body)
			}
		})
	}
}

func TestPreflightAndHealth(t *testing.T) {
	s, _ := testServer(t)
	req := httptest.NewRequest("OPTIONS", "/v1/transcribe", nil)
	req.Header.Set("Origin", "http://localhost:4174")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("preflight: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/health", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"model":"ggml-base"`) {
		t.Fatalf("health: %d %s", rec.Code, rec.Body)
	}
}

func TestParseWhisper(t *testing.T) {
	raw := []byte(`{"transcription":[
		{"offsets":{"from":0,"to":320},"text":" Welcome"},
		{"offsets":{"from":320,"to":500},"text":" to"},
		{"offsets":{"from":500,"to":900},"text":" Collate"},
		{"offsets":{"from":900,"to":950},"text":"."},
		{"offsets":{"from":950,"to":2000},"text":" [BLANK_AUDIO]"},
		{"offsets":{"from":2000,"to":2300},"text":" Bye"}
	]}`)
	got, err := parseWhisper(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Text != "Welcome to Collate. Bye" {
		t.Errorf("text %q", got.Text)
	}
	if len(got.Words) != 4 || got.Words[2].Text != "Collate." || got.Words[2].End != 0.95 || got.Words[3].Start != 2 {
		t.Errorf("words %+v", got.Words)
	}
}
