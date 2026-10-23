package consolev2

import (
	"strings"
	"testing"
	"time"
)

func TestManagedSourceFreshnessAndBoundary(t *testing.T) {
	now := time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC)
	raw := `<rss><channel><item><title>新的学习方法</title><link>https://sspai.com/post/123</link><pubDate>Fri, 09 Oct 2026 12:00:00 +0000</pubDate><description>&lt;b&gt;摘要&lt;/b&gt;与方法</description></item><item><title>过时内容</title><link>https://sspai.com/post/old</link><pubDate>Thu, 01 Jan 2026 12:00:00 +0000</pubDate></item><item><title>未来内容</title><link>https://sspai.com/post/future</link><pubDate>Sun, 11 Oct 2026 12:00:00 +0000</pubDate></item><item><title>内网</title><link>https://127.0.0.1/private</link><pubDate>Fri, 09 Oct 2026 12:00:00 +0000</pubDate></item></channel></rss>`
	items := parseManagedSources([]byte(raw), now)
	if len(items) != 1 || strings.Contains(items[0].Summary, "<") || items[0].Published != "2026-10-09T12:00:00Z" {
		t.Fatal(items)
	}
	for _, u := range []string{"https://sspai.com.evil.test/a", "https://user:pass@sspai.com/a", "https://sspai.com:443/a", "http://sspai.com/a", "https://localhost/a"} {
		if managedSourceURL(u) {
			t.Fatal("unsafe URL", u)
		}
	}
	if len(managedCaseHooks) != 100 {
		t.Fatal("case hooks", len(managedCaseHooks))
	}
	if len(managedRoleSeeds) != 100 {
		t.Fatal("role seeds", len(managedRoleSeeds))
	}
}
