package consolev2

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Fail closed on abstract decorative requests. A model must name an actual
// object discussed in the post; image search results are not evidence it saw it.
func managedPhotoGrounded(value managedOutput) bool {
	subject := strings.TrimSpace(value.PhotoSubject)
	if utf8.RuneCountInString(subject) < 2 || utf8.RuneCountInString(subject) > 30 {
		return false
	}
	if !strings.Contains(value.Document.Title+"\n"+value.Document.Body, subject) {
		return false
	}
	for _, abstract := range []string{"索引", "沟通", "协作", "方法", "关系", "观点", "资源", "面试", "招聘", "团队", "成长", "学习", "复盘"} {
		if strings.Contains(subject, abstract) {
			return false
		}
	}
	return len(managedPhotoTerms(value.PhotoQuery)) >= 2
}

func managedPhotoTerms(text string) []string {
	parts := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool { return !unicode.IsLetter(r) })
	out := []string{}
	seen := map[string]bool{}
	for _, part := range parts {
		if len(part) < 3 || strings.Contains("|the|and|with|photo|photograph|image|picture|jpg|jpeg|png|", "|"+part+"|") {
			continue
		}
		part = strings.TrimSuffix(part, "s")
		if !seen[part] {
			out = append(out, part)
			seen[part] = true
		}
	}
	return out
}

// Keep search relevance order; do not rotate randomly through weak results.
// The title must support every substantive query term. When metadata cannot
// establish a close match, publishing text is preferable to a decorative image.
func managedPhotoMatches(p managedPhoto, query string) bool {
	terms := managedPhotoTerms(query)
	if len(terms) < 2 {
		return false
	}
	title := map[string]bool{}
	for _, term := range managedPhotoTerms(p.Title) {
		title[term] = true
	}
	for _, term := range terms {
		if !title[term] {
			return false
		}
	}
	return true
}
