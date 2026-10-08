// Package sms delivers registration codes. It never logs phone numbers or codes.
package sms

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type Sender interface {
	Send(context.Context, string, string, string) error
}
type Aliyun struct {
	accessKey, secret, sign, template, securityToken string
	endpoint                                         string
	client                                           *http.Client
}

// FromEnv permits an unconfigured service to keep existing password logins working.
// Registration remains unavailable until all real provider settings exist.
func FromEnv() (Sender, error) {
	provider := strings.TrimSpace(os.Getenv("SMS_PROVIDER"))
	if provider == "" {
		return nil, nil
	}
	if provider != "aliyun-pnvs" {
		return nil, errors.New("SMS_PROVIDER must be aliyun-pnvs")
	}
	cfg := &Aliyun{accessKey: os.Getenv("SMS_ACCESS_KEY_ID"), secret: os.Getenv("SMS_ACCESS_KEY_SECRET"), sign: os.Getenv("SMS_SIGN_NAME"), template: os.Getenv("SMS_TEMPLATE_CODE"), securityToken: os.Getenv("SMS_SECURITY_TOKEN"), endpoint: "https://dypnsapi.aliyuncs.com/", client: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
	if cfg.accessKey == "" && cfg.secret == "" && cfg.sign == "" && cfg.template == "" {
		return nil, nil
	}
	for _, value := range []string{cfg.accessKey, cfg.secret, cfg.sign, cfg.template} {
		if strings.TrimSpace(value) == "" {
			return nil, errors.New("SMS_ACCESS_KEY_ID, SMS_ACCESS_KEY_SECRET, SMS_SIGN_NAME and SMS_TEMPLATE_CODE must be configured together")
		}
	}
	return cfg, nil
}

func percentEncode(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }
func rpcSignature(params url.Values, secret string) string {
	canonical := strings.ReplaceAll(params.Encode(), "+", "%20")
	mac := hmac.New(sha1.New, []byte(secret+"&"))
	_, _ = mac.Write([]byte("POST&%2F&" + percentEncode(canonical)))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// PNVS accepts a caller-generated code. Hashing, attempt limits and one-time
// verification stay in our database, bound to the requesting browser session.
func (a *Aliyun) Send(ctx context.Context, phone, code, challenge string) error {
	nonce := make([]byte, 18)
	if _, err := rand.Read(nonce); err != nil {
		return errors.New("sms nonce generation failed")
	}
	template, _ := json.Marshal(map[string]string{"code": code, "min": "5"})
	params := url.Values{
		"Format": {"JSON"}, "Version": {"2017-05-25"}, "AccessKeyId": {a.accessKey},
		"SignatureMethod": {"HMAC-SHA1"}, "SignatureVersion": {"1.0"},
		"SignatureNonce": {hex.EncodeToString(nonce)}, "Timestamp": {time.Now().UTC().Format("2006-01-02T15:04:05Z")},
		"Action": {"SendSmsVerifyCode"}, "CountryCode": {"86"}, "PhoneNumber": {phone},
		"SignName": {a.sign}, "TemplateCode": {a.template}, "TemplateParam": {string(template)},
		"OutId": {challenge}, "ValidTime": {"300"}, "Interval": {"60"}, "DuplicatePolicy": {"1"}, "ReturnVerifyCode": {"false"}, "AutoRetry": {"0"},
	}
	if a.securityToken != "" {
		params.Set("SecurityToken", a.securityToken)
	}
	params.Set("Signature", rpcSignature(params, a.secret))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint, strings.NewReader(params.Encode()))
	if err != nil {
		return errors.New("sms request creation failed")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.client.Do(req)
	if err != nil {
		return errors.New("sms provider unavailable")
	}
	defer resp.Body.Close()
	var result struct {
		Code    string
		Success bool
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&result) != nil {
		return errors.New("invalid sms provider response")
	}
	if resp.StatusCode != http.StatusOK || result.Code != "OK" || !result.Success {
		// Do not forward the provider's raw message, which may contain PII or secrets.
		if result.Code == "FREQUENCY_FAIL" || result.Code == "BUSINESS_LIMIT_CONTROL" {
			return errors.New("sms provider rate limited")
		}
		return fmt.Errorf("sms provider rejected delivery")
	}
	return nil
}
