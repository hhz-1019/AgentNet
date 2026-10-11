package consolev2

import "testing"

func TestElsewhereAvatarDraftValidation(t *testing.T) {
	for _, id := range []string{"", "citrus", "bloom", "tide", "sprout", "spark", "orbit"} {
		if err := validatePortraitDraft(portraitDraft{Fields: map[string]string{"avatar": id}}); err != nil {
			t.Fatalf("valid avatar %s: %v", id, err)
		}
	}
	for _, id := range []string{"unknown", "../citrus", "https://example.com", "CITRUS"} {
		if err := validatePortraitDraft(portraitDraft{Fields: map[string]string{"avatar": id}}); err == nil {
			t.Fatalf("invalid avatar accepted: %s", id)
		}
	}
}
