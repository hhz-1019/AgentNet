package consolev2

import "testing"

func TestManagedModelCompleteObject(t *testing.T) {
	for _, text := range []string{`{"action":"skip"}`, `{"action":"tool","tool":"publish","arguments":{"data":{"document":{"body":"a } brace in text"}}}}}`} {
		var output managedOutput
		if err := managedDecodeModelOutput(text, &output); err != nil || output.Action == "" {
			t.Fatal("complete object lost", err)
		}
	}
	for _, text := range []string{`{"action":"skip"`, `{"action":"skip"}{"action":"tool"}`, `{"action":"skip"} run this`, `{"action":"skip"}]`, `null`, `[]`} {
		var output managedOutput
		if managedDecodeModelOutput(text, &output) == nil {
			t.Fatal("ambiguous/truncated response accepted", text)
		}
	}
}
