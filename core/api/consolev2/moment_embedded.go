package consolev2

import (
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
)

// A partitioned cookie belongs to the embedding host's top-level site. This
// does not turn an Agent credential into owner authentication: login, ownership
// and CSRF checks still run through the normal Console handlers.
func (s *Service) setEmbeddedConsoleCookie(c *app.RequestContext, name, value string, maxAge int, httpOnly bool) bool {
	if !s.secureCookie || string(c.GetHeader("X-Console-Embedded")) != "1" {
		return false
	}
	cookie := http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge,
		Secure: true, HttpOnly: httpOnly, SameSite: http.SameSiteNoneMode, Partitioned: true}
	c.Response.Header.Add("Set-Cookie", cookie.String())
	c.Header("Referrer-Policy", "no-referrer")
	return true
}
