import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  forceCollide,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';
import { Minus, Plus, LocateFixed, Pause, Play } from 'lucide-react';
import { nodePriority, type NetworkNode } from './model';

interface Point extends SimulationNodeDatum {
  id: string;
  priority: number;
}
export function AgentGraph({
  nodes,
  selfId,
  selected,
  onSelect,
  next,
  onMore,
}: {
  nodes: NetworkNode[];
  selfId: string;
  selected: string;
  onSelect: (id: string) => void;
  next: boolean;
  onMore: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, Point>());
  const [size, setSize] = useState({ width: 640, height: 700 });
  const [points, setPoints] = useState<Point[]>([]);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const center = { x: size.width / 2, y: (size.height - 50) / 2 };
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setSize((old) =>
          old.width === width && old.height === height
            ? old
            : { width, height },
        );
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const radius = Math.max(
      80,
      Math.min(size.width * 0.33, (size.height - 170) * 0.36),
    );
    const data: Point[] = nodes.map((node, i) => {
      const old = previous.current.get(node.agent_id);
      const angle = i * 2.399963;
      return {
        ...old,
        id: node.agent_id,
        priority: nodePriority(node),
        x: old?.x ?? Math.cos(angle) * radius,
        y: old?.y ?? Math.sin(angle) * radius,
        ...(node.agent_id === selfId ? { fx: 0, fy: 0 } : {}),
      };
    });
    const simulation = forceSimulation(data)
      .force('charge', forceManyBody().strength(-110))
      .force(
        'radial',
        forceRadial<Point>((d) =>
          d.id === selfId
            ? 0
            : radius *
              (d.priority === 2 ? 0.57 : d.priority === 1 ? 0.85 : 1.1),
        ).strength(0.5),
      )
      .force(
        'collide',
        forceCollide<Point>((d) => (d.id === selfId ? 58 : 43)).iterations(3),
      )
      .alphaDecay(0.035);
    const update = () => {
      // The caption and control strip are outside the graph's drawing area.
      // Keep the initial view usable; explicit pan/zoom can explore dense graphs.
      for (const p of data) {
        if (p.id === selfId) continue;
        p.x = Math.max(
          52 - size.width / 2,
          Math.min(size.width / 2 - 52, p.x || 0),
        );
        p.y = Math.max(
          75 - (size.height - 50) / 2,
          Math.min(size.height - 145 - (size.height - 50) / 2, p.y || 0),
        );
      }
      previous.current = new Map(data.map((p) => [p.id, p]));
      setPoints(data.map((p) => ({ ...p })));
    };
    if (reduced || paused) {
      simulation.stop();
      simulation.tick(150);
      update();
    } else simulation.on('tick', update);
    const visibility = () =>
      document.hidden
        ? simulation.stop()
        : !paused && !reduced && simulation.alpha(0.15).restart();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      simulation.stop();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [nodes, selfId, size, reduced, paused]);
  const pointMap = new Map(points.map((p) => [p.id, p]));
  return (
    <div
      className={`agent-graph${paused || reduced ? ' graph-still' : ''}`}
      ref={container}
      aria-label="以你的 Agent 为中心的关系网络"
    >
      <div
        className="graph-pan-surface"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPan({
              x: drag.current.px + e.clientX - drag.current.x,
              y: drag.current.py + e.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="graph-field"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            className="graph-connections"
            aria-hidden="true"
            width={size.width}
            height={size.height}
          >
            {nodes
              .filter((n) => n.agent_id !== selfId)
              .map((n) => {
                const p = pointMap.get(n.agent_id);
                if (!p) return null;
                return (
                  <line
                    key={n.agent_id}
                    x1={center.x}
                    y1={center.y}
                    x2={center.x + (p.x || 0)}
                    y2={center.y + (p.y || 0)}
                    className={`${n.connected ? 'connected' : 'encountered'}${selected === n.agent_id ? ' selected' : ''}`}
                  />
                );
              })}
          </svg>
          {nodes.map((node) => {
            const p = pointMap.get(node.agent_id);
            const own = node.agent_id === selfId;
            const priority = nodePriority(node);
            return (
              <button
                key={node.agent_id}
                type="button"
                className={`graph-node priority-${priority}${own ? ' own-node' : ''}${selected === node.agent_id ? ' selected' : ''}`}
                style={
                  {
                    left: center.x + (p?.x || 0),
                    top: center.y + (p?.y || 0),
                    '--pulse-duration': priority === 2 ? '3.6s' : '6s',
                  } as CSSProperties
                }
                aria-label={`${node.agent_name}${own ? '，你的 Agent' : ''}，${node.pending} 件待决定，${node.unread} 条未读`}
                aria-pressed={selected === node.agent_id}
                onClick={() => onSelect(node.agent_id)}
              >
                <span className="node-orb">
                  {own && <span className="node-self-mark" />}
                  <span className="node-pulse" />
                </span>
                {(node.pending > 0 || node.unread > 0) && (
                  <span className="node-badge">
                    {node.pending + node.unread}
                  </span>
                )}
                <span className="node-name">
                  {own ? '我的 Agent' : node.agent_name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="graph-tools" aria-label="关系图控制">
        <button
          title="缩小"
          aria-label="缩小关系图"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
        >
          <Minus size={17} />
        </button>
        <button
          title="回到中心"
          aria-label="回到我的 Agent"
          onClick={() => {
            setPan({ x: 0, y: 0 });
            setZoom(1);
            onSelect(selfId);
          }}
        >
          <LocateFixed size={18} />
        </button>
        <button
          title="放大"
          aria-label="放大关系图"
          disabled={zoom >= 2}
          onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
        >
          <Plus size={17} />
        </button>
        {!reduced && (
          <button
            title={paused ? '恢复动态' : '暂停动态'}
            aria-label={paused ? '恢复动态' : '暂停动态'}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        )}
      </div>
      {next && (
        <button className="graph-more" onClick={onMore}>
          展开更多连接
        </button>
      )}
      <div className="graph-legend" aria-hidden="true">
        <span>
          <i className="legend-pending" />
          待决定
        </span>
        <span>
          <i className="legend-unread" />
          有新结果
        </span>
        <span>
          <i />
          暂无新内容
        </span>
      </div>
    </div>
  );
}
