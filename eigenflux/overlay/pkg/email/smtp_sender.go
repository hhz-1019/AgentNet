package email

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"errors"
	"fmt"
	"html"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strings"
	"time"
)

// NewConfiguredSender is shared by Auth RPC and Console V2. Resend is retained
// for existing installations; AgentNet's deployment defaults to TLS SMTP.
func NewConfiguredSender(resendKey, resendFrom string) (Sender, error) {
	switch strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")) {
	case "", "resend":
		if strings.TrimSpace(resendKey) == "" || strings.TrimSpace(resendFrom) == "" {
			return nil, errors.New("email: RESEND_API_KEY and RESEND_FROM_EMAIL are required")
		}
		return NewResendSender(resendKey, resendFrom), nil
	case "smtp":
		host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
		port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
		user := strings.TrimSpace(os.Getenv("SMTP_USERNAME"))
		password := os.Getenv("SMTP_PASSWORD")
		from, err := parseSMTPAddress(os.Getenv("SMTP_FROM_EMAIL"))
		if err != nil || host == "" || strings.ContainsAny(host, "/:\r\n\t ") || port != "465" || user == "" || strings.TrimSpace(password) == "" {
			return nil, errors.New("email: SMTP requires HOST, PORT=465, USERNAME, PASSWORD and a valid FROM_EMAIL")
		}
		if user != from.Address {
			return nil, errors.New("email: SMTP_USERNAME must match the DirectMail sender address")
		}
		return &smtpSender{host: host, address: net.JoinHostPort(host, port), user: user, password: password, from: from}, nil
	default:
		return nil, errors.New("email: unsupported EMAIL_PROVIDER")
	}
}

// Configured reports an explicitly selected sender even if its configuration
// is incomplete, so Console startup fails instead of silently disabling mail.
func Configured(resendKey string) bool {
	return strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")) != "" || strings.TrimSpace(resendKey) != ""
}

type smtpSender struct {
	host, address, user, password string
	from                          *mail.Address
	tlsConfig                     *tls.Config // nil in production; tests install their own trusted CA
}

func parseSMTPAddress(value string) (*mail.Address, error) {
	if strings.ContainsAny(value, "\r\n") {
		return nil, errors.New("email: invalid address")
	}
	a, err := mail.ParseAddress(value)
	if err != nil || !strings.Contains(a.Address, "@") {
		return nil, errors.New("email: invalid address")
	}
	return a, nil
}

func (s *smtpSender) SendLoginVerifyMail(ctx context.Context, to, otp string) error {
	return s.send(ctx, to, "AgentNet 登录验证码", buildLoginVerifyHTML(html.EscapeString(otp)))
}

func (s *smtpSender) SendAccountRecoveryMail(ctx context.Context, to, agentName string) error {
	return s.send(ctx, to, "AgentNet 身份恢复通知", fmt.Sprintf("<h2>AgentNet 身份已恢复</h2><p>完成邮箱验证后，新环境已连接到 Agent <strong>%s</strong>。如果不是你本人操作，请及时检查连接并撤销陌生凭证。</p>", html.EscapeString(agentName)))
}

func (s *smtpSender) send(ctx context.Context, recipient, subject, body string) error {
	to, err := parseSMTPAddress(recipient)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	tlsConfig := s.tlsConfig
	if tlsConfig == nil {
		tlsConfig = &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}
	}
	dialer := tls.Dialer{NetDialer: &net.Dialer{Timeout: 5 * time.Second}, Config: tlsConfig}
	conn, err := dialer.DialContext(ctx, "tcp", s.address)
	if err != nil {
		return errors.New("email: SMTP TLS connection failed")
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return errors.New("email: SMTP deadline failed")
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		return errors.New("email: SMTP greeting failed")
	}
	defer client.Close()
	// DirectMail documents AUTH LOGIN over implicit TLS (port 465).
	if err := client.Auth(&loginAuth{host: s.host, user: s.user, password: s.password}); err != nil {
		return errors.New("email: SMTP authentication failed")
	}
	if err := client.Mail(s.from.Address); err != nil {
		return errors.New("email: SMTP sender rejected")
	}
	if err := client.Rcpt(to.Address); err != nil {
		return errors.New("email: SMTP recipient rejected")
	}
	w, err := client.Data()
	if err != nil {
		return errors.New("email: SMTP DATA rejected")
	}
	var encoded strings.Builder
	encoder := quotedprintable.NewWriter(&encoded)
	_, _ = encoder.Write([]byte(body))
	_ = encoder.Close()
	message := "From: " + s.from.String() + "\r\nTo: " + to.String() + "\r\nSubject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\nDate: " + time.Now().Format(time.RFC1123Z) + "\r\nMessage-ID: <" + rand.Text() + "@" + s.host + ">\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" + encoded.String() + "\r\n"
	if _, err := w.Write([]byte(message)); err != nil {
		return errors.New("email: SMTP write failed")
	}
	if err := w.Close(); err != nil {
		return errors.New("email: SMTP delivery rejected")
	}
	// DATA acceptance is authoritative; a failed QUIT must not cause duplicate mail.
	_ = client.Quit()
	return nil
}

type loginAuth struct {
	host, user, password string
	step                 int
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS || server.Name != a.host {
		return "", nil, errors.New("email: SMTP authentication requires verified TLS")
	}
	a.step = 0
	return "LOGIN", nil, nil
}
func (a *loginAuth) Next(_ []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	a.step++
	switch a.step {
	case 1:
		return []byte(a.user), nil
	case 2:
		return []byte(a.password), nil
	default:
		return nil, errors.New("email: unexpected SMTP authentication challenge")
	}
}
