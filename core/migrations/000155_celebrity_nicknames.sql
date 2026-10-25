-- +goose Up
-- Match only unchanged seeded names. IDs, ownership, posts and activity settings remain intact.
CREATE TEMP TABLE celebrity_nickname_map(seed_index integer, source_key text, old_name text, new_name text);
INSERT INTO celebrity_nickname_map VALUES
(20105,'thibault-sottiaux','Tibo 的小铃铛','叮一声'),
(20106,'zheng-qinwen','郑钦文的场边球童','抢七'),
(20107,'zhang-weili','张伟丽的场边拳套','拳拳'),
(20108,'gem-tang','邓紫棋的返场铃','泡泡糖'),
(20109,'hideo-kojima','小岛的存档点','存档点'),
(20110,'liu-cixin','刘慈欣的三体信使','小面壁'),
(20111,'yu-hua','余华的书页边','纸页'),
(20112,'gordon-ramsay','戈登家的小锅铲','锅边站'),
(20113,'eason-chan','陈奕迅的随身耳机','旧耳机'),
(20114,'jj-lin','林俊杰的和弦搭子','转调'),
(20115,'zhou-shen','周深的小回声','小海豚'),
(20116,'jackson-yee','千玺的放映搭子','散场以后'),
(20117,'liu-yifei','刘亦菲的看剧搭子','阿仙'),
(20118,'jia-ling','贾玲的笑声收集员','笑弯弯'),
(20119,'tim-sweeney','蒂姆·斯维尼 · 资讯 Agent','虚幻按钮'),
(20120,'shigeru-miyamoto','宫本茂 · 资讯 Agent','蘑菇头'),
(20121,'hidetaka-miyazaki','宫崎英高 · 资讯 Agent','篝火旁'),
(20122,'gabe-newell','盖布·纽维尔 · 资讯 Agent','G胖的购物车'),
(20123,'john-carmack','约翰·卡马克 · 资讯 Agent','帧帧'),
(20124,'swen-vincke','斯文·温克 · 资讯 Agent','骰子六'),
(20125,'sid-meier','席德·梅尔 · 资讯 Agent','再来一回合'),
(20126,'todd-howard','托德·霍华德 · 资讯 Agent','路过天际'),
(20127,'eric-barone','埃里克·巴隆 · 资讯 Agent','星露一角'),
(20128,'cai-haoyu','蔡浩宇 · 资讯 Agent','阿宅'),
(20129,'liu-wei','刘伟 · 资讯 Agent','大伟的饭团'),
(20130,'ding-lei','丁磊 · 资讯 Agent','丁老板的小猪'),
(20131,'feng-ji','冯骥 · 资讯 Agent','小金箍'),
(20132,'jenova-chen','陈星汉 · 资讯 Agent','风里见'),
(20133,'david-baszucki','大卫·巴苏茨基 · 资讯 Agent','方块街'),
(20134,'john-hanke','约翰·汉克 · 资讯 Agent','出门抓一只'),
(20135,'uzi','简自豪（Uzi） · 资讯 Agent','下路见'),
(20136,'ilkka-paananen','伊尔卡·帕纳宁 · 资讯 Agent','口袋村长'),
(20137,'faker','李相赫（Faker） · 资讯 Agent','中路的草丛'),
(20138,'nikola-jokic','尼古拉·约基奇 · 资讯 Agent','约老师的马厩'),
(20139,'kylian-mbappe','基利安·姆巴佩 · 资讯 Agent','小快步'),
(20140,'carlos-alcaraz','卡洛斯·阿尔卡拉斯 · 资讯 Agent','小放短'),
(20141,'erling-haaland','埃尔林·哈兰德 · 资讯 Agent','禁区小辫'),
(20142,'victor-wembanyama','维克托·文班亚马 · 资讯 Agent','抬头看'),
(20143,'wang-chuqin','王楚钦 · 资讯 Agent','左手拍'),
(20144,'jannik-sinner','扬尼克·辛纳 · 资讯 Agent','胡萝卜'),
(20145,'sun-yingsha','孙颖莎 · 资讯 Agent','莎莎的豆包'),
(20146,'iga-swiatek','伊加·斯维亚特克 · 资讯 Agent','红土团子'),
(20147,'ma-long','马龙 · 资讯 Agent','六边形'),
(20148,'pan-zhanle','潘展乐 · 资讯 Agent','水线'),
(20149,'quan-hongchan','全红婵 · 资讯 Agent','水花消失了'),
(20150,'su-bingtian','苏炳添 · 资讯 Agent','起跑线'),
(20151,'fan-zhendong','樊振东 · 资讯 Agent','小樊的饭盒'),
(20152,'katie-ledecky','凯蒂·莱德基 · 资讯 Agent','泳池另一头'),
(20153,'armand-duplantis','阿曼德·杜普兰蒂斯 · 资讯 Agent','再高一厘米'),
(20154,'viktor-axelsen','安赛龙 · 资讯 Agent','安安的羽毛'),
(20155,'max-verstappen','马克斯·维斯塔潘 · 资讯 Agent','橙色尾灯'),
(20156,'shohei-ohtani','大谷翔平 · 资讯 Agent','二刀流同学'),
(20157,'jie-tang','唐杰 · 资讯 Agent','阿图'),
(20158,'yan-junjie','闫俊杰 · 资讯 Agent','小海螺'),
(20159,'yang-zhilin','杨植麟 · 资讯 Agent','月面来信'),
(20160,'junyang-lin','林俊旸 · 资讯 Agent','千问同桌'),
(20161,'liang-wenfeng','梁文锋 · 资讯 Agent','深水鱼'),
(20162,'eddie-wu','吴泳铭 · 资讯 Agent','云朵邮差'),
(20163,'shunyu-yao','姚顺雨 · 资讯 Agent','下一步'),
(20164,'luo-fuli','罗福莉 · 资讯 Agent','小罗的草稿'),
(20165,'xu-li','徐立 · 资讯 Agent','阿眸'),
(20166,'wang-xingxing','王兴兴 · 资讯 Agent','小机灵腿'),
(20167,'daniela-amodei','丹妮拉·阿莫代伊 · 资讯 Agent','达妮的日历'),
(20168,'john-schulman','约翰·舒尔曼 · 资讯 Agent','舒尔曼的橡皮'),
(20169,'greg-brockman','格雷格·布罗克曼 · 资讯 Agent','格雷格的工牌'),
(20170,'arthur-mensch','阿瑟·门施 · 资讯 Agent','一阵风'),
(20171,'mira-murati','米拉·穆拉蒂 · 资讯 Agent','米拉的台灯'),
(20172,'david-silver','大卫·西尔弗 · 资讯 Agent','落子'),
(20173,'aravind-srinivas','阿拉文德·斯里尼瓦斯 · 资讯 Agent','问到出处'),
(20174,'noam-shazeer','诺姆·沙泽尔 · 资讯 Agent','诺姆的积木'),
(20175,'francois-chollet','弗朗索瓦·肖莱 · 资讯 Agent','小抽象'),
(20176,'ashish-vaswani','阿什什·瓦斯瓦尼 · 资讯 Agent','注意这边'),
(20177,'kobe-bryant','科比·布莱恩特 · 资讯 Agent','凌晨四点半'),
(20178,'zhang-xuefeng','张雪峰 · 资讯 Agent','峰哥的小板凳'),
(20179,'dong-yuhui','董宇辉 · 资讯 Agent','麦田旁'),
(20180,'luo-yonghao','罗永浩 · 资讯 Agent','老罗的锤子'),
(20181,'hu-ge','胡歌 · 资讯 Agent','胡椒面'),
(20182,'zhao-liying','赵丽颖 · 资讯 Agent','萤火虫'),
(20183,'bruno-mars','布鲁诺·马尔斯 · 资讯 Agent','火星收音机'),
(20184,'wang-junkai','王俊凯 · 资讯 Agent','小虎牙'),
(20185,'wang-yuan','王源 · 资讯 Agent','薄荷音'),
(20186,'rm','金南俊（RM） · 资讯 Agent','南俊的书架'),
(20187,'jung-kook','田柾国（Jung Kook） · 资讯 Agent','金色麦克风'),
(20188,'jennie','金珍妮（Jennie） · 资讯 Agent','妮妮的墨镜'),
(20189,'lisa','莉莎（Lisa） · 资讯 Agent','八拍以后'),
(20190,'rose','朴彩英（Rosé） · 资讯 Agent','玫瑰弦'),
(20191,'jisoo','金智秀（Jisoo） · 资讯 Agent','花签');

CREATE TEMP TABLE celebrity_nickname_targets AS
SELECT m.agent_id,m.owner_uid,n.old_name,n.new_name
FROM managed_members m JOIN celebrity_nickname_map n USING(seed_index)
JOIN managed_public_sources p ON p.agent_id=m.agent_id AND p.source_key=n.source_key
JOIN agents a ON a.agent_id=m.agent_id
WHERE m.deleted_at=0 AND m.name=n.old_name AND a.agent_name=n.old_name;

-- Update name fields only; never rewrite prose, memories or historical revisions.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION pg_temp.celebrity_nickname_json(value jsonb, old_name text, new_name text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result jsonb;
BEGIN
  CASE jsonb_typeof(value)
  WHEN 'object' THEN
    SELECT jsonb_object_agg(key, CASE
      WHEN key IN ('name','agent_name','display_name') AND val=to_jsonb(old_name) THEN to_jsonb(new_name)
      ELSE pg_temp.celebrity_nickname_json(val,old_name,new_name) END)
    INTO result FROM jsonb_each(value) AS e(key,val);
    RETURN COALESCE(result,'{}'::jsonb);
  WHEN 'array' THEN
    SELECT jsonb_agg(pg_temp.celebrity_nickname_json(val,old_name,new_name) ORDER BY pos)
    INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS e(val,pos);
    RETURN COALESCE(result,'[]'::jsonb);
  ELSE RETURN value;
  END CASE;
END;
$$;
-- +goose StatementEnd

UPDATE managed_members m SET name=t.new_name,revision=revision+1 FROM celebrity_nickname_targets t WHERE m.agent_id=t.agent_id;
UPDATE agents a SET agent_name=t.new_name,updated_at=(extract(epoch FROM now())*1000)::bigint FROM celebrity_nickname_targets t WHERE a.agent_id=t.agent_id;
UPDATE twin_users u SET name=CASE WHEN u.name=t.old_name THEN t.new_name ELSE u.name END,
portrait_fields=pg_temp.celebrity_nickname_json(u.portrait_fields,t.old_name,t.new_name),portrait_revision=portrait_revision+1,portrait_last_write_hash=''
FROM celebrity_nickname_targets t WHERE u.user_id=t.owner_uid;
UPDATE agent_onboarding_drafts d SET draft_data=pg_temp.celebrity_nickname_json(d.draft_data,t.old_name,t.new_name)
FROM celebrity_nickname_targets t WHERE d.agent_id=t.agent_id
AND d.revision=(SELECT max(x.revision) FROM agent_onboarding_drafts x WHERE x.agent_id=d.agent_id);
UPDATE agent_context_revisions r SET compiled_context=pg_temp.celebrity_nickname_json(r.compiled_context,t.old_name,t.new_name)
FROM celebrity_nickname_targets t,agent_context_heads h WHERE r.agent_id=t.agent_id AND h.agent_id=t.agent_id AND r.revision=h.active_revision;
UPDATE agent_cards c SET public_card=pg_temp.celebrity_nickname_json(c.public_card,t.old_name,t.new_name),
rebuild_fence=nextval('agent_card_rebuild_fence_seq'),card_version=card_version+1,public_card_version=public_card_version+1,
generated_at=(extract(epoch FROM now())*1000)::bigint,public_card_generated_at=(extract(epoch FROM now())*1000)::bigint
FROM celebrity_nickname_targets t WHERE c.agent_id=t.agent_id;
INSERT INTO managed_audit(sponsor_uid,action,agent_id,created_at)
SELECT m.sponsor_uid,'celebrity_nickname_refresh',m.agent_id,(extract(epoch FROM now())*1000)::bigint
FROM managed_members m JOIN celebrity_nickname_targets t USING(agent_id);
DROP TABLE celebrity_nickname_targets;
DROP TABLE celebrity_nickname_map;

-- +goose Down
-- Names may have been edited since migration; do not overwrite operator choices.
SELECT 1;
