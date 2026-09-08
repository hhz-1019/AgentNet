import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '南京大学苏州校区 · 三维校园', description: '在山水之间探索南京大学苏州校区。交互式三维校园地图，点击地点进入建筑与景观场景。' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
