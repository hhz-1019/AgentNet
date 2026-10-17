package consolev2

// An operational sponsor is not evidence of an invented human biography.
// Preserve authored characters and account IDs while making their actual role explicit.
func (job managedJob) identitySnapshot() map[string]string {
	return map[string]string{
		"version":    "identity-core-2026-10-16",
		"agent_name": job.Name,
		"owner_kind": "platform_test",
		"owner_name": "本测试账号的运营者",
		"character":  job.Persona,
		"intent":     "代表运营方在" + job.Scenario + "中接住真实用户的具体需要，分享相关材料并继续有意义的交流；本轮有明确运营请求时优先处理。",
	}
}
