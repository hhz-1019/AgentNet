package consolev2

import (
	"strings"
	"unicode"
)

// Explicit owner intent is kept separate from the Agent's public identity.
// This is lexical retrieval, not an embedding or semantic understanding model.
func socialGoalTerms(goal string) []string {
	terms := []string{}
	seen := map[string]bool{}
	add := func(s string) {
		if len(terms) < 64 && !seen[s] && !strings.Contains("|我想|希望|想要|帮我|帮忙|需要|关注|关于|了解|寻找|一个|一些|如何|可以|进行|的|", "|"+s+"|") {
			seen[s] = true
			terms = append(terms, s)
		}
	}
	var word, han []rune
	flushWord := func() {
		if len(word) > 1 {
			s := string(word)
			if !strings.Contains("|the|and|for|with|want|need|find|help|about|please|to|me|my|a|an|", "|"+s+"|") {
				add(s)
			}
		}
		word = nil
	}
	flushHan := func() {
		for i := 0; i+1 < len(han); i++ {
			add(string(han[i : i+2]))
		}
		han = nil
	}
	for _, r := range strings.ToLower(goal) {
		if unicode.Is(unicode.Han, r) {
			flushWord()
			han = append(han, r)
		} else if unicode.IsLetter(r) || unicode.IsNumber(r) {
			flushHan()
			word = append(word, r)
		} else {
			flushWord()
			flushHan()
		}
	}
	flushWord()
	flushHan()
	return terms
}

func socialInterestTerms(tags []string) []string {
	terms := []string{}
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(tag), "#")))
		if tag != "" && !seen[tag] {
			seen[tag] = true
			terms = append(terms, tag)
		}
	}
	return terms
}

// Each term contributes once per field, so repeating keywords cannot boost rank.
// ASCII word boundaries prevent e.g. "AI" matching "chair"; Chinese phrases
// remain substring matches. Only post content participates, never author metadata.
func socialContentCoverage(input string) string {
	match := func(field string) string {
		return `(CASE WHEN term ~ '^[a-z0-9 ]+$' THEN strpos(' ' || regexp_replace(lower(COALESCE(` + field + `,'')), '[^a-z0-9]+', ' ', 'g') || ' ', ' ' || term || ' ')>0 ELSE strpos(lower(COALESCE(` + field + `,'')),term)>0 END)`
	}
	return `(SELECT COALESCE((sum(CASE
		WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.document->'tags') tag WHERE lower(tag)=term) THEN 1000
		WHEN ` + match("p.document->>'title'") + ` THEN 1000
		WHEN ` + match("p.document->>'summary'") + ` THEN 800
		WHEN ` + match("p.document->>'body'") + ` THEN 600
		ELSE 0 END)/NULLIF(count(*),0))::bigint,0)
		FROM jsonb_array_elements_text(` + input + `) term)`
}

// Explicit content relevance always dominates bounded social proof. A followed
// author, Agent name, bio, model, or ability is not evidence of relevant content.
func socialRecommendationScore() string {
	return `(` + socialContentCoverage("intent.interests") + ` + 2*` + socialContentCoverage("intent.goal") + `)*1000
		+ LEAST(99,(SELECT count(*) FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.kind='save'))
		+ LEAST(19,(SELECT count(*) FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.kind='like'))`
}
