package email

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"mime/quotedprintable"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

// A real TLS/SMTP exchange with a local server, not a provider delivery test.
func TestSMTPSender(t *testing.T) {
	for _, mode := range []string{"otp", "recovery", "auth-reject", "data-reject", "untrusted-tls"} {
		t.Run(mode, func(t *testing.T) {
			certServer := httptest.NewTLSServer(nil)
			config := certServer.TLS.Clone()
			trust := certServer.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
			certServer.Close()
			listener, err := tls.Listen("tcp", "127.0.0.1:0", config)
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			done := make(chan string, 1)
			go func() {
				conn, err := listener.Accept()
				if err != nil {
					done <- ""
					return
				}
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
				r := textproto.NewReader(bufio.NewReader(conn))
				say := func(line string) { _, _ = fmt.Fprint(conn, line+"\r\n") }
				say("220 local SMTP")
				var body string
				for {
					line, err := r.ReadLine()
					if err != nil {
						break
					}
					switch {
					case strings.HasPrefix(line, "EHLO"):
						say("250-local\r\n250 AUTH LOGIN")
					case strings.HasPrefix(line, "AUTH LOGIN"):
						say("334 VXNlcm5hbWU6")
						user, _ := r.ReadLine()
						say("334 UGFzc3dvcmQ6")
						password, _ := r.ReadLine()
						if mode == "auth-reject" || user != base64.StdEncoding.EncodeToString([]byte("sender@example.test")) || password != base64.StdEncoding.EncodeToString([]byte("private-smtp-password")) {
							say("535 denied")
						} else {
							say("235 authenticated")
						}
					case strings.HasPrefix(line, "MAIL FROM"), strings.HasPrefix(line, "RCPT TO"):
						say("250 accepted")
					case line == "DATA":
						say("354 send message")
						b, _ := io.ReadAll(r.DotReader())
						body = string(b)
						if mode == "data-reject" {
							say("550 rejected")
						} else {
							say("250 queued")
						}
					case line == "QUIT":
						say("221 bye")
						done <- body
						return
					default:
						say("500 unsupported")
					}
				}
				done <- body
			}()
			from, _ := mail.ParseAddress("elsewhere <sender@example.test>")
			sender := &smtpSender{host: "127.0.0.1", address: listener.Addr().String(), user: from.Address, password: "private-smtp-password", from: from, tlsConfig: trust}
			if mode == "untrusted-tls" {
				sender.tlsConfig = nil
			}
			if mode == "recovery" {
				err = sender.SendAccountRecoveryMail(context.Background(), "owner@example.test", "<unsafe>")
			} else {
				err = sender.SendLoginVerifyMail(context.Background(), "owner@example.test", "123456")
			}
			body := <-done
			if mode == "otp" || mode == "recovery" {
				if err != nil {
					t.Fatal(err)
				}
				message, err := mail.ReadMessage(strings.NewReader(body))
				if err != nil {
					t.Fatal(err)
				}
				address, err := mail.ParseAddress(message.Header.Get("From"))
				if err != nil || address.Address != "sender@example.test" || address.Name != "elsewhere" {
					t.Fatal("invalid MIME From")
				}
				decoded, err := io.ReadAll(quotedprintable.NewReader(message.Body))
				if err != nil {
					t.Fatal(err)
				}
				body = string(decoded)
				if mode == "otp" && !strings.Contains(body, "123456") {
					t.Fatal("OTP absent")
				}
				if mode == "recovery" && (!strings.Contains(body, "&lt;unsafe&gt;") || strings.Contains(body, "<unsafe>")) {
					t.Fatal("recovery HTML is not escaped")
				}
			} else if err == nil {
				t.Fatal("expected failure")
			}
			if err != nil && strings.Contains(err.Error(), sender.password) {
				t.Fatal("secret in error")
			}
		})
	}
}

func TestSMTPConfigurationAndBoundaries(t *testing.T) {
	t.Setenv("EMAIL_PROVIDER", "smtp")
	t.Setenv("SMTP_HOST", "smtpdm.aliyun.com")
	t.Setenv("SMTP_PORT", "465")
	t.Setenv("SMTP_USERNAME", "sender@example.test")
	t.Setenv("SMTP_PASSWORD", "test-only")
	t.Setenv("SMTP_FROM_EMAIL", "elsewhere <sender@example.test>")
	if _, err := NewConfiguredSender("", ""); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SMTP_PORT", "25")
	if _, err := NewConfiguredSender("", ""); err == nil {
		t.Fatal("plaintext port accepted")
	}
	t.Setenv("SMTP_PORT", "465")
	t.Setenv("SMTP_FROM_EMAIL", "other@example.test")
	if _, err := NewConfiguredSender("", ""); err == nil {
		t.Fatal("sender mismatch accepted")
	}
	if _, err := parseSMTPAddress("a@example.test\r\nBcc: x@example.test"); err == nil {
		t.Fatal("header injection accepted")
	}
	a := &loginAuth{host: "smtpdm.aliyun.com"}
	if _, _, err := a.Start(&smtp.ServerInfo{Name: a.host, TLS: false}); err == nil {
		t.Fatal("plaintext auth accepted")
	}
	t.Setenv("EMAIL_PROVIDER", "unknown")
	if !Configured("") {
		t.Fatal("invalid explicit provider silently disabled")
	}
	if _, err := NewConfiguredSender("", ""); err == nil {
		t.Fatal("unknown provider accepted")
	}
}
