// Local review settings; real account settings keep their existing API adapter.
export function DemoSettings({ route }: { route: string }) {
  const heading: Record<string, string> = {
    activity: '活动记录',
    attention: '需要关注',
  };
  return (
    <section className="sn-demo-settings">
      <h1>{heading[route] || '设置'}</h1>
      <div className="sw-empty">
        <h2>暂无活动记录</h2>
      </div>
    </section>
  );
}
