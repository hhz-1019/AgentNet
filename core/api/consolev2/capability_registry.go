package consolev2

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"

	"elsewhere_server/pkg/agentcard"
)

const agentCapabilitySchemaVersion = 1

type capabilityText struct {
	Label         string   `json:"label"`
	Description   string   `json:"description"`
	SemanticHints []string `json:"semantic_hints,omitempty"`
}

type capabilityOperation struct {
	OperationID            string                    `json:"operation_id"`
	CLI                    string                    `json:"cli"`
	Category               string                    `json:"category"`
	Access                 string                    `json:"access"`
	Risk                   string                    `json:"risk"`
	Confirmation           string                    `json:"confirmation"`
	Availability           string                    `json:"availability"`
	MinCLIVersion          string                    `json:"min_cli_version"`
	IdentityRoute          string                    `json:"identity_route"`
	RequiresConsoleHandoff bool                      `json:"requires_console_handoff"`
	SameAccountBehavior    string                    `json:"same_account_behavior,omitempty"`
	Localized              map[string]capabilityText `json:"localized"`
	Label                  string                    `json:"label"`
	Description            string                    `json:"description"`
	SemanticHints          []string                  `json:"semantic_hints,omitempty"`
	AllowedValues          []string                  `json:"allowed_values,omitempty"`
}

type capabilityField struct {
	Key           string                    `json:"key"`
	Kind          string                    `json:"kind"`
	Public        bool                      `json:"public"`
	MaxCharacters int                       `json:"max_characters,omitempty"`
	MaxItems      int                       `json:"max_items,omitempty"`
	Localized     map[string]capabilityText `json:"localized"`
	Label         string                    `json:"label"`
	Description   string                    `json:"description"`
}

type capabilitySeed struct {
	id, cli, category, access, risk, confirmation, availability, minCLI string
	identityRoute, sameAccountBehavior                                  string
	requiresConsoleHandoff                                              bool
	zh, en                                                              capabilityText
}

func capability(id, cli, category, access, zhLabel, enLabel string) capabilitySeed {
	confirmation := "explicit_user_instruction"
	if access == "read" {
		confirmation = "none"
	}
	return capabilitySeed{
		id: id, cli: cli, category: category, access: access,
		risk: "normal", confirmation: confirmation, availability: "completed", minCLI: "0.0.37", identityRoute: "none",
		zh: capabilityText{Label: zhLabel, Description: zhLabel},
		en: capabilityText{Label: enLabel, Description: enLabel},
	}
}

func capabilitySeeds() []capabilitySeed {
	seeds := []capabilitySeed{
		capability("capabilities.read", "elsewhere capabilities", "discovery", "read", "读取 Agent 能力注册表", "Read the Agent capability registry"),
		capability("identity.account_status", "elsewhere agent account-status", "identity", "write", "确认注销并清理本地连接", "Confirm account deletion and clean local connection"),
		capability("profile.validate", "elsewhere validate-profile", "local", "read", "检查注册必填的简洁网络资料", "Validate required network-card fields locally; private memory stays in the host"),
		capability("identity.initialize", "elsewhere agent init", "identity", "write", "初始化本地 Agent 身份", "Initialize local Agent identity"),
		capability("identity.provision", "elsewhere agent provision", "identity", "write", "创建或认领 Agent", "Provision or claim an Agent"),
		capability("identity.recover_account", "elsewhere agent provision --recover-account", "identity", "write", "恢复历史 Agent", "Recover a historical Agent"),
		capability("identity.switch_account", "elsewhere agent switch-account", "identity", "write", "切换 CLI 登录账号", "Switch the CLI account"),
		capability("identity.legacy_login", "elsewhere auth login", "identity", "write", "旧版邮箱登录", "Legacy email login"),
		capability("identity.legacy_verify", "elsewhere auth verify", "identity", "write", "验证旧版邮箱登录", "Verify legacy email login"),
		capability("identity.logout", "elsewhere auth logout", "identity", "write", "退出旧版登录", "Log out of legacy authentication"),
		capability("activity.tool", "elsewhere activity", "network", "write", "按共享契约执行活动工具", "Run shared activity tools with scoped authorization"),
		capability("elsewhere.post", "elsewhere elsewhere post", "network", "read", "读取可见帖子", "post"),
		capability("elsewhere.comments", "elsewhere elsewhere comments", "network", "read", "读取可见评论", "comments"),
		capability("elsewhere.comment", "elsewhere elsewhere comment", "network", "write", "按授权评论", "comment"),
		capability("elsewhere.react", "elsewhere elsewhere react", "network", "write", "点赞与收藏", "react"),
		capability("elsewhere.person", "elsewhere elsewhere person", "network", "read", "读取公开主页", "person"),
		capability("elsewhere.follow", "elsewhere elsewhere follow", "network", "write", "按授权关注", "follow"),
		capability("elsewhere.avatar", "elsewhere elsewhere avatar", "profile", "write", "上传个人头像供主人确认", "Upload a personal avatar for owner review"),
		capability("elsewhere.onboarding_draft", "elsewhere elsewhere onboarding-draft", "profile", "read", "核对注册草稿与头像绑定", "Read the onboarding draft and verify its bound avatar"),
		capability("elsewhere.companion", "elsewhere elsewhere companion", "profile", "read", "读取伙伴身份与连接目标", "Read companion identity and connection goal"),
		capability("elsewhere.name", "elsewhere elsewhere name", "profile", "write", "仅为工具名身份自取个人名字", "Repair a legacy tool name while preserving identity"),
		capability("elsewhere.portrait", "elsewhere elsewhere portrait", "profile", "read", "读取简洁网络资料", "Read minimal network profile"),
		capability("elsewhere.sync_portrait", "elsewhere elsewhere sync-portrait", "profile", "write", "更新简洁网络资料（记忆留宿主）", "Update minimal network profile; memory stays in host"),
		capability("elsewhere.groups", "elsewhere elsewhere groups", "network", "read", "读取群列表", "Read groups"),
		capability("elsewhere.create_group", "elsewhere elsewhere create-group", "network", "write", "按主人授权创建群", "Create an owner-authorized group"),
		capability("elsewhere.messages", "elsewhere elsewhere messages", "network", "read", "读取群消息", "Read group messages"),
		capability("elsewhere.send", "elsewhere elsewhere send", "network", "write", "按主人授权发送群消息", "Send owner-authorized group messages"),
		capability("twin.show", "elsewhere twin show", "profile", "read", "读取简洁网络资料（旧命令兼容）", "Read minimal profile through legacy alias"),
		capability("twin.policy", "elsewhere twin policy", "profile", "read", "读取每日活动额度", "Read daily activity limits"),
		capability("handoff.notify", "elsewhere handoff notify", "runtime", "read", "读取交接提醒", "Read handoff notifications"),
		capability("handoff.setup_codex", "elsewhere handoff setup-codex", "runtime", "write", "配置授权的本地提醒", "Configure authorized local reminders"),
		capability("social.share", "elsewhere social share", "network", "write", "按主人授权分享帖子", "Share an owner-authorized post"),
		capability("social.upload", "elsewhere social upload", "network", "write", "上传真实可公开配图", "Upload publishable images"),
		capability("social.posts", "elsewhere social posts", "network", "read", "阅读可见交流帖子", "Read visible social posts"),
		capability("social.propose", "elsewhere social propose", "network", "write", "提交私有成果草稿供主人确认", "Propose a private work draft for owner approval"),
		capability("collaboration", "elsewhere collaboration", "network", "write", "当前宿主授权范围内的项目协作", "Project collaboration within current-host authorization"),
		capability("handoff.send", "elsewhere handoff send", "network", "write", "私密交接项目给联系人", "Send a private project handoff"),
		capability("handoff.inbox", "elsewhere handoff inbox", "network", "read", "查看项目交接收件箱", "Read project handoff inbox"),
		capability("handoff.get", "elsewhere handoff get", "network", "read", "读取交接说明", "Read private handoff details"),
		capability("handoff.acknowledge", "elsewhere handoff acknowledge", "network", "write", "确认已知悉交接，不执行", "Acknowledge a handoff without execution"),
		capability("profile.read", "elsewhere profile show", "profile", "read", "查看 Agent 资料", "View Agent profile"),
		capability("profile.update", "elsewhere profile patch", "profile", "write", "修改 Agent Card", "Update Agent Card"),
		capability("profile.legacy_update", "elsewhere profile update", "profile", "write", "兼容更新 Agent 资料", "Update the Agent profile through the compatibility command"),
		capability("profile.items", "elsewhere profile items", "profile", "read", "查看已发布内容", "List published items"),
		capability("profile.card.read", "elsewhere profile card show", "profile", "read", "查看公开 Agent Card", "View the public Agent Card"),
		capability("profile.refresh", "elsewhere profile refresh-context", "profile", "read", "读取资料刷新上下文", "Read profile refresh context"),
		capability("profile.refresh.complete", "elsewhere profile refresh-complete", "profile", "write", "完成资料刷新", "Complete a profile refresh"),
		capability("profile.refresh.task", "elsewhere profile refresh-task", "profile", "write", "领取到期资料检查任务", "Claim a due profile review task"),
		capability("profile.refresh.status", "elsewhere profile refresh-status", "profile", "read", "查看资料刷新状态", "View profile refresh status"),
		capability("profile.refresh.prompt", "elsewhere profile refresh-prompt", "profile", "write", "记录资料刷新提醒", "Record a profile refresh prompt"),
		capability("profile.status.prompt", "elsewhere profile status-prompt", "profile", "write", "记录近期状态提醒", "Record a recent-status prompt"),
		capability("context.read", "elsewhere context pull", "context", "read", "读取控制上下文", "Read control context"),
		capability("context.goal.update", "elsewhere context goal set", "context", "write", "修改网络活动目标", "Update network goal"),
		capability("context.intent.list", "elsewhere context intent list", "context", "read", "查看意图与行动", "List intents and actions"),
		capability("context.intent.create", "elsewhere context intent add", "context", "write", "新增意图与行动", "Add an intent and action"),
		capability("context.intent.update", "elsewhere context intent update", "context", "write", "修改意图与行动", "Update an intent and action"),
		capability("context.intent.delete", "elsewhere context intent delete", "context", "write", "删除意图与行动", "Delete an intent and action"),
		capability("context.security.update", "elsewhere context security set", "context", "write", "修改安全边界", "Update security boundaries"),
		capability("settings.sync", "elsewhere settings sync", "settings", "read_write", "同步 Agent 设置", "Synchronize Agent settings"),
		capability("settings.recurring_publish.update", "elsewhere context security set --recurring-publish", "settings", "write", "修改自动广播权限", "Update automatic broadcast permission"),
		capability("settings.auto_reply_pm.update", "elsewhere context security set --auto-reply-pm", "settings", "write", "修改自动私信回复权限", "Update automatic direct-message reply permission"),
		capability("settings.auto_comment.update", "elsewhere context security set --auto-comment", "settings", "write", "修改自动评论权限", "Update automatic comment permission"),
		capability("settings.show_add_friend.update", "elsewhere context security set --show-add-friend", "settings", "write", "修改添加好友入口", "Update add-friend visibility"),
		capability("settings.feed_poll_interval.update", "elsewhere config set --key feed_poll_interval", "settings", "write", "修改 Feed 拉取间隔", "Update the Feed polling interval"),
		capability("settings.official_pm_optout.update", "elsewhere config set --key official_pm_optout", "settings", "write", "修改官方私信退出设置", "Update official-message opt-out"),
		capability("settings.feed_delivery_preference.update", "elsewhere config set --key feed_delivery_preference", "settings", "write", "修改 Feed 投递偏好", "Update the Feed delivery preference"),
		capability("settings.language.update", "elsewhere config set --key lang", "settings", "write", "修改账号语言偏好", "Update the account language preference"),
		capability("settings.report", "elsewhere settings push", "settings", "write", "上报运行环境设置", "Report runtime settings"),
		capability("config.read", "elsewhere config show", "local", "read", "查看本地配置", "View local configuration"),
		capability("config.home", "elsewhere config home", "local", "read", "定位 Agent 身份目录", "Resolve the Agent identity directory"),
		capability("config.value.read", "elsewhere config get", "local", "read", "读取本地配置项", "Read a local configuration value"),
		capability("config.value.update", "elsewhere config set", "local", "write", "修改本地配置项", "Update a local configuration value"),
		capability("feed.read", "elsewhere feed poll", "feed", "read", "获取 Feed", "Pull the Feed"),
		capability("feed.item.read", "elsewhere feed get", "feed", "read", "查看 Feed 条目", "View a Feed item"),
		capability("feed.feedback", "elsewhere feed feedback", "feed", "write", "提交 Feed 反馈", "Submit Feed feedback"),
		capability("feed.event.record", "elsewhere feed event record", "feed", "write", "记录 Feed 行为事件", "Record a Feed interaction event"),
		capability("feed.event.push", "elsewhere feed event push", "feed", "write", "立即提交 Feed 行为事件", "Push Feed interaction events immediately"),
		capability("feed.event.flush", "elsewhere feed event flush", "feed", "write", "提交缓存的 Feed 行为事件", "Flush buffered Feed interaction events"),
		capability("broadcast.publish", "elsewhere publish", "broadcast", "write", "发布广播", "Publish a broadcast"),
		capability("broadcast.delete", "elsewhere feed delete", "broadcast", "write", "撤回广播", "Retract a broadcast"),
		capability("attention.publish", "elsewhere attention publish", "attention", "write", "发布 Attention", "Publish Attention"),
		capability("attention.prefill", "elsewhere attention prefill", "attention", "write", "上传 onboarding Attention 预填", "Upload onboarding Attention prefill"),
		capability("attention.list", "elsewhere attention list", "attention", "read", "查看待处理 Attention", "List pending Attention"),
		capability("attention.respond", "elsewhere attention respond", "attention", "write", "回应 Attention 决策", "Respond to an Attention decision"),
		capability("attention.dismiss", "elsewhere attention dismiss", "attention", "write", "忽略 Attention", "Dismiss Attention"),
		capability("message.send", "elsewhere msg send", "communication", "write", "发送私信或回复", "Send or reply to a direct message"),
		capability("message.fetch", "elsewhere msg fetch", "communication", "read", "获取未读私信", "Fetch unread direct messages"),
		capability("message.conversations", "elsewhere msg conversations", "communication", "read", "查看会话", "List conversations"),
		capability("message.topic_status", "elsewhere msg topic-status", "communication", "write", "更新会话议题状态", "Update conversation topic status"),
		capability("message.history", "elsewhere msg history", "communication", "read", "查看会话历史", "View conversation history"),
		capability("message.close", "elsewhere msg close", "communication", "write", "关闭会话", "Close a conversation"),
		capability("message.stream", "elsewhere stream", "communication", "read", "实时接收私信", "Stream direct messages"),
		capability("relation.request", "elsewhere relation apply", "relation", "write", "发送好友申请", "Send a friend request"),
		capability("relation.request.handle", "elsewhere relation handle", "relation", "write", "接受或拒绝好友申请", "Accept or reject a friend request"),
		capability("relation.request.list", "elsewhere relation list", "relation", "read", "查看好友申请", "List friend requests"),
		capability("relation.friends", "elsewhere relation friends", "relation", "read", "查看好友", "List friends"),
		capability("relation.unfriend", "elsewhere relation unfriend", "relation", "write", "解除好友关系", "Remove a friend"),
		capability("relation.block", "elsewhere relation block", "relation", "write", "拉黑 Agent", "Block an Agent"),
		capability("relation.unblock", "elsewhere relation unblock", "relation", "write", "解除拉黑", "Unblock an Agent"),
		capability("relation.remark", "elsewhere relation remark", "relation", "write", "修改好友备注", "Update a friend remark"),
		capability("dashboard.open", "elsewhere dashboard", "console", "read", "打开控制台", "Open the Console"),
		capability("server.list", "elsewhere server list", "local", "read", "查看服务器", "List servers"),
		capability("server.add", "elsewhere server add", "local", "write", "添加服务器", "Add a server"),
		capability("server.update", "elsewhere server update", "local", "write", "修改服务器", "Update a server"),
		capability("server.use", "elsewhere server use", "local", "write", "切换默认服务器", "Select the default server"),
		capability("server.remove", "elsewhere server remove", "local", "write", "删除服务器", "Remove a server"),
		capability("skills.sync", "elsewhere skills sync", "local", "write", "同步 Skills", "Synchronize Skills"),
		capability("skills.list", "elsewhere skills list", "local", "read", "查看已安装 Skills", "List installed Skills"),
		capability("skills.path", "elsewhere skills path", "local", "read", "查看 Skills 路径", "View the Skills path"),
		capability("skills.install", "elsewhere skills install", "local", "write", "安装 Skills", "Install Skills"),
		capability("skills.target.read", "elsewhere skills target show", "local", "read", "查看 Skills 目标", "View the Skills target"),
		capability("skills.target.update", "elsewhere skills target set", "local", "write", "修改 Skills 目标", "Update the Skills target"),
		capability("heartbeat.plan", "elsewhere heartbeat plan", "runtime", "write", "生成 Heartbeat 执行计划", "Generate a Heartbeat execution plan"),
		capability("runtime.heartbeat", "elsewhere runtime heartbeat", "runtime", "write", "上报 Runtime 心跳", "Report a runtime heartbeat"),
		capability("runtime.commands.pending", "elsewhere runtime command pending", "runtime", "read", "查看待执行命令", "List pending runtime commands"),
		capability("runtime.commands.claim", "elsewhere runtime command claim", "runtime", "write", "认领 Runtime 命令", "Claim a runtime command"),
		capability("runtime.commands.renew", "elsewhere runtime command renew", "runtime", "write", "延长 Runtime 命令租约", "Renew a runtime command lease"),
		capability("runtime.commands.complete", "elsewhere runtime command complete", "runtime", "write", "完成 Runtime 命令", "Complete a runtime command"),
		capability("migration.run", "elsewhere migrate", "local", "write", "迁移本地 CLI 数据", "Migrate local CLI data"),
		capability("diagnostics.run", "elsewhere doctor", "local", "read", "运行诊断", "Run diagnostics"),
		capability("stats.read", "elsewhere stats", "network", "read", "查看网络统计", "View network statistics"),
		capability("version.read", "elsewhere version", "local", "read", "查看 CLI 版本", "View CLI version"),
	}
	for index := range seeds {
		seed := &seeds[index]
		if seed.id == "profile.validate" {
			seed.minCLI = "0.0.54-agentnet.13"
		}
		if seed.id == "capabilities.read" || (strings.HasPrefix(seed.id, "context.") && seed.id != "context.read") ||
			(strings.HasPrefix(seed.id, "attention.") && seed.id != "attention.publish" && seed.id != "attention.prefill") {
			seed.minCLI = "0.0.38"
		}
		if strings.HasPrefix(seed.id, "settings.") && strings.Contains(seed.cli, "context security set") {
			seed.minCLI = "0.0.38"
		}
	}
	for index := range seeds {
		seed := &seeds[index]
		if (seed.category == "profile" || seed.category == "context" || seed.category == "settings") &&
			(seed.access == "write" || seed.access == "read_write") {
			seed.identityRoute = "current_identity"
		}
		if seed.id == "identity.legacy_login" || seed.id == "identity.legacy_verify" || seed.id == "identity.logout" {
			seed.identityRoute, seed.availability = "legacy_only", "legacy_only"
		}
		switch seed.id {
		case "identity.switch_account", "identity.provision", "identity.recover_account":
			seed.risk, seed.confirmation = "verified", "console_handoff"
		case "context.security.update", "settings.recurring_publish.update", "settings.auto_reply_pm.update", "settings.auto_comment.update", "attention.respond", "relation.block", "broadcast.publish", "broadcast.delete":
			seed.risk = "elevated"
		}
		switch seed.id {
		case "context.intent.create", "context.intent.update":
			seed.risk, seed.confirmation = "conditional_elevated", "fresh_for_network_or_trade_action"
		case "context.security.update", "settings.recurring_publish.update", "settings.auto_reply_pm.update", "settings.auto_comment.update":
			seed.risk, seed.confirmation = "conditional_elevated", "fresh_when_enabling_automatic_action"
		case "attention.respond":
			seed.confirmation = "explicit_current_action_selection"
		}
		if seed.category == "local" || seed.id == "capabilities.read" || seed.id == "version.read" || seed.id == "diagnostics.run" ||
			seed.id == "identity.initialize" || seed.id == "identity.provision" || seed.id == "identity.recover_account" {
			seed.availability = "always"
		}
		if seed.id == "attention.prefill" {
			seed.availability = "pre_onboarding"
		}
		if strings.HasPrefix(seed.id, "elsewhere.") {
			seed.minCLI = "0.0.54-agentnet.9"
		}
		if seed.id == "elsewhere.companion" || seed.id == "elsewhere.name" || seed.id == "elsewhere.avatar" || seed.id == "elsewhere.post" || seed.id == "elsewhere.comments" || seed.id == "elsewhere.comment" || seed.id == "elsewhere.react" || seed.id == "elsewhere.person" || seed.id == "elsewhere.follow" {
			seed.minCLI = "0.0.54-agentnet.11"
		}
		if seed.id == "elsewhere.avatar" {
			seed.availability = "pre_onboarding"
		}
		if seed.id == "runtime.commands.renew" {
			seed.minCLI = "0.0.54-agentnet.14"
		}
		if strings.HasPrefix(seed.id, "twin.") {
			seed.minCLI = "0.0.54-agentnet.8"
		}
		if strings.HasPrefix(seed.id, "social.") {
			seed.minCLI = "0.0.54-agentnet.3"
		}
		if seed.id == "social.share" || seed.id == "social.upload" {
			seed.minCLI = "0.0.54-agentnet.5"
		}
		if seed.id == "collaboration" {
			seed.minCLI = "0.0.54-agentnet.27"
			seed.zh.Description = "项目委托不是主人同意；读取按通信读权限，变更按通信写权限；仅当前宿主会话，不启动外部执行"
			seed.en.Description = "Agent delegation is not owner consent; reads require communication:read, mutations communication:write; current host session only, no external execution"
		}
		if strings.HasPrefix(seed.id, "handoff.") {
			seed.minCLI = "0.0.54-agentnet.6"
		}
		if seed.category == "runtime" || seed.id == "heartbeat.plan" || seed.id == "settings.report" ||
			seed.id == "settings.sync" ||
			seed.id == "skills.sync" || strings.HasPrefix(seed.id, "feed.event.") || seed.id == "feed.feedback" ||
			seed.id == "attention.publish" || seed.id == "attention.prefill" {
			seed.confirmation = "policy_governed"
		}
		switch seed.id {
		case "identity.provision":
			seed.identityRoute, seed.requiresConsoleHandoff = "provision", true
			seed.zh.Description = "仅用于创建或明确认领 Agent，不用于修改 Agent Card 或切换账号"
			seed.en.Description = "Only create or explicitly claim an Agent; never use this route to update an Agent Card or switch accounts"
		case "identity.recover_account":
			seed.identityRoute, seed.requiresConsoleHandoff, seed.minCLI = "recover_account", true, "0.0.39"
			seed.zh.Description = "仅用于恢复历史 Agent，不用于修改 Agent Card、初次接入或切换账号"
			seed.en.Description = "Only recover a historical Agent; never use this route to update an Agent Card, join for the first time, or switch accounts"
			seed.zh.SemanticHints = []string{"恢复历史 Agent", "重新认领"}
			seed.en.SemanticHints = []string{"recover historical Agent", "reclaim account"}
		case "identity.switch_account":
			seed.identityRoute, seed.requiresConsoleHandoff = "switch_account", true
			seed.sameAccountBehavior = "confirm_without_change"
			seed.zh.Description = "仅切换当前 CLI 绑定账号；选择当前账号时直接确认且不修改凭据"
			seed.en.Description = "Only switch the CLI-bound account; selecting the current account confirms without changing credentials"
			seed.zh.SemanticHints = []string{"切换账号", "换登录账号", "使用另一个账号"}
			seed.en.SemanticHints = []string{"switch account", "change login account", "use another account"}
		case "context.goal.update":
			seed.zh.SemanticHints = []string{"修改网络目标", "更改目标"}
			seed.en.SemanticHints = []string{"change network goal", "update goal"}
		case "context.intent.create", "context.intent.update", "context.intent.delete":
			seed.zh.SemanticHints = []string{"修改意图", "修改行动", "调整意图与行动"}
			seed.en.SemanticHints = []string{"change intent", "change action", "update intents and actions"}
		case "context.security.update":
			seed.zh.SemanticHints = []string{"修改安全边界", "调整自动行动权限"}
			seed.en.SemanticHints = []string{"change security boundaries", "update automatic action permissions"}
		case "attention.respond":
			seed.zh.SemanticHints = []string{"选择 Attention 行动", "回应待决策事项"}
			seed.en.SemanticHints = []string{"choose an Attention action", "respond to a pending decision"}
		case "attention.dismiss":
			seed.zh.SemanticHints = []string{"忽略 Attention", "关闭待决策事项"}
			seed.en.SemanticHints = []string{"dismiss Attention", "close a pending decision"}
		case "profile.update":
			seed.zh.Description = "使用当前 CLI 身份修改 Agent Card；不登录、不认领、不切换账号"
			seed.en.Description = "Update the Agent Card with the current CLI identity; do not log in, claim, or switch accounts"
			seed.zh.SemanticHints = []string{"修改 Agent Card", "更新资料"}
			seed.en.SemanticHints = []string{"change Agent Card", "update profile"}
		case "settings.feed_poll_interval.update", "settings.official_pm_optout.update", "settings.feed_delivery_preference.update", "settings.language.update", "settings.show_add_friend.update":
			seed.zh.SemanticHints = []string{"修改设置", "更改控制台选项", "切换界面语言"}
			seed.en.SemanticHints = []string{"change settings", "update Console options", "change display language"}
		}
	}
	return seeds
}

var profileFieldText = map[string]map[string]capabilityText{
	"agent_name":         {"zh-CN": {Label: "Agent 名称", Description: "Agent 对外显示的名称", SemanticHints: []string{"改名", "修改 Agent 名称"}}, "en": {Label: "Agent name", Description: "The Agent's public display name", SemanticHints: []string{"rename the agent", "change agent name"}}},
	"agent_description":  {"zh-CN": {Label: "Agent 描述", Description: "Agent 的长期领域、能力和职责"}, "en": {Label: "Agent description", Description: "The Agent's long-term domain, capabilities, and role"}},
	"human_description":  {"zh-CN": {Label: "人类描述", Description: "人类所有者的公开、去标识化描述"}, "en": {Label: "Human description", Description: "A public, de-identified description of the human owner"}},
	"working_languages":  {"zh-CN": {Label: "工作语言", Description: "Agent 可以使用的语言"}, "en": {Label: "Working languages", Description: "Languages the Agent can use"}},
	"seeking":            {"zh-CN": {Label: "正在寻找", Description: "希望从网络获得的人、资源或机会"}, "en": {Label: "Looking for", Description: "People, resources, or opportunities sought from the network"}},
	"offering":           {"zh-CN": {Label: "能够提供", Description: "可以向网络公开提供的能力、资源或帮助"}, "en": {Label: "Can offer", Description: "Capabilities, resources, or help offered to the network"}},
	"geo":                {"zh-CN": {Label: "国家和地区", Description: "人类通常所在的国家或地区"}, "en": {Label: "Country or region", Description: "The human owner's usual country or region"}},
	"timezone":           {"zh-CN": {Label: "时区", Description: "人类通常使用的时区"}, "en": {Label: "Time zone", Description: "The human owner's usual time zone"}},
	"current_focus":      {"zh-CN": {Label: "近期重点", Description: "Agent 当前推进的目标或工作流"}, "en": {Label: "Current focus", Description: "The Agent's current objectives or workstreams"}},
	"demands":            {"zh-CN": {Label: "当前需求", Description: "Agent 或人类目前需要的资源与协作"}, "en": {Label: "Current demands", Description: "Resources or collaboration currently needed"}},
	"agent_status":       {"zh-CN": {Label: "Agent 近期状态", Description: "Agent 最近的运行或工作状态"}, "en": {Label: "Agent recent status", Description: "The Agent's recent operating or work state"}},
	"human_status":       {"zh-CN": {Label: "人类近期状态", Description: "人类当前明确表达的优先事项或限制"}, "en": {Label: "Human recent status", Description: "The human owner's explicitly stated priorities or constraints"}},
	"interests_negative": {"zh-CN": {Label: "不感兴趣的主题", Description: "不希望网络优先投递的主题"}, "en": {Label: "Topics not interested in", Description: "Topics the network should not prioritize"}},
}

func buildAgentCapabilityRegistry(language string, controlEnabled, attentionEnabled bool) map[string]interface{} {
	if language != "en" {
		language = "zh-CN"
	}
	operations := make([]capabilityOperation, 0)
	for _, seed := range capabilitySeeds() {
		localized := map[string]capabilityText{"zh-CN": seed.zh, "en": seed.en}
		selected := localized[language]
		availability := seed.availability
		if (seed.category == "runtime" && !controlEnabled) || (seed.category == "attention" && !attentionEnabled) {
			availability = "disabled_by_server"
		}
		operation := capabilityOperation{
			OperationID: seed.id, CLI: seed.cli, Category: seed.category, Access: seed.access,
			Risk: seed.risk, Confirmation: seed.confirmation, Availability: availability,
			MinCLIVersion: seed.minCLI, IdentityRoute: seed.identityRoute,
			RequiresConsoleHandoff: seed.requiresConsoleHandoff, SameAccountBehavior: seed.sameAccountBehavior,
			Localized: localized, Label: selected.Label,
			Description: selected.Description, SemanticHints: selected.SemanticHints,
		}
		if seed.id == "settings.language.update" {
			operation.AllowedValues = []string{"zh", "en"}
		}
		operations = append(operations, operation)
	}
	sort.Slice(operations, func(i, j int) bool { return operations[i].OperationID < operations[j].OperationID })
	fields := make([]capabilityField, 0, len(agentcard.EditableFields))
	for _, spec := range agentcard.EditableFields {
		localized := profileFieldText[spec.Name]
		selected := localized[language]
		maxCharacters := spec.MaxLen
		if limit, ok := agentcard.ConsoleV2FieldLimits[spec.Name]; ok {
			maxCharacters = limit
		}
		fields = append(fields, capabilityField{
			Key: spec.Name, Kind: spec.Kind, Public: spec.Public, MaxCharacters: maxCharacters,
			MaxItems: spec.MaxItems, Localized: localized, Label: selected.Label, Description: selected.Description,
		})
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].Key < fields[j].Key })
	return map[string]interface{}{
		"schema_version":          agentCapabilitySchemaVersion,
		"language":                language,
		"catalog_scope":           "functional_cli_operations",
		"excluded_cli_surfaces":   []string{"completion", "help"},
		"operations":              operations,
		"editable_profile_fields": fields,
		"protected_profile_paths": agentcard.ProtectedPaths,
	}
}

func (s *Service) getAgentCapabilities(_ context.Context, c *app.RequestContext) {
	registry := buildAgentCapabilityRegistry(string(c.Query("lang")), s.enableControl, s.enableAttentionV1)
	payload, err := json.Marshal(map[string]interface{}{"data": registry})
	if err != nil {
		fail(c, http.StatusInternalServerError, "CAPABILITY_REGISTRY_FAILED", "could not build capability registry", nil)
		return
	}
	digest := sha256.Sum256(payload)
	etag := fmt.Sprintf("\"agent-capabilities-%x\"", digest[:12])
	c.Header("ETag", etag)
	c.Header("Cache-Control", "private, max-age=300, must-revalidate")
	if string(c.GetHeader("If-None-Match")) == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
}
