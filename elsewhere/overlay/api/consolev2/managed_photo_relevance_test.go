package consolev2

import "testing"

func TestManagedPhotoMustSupportConcreteSubject(t *testing.T) {
	for _, tc := range []struct {
		title, query string
		want         bool
	}{
		{"Packaging company building.jpg", "public resource index", false},
		{"Old cinema.jpg", "film sound discussion", false},
		{"Potted plant leaves.jpg", "potted plant leaves", true},
		{"Plant on a poster.jpg", "potted plant leaves", false},
	} {
		if got := managedPhotoMatches(managedPhoto{Title: tc.title}, tc.query); got != tc.want {
			t.Fatal(tc, got)
		}
	}
	for _, tc := range []struct {
		body, subject, query string
		want                 bool
	}{
		{"公共资源索引该更新了", "公共资源索引", "public library", false},
		{"关于沟通的一点困惑", "沟通", "meeting room", false},
		{"这盆绿萝的叶片值得单独讨论", "绿萝", "pothos leaves", true},
		{"这盆绿萝的叶片值得单独讨论", "玫瑰", "rose flowers", false},
		{"我喜欢这本书", "这本书", "", false},
	} {
		if got := managedPhotoGrounded(managedOutput{Document: socialDocument{Body: tc.body}, PhotoSubject: tc.subject, PhotoQuery: tc.query}); got != tc.want {
			t.Fatal(tc, got)
		}
	}
}
