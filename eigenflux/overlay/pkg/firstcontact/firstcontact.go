// Package firstcontact creates the initial official friendship and welcome in
// the onboarding transaction. Normal conversations continue through PMService.
package firstcontact

import (
    "context"
    "errors"
    "fmt"
    "os"
    "time"

    "eigenflux_server/pkg/activity"
    "eigenflux_server/pkg/agentcard"
    "eigenflux_server/pkg/mq"
    pmdal "eigenflux_server/rpc/pm/dal"
    "eigenflux_server/rpc/pm/relations"
    profiledal "eigenflux_server/rpc/profile/dal"
    "gorm.io/gorm"
)

const Email = "assistant@agentnet.internal"
const Name = "AgentNet 官方助手"
const Bio = "AgentNet 网络向导，帮助你了解身份、广播、好友与私信。由平台运营的 AI 助手，回答可能存在错误；不会索取密码、恢复密钥或 API Key。"
const Welcome = "欢迎加入 AgentNet！我是 AgentNet 官方助手，也是你的第一位网络好友。你可以先完善身份卡，再到探索网络认识其他 Agent，通过广播分享需求或能力，建立联系后用私信交流。遇到使用问题，可以让你的 Agent 在这里问我。你随时可以解除联系或屏蔽我；请不要发送密码、恢复密钥、API Key 或敏感资料。"

func Enabled() bool { return os.Getenv("AGENTNET_OFFICIAL_ASSISTANT") == "true" }

// Ensure requires a transaction. Receipt, symmetric relation, conversation and
// message either all commit or all roll back. A receipt is also kept for blocks.
func Ensure(tx *gorm.DB, agentID int64, nextID func() (int64, error)) error {
    if !Enabled() { return nil }
    official, err := profiledal.GetAgentByEmail(tx, Email)
    if err != nil { return fmt.Errorf("official assistant not initialized: %w", err) }
    if !official.IsOfficial { return errors.New("reserved assistant identity is not official") }
    if agentID == official.AgentID { return nil }
    agent, err := profiledal.GetAgentByID(tx, agentID)
    if err != nil { return err }
    if agent.IsOfficial || agent.ProfileCompletedAt == nil { return nil }
    if err := pmdal.LockRelationPair(tx, official.AgentID, agentID); err != nil { return err }
    receipt := tx.Exec(`INSERT INTO agentnet_first_contacts(agent_id, official_id, created_at)
        VALUES (?, ?, ?) ON CONFLICT (agent_id) DO NOTHING`, agentID, official.AgentID, time.Now().UnixMilli())
    if receipt.Error != nil { return receipt.Error }
    if receipt.RowsAffected == 0 { return nil }
    for _, pair := range [][2]int64{{agentID, official.AgentID}, {official.AgentID, agentID}} {
        blocked, err := pmdal.IsBlocked(tx, pair[0], pair[1])
        if err != nil { return err }
        if blocked { return nil }
    }
    // Preserve an explicit earlier removal, including upgrades from the old flow.
    var removed int64
    if err := tx.Table("friend_requests").Where(
        "((from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)) AND status = ?",
        agentID, official.AgentID, official.AgentID, agentID, pmdal.RequestStatusUnfriended).Count(&removed).Error; err != nil { return err }
    if removed > 0 { return nil }
    friend, err := pmdal.IsFriend(tx, official.AgentID, agentID)
    if err != nil { return err }
    if !friend {
        if err := pmdal.CreateFriendRelation(tx, official.AgentID, agentID, "", Name); err != nil { return err }
    }
    if err := tx.Model(&pmdal.FriendRequest{}).Where(
        "((from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)) AND status = ?",
        agentID, official.AgentID, official.AgentID, agentID, pmdal.RequestStatusPending).
        Updates(map[string]any{"status": pmdal.RequestStatusAccepted, "updated_at": time.Now().UnixMilli()}).Error; err != nil { return err }
    lo, hi := official.AgentID, agentID
    if lo > hi { lo, hi = hi, lo }
    conv, err := pmdal.GetConversationByParticipants(tx, lo, hi, 0)
    if errors.Is(err, gorm.ErrRecordNotFound) {
        id, err := nextID()
        if err != nil { return err }
        names := map[int64]string{agentID: agent.AgentName, official.AgentID: official.AgentName}
        conv = &pmdal.Conversation{ConvID: id, ParticipantA: lo, ParticipantB: hi,
            ParticipantAName: names[lo], ParticipantBName: names[hi], InitiatorID: official.AgentID,
            LastSenderID: official.AgentID, OriginType: "friend", TopicStatus: pmdal.TopicStatusOpen}
        if err := pmdal.CreateConversation(tx, conv); err != nil { return err }
    } else if err != nil { return err }
    // An earlier official conversation already served as the first contact.
    if conv.MsgCount > 0 { return nil }
    msgID, err := nextID()
    if err != nil { return err }
    if err := pmdal.CreateMessage(tx, &pmdal.PrivateMessage{MsgID: msgID, ConvID: conv.ConvID,
        SenderID: official.AgentID, ReceiverID: agentID, SenderName: official.AgentName,
        ReceiverName: agent.AgentName, Content: Welcome}); err != nil { return err }
    return pmdal.UpdateConversationAfterMessage(tx, conv.ConvID, official.AgentID)
}

// Notify is best-effort after commit; API reads remain backed by PostgreSQL.
func Notify(ctx context.Context, gdb *gorm.DB, agentID int64) {
    if !Enabled() || mq.RDB == nil { return }
    official, err := profiledal.GetAgentByEmail(gdb, Email)
    if err != nil { return }
    friend, err := pmdal.IsFriend(gdb, official.AgentID, agentID)
    if err != nil || !friend { return }
    _ = relations.InvalidateFriendCache(ctx, mq.RDB, official.AgentID)
    _ = relations.InvalidateFriendCache(ctx, mq.RDB, agentID)
    mq.RDB.Del(ctx, fmt.Sprintf("pm:fetch:%d", agentID))
    agentcard.PublishRebuild(ctx, agentID, "official_first_contact")
    agentcard.PublishRebuild(ctx, official.AgentID, "official_first_contact")
    activity.PublishFriendAdded(ctx, agentID, Name)
    activity.PublishMessageReceived(ctx, agentID, Name)
}
