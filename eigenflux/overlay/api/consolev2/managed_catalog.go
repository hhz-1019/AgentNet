package consolev2

type managedPersona struct{ Name, Scenario, Persona string }

// Fictional adults, never biographies of actual people or verified companies.
func managedCatalog() []managedPersona {
	names := [][]string{
		{"陈屿", "小满", "许念", "阿哲", "胶片橘子", "阿音", "周野", "Mia", "叶栀", "方程"},
		{"宋研", "产品阿凯", "乔安", "魏然", "鹿宁", "小麦", "郑可", "北窗", "邵景", "程珂"},
		{"路遥", "阿森", "螺丝松了", "顾蓝", "孟夏", "小岛", "秦川", "桃子汽水", "安迪", "何又"},
		{"三行伪码", "Echo", "林数", "半页纸", "阿岚", "陆衡", "小七", "书页之间", "Nora", "慢慢来"},
		{"陈墨", "许舟", "括号君", "文档小站", "找茬的豆子", "唐芷", "沈砚", "一只海獭", "何序", "乌云边"},
		{"白榆", "像素阿洛", "栗子画室", "闻光", "半句诗", "陈弦", "骰子面", "横竖撇捺", "阿帧", "墨点"},
		{"梁知", "向量小鱼", "许珂", "田野笔记", "概率云", "开放书桌", "陶青", "温序", "图说阿宁", "边界漫游"},
		{"走走停停", "迟夏", "桌边老麦", "第七排", "一碗热汤", "叶子慢长", "布与线", "轮迹", "方巷", "半杯拿铁"},
		{"无障碍小鹿", "青苔", "科普阿白", "拾光书架", "邻里小桥", "慢速教程", "陆川川", "小爪印", "旧巷来信", "温暖留白"},
		{"袁一", "魏行", "产品阿喻", "林协", "说话练习簿", "莫可", "转弯处", "远方同桌", "纪然", "周末复盘"},
	}
	out := make([]managedPersona, 0, 100)
	for _, group := range names {
		for _, name := range group {
			out = append(out, managedRichPersona(len(out), name))
		}
	}
	return out
}

func managedNumbers() []int64 {
	out := []int64{66666, 88888, 99999, 11111, 22222, 33333, 44444, 55555, 77777, 12345, 23456, 34567, 45678, 56789, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000}
	seen := map[int64]bool{}
	for _, n := range out {
		seen[n] = true
	}
	for a := int64(1); a <= 9; a++ {
		for b := int64(0); b <= 9; b++ {
			n := a*10101 + b*1010
			if !seen[n] {
				out = append(out, n)
				seen[n] = true
			}
		}
	}
	for a := int64(1); a <= 9; a++ {
		for b := int64(0); b <= 9; b++ {
			n := a*11000 + b*111
			if !seen[n] {
				out = append(out, n)
				seen[n] = true
			}
		}
	}
	return out
}
