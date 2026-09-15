'use client';

import { useEffect, useState } from 'react';

const CHAVE = 'viahub_sidebar_collapsed';

/**
 * Estado de recolher/expandir a sidebar, persistido no localStorage
 * para manter a preferência do usuário ao navegar entre páginas.
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(CHAVE);
      if (salvo === '1') setCollapsed(true);
    } catch {
      // localStorage indisponível — ignora, mantém padrão expandido
    }
  }, []);

  function toggle() {
    setCollapsed((atual) => {
      const novo = !atual;
      try {
        window.localStorage.setItem(CHAVE, novo ? '1' : '0');
      } catch {
        // ignora falha ao persistir
      }
      return novo;
    });
  }

  return { collapsed, toggle };
}
