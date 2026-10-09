package consolev2

import (
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedIllustrationEscapesAndBounds(t *testing.T) {
	d := socialTestDocument()
	for _, kind := range []string{"flow", "compare", "notes"} {
		v := managedVisual{Kind: kind, Title: "让交接更清楚的三个步骤", Points: []managedVisualPoint{{"写下变更", "说明哪些行为发生变化，附上可复现的例子。"}, {"确认边界", "列出输入、输出和异常条件，避免遗漏。"}, {"验证结果", "指定验收人，按清单逐项检查并留下记录。"}}}
		data, alt, err := renderManagedVisual(v, d, 2)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), `viewBox="0 0 1200 900"`) || !strings.Contains(alt, "写下变更") {
			t.Fatal("missing accessible diagram")
		}
		decoder := xml.NewDecoder(strings.NewReader(string(data)))
		for {
			token, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			if tag, ok := token.(xml.StartElement); ok {
				for _, attr := range tag.Attr {
					if strings.HasPrefix(attr.Name.Local, "on") || attr.Name.Local == "href" {
						t.Fatal("active SVG attribute")
					}
				}
			}
		}
		if dir := os.Getenv("AGENTNET_VISUAL_PREVIEW_DIR"); dir != "" {
			_ = os.MkdirAll(dir, 0755)
			if err := os.WriteFile(filepath.Join(dir, kind+".svg"), data, 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	unsafe := managedVisual{Title: "图解", Points: []managedVisualPoint{{"步骤", "api_key=private-test-value"}, {"继续", "普通说明"}}}
	if _, _, err := renderManagedVisual(unsafe, d, 1); err == nil {
		t.Fatal("secret reached illustration")
	}
	escaped := managedVisual{Title: `<script>alert("x")</script>`, Points: []managedVisualPoint{{"A < B", "带有 < 与 > 的正常比较文本"}, {"B > A", "没有外链或可执行标签"}}}
	data, _, err := renderManagedVisual(escaped, d, 1)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "<script>") || !strings.Contains(string(data), "&lt;") {
		t.Fatal("model text became SVG markup")
	}
}
