package consolev2

import (
	"encoding/json"
	"errors"
	"strings"
)

// Some JSON-mode providers append a duplicate closing brace after a complete
// object. Accept that punctuation only: never invent missing content, accept a
// truncated document, or ignore a second value/instructions after the object.
func managedDecodeModelOutput(raw string, value *managedOutput) error {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "{") {
		return errors.New("object required")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	var complete json.RawMessage
	if err := decoder.Decode(&complete); err != nil {
		return err
	}
	tail := strings.TrimSpace(raw[decoder.InputOffset():])
	if len(tail) > 3 || strings.Trim(tail, "}") != "" {
		return errors.New("extra output")
	}
	return json.Unmarshal(complete, value)
}
