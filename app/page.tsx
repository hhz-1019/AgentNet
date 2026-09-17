'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Compass, ExternalLink, Focus, Info, Layers2, MapPin, MessageCircle, Minus, Mountain, MoveUpRight, Plus, RotateCcw, Trees, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LOCATIONS, type LocationId } from '@/lib/campus-data';
import CampusCanvas, { type CampusControls } from '@/components/campus-canvas';
import { CompanionPanel,useCompanion } from '@/components/companion-panel';

export default function Home() {
  const [selected, setSelected] = useState<LocationId | null>(null);
  const [topView, setTopView] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const controls = useRef<CampusControls | null>(null);
  const world=useCompanion();
  const [companionOpen,setCompanionOpen]=useState(false);
  const location = LOCATIONS.find((place) => place.id === selected);
  const select = useCallback((id: LocationId | null) => {
    setSelected(id); setTopView(false); setDirectoryOpen(window.innerWidth > 760);
    window.history.replaceState(null, '', id ? `#${id}` : window.location.pathname);
  }, []);
  useEffect(() => {
    if(new URLSearchParams(window.location.search).get('connect')==='1')setCompanionOpen(true);
    const media = window.matchMedia('(min-width: 761px)');
    const syncDirectory = () => setDirectoryOpen(media.matches);
    const readHash = () => { const id = window.location.hash.slice(1); setSelected(LOCATIONS.some((p) => p.id === id) ? id as LocationId : null); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') select(null); };
    readHash(); syncDirectory(); media.addEventListener('change', syncDirectory); window.addEventListener('hashchange', readHash); window.addEventListener('keydown', keydown);
    return () => { media.removeEventListener('change', syncDirectory); window.removeEventListener('hashchange', readHash); window.removeEventListener('keydown', keydown); };
  }, [select]);
  return <main className="campus-app">
    <a className="skip-link" href="#locations">跳到地点目录</a>
    <header className="masthead">
      <Button variant="ghost" className="brand" onClick={() => select(null)} aria-label="AgentNet，返回校园总图">
        <span className="brand-mark">AgentNet</span><span className="brand-divider" />
        <span className="brand-name">南京大学 <span>苏州校区</span></span>
      </Button>
      <div className="header-center"><span className="view-indicator" />三维校园</div>
      <Button variant="outline" className="companion-open" aria-label="打开我的校园伙伴" onClick={()=>setCompanionOpen(true)}><MessageCircle size={17}/><span>{world.view?.character?.name??'我的伙伴'}</span>{world.view?.connected&&<span className="companion-online" aria-label="Agent 在线"/>}</Button>
      <Popover><PopoverTrigger render={<Button variant="ghost" className="about-button" aria-label="地图说明" />}><Info size={17} /><span>地图说明</span></PopoverTrigger>
        <PopoverContent align="end" className="map-about"><PopoverTitle>AgentNet · 关于这座校园</PopoverTitle>
          <p>平面布局依据苏州校区标准地图校正，保留建筑占地、道路、水系与庄里山的相对位置。立面与场地配色参考建筑设计资料和建成实景。</p>
          <p>东区蓝色跑道与西区紫色跑道均已对照实景。尚未取得完整竣工图，尺寸、未见立面和部分屋顶细节仍为近似重建，不用于测量或实地导航。</p>
          <a href="https://zcc.nju.edu.cn/dzdt/szxqdt/index.html" target="_blank" rel="noreferrer">南京大学官方校区地图 <ExternalLink size={14} /></a>
          <a href="https://www.artsgroup.cn/zhonghengdongtai/shejiqushi/2023-12-29/558.html" target="_blank" rel="noreferrer">建筑设计资料 · 中衡设计 <ExternalLink size={14} /></a>
          <a href="https://ltx.nju.edu.cn/yfsh/sy/jsnltzsyzpjj/20251205/i353895.html" target="_blank" rel="noreferrer">西区建成实景 · 南京大学 <ExternalLink size={14} /></a>
          <a href="https://ltx.nju.edu.cn/yfsh/sy/jsnltzsyzpjj/20231222/i256558.html" target="_blank" rel="noreferrer">东区建筑与运动场实景 <ExternalLink size={14} /></a>
        </PopoverContent>
      </Popover>
    </header>
    <div className="workspace">
      <aside className={`atlas-sidebar ${location ? 'has-selection' : ''}`}>
        <div className="sidebar-heading">
          {location ? <Button variant="ghost" className="back-link" onClick={() => select(null)}><ArrowLeft size={16} />校园总览</Button> : <span className="sidebar-symbol"><Compass size={24} strokeWidth={1.3} /></span>}
          <h1>{location ? location.name : '一览苏州校区'}</h1><p className="sidebar-subtitle">{location ? location.english : '在山水之间，探索校园。'}</p>
        </div>
        {location && <section className="place-story" aria-label="地点介绍">
          <span className="zone-label">{location.zone}<span />{location.type}</span><p>{location.description}</p>
          <div className="place-details">{location.features.map((feature) => <span key={feature}>{feature}</span>)}</div>
          <Button variant="outline" className="restore-scene" onClick={() => controls.current?.reset()}><Focus size={16} />重置场景视角</Button>
        </section>}
        <Collapsible className="directory" open={directoryOpen} onOpenChange={setDirectoryOpen}>
          <div className="directory-caption"><h2 id="locations">地点目录</h2><span>{LOCATIONS.length} 处地点</span></div>
          <CollapsibleTrigger render={<Button variant="ghost" className="mobile-directory-trigger" />}><Layers2 size={17} /><span>{location ? location.name : '探索校园地点'}</span>{directoryOpen ? <ChevronDown size={17} /> : <ChevronUp size={17} />}</CollapsibleTrigger>
          <CollapsibleContent className="directory-list" keepMounted><nav aria-label="校园地点">{LOCATIONS.map((place) => <Button key={place.id} variant="ghost" className={`location-row ${selected === place.id ? 'is-selected' : ''}`} onClick={() => select(place.id)} aria-current={selected === place.id ? 'location' : undefined}>
            <span className={`location-symbol ${place.type === '自然景观' ? 'is-nature' : ''}`}>{place.id === 'hill' ? <Mountain size={17} /> : place.id === 'riverside' ? <Waves size={17} /> : <MapPin size={17} />}</span>
            <span className="location-row-copy"><span>{place.name}</span><small>{place.zone}</small></span><MoveUpRight size={14} className="location-arrow" />
          </Button>)}</nav></CollapsibleContent>
        </Collapsible>
        <div className="sidebar-footer"><Trees size={18} strokeWidth={1.4} /><p>依山而建，向水而生。<span>庄里山 · 九曲河</span></p></div>
      </aside>
      <section className={`map-stage ${location ? 'scene-mode' : ''}`} aria-label={location ? `${location.name}三维场景` : '苏州校区三维地图'}>
        <CampusCanvas selected={selected} topView={topView} controlsRef={controls} onSelect={select} onReady={() => setReady(true)} onError={setError} companion={world.view} onCompanionClick={()=>setCompanionOpen(true)} />
        <div className="map-topline"><div className="map-breadcrumb"><span>苏州校区</span><span className="breadcrumb-slash">/</span><strong>{location ? location.name : '全景地图'}</strong></div><span className="model-caption">AgentNet</span></div>
        {!ready && !error && <div className="loading-state" role="status"><span className="loading-orbit" /><p>正在展开校园</p><small>山、水与建筑，即将呈现</small></div>}
        {error && <div className="canvas-error" role="alert"><Mountain size={36} strokeWidth={1} /><h2>三维视图暂时无法打开</h2><p>{error}</p><Button onClick={() => window.location.reload()}>重新加载</Button><a href="https://zcc.nju.edu.cn/dzdt/szxqdt/index.html" target="_blank" rel="noreferrer">查看官方校园地图 <ExternalLink size={14} /></a></div>}
        <div className="view-toolbar" aria-label="视角控制"><Button variant="ghost" className={!topView ? 'active-view' : ''} onClick={() => setTopView(false)} disabled={!ready} aria-pressed={!topView}><Layers2 size={16} />立体</Button><Button variant="ghost" className={topView ? 'active-view' : ''} onClick={() => setTopView(true)} disabled={!ready} aria-pressed={topView}><ArrowDownLeft size={16} />俯视</Button></div>
        <div className="map-compass" aria-label="北向指示"><span>N</span><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" /><g id="compass-needle"><path d="M22 7 28 26 22 23Z" /><path d="M22 7 16 26 22 23Z" /></g></svg></div>
        <div className="map-controls" aria-label="地图缩放"><Button variant="ghost" size="icon" aria-label="放大地图" title="放大" onClick={() => controls.current?.zoom(1.25)} disabled={!ready}><Plus size={20} /></Button><Button variant="ghost" size="icon" aria-label="缩小地图" title="缩小" onClick={() => controls.current?.zoom(.8)} disabled={!ready}><Minus size={20} /></Button><span /><Button variant="ghost" size="icon" aria-label="重置地图视角" title="重置视角" onClick={() => controls.current?.reset()} disabled={!ready}><RotateCcw size={18} /></Button></div>
        <div className="map-footnote"><span className="map-hint">拖动旋转<span>·</span>滚动缩放<span>·</span>点击地点进入</span><span className="mobile-map-hint">单指旋转 · 双指缩放</span><span className="model-note">实景参考建模</span></div>
        {location && <Button className="floating-return" onClick={() => select(null)}><ArrowLeft size={16} />返回全景地图</Button>}
      </section>
    </div>
    <footer className="page-footer"><span>AgentNet · 南京大学苏州校区</span><span className="footer-location">中国 · 苏州高新区</span><span>诚朴雄伟 · 励学敦行 <ArrowRight size={12} /></span></footer>
    <CompanionPanel world={world} open={companionOpen} onOpenChange={setCompanionOpen} onLocate={()=>controls.current?.focusCompanion()}/>
    <div className="sr-only" aria-live="polite">{location ? `已进入${location.name}三维场景。${location.description}` : '当前为苏州校区全景地图。'}</div>
  </main>;
}
