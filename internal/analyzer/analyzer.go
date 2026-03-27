package analyzer

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	DefaultClaudeRoot = "~/.claude/projects"
)

type Options struct {
	Root      string
	Files     []string
	Now       time.Time
	Last      time.Duration
	Top       int
	SessionID string
}

type Report struct {
	GeneratedAt     time.Time       `json:"generated_at"`
	ScannedRoot     string          `json:"scanned_root"`
	Window          string          `json:"window"`
	Risk            string          `json:"risk"`
	SessionCount    int             `json:"session_count"`
	EntryCount      int             `json:"entry_count"`
	TopSessions     []SessionReport `json:"top_sessions"`
	Interpretation  []string        `json:"interpretation"`
	Recommendations []string        `json:"recommendations"`
}

type SessionReport struct {
	SessionID            string    `json:"session_id"`
	FilePath             string    `json:"file_path"`
	FirstSeen            time.Time `json:"first_seen"`
	LastSeen             time.Time `json:"last_seen"`
	Duration             string    `json:"duration"`
	WindowAssistantCount int       `json:"window_assistant_count"`
	WindowInputTokens    int64     `json:"window_input_tokens"`
	WindowCacheCreate    int64     `json:"window_cache_creation_input_tokens"`
	WindowCacheRead      int64     `json:"window_cache_read_input_tokens"`
	WindowOutputTokens   int64     `json:"window_output_tokens"`
	WindowAvgCacheRead   int64     `json:"window_avg_cache_read_tokens"`
	TotalAssistantCount  int       `json:"total_assistant_count"`
	TotalEventCount      int       `json:"total_event_count"`
	TotalToolResultCount int       `json:"total_tool_result_count"`
	TotalToolResultChars int64     `json:"total_tool_result_chars"`
	Risk                 string    `json:"risk"`
	Reason               string    `json:"reason"`
}

type rawEntry struct {
	Type      string    `json:"type"`
	SessionID string    `json:"sessionId"`
	Timestamp time.Time `json:"timestamp"`
	Message   *struct {
		Usage *struct {
			InputTokens              int64 `json:"input_tokens"`
			CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
			CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
			OutputTokens             int64 `json:"output_tokens"`
		} `json:"usage"`
	} `json:"message"`
	Content string `json:"content"`
}

type sessionAccumulator struct {
	SessionID            string
	FilePath             string
	FirstSeen            time.Time
	LastSeen             time.Time
	TotalEventCount      int
	TotalAssistantCount  int
	TotalToolResultCount int
	TotalToolResultChars int64

	WindowAssistantCount int
	WindowInputTokens    int64
	WindowCacheCreate    int64
	WindowCacheRead      int64
	WindowOutputTokens   int64
}

func Analyze(opts Options) (Report, error) {
	root, err := expandHome(opts.Root)
	if err != nil {
		return Report{}, err
	}
	if root == "" {
		root = mustExpandHome(DefaultClaudeRoot)
	}
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	window := opts.Last
	if window <= 0 {
		window = time.Hour
	}
	top := opts.Top
	if top <= 0 {
		top = 3
	}

	accs := map[string]*sessionAccumulator{}
	entryCount := 0
	if len(opts.Files) > 0 {
		for _, path := range opts.Files {
			if err := scanFile(path, now.Add(-window), opts.SessionID, accs, &entryCount); err != nil {
				return Report{}, err
			}
		}
	} else {
		err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() || !strings.HasSuffix(path, ".jsonl") {
				return nil
			}
			return scanFile(path, now.Add(-window), opts.SessionID, accs, &entryCount)
		})
		if err != nil {
			return Report{}, err
		}
	}
	if len(accs) == 0 {
		return Report{
			GeneratedAt: now,
			ScannedRoot: root,
			Window:      window.String(),
			Risk:        "OK",
		}, nil
	}

	sessions := make([]SessionReport, 0, len(accs))
	for _, acc := range accs {
		sessions = append(sessions, finalizeSession(acc))
	}
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].WindowCacheRead == sessions[j].WindowCacheRead {
			return sessions[i].LastSeen.After(sessions[j].LastSeen)
		}
		return sessions[i].WindowCacheRead > sessions[j].WindowCacheRead
	})
	if len(sessions) > top {
		sessions = sessions[:top]
	}

	report := Report{
		GeneratedAt:  now,
		ScannedRoot:  root,
		Window:       window.String(),
		Risk:         sessions[0].Risk,
		SessionCount: len(accs),
		EntryCount:   entryCount,
		TopSessions:  sessions,
	}
	report.Interpretation = buildInterpretation(report)
	report.Recommendations = buildRecommendations(report)
	return report, nil
}

func scanFile(path string, windowStart time.Time, sessionFilter string, accs map[string]*sessionAccumulator, entryCount *int) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, 8*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		*entryCount++

		var entry rawEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		sessionID := entry.SessionID
		if sessionID == "" {
			sessionID = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		}
		if sessionFilter != "" && sessionID != sessionFilter {
			continue
		}
		acc := accs[sessionID]
		if acc == nil {
			acc = &sessionAccumulator{
				SessionID: sessionID,
				FilePath:  path,
			}
			accs[sessionID] = acc
		}
		acc.TotalEventCount++
		if !entry.Timestamp.IsZero() {
			if acc.FirstSeen.IsZero() || entry.Timestamp.Before(acc.FirstSeen) {
				acc.FirstSeen = entry.Timestamp
			}
			if acc.LastSeen.IsZero() || entry.Timestamp.After(acc.LastSeen) {
				acc.LastSeen = entry.Timestamp
			}
		}
		switch entry.Type {
		case "assistant":
			acc.TotalAssistantCount++
			if entry.Timestamp.Before(windowStart) {
				continue
			}
			if entry.Message == nil || entry.Message.Usage == nil {
				continue
			}
			acc.WindowAssistantCount++
			acc.WindowInputTokens += entry.Message.Usage.InputTokens
			acc.WindowCacheCreate += entry.Message.Usage.CacheCreationInputTokens
			acc.WindowCacheRead += entry.Message.Usage.CacheReadInputTokens
			acc.WindowOutputTokens += entry.Message.Usage.OutputTokens
		case "tool_result":
			acc.TotalToolResultCount++
			acc.TotalToolResultChars += int64(len(entry.Content))
		}
	}
	return scanner.Err()
}

func finalizeSession(acc *sessionAccumulator) SessionReport {
	avgCacheRead := int64(0)
	if acc.WindowAssistantCount > 0 {
		avgCacheRead = acc.WindowCacheRead / int64(acc.WindowAssistantCount)
	}
	risk, reason := classify(acc, avgCacheRead)
	return SessionReport{
		SessionID:            acc.SessionID,
		FilePath:             acc.FilePath,
		FirstSeen:            acc.FirstSeen,
		LastSeen:             acc.LastSeen,
		Duration:             humanDuration(acc.LastSeen.Sub(acc.FirstSeen)),
		WindowAssistantCount: acc.WindowAssistantCount,
		WindowInputTokens:    acc.WindowInputTokens,
		WindowCacheCreate:    acc.WindowCacheCreate,
		WindowCacheRead:      acc.WindowCacheRead,
		WindowOutputTokens:   acc.WindowOutputTokens,
		WindowAvgCacheRead:   avgCacheRead,
		TotalAssistantCount:  acc.TotalAssistantCount,
		TotalEventCount:      acc.TotalEventCount,
		TotalToolResultCount: acc.TotalToolResultCount,
		TotalToolResultChars: acc.TotalToolResultChars,
		Risk:                 risk,
		Reason:               reason,
	}
}

func classify(acc *sessionAccumulator, avgCacheRead int64) (string, string) {
	switch {
	case acc.WindowCacheRead >= 1_000_000:
		return "HIGH", "cache-read tokens exceeded 1M in the selected window"
	case acc.WindowAssistantCount >= 20 && avgCacheRead >= 100_000:
		return "HIGH", "many assistant responses reused a very large cached context"
	case acc.TotalEventCount >= 1_000 && acc.WindowCacheRead >= 500_000:
		return "HIGH", "a very long-lived session is still driving heavy cache re-reads"
	case acc.WindowCacheRead >= 100_000:
		return "WARN", "cache-read tokens are elevated in the selected window"
	case avgCacheRead >= 50_000:
		return "WARN", "average cache-read per assistant response is high"
	case acc.TotalEventCount >= 500:
		return "WARN", "session history is already large enough to deserve rotation"
	default:
		return "OK", "no obvious session bloat signal was detected"
	}
}

func buildInterpretation(report Report) []string {
	if len(report.TopSessions) == 0 {
		return []string{"No Claude session files were found in the selected root."}
	}
	top := report.TopSessions[0]
	lines := []string{}
	if top.WindowCacheRead > top.WindowInputTokens {
		lines = append(lines, "Most of the reported usage is cache re-read, not freshly typed prompt input.")
	}
	if top.WindowAssistantCount > 0 && top.WindowAvgCacheRead > 0 {
		lines = append(lines, fmt.Sprintf("The top session reused about %s cached tokens per assistant response.", formatInt(top.WindowAvgCacheRead)))
	}
	if top.TotalEventCount >= 500 {
		lines = append(lines, "This session has grown large enough that continuing it in place is likely to keep inflating usage.")
	}
	return lines
}

func buildRecommendations(report Report) []string {
	lines := []string{
		"Run Claude with --no-session-persistence for non-interactive automation loops.",
		"Restart or rotate the bloated session instead of continuing it indefinitely.",
	}
	if len(report.TopSessions) > 0 && report.TopSessions[0].Risk != "OK" {
		lines = append(lines, "If you wrap Claude in another tool, add a safe default that starts a fresh session per task.")
	}
	return lines
}

func expandHome(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if !strings.HasPrefix(path, "~/") && path != "~" {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", errors.New("cannot resolve home directory")
	}
	if path == "~" {
		return home, nil
	}
	return filepath.Join(home, path[2:]), nil
}

func mustExpandHome(path string) string {
	expanded, err := expandHome(path)
	if err != nil {
		return path
	}
	return expanded
}

func humanDuration(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	if d < time.Minute {
		return d.Round(time.Second).String()
	}
	if d < 24*time.Hour {
		return d.Round(time.Minute).String()
	}
	return d.Round(time.Hour).String()
}

func formatInt(v int64) string {
	sign := ""
	if v < 0 {
		sign = "-"
		v = -v
	}
	s := fmt.Sprintf("%d", v)
	if len(s) <= 3 {
		return sign + s
	}
	var parts []string
	for len(s) > 3 {
		parts = append([]string{s[len(s)-3:]}, parts...)
		s = s[:len(s)-3]
	}
	parts = append([]string{s}, parts...)
	return sign + strings.Join(parts, ",")
}
