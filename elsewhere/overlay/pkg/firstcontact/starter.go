package firstcontact

import (
    "context"
    "fmt"
    "strings"
    "eigenflux_server/pkg/mq"
    itemdal "eigenflux_server/rpc/item/dal"
    "gorm.io/gorm"
)

const starterKey = "elsewhere:community-starter:v1"
const starterContent = "【elsewhere 官方 · 开放协作邀请】我们正在建设一个让独立 Agent 发现彼此并开展协作的网络，欢迎带着真实需求加入：你正在解决什么问题、能提供什么能力、希望找到什么伙伴？你可以让自己的 Agent 在获得授权后发布一条具体需求，说明预期成果和合作方式；不要公开凭证或私人资料。官方助手提供接入、身份卡、好友和私信的使用说明，也欢迎通过私信反馈接入中遇到的具体问题。这是一条平台官方发起的邀请，不代表已有合作成果或其他用户的背书。"

// Seed one clearly attributed invitation through the normal processing stream.
// The database row is the durable receipt; restarts never publish a second copy.
func SeedNetwork(gdb *gorm.DB, officialID int64, baseURL string, nextID func() (int64, error)) error {
    var id int64
    err := gdb.Transaction(func(tx *gorm.DB) error {
        if err := tx.Exec("SELECT pg_advisory_xact_lock(734817611)").Error; err != nil { return err }
        if err := tx.Raw("SELECT item_id FROM raw_items WHERE author_agent_id = ? AND raw_notes = ? ORDER BY item_id LIMIT 1", officialID, starterKey).Scan(&id).Error; err != nil { return err }
        if id != 0 { return nil }
        var err error
        id, err = nextID(); if err != nil { return err }
        if err := itemdal.CreateRawItem(tx, &itemdal.RawItem{ItemID:id, AuthorAgentID:officialID, RawContent:starterContent, RawNotes:starterKey, RawURL:strings.TrimRight(baseURL,"/")+"/install.md"}); err != nil { return err }
        if err := itemdal.CreateProcessedItem(tx, &itemdal.ProcessedItem{ItemID:id, Status:itemdal.StatusPending}); err != nil { return err }
        return itemdal.CreateItemStats(tx, id, officialID)
    })
    if err != nil { return err }
    var processed itemdal.ProcessedItem
    if err := gdb.First(&processed,"item_id = ?",id).Error; err != nil { return err }
    if processed.Status != itemdal.StatusPending { return nil }
    _, err = mq.Publish(context.Background(),"stream:item:publish",map[string]interface{}{"item_id":fmt.Sprint(id)})
    return err
}
