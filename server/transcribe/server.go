package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Word is one word said, with when it starts and ends (seconds).
type Word struct {
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// Transcript is what was said in a recording.
type Transcript struct {
	Text  string `json:"text"`
	Words []Word `json:"words"`
}

// Transcriber turns a 16 kHz mono WAV file into a transcript.
type Transcriber interface {
	Transcribe(ctx context.Context, wavPath, lang string) (Transcript, error)
}

type server struct {
	cfg   config
	tr    Transcriber
	slots chan struct{}
	mux   *http.ServeMux
}

func newServer(cfg config, tr Transcriber) *server {
	s := &server{cfg: cfg, tr: tr, slots: make(chan struct{}, max(1, cfg.Workers)), mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /v1/health", s.health)
	s.mux.HandleFunc("POST /v1/transcribe", s.transcribe)
	return s
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" {
		if !s.allowed(origin) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Vary", "Origin")
		h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Content-Type")
		h.Set("Access-Control-Max-Age", "600")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.mux.ServeHTTP(w, r)
}

func (s *server) allowed(origin string) bool {
	return slices.ContainsFunc(s.cfg.Origins, func(o string) bool {
		o = strings.TrimSpace(o)
		return o == "*" || strings.EqualFold(o, origin)
	})
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "model": strings.TrimSuffix(filepath.Base(s.cfg.Model), ".bin"), "maxSeconds": s.cfg.MaxSeconds})
}

func (s *server) transcribe(w http.ResponseWriter, r *http.Request) {
	limit := int64(wavHeaderMax + s.cfg.MaxSeconds*sampleRate*2)
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "auto"
	}
	if !validLang(lang) {
		writeError(w, http.StatusBadRequest, "unknown language")
		return
	}

	// Wait for a free worker (as long as the caller does).
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-r.Context().Done():
		return
	}

	dir, path, err := saveWAV(r.Body)
	if dir != "" {
		defer removeAll(dir)
	}
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "the recording is longer than this service accepts")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	began := time.Now()
	t, err := s.tr.Transcribe(ctx, path, lang)
	if err != nil {
		log.Printf("transcription failed: %v", err)
		writeError(w, http.StatusInternalServerError, "the recording could not be transcribed")
		return
	}
	log.Printf("transcribed %d words in %s", len(t.Words), time.Since(began).Round(time.Millisecond))
	writeJSON(w, http.StatusOK, t)
}

func validLang(l string) bool {
	if l == "auto" {
		return true
	}
	if len(l) < 2 || len(l) > 3 {
		return false
	}
	for _, c := range l {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
