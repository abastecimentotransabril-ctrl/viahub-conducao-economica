import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

interface PontoEntrada {
  lat: number;
  lon: number;
}

// Serviço público de demonstração do OSRM (Open Source Routing Machine).
// Gratuito, sem chave de API, mas é um servidor de demonstração — não tem
// SLA garantido. Se ficar indisponível ou limitar a requisição, o frontend
// cai de volta para a linha reta entre os pontos reais, sem quebrar a tela.
const OSRM_BASE = 'https://router.project-osrm.org/match/v1/driving/';

// O serviço público tem limite prático de tamanho de URL/pontos por
// requisição. Reduzimos a amostra mantendo sempre o primeiro e o último
// ponto, para não estourar o limite em períodos com muitas leituras.
const MAX_PONTOS_OSRM = 90;

function amostrar<T>(pontos: T[], maxItens: number): T[] {
  if (pontos.length <= maxItens) return pontos;
  const passo = (pontos.length - 1) / (maxItens - 1);
  const amostrados: T[] = [];
  for (let i = 0; i < maxItens; i++) {
    amostrados.push(pontos[Math.round(i * passo)]);
  }
  return amostrados;
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ sucesso: false, erro: authError || 'Não autenticado' }, { status: 401 });
    }

    const { pontos } = (await request.json()) as { pontos: PontoEntrada[] };

    if (!pontos || pontos.length < 2) {
      return NextResponse.json({ sucesso: false, erro: 'São necessários pelo menos 2 pontos' }, { status: 400 });
    }

    const amostra = amostrar(pontos, MAX_PONTOS_OSRM);
    const coordsStr = amostra.map((p) => `${p.lon},${p.lat}`).join(';');
    const url = `${OSRM_BASE}${coordsStr}?geometries=geojson&overview=full&radiuses=${amostra.map(() => '50').join(';')}`;

    const resposta = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!resposta.ok) {
      return NextResponse.json({ sucesso: false, erro: 'Serviço de correspondência viária indisponível' }, { status: 502 });
    }

    const json = await resposta.json();

    if (json.code !== 'Ok' || !json.matchings || json.matchings.length === 0) {
      return NextResponse.json({ sucesso: false, erro: 'Não foi possível casar os pontos com ruas conhecidas' }, { status: 422 });
    }

    // Junta a geometria de todos os "matchings" retornados (podem vir
    // segmentados quando há trechos sem correspondência confiável)
    const linha: [number, number][] = [];
    for (const m of json.matchings) {
      const coords: [number, number][] = m.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]); // [lon,lat] -> [lat,lon]
      linha.push(...coords);
    }

    return NextResponse.json({ sucesso: true, dados: { linha, pontosUsados: amostra.length, pontosOriginais: pontos.length } });
  } catch (erro) {
    console.error('Erro no map matching:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro ao consultar serviço de correspondência viária', detalhe: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
