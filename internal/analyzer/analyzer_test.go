package analyzer

import (
	"path/filepath"
	"testing"
	"time"
)

func TestAnalyzeFlagsHighCacheRead(t *testing.T) {
	report, err := Analyze(Options{
		Root: filepath.Join("..", "..", "testdata", "claude-projects"),
		Now:  time.Date(2026, 3, 27, 14, 0, 0, 0, time.UTC),
		Last: time.Hour,
		Top:  2,
	})
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if report.Risk != "HIGH" {
		t.Fatalf("risk = %q, want HIGH", report.Risk)
	}
	if len(report.TopSessions) == 0 {
		t.Fatal("expected top sessions")
	}
	if got := report.TopSessions[0].WindowCacheRead; got != 1240000 {
		t.Fatalf("WindowCacheRead = %d, want 1240000", got)
	}
}

func TestAnalyzeSessionFilter(t *testing.T) {
	report, err := Analyze(Options{
		Root:      filepath.Join("..", "..", "testdata", "claude-projects"),
		Now:       time.Date(2026, 3, 27, 14, 0, 0, 0, time.UTC),
		Last:      time.Hour,
		Top:       5,
		SessionID: "session-ok",
	})
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if report.SessionCount != 1 {
		t.Fatalf("SessionCount = %d, want 1", report.SessionCount)
	}
	if len(report.TopSessions) != 1 || report.TopSessions[0].SessionID != "session-ok" {
		t.Fatalf("unexpected top sessions: %+v", report.TopSessions)
	}
}
