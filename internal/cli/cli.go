package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/dalsoop/save-my-claude-token/internal/analyzer"
)

func Run(args []string, stdout, stderr io.Writer) error {
	command := "scan"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command = args[0]
		args = args[1:]
	}
	switch command {
	case "scan":
		return runScan(args, stdout)
	case "hook":
		return runHook(args, stdout)
	case "help", "-h", "--help":
		printUsage(stdout)
		return nil
	default:
		return fmt.Errorf("unknown command %q\n\n%s", command, usageText())
	}
}

func runScan(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("scan", flag.ContinueOnError)
	fs.SetOutput(io.Discard)

	root := fs.String("root", analyzer.DefaultClaudeRoot, "Claude projects root to scan")
	last := fs.Duration("last", time.Hour, "Time window to inspect")
	top := fs.Int("top", 3, "Number of sessions to print")
	jsonOutput := fs.Bool("json", false, "Print JSON instead of human-readable text")
	sessionID := fs.String("session", "", "Only inspect a single session id")
	if err := fs.Parse(args); err != nil {
		return err
	}

	report, err := analyzer.Analyze(analyzer.Options{
		Root:      *root,
		Last:      *last,
		Top:       *top,
		SessionID: *sessionID,
	})
	if err != nil {
		return err
	}
	if *jsonOutput {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(report)
	}
	renderText(stdout, report)
	return nil
}

func renderText(w io.Writer, report analyzer.Report) {
	fmt.Fprintf(w, "Risk: %s\n\n", report.Risk)
	fmt.Fprintf(w, "Scanned root: %s\n", report.ScannedRoot)
	fmt.Fprintf(w, "Window: last %s\n", report.Window)
	fmt.Fprintf(w, "Sessions analyzed: %d\n", report.SessionCount)
	fmt.Fprintf(w, "Entries scanned: %d\n", report.EntryCount)

	if len(report.TopSessions) == 0 {
		fmt.Fprintln(w, "\nNo Claude session files were found.")
		return
	}

	fmt.Fprintln(w, "\nTop issues")
	for _, session := range report.TopSessions {
		fmt.Fprintf(w, "- [%s] %s\n", session.Risk, truncateID(session.SessionID))
		fmt.Fprintf(w, "  reused for %s, last seen %s\n", session.Duration, session.LastSeen.Format(time.RFC3339))
		fmt.Fprintf(w, "  last %s: cache-read=%s, input=%s, output=%s, responses=%d\n",
			report.Window,
			humanTokens(session.WindowCacheRead),
			humanTokens(session.WindowInputTokens),
			humanTokens(session.WindowOutputTokens),
			session.WindowAssistantCount,
		)
		fmt.Fprintf(w, "  avg cache-read per response: %s\n", humanTokens(session.WindowAvgCacheRead))
		fmt.Fprintf(w, "  events=%d, tool_results=%d, tool_chars=%s\n", session.TotalEventCount, session.TotalToolResultCount, humanTokens(session.TotalToolResultChars))
		fmt.Fprintf(w, "  reason: %s\n", session.Reason)
	}

	fmt.Fprintln(w, "\nInterpretation")
	for _, line := range report.Interpretation {
		fmt.Fprintf(w, "- %s\n", line)
	}

	fmt.Fprintln(w, "\nRecommended actions")
	for _, line := range report.Recommendations {
		fmt.Fprintf(w, "- %s\n", line)
	}
}

func usageText() string {
	return `save-my-claude-token

Usage:
  save-my-claude-token scan [--root ~/.claude/projects] [--last 1h] [--top 3] [--json]
  save-my-claude-token hook claude-guard [--max-cache-read 1000000] [--max-events 1000]

Commands:
  scan    Analyze Claude Code session logs and flag session bloat
  hook    Claude Code hook helpers
  help    Show this help`
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, usageText())
}

func truncateID(id string) string {
	if len(id) <= 12 {
		return id
	}
	return id[:12] + "..."
}

func humanTokens(v int64) string {
	switch {
	case v >= 1_000_000_000:
		return fmt.Sprintf("%.1fB", float64(v)/1_000_000_000)
	case v >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(v)/1_000_000)
	case v >= 1_000:
		return fmt.Sprintf("%.1fk", float64(v)/1_000)
	default:
		return fmt.Sprintf("%d", v)
	}
}

type hookPayload struct {
	SessionID      string `json:"session_id"`
	TranscriptPath string `json:"transcript_path"`
	HookEventName  string `json:"hook_event_name"`
	Cwd            string `json:"cwd"`
}

type hookResponse struct {
	Continue       bool   `json:"continue"`
	StopReason     string `json:"stopReason,omitempty"`
	SystemMessage  string `json:"systemMessage,omitempty"`
	SuppressOutput bool   `json:"suppressOutput,omitempty"`
}

func runHook(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("missing hook name\n\n%s", usageText())
	}
	switch args[0] {
	case "claude-guard":
		return runClaudeGuard(args[1:], stdout)
	default:
		return fmt.Errorf("unknown hook %q", args[0])
	}
}

func runClaudeGuard(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("claude-guard", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	maxCacheRead := fs.Int64("max-cache-read", 1_000_000, "Block when cache-read tokens in the window exceed this value")
	maxEvents := fs.Int("max-events", 1000, "Block when total event count exceeds this value and risk is not OK")
	last := fs.Duration("last", time.Hour, "Time window to inspect")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var payload hookPayload
	if err := json.NewDecoder(os.Stdin).Decode(&payload); err != nil {
		return err
	}

	response := hookResponse{
		Continue:       true,
		SuppressOutput: true,
	}
	if payload.TranscriptPath == "" {
		return json.NewEncoder(stdout).Encode(response)
	}

	report, err := analyzer.Analyze(analyzer.Options{
		Files:     []string{payload.TranscriptPath},
		Last:      *last,
		Top:       1,
		SessionID: payload.SessionID,
	})
	if err != nil {
		response.SystemMessage = "save-my-claude-token hook could not inspect the current transcript"
		return json.NewEncoder(stdout).Encode(response)
	}
	if len(report.TopSessions) == 0 {
		return json.NewEncoder(stdout).Encode(response)
	}

	session := report.TopSessions[0]
	switch {
	case session.WindowCacheRead >= *maxCacheRead || (session.Risk != "OK" && session.TotalEventCount >= *maxEvents):
		response.Continue = false
		response.StopReason = fmt.Sprintf(
			"Blocked by save-my-claude-token: session %s looks bloated (%s cache-read in last %s, %d events). Start a fresh Claude session or use non-persistent automation.",
			truncateID(session.SessionID),
			humanTokens(session.WindowCacheRead),
			report.Window,
			session.TotalEventCount,
		)
		response.SystemMessage = session.Reason
	case session.Risk == "WARN":
		response.SystemMessage = fmt.Sprintf(
			"save-my-claude-token warning: session %s is growing (%s cache-read in last %s, %d events). Consider rotating it soon.",
			truncateID(session.SessionID),
			humanTokens(session.WindowCacheRead),
			report.Window,
			session.TotalEventCount,
		)
	}
	return json.NewEncoder(stdout).Encode(response)
}
