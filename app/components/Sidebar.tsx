'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const ITENS_NAV = [
  { href: '/', icone: '👥', label: 'Motoristas' },
  { href: '/painel', icone: '🎮', label: 'Visão Geral (Gamificação)' },
  { href: '#', icone: '📊', label: 'Indicadores' },
  { href: '#', icone: '🔄', label: 'Recálculo' },
  { href: '#', icone: '🏁', label: 'Master Drive' },
  { href: '#', icone: '🗂️', label: 'Versões' },
  { href: '#', icone: '🔍', label: 'Diagnóstico' },
  { href: '#', icone: '📄', label: 'Relatórios' },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className={collapsed ? 'collapsed' : ''}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={onToggle}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        {collapsed ? '»' : '«'}
      </button>

      <div className="brandmark">
        <svg width="30" height="30" viewBox="0 0 30 30" style={{ flexShrink: 0 }}>
          <path d="M4 22 L14 6 L18 6 L10 22 Z" fill="#d99a3f" />
          <path d="M15 22 L23 8 L27 8 L19 22 Z" fill="#f2ede4" />
        </svg>
        {!collapsed && (
          <div><div className="t">ViaHub</div><div className="s">TELEMETRIA &amp; PERFORMANCE</div></div>
        )}
      </div>

      <nav>
        {ITENS_NAV.map((item) => {
          const ativo = item.href !== '#' && pathname === item.href;
          return (
            <Link key={item.label} href={item.href} className={ativo ? 'on' : ''} title={collapsed ? item.label : undefined}>
              <span className="nav-ic">{item.icone}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && <div className="side-foot">DADO CERTO, DECISÃO RÁPIDA</div>}
    </aside>
  );
}
