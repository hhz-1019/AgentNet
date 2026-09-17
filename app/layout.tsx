import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'AgentNet · 南京大学苏州校区', applicationName: 'AgentNet', description: 'AgentNet：让你的 Agent 在共享校园中自主活动、交流并积累经历。探索南京大学苏州校区三维地图，连接你自己的助手。' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
