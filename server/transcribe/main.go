// Command transcribe is Collate's optional speech-to-text service. The site's
// /api/transcribe route passes recordings on to it (TRANSCRIBE_URL).
//
// The browser can transcribe recordings itself (Whisper tiny, in a worker),
// but on slower machines that takes a while. With the reader's consent, it can
// send the recordings here instead: 16 kHz mono WAV, the same sound it already
// decoded. The service runs whisper.cpp (C++, on every core, with Metal or
// CUDA where it was built with them) with a larger model, and sends back the
// text with each word's time.
//
// Nothing is kept: each recording is written to a private temporary folder,
// transcribed, and the folder is removed before the answer is sent. The
// recordings' contents are never logged.
//
// Configuration, from the environment:
//
//	ADDR             where to listen (default 127.0.0.1:8787: this machine only, for the site's
//	                 /api/transcribe to call; set it to :8787 to be called from elsewhere)
//	WHISPER_BIN      the whisper.cpp command-line program (default whisper-cli)
//	WHISPER_MODEL    the ggml model file (default models/ggml-base.bin)
//	WHISPER_THREADS  threads per transcription (default: the cores, shared by the workers)
//	WORKERS          transcriptions at once; more wait their turn (default 2)
//	ALLOWED_ORIGINS  comma-separated origins allowed to call it (default: local development)
//	MAX_MINUTES      the longest recording accepted (default 30)
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	cfg := configFromEnv()
	if _, err := os.Stat(cfg.Model); err != nil {
		log.Fatalf("the model %q can't be read: %v (run `npm run server:model` to download one)", cfg.Model, err)
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           newServer(cfg, whisperCLI{bin: cfg.Bin, model: cfg.Model, threads: cfg.Threads}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("transcribing with %s on %s (%d at once)", cfg.Model, cfg.Addr, cfg.Workers)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

type config struct {
	Addr       string
	Bin        string
	Model      string
	Threads    int
	Workers    int
	Origins    []string
	MaxSeconds int
}

func configFromEnv() config {
	workers := envInt("WORKERS", 2)
	return config{
		Addr:       env("ADDR", "127.0.0.1:8787"),
		Bin:        env("WHISPER_BIN", "whisper-cli"),
		Model:      env("WHISPER_MODEL", "models/ggml-base.bin"),
		Workers:    workers,
		Threads:    envInt("WHISPER_THREADS", max(1, runtime.NumCPU()/workers)),
		Origins:    strings.Split(env("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:4174,http://127.0.0.1:3000,http://127.0.0.1:4174"), ","),
		MaxSeconds: envInt("MAX_MINUTES", 30) * 60,
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}
