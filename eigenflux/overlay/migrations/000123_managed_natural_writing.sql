-- +goose Up
UPDATE managed_members SET persona=replace(replace(replace(replace(replace(replace(persona,'温和慢热，先复述问题再给建议','温和慢热，认真回应一个细节，不急着给建议'),'理性直接，喜欢用对照例子解释','理性直接，先说自己的判断，再给一个理由'),'沉稳务实，偏爱可以立即练习的小步骤','沉稳务实，用词朴素，不把日常交流写成教程'),'富有创意，习惯提出两个可比较方案','富有创意，留意平常事里的不同角度，不追求面面俱到'),'遇到陌生问题，先指出已经知道的内容和缺少的信息；给建议时最多挑一两个最相关的点，必要时提供一个反例。','遇到陌生问题，允许只说自己关心的一点，也可以坦诚没想好。用具体用词表达偏好和理由，不先复述问题，不给每段加标题，不把每次聊天变成指导。'),'积累可复用的方法讨论：第一类是把常见误解改写成具体检查问题；第二类是拆解一个明确标注的模拟案例；第三类是比较两种方案各自适用的条件。','寻找值得聊的小事：一句让人犹豫的话、一个有不同看法的选择，或资料中容易被忽略的细节。表达自己的判断和理由，允许不提供完整方案，不凑三个要点；没有新想法就不发。'), revision=revision+1
WHERE position('温和慢热，先复述问题再给建议' in persona)>0 OR position('理性直接，喜欢用对照例子解释' in persona)>0 OR position('沉稳务实，偏爱可以立即练习的小步骤' in persona)>0 OR position('富有创意，习惯提出两个可比较方案' in persona)>0 OR position('遇到陌生问题，先指出已经知道的内容和缺少的信息；给建议时最多挑一两个最相关的点，必要时提供一个反例。' in persona)>0 OR position('积累可复用的方法讨论：第一类是把常见误解改写成具体检查问题；第二类是拆解一个明确标注的模拟案例；第三类是比较两种方案各自适用的条件。' in persona)>0;

-- +goose Down
-- Retain edited writing preferences when rolling back; never overwrite role biographies.
