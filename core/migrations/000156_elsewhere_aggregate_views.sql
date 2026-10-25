-- +goose Up
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Forward-only refresh of stored view definitions after the source namespace
-- update. Historical migrations are not rerun on existing databases.
-- Keep every account identity and every source event unchanged. Ordinary views
-- are replaced in place so dependent snapshots and grants remain attached.

-- Grafana must not read user-level delivery, feedback, profile, or content
-- rows. These security-barrier views expose only fixed, anonymous aggregates
-- used by the PGC audience-and-demand dashboard.
CREATE OR REPLACE VIEW grafana_pgc_audience_reach_24h
WITH (security_barrier = true) AS
WITH cut AS (
    SELECT (extract(epoch FROM now()) * 1000)::BIGINT - 86400000 AS since_ms
), deliveries AS MATERIALIZED (
    SELECT
        r.agent_id,
        lower(author.email) LIKE '%@pgc.elsewhere.internal' AS is_pgc
    FROM replay_logs r
    JOIN agents consumer ON consumer.agent_id = r.agent_id
    JOIN raw_items i USING (item_id)
    JOIN agents author ON author.agent_id = i.author_agent_id,
         cut
    WHERE r.delivered IS TRUE
      AND r.served_at >= cut.since_ms
      AND lower(consumer.email) NOT LIKE '%bot.elsewhere%'
      AND lower(consumer.email) NOT LIKE '%pgc.elsewhere%'
)
SELECT
    count(DISTINCT agent_id) AS active_agents,
    count(DISTINCT agent_id) FILTER (WHERE is_pgc) AS pgc_reached_agents,
    count(*) AS all_deliveries,
    count(*) FILTER (WHERE is_pgc) AS pgc_deliveries,
    round(
        100.0 * count(*) FILTER (WHERE is_pgc) / NULLIF(count(*), 0),
        1
    ) AS pgc_delivery_share
FROM deliveries;

CREATE OR REPLACE VIEW grafana_pgc_demand_supply_24h
WITH (security_barrier = true) AS
WITH cut AS (
    SELECT (extract(epoch FROM now()) * 1000)::BIGINT - 86400000 AS since_ms
), active AS MATERIALIZED (
    SELECT DISTINCT
        r.agent_id,
        lower(COALESCE(p.keywords, '')) AS profile
    FROM replay_logs r
    JOIN agents consumer ON consumer.agent_id = r.agent_id
    LEFT JOIN agent_profiles p ON p.agent_id = r.agent_id,
         cut
    WHERE r.delivered IS TRUE
      AND r.served_at >= cut.since_ms
      AND lower(consumer.email) NOT LIKE '%bot.elsewhere%'
      AND lower(consumer.email) NOT LIKE '%pgc.elsewhere%'
), pgc AS MATERIALIZED (
    SELECT
        r.agent_id,
        lower(COALESCE(pi.domains, '') || ',' || COALESCE(pi.keywords, '')) AS text
    FROM replay_logs r
    JOIN active u ON u.agent_id = r.agent_id
    JOIN raw_items i USING (item_id)
    JOIN agents author ON author.agent_id = i.author_agent_id
    JOIN processed_items pi USING (item_id),
         cut
    WHERE r.delivered IS TRUE
      AND r.served_at >= cut.since_ms
      AND lower(author.email) LIKE '%@pgc.elsewhere.internal'
), buckets(ord, key, label, rx) AS (
    VALUES
        (1, 'automation_workflow', '自动化 / workflow', 'automat|workflow|pipeline|orchestrat|agent loop|自动化|工作流|编排'),
        (2, 'finance_trading', '金融 / 交易', 'financ|trading|trade|market|stock|crypto|invest|macro|equit|ticker|金融|交易|投资|行情|股'),
        (3, 'research_signal', '研究 / 信号 / 情报', 'research|paper|arxiv|benchmark|signal|intel|intelligence|news|trend|discover|insight|study|科研|论文|信号|情报|研究|前沿'),
        (4, 'mcp_tools', 'MCP / 工具 / skill', 'mcp|tool|skill|plugin|integration|api|connector|工具|技能|插件'),
        (5, 'frameworks_infra', '框架 / 基建', 'framework|infra|infrastructure|deploy|platform|sdk|runtime|hosting|scal|框架|基建|部署'),
        (6, 'startup_funding', '创业 / 融资', 'startup|founder|fundrais|funding|vc|seed round|venture|raise|创业|融资|投融资')
), measured AS (
    SELECT
        b.ord,
        b.key,
        b.label,
        (SELECT count(*) FROM active a WHERE a.profile ~ b.rx) AS demand_agents,
        (
            SELECT count(DISTINCT p.agent_id)
            FROM pgc p
            JOIN active a USING (agent_id)
            WHERE a.profile ~ b.rx
        ) AS reached_demand_agents,
        100.0 * (SELECT count(*) FROM active a WHERE a.profile ~ b.rx)
            / NULLIF((SELECT count(*) FROM active), 0) AS demand_share,
        100.0 * (SELECT count(*) FROM pgc p WHERE p.text ~ b.rx)
            / NULLIF((SELECT count(*) FROM pgc), 0) AS exposure_share,
        100.0 * (
            SELECT count(*)
            FROM pgc p
            JOIN active a USING (agent_id)
            WHERE a.profile ~ b.rx AND p.text ~ b.rx
        ) / NULLIF((
            SELECT count(*)
            FROM pgc p
            JOIN active a USING (agent_id)
            WHERE a.profile ~ b.rx
        ), 0) AS within_cohort_match
    FROM buckets b
)
SELECT
    ord,
    key,
    label,
    demand_agents,
    reached_demand_agents,
    round(demand_share, 1) AS demand_share,
    round(exposure_share, 1) AS exposure_share,
    round(within_cohort_match, 1) AS within_cohort_match,
    round(demand_share - exposure_share, 1) AS supply_gap,
    CASE
        WHEN demand_share - exposure_share >= 15 THEN '优先补充一手源'
        WHEN demand_share - exposure_share >= 5 THEN '继续补充'
        ELSE '已有覆盖'
    END AS next_step
FROM measured;

CREATE OR REPLACE VIEW grafana_pgc_feedback_7d
WITH (security_barrier = true) AS
WITH cut AS (
    SELECT (extract(epoch FROM now()) * 1000)::BIGINT - 604800000 AS since_ms
), feedback AS MATERIALIZED (
    SELECT
        f.agent_id,
        f.score,
        CASE
            WHEN lower(author.email) LIKE '%@pgc.elsewhere.internal' THEN 'PGC'
            ELSE 'UGC'
        END AS lane
    FROM feedback_logs f
    JOIN agents consumer ON consumer.agent_id = f.agent_id
    JOIN raw_items i USING (item_id)
    JOIN agents author ON author.agent_id = i.author_agent_id,
         cut
    WHERE f.feedback_at >= cut.since_ms
      AND lower(consumer.email) NOT LIKE '%bot.elsewhere%'
      AND lower(consumer.email) NOT LIKE '%pgc.elsewhere%'
)
SELECT
    lane,
    count(*) AS feedback_events,
    count(DISTINCT agent_id) AS feedback_agents,
    round(100.0 * count(*) FILTER (WHERE score IN (1, 2)) / count(*), 1) AS positive_rate,
    round(100.0 * count(*) FILTER (WHERE score = -1) / count(*), 1) AS discard_rate,
    round(100.0 * count(*) FILTER (WHERE score = 0) / count(*), 1) AS consumed_only_rate
FROM feedback
GROUP BY lane;

CREATE OR REPLACE VIEW grafana_pgc_surface_7d
WITH (security_barrier = true) AS
WITH cut AS (
    SELECT (extract(epoch FROM now()) * 1000)::BIGINT - 604800000 AS since_ms
), reporters AS MATERIALIZED (
    SELECT DISTINCT f.agent_id
    FROM followup_labels f
    JOIN agents consumer ON consumer.agent_id = f.agent_id,
         cut
    WHERE f.reported_at >= cut.since_ms
      AND lower(consumer.email) NOT LIKE '%bot.elsewhere%'
      AND lower(consumer.email) NOT LIKE '%pgc.elsewhere%'
), deliveries AS MATERIALIZED (
    SELECT
        r.agent_id,
        CASE
            WHEN lower(author.email) LIKE '%@pgc.elsewhere.internal' THEN 'PGC'
            ELSE 'UGC'
        END AS lane
    FROM replay_logs r
    JOIN reporters q USING (agent_id)
    JOIN raw_items i USING (item_id)
    JOIN agents author ON author.agent_id = i.author_agent_id,
         cut
    WHERE r.delivered IS TRUE AND r.served_at >= cut.since_ms
), surfaces AS MATERIALIZED (
    SELECT
        f.agent_id,
        CASE
            WHEN lower(author.email) LIKE '%@pgc.elsewhere.internal' THEN 'PGC'
            ELSE 'UGC'
        END AS lane
    FROM followup_labels f
    JOIN reporters q USING (agent_id)
    JOIN raw_items i USING (item_id)
    JOIN agents author ON author.agent_id = i.author_agent_id,
         cut
    WHERE f.kind = 'surface' AND f.reported_at >= cut.since_ms
), delivery_agg AS (
    SELECT lane, count(*) AS delivered, count(DISTINCT agent_id) AS reporters
    FROM deliveries
    GROUP BY lane
), surface_agg AS (
    SELECT lane, count(*) AS surfaced
    FROM surfaces
    GROUP BY lane
)
SELECT
    d.lane,
    d.reporters,
    d.delivered,
    COALESCE(s.surfaced, 0) AS surfaced,
    round(100.0 * COALESCE(s.surfaced, 0) / NULLIF(d.delivered, 0), 2) AS surface_rate
FROM delivery_agg d
LEFT JOIN surface_agg s USING (lane);

CREATE OR REPLACE VIEW grafana_pgc_profile_completeness
WITH (security_barrier = true) AS
WITH general AS MATERIALIZED (
    SELECT p.keywords, p.profile_data
    FROM agent_profiles p
    JOIN agents account USING (agent_id)
    WHERE lower(account.email) NOT LIKE '%bot.elsewhere%'
      AND lower(account.email) NOT LIKE '%pgc.elsewhere%'
), fields(ord, key, label, agents) AS (
    SELECT 1, 'durable_interests', '长期兴趣', count(*) FILTER (
        WHERE nullif(trim(keywords), '') IS NOT NULL
    ) FROM general
    UNION ALL SELECT 2, 'current_focus', '当前关注', count(*) FILTER (
        WHERE profile_data ? 'current_focus'
          AND profile_data->'current_focus' NOT IN ('null'::JSONB, '[]'::JSONB)
    ) FROM general
    UNION ALL SELECT 3, 'demands', '明确需求', count(*) FILTER (
        WHERE profile_data ? 'demands'
          AND profile_data->'demands' NOT IN ('null'::JSONB, '[]'::JSONB)
    ) FROM general
    UNION ALL SELECT 4, 'seeking', '正在寻找', count(*) FILTER (
        WHERE profile_data ? 'seeking'
          AND profile_data->'seeking' NOT IN ('null'::JSONB, '[]'::JSONB)
    ) FROM general
    UNION ALL SELECT 5, 'offering', '可以提供', count(*) FILTER (
        WHERE profile_data ? 'offering'
          AND profile_data->'offering' NOT IN ('null'::JSONB, '[]'::JSONB)
    ) FROM general
    UNION ALL SELECT 6, 'negative_interests', '不想看到', count(*) FILTER (
        WHERE profile_data ? 'interests_negative'
          AND profile_data->'interests_negative' NOT IN ('null'::JSONB, '[]'::JSONB)
    ) FROM general
)
SELECT
    ord,
    key,
    label,
    agents AS completed_agents,
    (SELECT count(*) FROM general) AS total_agents,
    round(100.0 * agents / NULLIF((SELECT count(*) FROM general), 0), 1) AS coverage_rate
FROM fields;

REVOKE ALL ON grafana_pgc_audience_reach_24h FROM PUBLIC;
REVOKE ALL ON grafana_pgc_demand_supply_24h FROM PUBLIC;
REVOKE ALL ON grafana_pgc_feedback_7d FROM PUBLIC;
REVOKE ALL ON grafana_pgc_surface_7d FROM PUBLIC;
REVOKE ALL ON grafana_pgc_profile_completeness FROM PUBLIC;

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_ro_v2') THEN
        GRANT SELECT ON grafana_pgc_audience_reach_24h TO grafana_ro_v2;
        GRANT SELECT ON grafana_pgc_demand_supply_24h TO grafana_ro_v2;
        GRANT SELECT ON grafana_pgc_feedback_7d TO grafana_ro_v2;
        GRANT SELECT ON grafana_pgc_surface_7d TO grafana_ro_v2;
        GRANT SELECT ON grafana_pgc_profile_completeness TO grafana_ro_v2;
    END IF;
END
$$;
-- +goose StatementEnd

COMMENT ON VIEW grafana_pgc_audience_reach_24h IS
    'Anonymous 24-hour PGC reach and delivery aggregates for Grafana.';
COMMENT ON VIEW grafana_pgc_demand_supply_24h IS
    'Anonymous 24-hour fixed-bucket demand and PGC exposure aggregates for Grafana.';
COMMENT ON VIEW grafana_pgc_feedback_7d IS
    'Anonymous 7-day PGC/UGC downstream triage aggregates for Grafana.';
COMMENT ON VIEW grafana_pgc_surface_7d IS
    'Anonymous 7-day PGC/UGC surface aggregates for Grafana.';
COMMENT ON VIEW grafana_pgc_profile_completeness IS
    'Anonymous profile-field completion aggregates for Grafana.';

-- PGC source governance needs repeated downstream-outcome evidence, but the
-- PGC host must never receive user-level feedback rows. Collapse each agent to
-- one vote distribution per source/source class first, then expose only groups
-- with a meaningful anonymity and evidence floor.
CREATE OR REPLACE VIEW pgc_feedback_outcomes_7d
WITH (security_barrier = true) AS
WITH cut AS (
    SELECT (extract(epoch FROM now()) * 1000)::BIGINT - 604800000 AS since_ms
), feedback AS MATERIALIZED (
    SELECT
        f.agent_id,
        f.score,
        CASE
            WHEN i.raw_notes IS JSON THEN i.raw_notes::JSONB
            ELSE '{}'::JSONB
        END AS notes
    FROM feedback_logs f
    JOIN agents consumer ON consumer.agent_id = f.agent_id
    JOIN raw_items i USING (item_id)
    JOIN agents author ON author.agent_id = i.author_agent_id,
         cut
    WHERE f.feedback_at >= cut.since_ms
      AND lower(author.email) LIKE '%@pgc.elsewhere.internal'
      AND lower(consumer.email) NOT LIKE '%bot.elsewhere%'
      AND lower(consumer.email) NOT LIKE '%pgc.elsewhere%'
), attributed AS MATERIALIZED (
    SELECT
        agent_id,
        score,
        nullif(trim(notes #>> '{evidence,source_name}'), '') AS source_name,
        COALESCE(
            nullif(trim(notes #>> '{evidence,source_class}'), ''),
            'unclassified'
        ) AS source_class
    FROM feedback
), scoped AS (
    SELECT agent_id, score, 'source'::TEXT AS scope, source_name AS name
    FROM attributed
    WHERE source_name IS NOT NULL
    UNION ALL
    SELECT agent_id, score, 'source_class'::TEXT AS scope, source_class AS name
    FROM attributed
), agent_bucket AS (
    SELECT
        scope,
        name,
        agent_id,
        count(*) AS events,
        count(*) FILTER (WHERE score IN (1, 2)) AS positive,
        count(*) FILTER (WHERE score = 2) AS strong_positive,
        count(*) FILTER (WHERE score = -1) AS discarded
    FROM scoped
    GROUP BY scope, name, agent_id
    HAVING count(*) >= 3
), aggregate_bucket AS (
    SELECT
        scope,
        name,
        count(*) AS agents,
        sum(events) AS feedback_events,
        round(avg(100.0 * positive / events), 1) AS agent_equal_positive_rate,
        round(avg(100.0 * discarded / events), 1) AS agent_equal_discard_rate,
        round(avg(100.0 * strong_positive / events), 1) AS agent_equal_strong_positive_rate,
        round(100.0 * sum(positive) / sum(events), 1) AS raw_positive_rate,
        round(100.0 * sum(discarded) / sum(events), 1) AS raw_discard_rate
    FROM agent_bucket
    GROUP BY scope, name
    HAVING count(*) >= 20 AND sum(events) >= 100
)
SELECT
    scope,
    name,
    agents,
    feedback_events,
    agent_equal_positive_rate,
    agent_equal_discard_rate,
    agent_equal_strong_positive_rate,
    raw_positive_rate,
    raw_discard_rate,
    round(100.0 * feedback_events / NULLIF((SELECT count(*) FROM feedback), 0), 2)
        AS feedback_event_share
FROM aggregate_bucket;

REVOKE ALL ON pgc_feedback_outcomes_7d FROM PUBLIC;

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgc_demand') THEN
        GRANT SELECT ON pgc_feedback_outcomes_7d TO pgc_demand;
        GRANT SELECT ON grafana_pgc_feedback_7d TO pgc_demand;
        GRANT SELECT ON grafana_pgc_surface_7d TO pgc_demand;
    END IF;
END
$$;
-- +goose StatementEnd

COMMENT ON VIEW pgc_feedback_outcomes_7d IS
    'Anonymous seven-day PGC source outcomes. Each agent is equal-weighted; '
    'only groups with at least 20 agents and 100 feedback events are exposed.';

-- The daily strong-feedback panel used to execute the full 90-day join on
-- every Grafana refresh. Production evidence on 2026-08-28 showed one read
-- touching 7.2M buffers and taking 4.86s. Keep the anonymous aggregate, but
-- compute it once per refresh instead of once per viewer.
DROP MATERIALIZED VIEW IF EXISTS grafana_pgc_strong_feedback_daily;

CREATE MATERIALIZED VIEW grafana_pgc_strong_feedback_daily AS
WITH bounds AS (
    SELECT
        (now() AT TIME ZONE 'Asia/Shanghai')::date AS today,
        ((extract(epoch FROM now()) * 1000)::BIGINT - 7862400000) AS since_ms,
        now() AS snapshot_at
), calendar AS (
    SELECT generate_series(today - 89, today, interval '1 day')::date AS day
    FROM bounds
), feedback AS MATERIALIZED (
    SELECT
        (to_timestamp(f.feedback_at / 1000.0)
            AT TIME ZONE 'Asia/Shanghai')::date AS day,
        f.agent_id,
        f.score
    FROM feedback_logs f
    JOIN agents consumer ON consumer.agent_id = f.agent_id
    JOIN raw_items i USING (item_id)
    JOIN agents author ON author.agent_id = i.author_agent_id,
         bounds
    WHERE f.feedback_at >= bounds.since_ms
      AND lower(author.email) LIKE '%@pgc.elsewhere.internal'
      AND lower(consumer.email) NOT LIKE '%bot.elsewhere%'
      AND lower(consumer.email) NOT LIKE '%pgc.elsewhere%'
), daily AS (
    SELECT
        day,
        count(*) AS feedback_events,
        count(*) FILTER (WHERE score = 2) AS strong_positive_events,
        count(DISTINCT agent_id) AS feedback_agents
    FROM feedback
    GROUP BY day
)
SELECT
    c.day,
    COALESCE(d.feedback_events, 0) AS feedback_events,
    COALESCE(d.strong_positive_events, 0) AS strong_positive_events,
    COALESCE(d.feedback_agents, 0) AS feedback_agents,
    round(
        100.0 * COALESCE(d.strong_positive_events, 0)
            / NULLIF(d.feedback_events, 0),
        1
    ) AS strong_positive_rate,
    b.snapshot_at
FROM calendar c
LEFT JOIN daily d USING (day)
CROSS JOIN bounds b
ORDER BY c.day;

CREATE UNIQUE INDEX uq_grafana_pgc_strong_feedback_daily_day
    ON grafana_pgc_strong_feedback_daily (day);

REVOKE ALL ON grafana_pgc_strong_feedback_daily FROM PUBLIC;

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_ro_v2') THEN
        GRANT SELECT ON grafana_pgc_strong_feedback_daily TO grafana_ro_v2;
    END IF;
END
$$;
-- +goose StatementEnd
COMMENT ON MATERIALIZED VIEW grafana_pgc_strong_feedback_daily IS
    'Anonymous daily PGC score=2 feedback totals, refreshed every five minutes. '
    'Days use Asia/Shanghai event time; user-level feedback remains private.';

-- The dependent snapshot survives CREATE OR REPLACE and is refreshed within
-- this same migration, so dashboards never retain the previous classification.
REFRESH MATERIALIZED VIEW grafana_pgc_demand_supply_24h_snapshot;

-- +goose Down
-- Definitions stay on the current namespace; rollback must not restore obsolete
-- classification rules or rewrite account identities and source events.
SELECT 1;
