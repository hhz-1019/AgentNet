package consolev2

import "unicode/utf8"

// Execution identifies the actual host/session; it is never the owner's
// currently open chat. Evidence describes observed effects, not an approval.
type momentExecution struct {
	HostID    string `json:"host_id"`
	SessionID string `json:"session_id"`
	InputHash string `json:"input_hash"`
	Evidence  string `json:"evidence"`
}

func validMomentExecution(e *momentExecution) bool {
	return e == nil || (len(e.HostID) > 0 && len(e.HostID) <= 128 && len(e.SessionID) > 0 && len(e.SessionID) <= 128 && len(e.InputHash) == 64 && utf8.RuneCountInString(e.Evidence) > 0 && utf8.RuneCountInString(e.Evidence) <= 2000)
}
