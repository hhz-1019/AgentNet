package consolev2

import (
	"context"
	"crypto/subtle"
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"eigenflux_server/pkg/sms"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

const phoneTTL = 5 * time.Minute

var mainlandPhone = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
var phoneCode = regexp.MustCompile(`^[0-9]{6}$`)
var errPhoneChallenge = errors.New("invalid phone challenge")
var errPhoneUsed = errors.New("phone already bound")

func configurePhoneAuth(s *Service) error {
	var err error
	s.phoneSender, err = sms.FromEnv()
	if err != nil {
		return err
	}
	s.phoneDailyLimit = 1000
	if raw := os.Getenv("SMS_DAILY_LIMIT"); raw != "" {
		s.phoneDailyLimit, err = strconv.Atoi(raw)
		if err != nil || s.phoneDailyLimit < 1 || s.phoneDailyLimit > 1000000 {
			return errors.New("SMS_DAILY_LIMIT must be between 1 and 1000000")
		}
	}
	return nil
}
func normalizePhone(raw string) (string, bool) {
	phone := strings.TrimSpace(raw)
	if strings.HasPrefix(phone, "+86") {
		phone = strings.TrimPrefix(phone, "+86")
	}
	return phone, mainlandPhone.MatchString(phone)
}
func (s *Service) phoneHash(phone string) string {
	return keyedHash(s.otpPepper, "human-phone\x00"+phone)
}
func (s *Service) phoneOTPHash(id, session, purpose, phone, code string) string {
	return keyedHash(s.otpPepper, strings.Join([]string{"human-phone-otp", id, session, purpose, phone, code}, "\x00"))
}
func phoneSession(c *app.RequestContext) string {
	value, _ := c.Get("console_session_id")
	session, _ := value.(string)
	return session
}
func phoneFailure(c *app.RequestContext, err error) {
	switch {
	case errors.Is(err, errPhoneChallenge):
		fail(c, 400, "PHONE_CODE_INVALID", "验证码不正确、已过期或已使用，请重新获取", nil)
	case errors.Is(err, errPhoneUsed), isUniqueViolation(err):
		fail(c, 409, "PHONE_ALREADY_BOUND", "这个手机号已绑定账号，请使用原账号登录", nil)
	default:
		fail(c, 503, "PHONE_AUTH_UNAVAILABLE", "手机号验证暂不可用，请稍后重试", nil)
	}
}

// All quotas are reserved together before a paid request. Failed delivery still
// consumes a reservation, preventing retries from bypassing the spending cap.
var phoneRateScript = redis.NewScript(`
for i,key in ipairs(KEYS) do
 local count=tonumber(redis.call('GET',key) or '0')
 if count>=tonumber(ARGV[(i-1)*2+1]) then return 0 end
end
for i,key in ipairs(KEYS) do
 local count=redis.call('INCR',key)
 if count==1 then redis.call('PEXPIRE',key,ARGV[(i-1)*2+2]) end
end
return 1
`)

func (s *Service) allowPhoneSend(ctx context.Context, c *app.RequestContext, phone string) (bool, error) {
	if s.redisClient == nil {
		return false, errors.New("redis unavailable")
	}
	hash := s.phoneHash(phone)
	limit := s.phoneDailyLimit
	if limit < 1 {
		limit = 1000
	}
	keys := []string{"sms:cooldown:" + hash, "sms:hour:" + hash, "sms:day:" + hash, "sms:ip:" + s.clientIPHash(c), "sms:global:day"}
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	value, err := phoneRateScript.Run(ctx, s.redisClient, keys, 1, 60000, 5, 3600000, 10, 86400000, 10, 600000, limit, 86400000).Int()
	return value == 1, err
}

type phoneRequest struct {
	Phone       string `json:"phone"`
	Purpose     string `json:"purpose"`
	ChallengeID string `json:"challenge_id"`
	Code        string `json:"code"`
	UID         string `json:"uid"`
	Password    string `json:"password"`
}

func (s *Service) sessionOwner(c *app.RequestContext) (string, error) {
	var uid string
	id, _ := agentID(c)
	err := s.db.Raw(`SELECT s.owner_uid FROM console_v2_sessions s JOIN agent_owners o ON o.owner_uid=s.owner_uid AND o.agent_id=s.agent_id WHERE s.session_id=? AND s.agent_id=? AND s.auth_method='uid_password' AND s.status='active'`, phoneSession(c), id).Scan(&uid).Error
	if err == nil && uid == "" {
		err = errUnauthorized
	}
	return uid, err
}
func (s *Service) createPhoneChallenge(ctx context.Context, c *app.RequestContext) {
	var req phoneRequest
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_REQUEST", "请检查手机号", nil)
		return
	}
	phone, valid := normalizePhone(req.Phone)
	if !valid || (req.Purpose != "register" && req.Purpose != "bind") {
		fail(c, 400, "PHONE_INVALID", "请填写中国大陆手机号并选择验证用途", nil)
		return
	}
	session := phoneSession(c)
	if session == "" {
		uidFailure(c, errUnauthorized)
		return
	}
	if req.Purpose == "bind" {
		if _, err := s.sessionOwner(c); err != nil {
			uidFailure(c, err)
			return
		}
	} else {
		var owned bool
		id, _ := agentID(c)
		if err := s.db.Raw(`SELECT EXISTS(SELECT 1 FROM agent_owners WHERE agent_id=?)`, id).Scan(&owned).Error; err != nil {
			phoneFailure(c, err)
			return
		}
		if owned {
			uidFailure(c, errConflict)
			return
		}
	}
	if s.phoneSender == nil {
		phoneFailure(c, errors.New("sms not configured"))
		return
	}
	allowed, err := s.allowPhoneSend(ctx, c, phone)
	if err != nil {
		phoneFailure(c, err)
		return
	}
	if !allowed {
		c.Header("Retry-After", "60")
		fail(c, 429, "SMS_RATE_LIMITED", "发送过于频繁或今日发送额度已用完，请稍后再试", nil)
		return
	}
	id, err := randomToken("ph_", 24)
	if err != nil {
		phoneFailure(c, err)
		return
	}
	code, err := generateV2OTP()
	if err != nil {
		phoneFailure(c, err)
		return
	}
	now := time.Now().UnixMilli()
	hash := s.phoneHash(phone)
	// Do not reveal whether a number exists in the send response.
	err = s.db.Exec(`INSERT INTO human_phone_challenges(challenge_id,phone_hash,otp_hash,session_id,purpose,delivery_state,created_at,expires_at) VALUES(?,?,?,?,?,'pending',?,?)`, id, hash, s.phoneOTPHash(id, session, req.Purpose, phone, code), session, req.Purpose, now, now+int64(phoneTTL/time.Millisecond)).Error
	if err != nil {
		phoneFailure(c, err)
		return
	}
	sendCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	err = s.phoneSender.Send(sendCtx, phone, code, id)
	cancel()
	if err != nil {
		_ = s.db.Exec(`UPDATE human_phone_challenges SET delivery_state='failed' WHERE challenge_id=?`, id).Error
		phoneFailure(c, err)
		return
	}
	// A later resend replaces previous codes only after successful delivery.
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended(?,0))`, hash+session+req.Purpose).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE human_phone_challenges SET consumed_at=? WHERE phone_hash=? AND session_id=? AND purpose=? AND challenge_id<>? AND consumed_at IS NULL`, now, hash, session, req.Purpose, id).Error; err != nil {
			return err
		}
		return tx.Exec(`UPDATE human_phone_challenges SET delivery_state='sent' WHERE challenge_id=?`, id).Error
	})
	if err != nil {
		phoneFailure(c, err)
		return
	}
	_ = s.db.Exec(`DELETE FROM human_phone_challenges WHERE expires_at<?`, now-int64(24*time.Hour/time.Millisecond)).Error
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]any{"challenge_id": id, "expires_in": 300, "retry_after": 60})
}

type phoneChallenge struct{ ChallengeID, OTPHash string }

// Persist every guess outside the credential transaction. Rolling back a failed
// account claim must not restore the attacker's attempt allowance.
func (s *Service) checkPhoneCode(c *app.RequestContext, phone, purpose, id, code string) error {
	if !phoneCode.MatchString(code) || len(id) > 64 {
		return errPhoneChallenge
	}
	var row phoneChallenge
	err := s.db.Raw(`UPDATE human_phone_challenges SET attempts=attempts+1 WHERE challenge_id=? AND phone_hash=? AND session_id=? AND purpose=? AND delivery_state='sent' AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING challenge_id,otp_hash`, id, s.phoneHash(phone), phoneSession(c), purpose, time.Now().UnixMilli()).Scan(&row).Error
	if err != nil {
		return err
	}
	if row.ChallengeID == "" || subtle.ConstantTimeCompare([]byte(row.OTPHash), []byte(s.phoneOTPHash(id, phoneSession(c), purpose, phone, code))) != 1 {
		return errPhoneChallenge
	}
	return nil
}
func (s *Service) consumePhoneCode(tx *gorm.DB, c *app.RequestContext, phone, purpose, id, code string, now int64) error {
	var row phoneChallenge
	if err := tx.Raw(`SELECT challenge_id,otp_hash FROM human_phone_challenges WHERE challenge_id=? AND phone_hash=? AND session_id=? AND purpose=? AND delivery_state='sent' AND consumed_at IS NULL AND expires_at>? AND attempts<=5 FOR UPDATE`, id, s.phoneHash(phone), phoneSession(c), purpose, now).Scan(&row).Error; err != nil {
		return err
	}
	if row.ChallengeID == "" || subtle.ConstantTimeCompare([]byte(row.OTPHash), []byte(s.phoneOTPHash(id, phoneSession(c), purpose, phone, code))) != 1 {
		return errPhoneChallenge
	}
	return tx.Exec(`UPDATE human_phone_challenges SET consumed_at=? WHERE challenge_id=?`, now, id).Error
}
func (s *Service) getPhoneBinding(_ context.Context, c *app.RequestContext) {
	uid, err := s.sessionOwner(c)
	if err != nil {
		uidFailure(c, err)
		return
	}
	var row struct {
		PhoneLast4      string
		PhoneVerifiedAt *int64
	}
	if err = s.db.Raw(`SELECT phone_last4,phone_verified_at FROM human_accounts WHERE uid=?`, uid).Scan(&row).Error; err != nil {
		phoneFailure(c, err)
		return
	}
	masked := ""
	if row.PhoneLast4 != "" {
		masked = "*******" + row.PhoneLast4
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]any{"verified": row.PhoneVerifiedAt != nil, "masked_phone": masked})
}
func (s *Service) bindPhone(ctx context.Context, c *app.RequestContext) {
	var req phoneRequest
	if decodeBody(c, &req) != nil || len(req.Password) > 72 || len(req.UID) > 64 {
		fail(c, 400, "INVALID_REQUEST", "请检查手机号和账号密码", nil)
		return
	}
	phone, valid := normalizePhone(req.Phone)
	if !valid {
		fail(c, 400, "PHONE_INVALID", "请填写中国大陆手机号", nil)
		return
	}
	uid, err := s.sessionOwner(c)
	if err != nil {
		uidFailure(c, err)
		return
	}
	if !s.uidRate(ctx, c, req.UID) {
		return
	}
	account, err := s.authenticateUID(uidRequest{UID: strings.TrimSpace(req.UID), Password: req.Password})
	if err != nil || account.UID != uid {
		uidFailure(c, errUnauthorized)
		return
	}
	if err = s.checkPhoneCode(c, phone, "bind", req.ChallengeID, req.Code); err != nil {
		phoneFailure(c, err)
		return
	}
	now := time.Now().UnixMilli()
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUID(tx, account); err != nil {
			return err
		}
		var stored string
		if err := tx.Raw(`SELECT COALESCE(phone_hash,'') FROM human_accounts WHERE uid=?`, uid).Scan(&stored).Error; err != nil {
			return err
		}
		if stored != "" {
			return errPhoneUsed
		}
		if err := s.consumePhoneCode(tx, c, phone, "bind", req.ChallengeID, req.Code, now); err != nil {
			return err
		}
		return tx.Exec(`UPDATE human_accounts SET phone_hash=?,phone_last4=?,phone_verified_at=? WHERE uid=?`, s.phoneHash(phone), phone[len(phone)-4:], now, uid).Error
	})
	if err != nil {
		phoneFailure(c, err)
		return
	}
	reply(c, 200, map[string]any{"verified": true, "uid": account.Number})
}
