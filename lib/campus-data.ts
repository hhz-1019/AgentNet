// Drawing coordinates trace the 2026-08 official plan at 2048px preview width.
// ponytail: horizontal positions are map-derived; elevations are architectural approximations, not a survey.
export const MAP_SCALE = .265625;
export const mapPosition = (x: number, y: number): [number, number] => [(x - 1024) * MAP_SCALE, (y - 576) * MAP_SCALE];
export const LOCATIONS = [
  { id: 'beida', name: '北大楼', english: 'NORTH BUILDING', zone: '西区', type: '标志建筑', x: 911, y: 633, elevation: 14, span: 65, description: '西区的标志性建筑组团，官方新图标注为行政楼。围合院落与中轴空间延续南大建筑文脉，东侧与庄里山相望。', features: ['南大建筑文脉', '围合院落', '山前中轴'] },
  { id: 'library', name: '图书馆', english: 'CAMPUS LIBRARY', zone: '西区', type: '学习空间', x: 673, y: 849, elevation: 19, span: 62, description: '位于西区南部的学习空间。层叠体块、开敞平台与庭院构成阅读场所，连接周围的教学科研组团。', features: ['层叠平台', '学习交流', '科研组团'] },
  { id: 'nanyong', name: '南雍楼', english: 'NANYONG BUILDING', zone: '东区', type: '教学场馆', x: 1253, y: 409, elevation: 11, span: 72, description: '依山临水的教学建筑组团。灰砖与暗红窗框之间，院落和连廊相互串联，起伏的屋顶花园回应庄里山的轮廓。', features: ['庭院与连廊', '灰砖红窗', '屋顶花园'] },
  { id: 'stadium', name: '东区运动场', english: 'EAST SPORTS FIELD', zone: '东区', type: '运动空间', x: 1333, y: 562, elevation: 3, span: 66, description: '位于南雍楼南侧、山水之间的开阔运动场。环形跑道与球场沿东区地形展开，西侧看台朝向庄里山。', features: ['田径跑道', '开放球场', '山景看台'] },
  { id: 'sports', name: '西区文体中心', english: 'SPORTS & CULTURE', zone: '西区', type: '运动空间', x: 485, y: 429, elevation: 12, span: 74, description: '西区北部的文体活动组团。体育馆、游泳馆与室外运动场共同构成校园日常运动的公共空间。', features: ['体育馆', '游泳馆', '室外运动场'] },
  { id: 'dorms', name: '东区生活组团', english: 'STUDENT RESIDENCES', zone: '东区', type: '学生生活', x: 1037, y: 98, elevation: 17, span: 75, description: '位于东区北端的学生生活组团。宿舍顺应山水与道路布置，在面山和临水之间形成不同的生活庭院。', features: ['学生宿舍', '生活庭院', '面山临水'] },
  { id: 'innovation', name: '科创大厦', english: 'INNOVATION COMPLEX', zone: '东区', type: '教学科研', x: 1532, y: 793, elevation: 17, span: 76, description: '位于东区南部的科研建筑组团。院落式体块由公共空间连接，面向九曲河展开，南侧毗邻国际学术交流中心。', features: ['科研院落', '公共连廊', '滨水界面'] },
  { id: 'hill', name: '庄里山', english: 'ZHUANGLI HILL', zone: '校园中部', type: '自然景观', x: 1182, y: 826, elevation: 34, span: 115, description: '贯穿校园的自然山体，将校区分为东、西两区。建筑沿山展开，道路连接两侧，山林构成校园鲜明的空间背景。', features: ['校园山脊', '环山步道', '东西相望'] },
  { id: 'riverside', name: '九曲河畔', english: 'JIUQU RIVERSIDE', zone: '东侧水岸', type: '自然景观', x: 1475, y: 545, elevation: 3, span: 84, description: '九曲河沿校园东侧蜿蜒而过。滨水步道、草坡与林荫空间连接教学、运动和生活区域，为校园留下一条舒展的水岸。', features: ['滨水步道', '河岸绿地', '开阔水景'] },
] as const;
export type LocationId = typeof LOCATIONS[number]['id'];
