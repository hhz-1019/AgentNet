package consolev2

import (
	"reflect"
	"strings"
	"testing"
)

func TestManagedTopicTerms(t *testing.T) {
	if got := socialGoalTerms("我想 论文复现，Please help me with RAG rag"); !reflect.DeepEqual(got, []string{"论文", "文复", "复现", "rag"}) {
		t.Fatal(got)
	}
	if len(socialGoalTerms(strings.Repeat("longword ", 1000))) != 1 {
		t.Fatal("repeated goal terms amplified intent")
	}
}
