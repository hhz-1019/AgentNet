// Provision once before services accept onboarding, then backfill existing
// completed agents using the same transaction as new onboarding.
package main

import (
    "context"
    "errors"
    "log"
    "strings"
    "time"

    "eigenflux_server/pkg/config"
    "eigenflux_server/pkg/agentcard"
    "eigenflux_server/pkg/db"
    "eigenflux_server/pkg/firstcontact"
    "eigenflux_server/pkg/idgen"
    "eigenflux_server/pkg/mq"
    profiledal "eigenflux_server/rpc/profile/dal"
    "gorm.io/gorm"
)

func main() {
    if !firstcontact.Enabled() { return }
    cfg := config.Load()
    db.Init(cfg.PgDSN)
    mq.Init(cfg.RedisAddr, cfg.RedisPassword)
    gen, err := idgen.NewManagedGenerator(context.Background(), idgen.ManagedGeneratorConfig{
        Endpoints: strings.Split(cfg.EtcdAddr, ","), WorkerPrefix: cfg.IDWorkerPrefix,
        ServiceName: "agentnet-official-assistant", InstanceID: cfg.IDInstanceID,
        LeaseTTLSecond: cfg.IDWorkerLeaseTTL, EpochMS: cfg.IDSnowflakeEpoch,
    })
    if err != nil { log.Fatal(err) }
    defer gen.Close(context.Background())
    var officialID int64
    err = db.DB.Transaction(func(tx *gorm.DB) error {
        if err := tx.Exec("SELECT pg_advisory_xact_lock(734817610)").Error; err != nil { return err }
        var count int64
        if err := tx.Model(&profiledal.Agent{}).Where("email = ?", firstcontact.Email).Count(&count).Error; err != nil { return err }
        if count == 0 {
            id, err := gen.NextID()
            if err != nil { return err }
            if err := profiledal.CreateAgent(tx, &profiledal.Agent{AgentID: id, Email: firstcontact.Email,
                AgentName: firstcontact.Name, Bio: firstcontact.Bio, IsOfficial: true}); err != nil { return err }
        }
        agent, err := profiledal.GetAgentByEmail(tx, firstcontact.Email)
        if err != nil { return err }
        if !agent.IsOfficial { return errors.New("reserved assistant identity belongs to a non-official agent") }
        officialID = agent.AgentID
        return tx.Model(&profiledal.Agent{}).Where("agent_id = ?", agent.AgentID).Updates(map[string]any{
            "agent_name": firstcontact.Name, "bio": firstcontact.Bio,
            "profile_completed_at": gorm.Expr("COALESCE(profile_completed_at, ?)", time.Now().UnixMilli()),
        }).Error
    })
    if err != nil { log.Fatal(err) }
    if err := agentcard.Rebuild(context.Background(), db.DB, mq.RDB, officialID); err != nil { log.Fatal(err) }
    for {
        var ids []int64
        err := db.DB.Raw(`SELECT a.agent_id FROM agents a LEFT JOIN agentnet_first_contacts f USING(agent_id)
            WHERE a.profile_completed_at IS NOT NULL AND NOT a.is_official AND f.agent_id IS NULL
            ORDER BY a.agent_id LIMIT 100`).Scan(&ids).Error
        if err != nil { log.Fatal(err) }
        if len(ids) == 0 { break }
        for _, id := range ids {
            if err := db.DB.Transaction(func(tx *gorm.DB) error { return firstcontact.Ensure(tx, id, gen.NextID) }); err != nil { log.Fatal(err) }
            firstcontact.Notify(context.Background(), db.DB, id)
        }
    }
    log.Println("AgentNet official assistant initialized; first contacts reconciled")
}
