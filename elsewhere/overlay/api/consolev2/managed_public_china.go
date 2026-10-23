package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var errRecruitmentPartial = errors.New("partial board snapshot")

// Public website request formats independently verified against the company sites.
// A partial paginated snapshot may update confirmed records but must never close jobs.
func fetchRecruitmentJobs(ctx context.Context, b recruitmentBoard) ([]publicJob, error) {
	if b.Provider == "greenhouse" || b.Provider == "ashby" {
		raw, e := publicSourceFetch(ctx, b.Endpoint)
		if e != nil {
			return nil, e
		}
		return parseRecruitmentJobs(raw, b.Provider)
	}
	jobs := []publicJob{}
	seen := map[string]bool{}
	expected := -1
	incomplete := false
	received := 0
	for page := 1; page <= 300; page++ {
		endpoint := b.Endpoint
		size := 100
		body := map[string]any{}
		method := "POST"
		contentType := "application/json"
		switch b.Provider {
		case "tencent":
			method = "GET"
			endpoint += fmt.Sprintf("?pageIndex=%d&pageSize=100&language=zh-cn&area=cn", page)
		case "netease":
			body = map[string]any{"currentPage": page, "pageSize": size, "workType": "0"}
		case "baidu":
			size = 10
			contentType = "application/x-www-form-urlencoded"
			body = map[string]any{"curPage": page, "pageSize": size, "recruitType": "SOCIAL", "keyWord": ""}
		case "meituan":
			size = 30
			body = map[string]any{"page": map[string]int{"pageNo": page, "pageSize": size}, "jobShareType": "1", "keywords": "", "cityList": []any{}, "department": []any{}, "jfJgList": []any{}, "jobType": []any{map[string]any{"code": "3", "subCode": []any{}}}, "typeCode": []any{}, "specialCode": []any{}}
		case "ctrip":
			body = map[string]any{"condition": map[string]any{"category": 1, "kind": []string{"Regular"}, "keyword": "", "fromId": []any{}, "country": []any{}, "city": []any{}, "bucode": []any{}, "jobFamilyCode": []any{}, "jobFamilyGroupCode": []any{}}, "pager": map[string]string{"index": strconv.Itoa(page), "size": strconv.Itoa(size)}, "head": map[string]string{"language": "zh_CN", "version": "1"}}
		case "xiaomi", "bytedance":
			portal := 3
			if b.Provider == "xiaomi" {
				portal = 6
			}
			body = map[string]any{"keyword": "", "limit": size, "offset": (page - 1) * size, "portal_type": portal, "portal_entrance": 1}
		case "dji":
			body = map[string]any{"currentPage": page, "pageSize": size, "schoolFlag": "N", "keyWord": "", "recruitmentTypes": []any{}, "cityList": []any{}, "teamList": []any{}, "positionCategoryList": []any{}}
		default:
			return nil, errors.New("unsupported board")
		}
		encoded, _ := json.Marshal(body)
		payload := string(encoded)
		if contentType == "application/x-www-form-urlencoded" {
			form := url.Values{}
			for k, v := range body {
				form.Set(k, fmt.Sprint(v))
			}
			payload = form.Encode()
		}
		raw, e := publicSourceRequest(ctx, endpoint, method, strings.NewReader(payload), contentType)
		if e != nil {
			return nil, e
		}
		batch, total, e := parseChinaRecruitment(raw, b)
		if e != nil {
			return nil, e
		}
		if expected < 0 {
			expected = total
		}
		if total != expected {
			incomplete = true
			expected = total
		}
		for _, j := range batch {
			if j.ID == "" || j.Title == "" || !allowedJobURL(j.URL) {
				return nil, errors.New("invalid or repeated job")
			}
			if seen[j.ID] {
				incomplete = true
				continue
			}
			seen[j.ID] = true
			jobs = append(jobs, j)
		}
		received += len(batch)
		if received >= total {
			if incomplete || len(jobs) != total {
				return jobs, errRecruitmentPartial
			}
			return jobs, nil
		}
		if len(batch) == 0 || len(jobs) > total {
			return nil, errors.New("incomplete board")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
	return nil, errors.New("board pagination limit")
}
func jobText(m map[string]any, k string) string {
	v := m[k]
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func jobMap(m map[string]any, k string) map[string]any { v, _ := m[k].(map[string]any); return v }
func parseChinaRecruitment(raw []byte, b recruitmentBoard) ([]publicJob, int, error) {
	var root map[string]any
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.UseNumber()
	if d.Decode(&root) != nil {
		return nil, 0, errors.New("invalid board JSON")
	}
	data := jobMap(root, "data")
	listKey, totalKey := "list", "total"
	switch b.Provider {
	case "tencent":
		if jobText(root, "Code") != "200" {
			return nil, 0, errors.New("board rejected")
		}
		data = jobMap(root, "Data")
		listKey = "Posts"
		totalKey = "Count"
	case "netease":
		if jobText(root, "code") != "200" {
			return nil, 0, errors.New("board rejected")
		}
	case "baidu":
		if jobText(root, "status") != "ok" {
			return nil, 0, errors.New("board rejected")
		}
	case "ctrip":
		if jobText(root, "retCode") != "201" {
			return nil, 0, errors.New("board rejected")
		}
		data = jobMap(root, "retValue")
		listKey = "recruitJobAdList"
	case "meituan":
		if data == nil {
			return nil, 0, errors.New("board rejected")
		}
	case "xiaomi", "bytedance":
		if jobText(root, "code") != "0" {
			return nil, 0, errors.New("board rejected")
		}
		listKey = "job_post_list"
		totalKey = "count"
	case "dji":
		if jobText(root, "code") != "S0000" {
			return nil, 0, errors.New("board rejected")
		}
		listKey = "datas"
		totalKey = "totalCount"
	}
	rows, ok := data[listKey].([]any)
	if !ok {
		return nil, 0, errors.New("missing board records")
	}
	totalText := jobText(data, totalKey)
	if b.Provider == "meituan" {
		totalText = jobText(jobMap(data, "page"), "totalCount")
	}
	total, e := strconv.Atoi(totalText)
	if e != nil || total < 0 {
		return nil, 0, errors.New("missing board total")
	}
	out := []publicJob{}
	for _, v := range rows {
		r, ok := v.(map[string]any)
		if !ok {
			return nil, 0, errors.New("invalid record")
		}
		j := publicJob{}
		switch b.Provider {
		case "tencent":
			j = publicJob{jobText(r, "PostId"), jobText(r, "RecruitPostName"), jobText(r, "LocationName"), "https://careers.tencent.com/jobdesc.html?postId=" + url.QueryEscape(jobText(r, "PostId")), jobText(r, "Responsibility")}
		case "netease":
			j = publicJob{jobText(r, "id"), jobText(r, "name"), jobStringList(r, "workPlaceNameList"), "https://hr.163.com/job-detail.html?id=" + url.QueryEscape(jobText(r, "id")), jobText(r, "description") + "\n" + jobText(r, "requirement")}
		case "baidu":
			j = publicJob{jobText(r, "postId"), jobText(r, "name"), jobText(r, "workPlace"), "https://talent.baidu.com/jobs/detail/SOCIAL/" + url.PathEscape(jobText(r, "postId")), jobText(r, "workContent") + "\n" + jobText(r, "serviceCondition")}
		case "ctrip":
			j = publicJob{jobText(r, "fromId"), jobText(r, "jobTitle"), jobText(r, "cityName"), "https://job.ctrip.com/#/experienced/jobList?fromId=" + url.QueryEscape(jobText(r, "fromId")), jobText(r, "requirements")}
		case "meituan":
			j = publicJob{jobText(r, "jobUnionId"), jobText(r, "name"), "", "https://zhaopin.meituan.com/web/position/detail?jobUnionId=" + url.QueryEscape(jobText(r, "jobUnionId")) + "&jobType=3", jobText(r, "desc")}
			if cities, ok := r["cityList"].([]any); ok {
				names := []string{}
				for _, c := range cities {
					if m, ok := c.(map[string]any); ok {
						names = append(names, jobText(m, "name"))
					}
				}
				j.Location = strings.Join(names, "、")
			}
		case "xiaomi", "bytedance":
			base := b.URL
			j = publicJob{jobText(r, "id"), jobText(r, "title"), jobText(jobMap(r, "city_info"), "name"), strings.TrimSuffix(base, "/position") + "/position/" + url.PathEscape(jobText(r, "id")) + "/detail", jobText(r, "description") + "\n" + jobText(r, "requirement")}
		case "dji":
			j = publicJob{jobText(r, "positionId"), jobText(r, "jobTitle"), jobText(r, "locationDescription"), "https://we.dji.com/zh-CN/position/detail?positionId=" + url.QueryEscape(jobText(r, "positionId")), jobText(r, "duty")}
		}
		j.Description = managedSourceText(j.Description, 2400)
		if j.Location == "" {
			j.Location = "以官网为准"
		}
		out = append(out, j)
	}
	return out, total, nil
}

func jobStringList(m map[string]any, k string) string {
	items, _ := m[k].([]any)
	out := []string{}
	for _, v := range items {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return strings.Join(out, "、")
}
