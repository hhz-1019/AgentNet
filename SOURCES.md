# Campus model sources

## Horizontal layout

南京大学资产管理处，苏州校区平面图，2026-08-25。

- https://zcc.nju.edu.cn/dzdt/szxqdt/index.html
- https://zcc.nju.edu.cn/DFS//file/2026/08/25/202608251532397481kq6nm.pdf

The user-supplied standard campus map received on 2026-09-09 takes precedence for horizontal layout. `scripts/trace-campus-plan.py` extracts building outlines and courtyards, roads, water and hill boundaries into `lib/campus-plan.json`, normalized to the existing 2048-pixel drawing frame. The original image remains a private reference input. Model +X is drawing-right and +Z is drawing-down; the numeric world scale is a presentation scale, not surveyed meters. Printed labels and simplified contours can affect traced edges. Building heights, repeated windows, trees and close-scene furnishings remain approximate artistic reconstruction. Map legend colors indicate building uses and are not facade materials.

## Building forms

中衡设计集团，南京大学苏州校区东区规划与教学行政综合体设计，2023-12-28。

https://www.artsgroup.cn/zhonghengdongtai/shejiqushi/2023-12-29/558.html

南京大学离退休工作处，2025 年西区建筑实景相册，摄影陈瀚。

https://ltx.nju.edu.cn/yfsh/sy/jsnltzsyzpjj/20251205/i353895.html

Reference photos were inspected to distinguish the library's horizontal fins and wide eaves, the North Building's central tower and grey-brick/red-window courtyard, and the sports centre's folded silver roof and angled red facade fins. These reference photos are not redistributed in the application.

The supplied standard map labels the North Building ensemble 北大楼建筑风貌群. Its annotations identify 仁园 and 勇园 at the north end of the east campus and 知园 southeast of the east track. The directory now follows these labels; individual 甲、乙、丙 building names are not assigned to unverified towers.

## Typography

Noto Serif SC, Google Fonts, SIL Open Font License. A small Chinese heading subset is served locally. Main interface uses the device's Chinese sans serif font.

## Scope

The directory now provides 44 exterior meeting points and scene views, a full-campus overview, orbit and zoom, top view and camera return. Authorized agents can meet at these points, hold scoped conversations and retain their own events. Interiors and surveyed building heights remain outside this version. Routes are authored from the traced road network, avoiding building and hill footprints; they are sandbox presentation paths, not surveyed pedestrian navigation or guaranteed shortest routes. Dormitory points represent public entrances, not private rooms. Named groups can encompass several physical buildings.

The shared-world place catalogue is `lib/world-places.json`; `scripts/build-world-routes.py` generates the common road tree in `lib/world-routes.json`. The user-supplied map remains the location authority. The Sujiao name is also used in [NJU's campus construction account](https://zjg.nju.edu.cn/info/1002/4521.htm); see the [public teaching building page](https://njusz.nju.edu.cn/27/71/c52379a796529/page.htm). Checked 2026-09-20.

## Photo-based refinement — 2026-09-09

User requested closer correspondence to the built Suzhou campus, including the running-track color. Built photographs take precedence over older design renderings. Images of the Gulou campus's ivy-covered North Building are not references for the Suzhou building.

The following references were visually inspected in their original university/design-practice pages. Reference photos are linked, not copied into the public assets.

| Reference | Observed features used in the model |
| --- | --- |
| [East campus photo album, 2023-12-22](https://ltx.nju.edu.cn/yfsh/sy/jsnltzsyzpjj/20231222/i256558.html), 蒋松柳《操场一角》 | Blue east running track, white lane lines, green field, open goal frames; Nanyong's glazed sloping end, red accents and broad canopy |
| [University's 2025 campus report](https://www.nju.edu.cn/info/3341/427561.htm) | Additional built photograph confirms the blue east track |
| [ARTS Group built-project report](https://www.artsgroup.cn/zhonghengdongtai/shejiqushi/2023-12-29/558.html), images 4, 6, 22 and 23 | Pale residential facades, teaching courts and planted central spine; plans and sections inform the roof garden. The current footprint follows the supplied standard campus map; heights and architectural details remain approximate. |
| [West campus photo album, photographed 2025-11-25](https://ltx.nju.edu.cn/yfsh/sy/jsnltzsyzpjj/20251205/i353895.html), 陈瀚 photos 2, 4, 5, 8 and 11 | Suzhou North Building's gray masonry, roof and glazed tower; library's colonnade, paired horizontal fins, square glazing and lifting eaves; silver sports-centre ribs and curved red-screened culture volumes |

The **east** running track is blue in the university photographs. The user subsequently supplied a location-confirmed photograph of the **west** running track and explicitly identified it as purple; the model now uses purple there. East court surfaces are blue-gray in the inspected distant photograph; detailed west basketball-court colors remain unverified. The west running-track correction does not imply a change to the separate basketball courts.

The model adds window mullions, sills, parapets, roof ridges, railings, canopies, steps, playing-field markings and goal nets. Counts and dimensions not established by the images remain approximations. Residential and innovation-block heights are inferred from visible storeys, not measured. Unseen facades, rooftop equipment and exact planting positions still require current photographs or as-built drawings.

Rendering uses a generated daylight environment, neutral sunlight, focused close-view shadow maps, desktop ambient occlusion in the overview and close scenes, and world-scale procedural surface shading. Procedural shading is authored code, not a sampled photographic texture or measured material. The GLB contains geometry and standard PBR base materials; application shader effects and postprocessing belong to the web renderer.

## User references — purple west track and architectural visualization

- `codex-clipboard-904da383-edae-4ca5-a896-65f1d8e19015.jpg`: user-provided night photograph identifying the west track as purple, with white lane markings and green turf. Night floodlights and camera processing affect the apparent shade; `#7650cf` is an authored daylight base color, not a calibrated reflectance measurement.
- `codex-clipboard-a7d8a039-3449-4687-b844-c5c2df105b1e.jpg`: user-provided architectural visualization used for material depth, recessed windows, glazing divisions, roof paneling, vegetation and daylight contrast. Its building geometry and campus identity are not evidence for Suzhou campus and are not copied into the model.

Both images remain private reference inputs rather than public image assets. The reconstruction now uses wall piers and spandrels surrounding recessed glazing, thin window frames and projecting sills, four-sided parapets, roof coping, differentiated roof finishes, curtain-wall panels and thickened distinctive roofs. Small rooftop service objects are schematic visual details; their exact types, counts and positions remain unverified. Procedural material detail includes derivative-scaled surface relief and roughness, with distance filtering to suppress fine-pattern aliasing.
