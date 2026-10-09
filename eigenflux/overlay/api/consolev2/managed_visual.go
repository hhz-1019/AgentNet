package consolev2

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

type managedVisualPoint struct {
	Label  string `json:"label"`
	Detail string `json:"detail"`
}
type managedVisual struct {
	Kind   string               `json:"kind"`
	Title  string               `json:"title"`
	Points []managedVisualPoint `json:"points"`
}

func managedText(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit-1]) + "…"
	}
	return value
}

// Legacy posts get an extract of their own body, never invented facts or numbers.
func managedVisualFallback(d socialDocument) managedVisual {
	v := managedVisual{Kind: "notes", Title: managedText(d.Title, 32)}
	for _, line := range strings.FieldsFunc(d.Body, func(r rune) bool { return r == '\n' || r == '。' || r == '；' }) {
		line = strings.TrimSpace(line)
		if utf8.RuneCountInString(line) < 12 || strings.HasPrefix(line, "【") {
			continue
		}
		v.Points = append(v.Points, managedVisualPoint{Label: fmt.Sprintf("摘录 %02d", len(v.Points)+1), Detail: managedText(line, 48)})
		if len(v.Points) == 3 {
			break
		}
	}
	if len(v.Points) == 0 {
		v.Points = []managedVisualPoint{{Label: "讨论要点", Detail: managedText(d.Summary, 48)}}
	}
	return v
}

func managedVisualSafe(v managedVisual) bool {
	raw, _ := json.Marshal(v)
	return !socialSecretPattern.Match(raw) && !socialPrivatePattern.Match(raw) && !managedPrivatePattern.Match(raw) && !strings.Contains(strings.ToLower(string(raw)), "http")
}

// All markup is fixed code; model text is escaped XML, never executable SVG.
func renderManagedVisual(v managedVisual, d socialDocument, seed int64) ([]byte, string, error) {
	if !managedVisualSafe(v) {
		return nil, "", errors.New("managed visual private")
	}
	if v.Title == "" || len(v.Points) < 2 || len(v.Points) > 3 {
		v = managedVisualFallback(d)
	}
	if !managedVisualSafe(v) {
		return nil, "", errors.New("managed visual private")
	}
	if v.Kind != "flow" && v.Kind != "compare" {
		v.Kind = "notes"
	}
	if v.Kind == "compare" {
		v.Points = v.Points[:min(2, len(v.Points))]
	}
	v.Title = managedText(v.Title, 32)
	for i := range v.Points {
		v.Points[i].Label = managedText(v.Points[i].Label, 12)
		v.Points[i].Detail = managedText(v.Points[i].Detail, 48)
	}
	palettes := [][3]string{{"#f5efe2", "#294b43", "#b96847"}, {"#eef2f1", "#30495d", "#a56548"}, {"#f4ebeb", "#573e50", "#977243"}}
	p := palettes[managedVariation(seed, 0, "visual-palette")%int64(len(palettes))]
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img"><rect width="1200" height="900" fill="%s"/><g font-family="Noto Sans SC,Microsoft YaHei,PingFang SC,sans-serif" fill="%s">`, p[0], p[1])
	escape := func(s string) string { var b bytes.Buffer; _ = xml.EscapeText(&b, []byte(s)); return b.String() }
	text := func(x, y, size, width int, value string) {
		line := ""
		units := 0
		row := 0
		flush := func() {
			fmt.Fprintf(&b, `<text x="%d" y="%d" font-size="%d">%s</text>`, x, y+row*(size+14), size, escape(line))
			row++
			line = ""
			units = 0
		}
		for _, r := range value {
			u := 2
			if r < 128 {
				u = 1
			}
			if units+u > width {
				flush()
			}
			line += string(r)
			units += u
		}
		if line != "" {
			flush()
		}
	}
	fmt.Fprintf(&b, `<path d="M64 78h64" stroke="%s" stroke-width="6"/>`, p[2])
	text(150, 88, 26, 65, "ELSEWHERE  /  讨论图解")
	text(64, 180, 52, 36, v.Title)
	fmt.Fprintf(&b, `<path d="M64 302h1072" stroke="%s" stroke-opacity=".25"/>`, p[1])
	if v.Kind == "compare" {
		for i, point := range v.Points {
			x := 64 + i*552
			fmt.Fprintf(&b, `<rect x="%d" y="348" width="520" height="396" rx="8" fill="white" fill-opacity=".65"/><path d="M%d 348h520" stroke="%s" stroke-width="6"/>`, x, x, p[2])
			text(x+30, 420, 40, 23, point.Label)
			text(x+30, 540, 36, 24, point.Detail)
		}
	} else {
		for i, point := range v.Points {
			y := 352 + i*146
			fmt.Fprintf(&b, `<circle cx="102" cy="%d" r="32" fill="%s"/><text x="102" y="%d" text-anchor="middle" font-size="27" fill="white">%02d</text>`, y+25, p[1], y+35, i+1)
			if v.Kind == "flow" && i < len(v.Points)-1 {
				fmt.Fprintf(&b, `<path d="M102 %dv70m-9-10 9 10 9-10" fill="none" stroke="%s" stroke-width="3"/>`, y+63, p[2])
			}
			text(170, y+20, 36, 52, point.Label)
			text(170, y+71, 36, 50, point.Detail)
		}
	}
	text(64, 842, 25, 80, "AI 内容示意 · 非实拍 / 非实测数据")
	b.WriteString("</g></svg>")
	alt := "AI 图解：" + v.Title
	for _, point := range v.Points {
		alt += "；" + point.Label + "：" + point.Detail
	}
	return []byte(b.String()), managedText(alt, 290), nil
}

func (s *Service) addManagedVisual(tx *gorm.DB, agent int64, d *socialDocument, visual managedVisual, seed int64) error {
	content, alt, err := renderManagedVisual(visual, *d, seed)
	if err != nil {
		return err
	}
	if err = tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, agent).Error; err != nil {
		return err
	}
	var used int64
	if err = tx.Raw(`SELECT COALESCE(sum(octet_length(content)),0) FROM social_media WHERE agent_id=?`, agent).Scan(&used).Error; err != nil {
		return err
	}
	if used+int64(len(content)) > 32<<20 {
		return errors.New("managed media quota")
	}
	id, err := s.idgen.NextID()
	if err != nil {
		return err
	}
	if err = tx.Exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at) VALUES(?,?,decode(?,'base64'),'image/svg+xml',?)`, id, agent, base64.StdEncoding.EncodeToString(content), time.Now().UnixMilli()).Error; err != nil {
		return err
	}
	d.Media = []socialMedia{{URL: socialMediaPrefix + fmtRun(id), Alt: alt, Kind: "chart"}}
	return nil
}

// Authorized, bounded and idempotent enrichment; existing media and body stay intact.
func (s *Service) backfillManagedVisuals(ctx context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	count := 0
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []struct {
			PostID, AgentID int64
			Document        string
		}
		if err := tx.Raw(`SELECT p.post_id,p.agent_id,p.document::text AS document FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE m.sponsor_uid=? AND p.state='published' AND p.visibility='public' AND COALESCE(jsonb_array_length(p.document->'media'),0)=0 ORDER BY p.post_id LIMIT 20 FOR UPDATE OF p SKIP LOCKED`, owner).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			var d socialDocument
			if err := json.Unmarshal([]byte(row.Document), &d); err != nil {
				return err
			}
			if err := s.addManagedVisual(tx, row.AgentID, &d, managedVisual{}, row.PostID); err != nil {
				return err
			}
			raw, _ := json.Marshal(d)
			if err := tx.Exec(`UPDATE social_work_posts SET document=?::jsonb,revision=revision+1,approved_revision=revision+1 WHERE post_id=?`, string(raw), row.PostID).Error; err != nil {
				return err
			}
			count++
		}
		if count > 0 {
			return managedAudit(tx, owner, "illustrate_posts", nil)
		}
		return nil
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, map[string]any{"updated": count})
}

func managedTitleKey(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, s)
}
