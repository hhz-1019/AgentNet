package sms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestAliyunDeliveryContract(t *testing.T) {
	for _, scenario := range []struct {
		body   string
		status int
		ok     bool
	}{
		{`{"Code":"OK","Success":true}`, 200, true},
		{`{"Code":"OK","Success":false}`, 200, false},
		{`{"Code":"FREQUENCY_FAIL","Message":"13800138000 secret"}`, 400, false},
		{`bad json`, 200, false},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" || r.URL.RawQuery != "" {
				t.Error("phone/code must not appear in request URL")
			}
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if r.Form.Get("Action") != "SendSmsVerifyCode" || r.Form.Get("PhoneNumber") != "13800138000" || r.Form.Get("ReturnVerifyCode") != "false" || r.Form.Get("AutoRetry") != "0" {
				t.Error("incorrect delivery parameters")
			}
			var template map[string]string
			_ = json.Unmarshal([]byte(r.Form.Get("TemplateParam")), &template)
			if template["code"] != "123456" || template["min"] != "5" {
				t.Error("code or expiry omitted")
			}
			signature := r.Form.Get("Signature")
			r.Form.Del("Signature")
			if signature != rpcSignature(r.Form, "test-secret") {
				t.Error("bad signature")
			}
			w.WriteHeader(scenario.status)
			_, _ = w.Write([]byte(scenario.body))
		}))
		sender := &Aliyun{accessKey: "test-id", secret: "test-secret", sign: "测试", template: "100001", client: server.Client(), endpoint: server.URL}
		err := sender.Send(context.Background(), "13800138000", "123456", "ph_test")
		server.Close()
		if (err == nil) != scenario.ok {
			t.Fatalf("delivery status misclassified: %v", err)
		}
		if err != nil && (strings.Contains(err.Error(), "13800138000") || strings.Contains(err.Error(), "secret")) {
			t.Fatal("PII leaked")
		}
	}
}
func TestRPCEncoding(t *testing.T) {
	if percentEncode("a b+~中") != "a%20b%2B~%E4%B8%AD" {
		t.Fatal("incorrect RFC3986 escaping")
	}
	params := url.Values{"B": {"b"}, "A": {"a"}}
	// Independent HMAC-SHA1 fixture for POST&%2F&A%3Da%26B%3Db with key secret&.
	if rpcSignature(params, "secret") != "1z9CoEpDCCUAabvEfFksr7fu9xw=" {
		t.Fatal("signature fixture mismatch")
	}
}
func TestSMSConfiguration(t *testing.T) {
	for _, key := range []string{"SMS_PROVIDER", "SMS_ACCESS_KEY_ID", "SMS_ACCESS_KEY_SECRET", "SMS_SIGN_NAME", "SMS_TEMPLATE_CODE", "SMS_SCHEME_NAME"} {
		t.Setenv(key, "")
	}
	sender, err := FromEnv()
	if sender != nil || err != nil {
		t.Fatal("unconfigured provider should not enable registration")
	}
	t.Setenv("SMS_PROVIDER", "mock")
	if _, err = FromEnv(); err == nil {
		t.Fatal("mock provider accepted")
	}
	t.Setenv("SMS_PROVIDER", "aliyun-pnvs")
	t.Setenv("SMS_ACCESS_KEY_ID", "id")
	if _, err = FromEnv(); err == nil {
		t.Fatal("partial credentials accepted")
	}
}
