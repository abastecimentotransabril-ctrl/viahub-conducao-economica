'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchAutenticado } from '@/lib/fetch-autenticado';

export interface PontoTrajeto {
  id: string;
  dataHoraISO: string;
  lat: number;
  lon: number;
  velocidadeKmh: number | null;
  rpm: number | null;
}

interface MapaTrajetoProps {
  pontos: PontoTrajeto[];
}

function corVelocidade(v: number | null): string {
  if (v === null) return '#a39d8c';
  if (v === 0) return '#d1493c'; // parado
  if (v < 40) return '#d9932f'; // lento
  return '#3f9d5d'; // em movimento normal
}

/** Ajusta o zoom/centro do mapa para caber todos os pontos */
function AjustarLimites({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useMemo(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [bounds, map]);
  return null;
}

export default function MapaTrajeto({ pontos }: MapaTrajetoProps) {
  const [linhaRota, setLinhaRota] = useState<[number, number][] | null>(null);
  const [statusRota, setStatusRota] = useState<'carregando' | 'ok' | 'indisponivel'>('carregando');
  const [mostrarRuas, setMostrarRuas] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setStatusRota('carregando');
    setLinhaRota(null);

    if (pontos.length < 2) {
      setStatusRota('indisponivel');
      return;
    }

    (async () => {
      try {
        const response = await fetchAutenticado('/api/mapa/casar-rota', {
          method: 'POST',
          body: JSON.stringify({ pontos: pontos.map((p) => ({ lat: p.lat, lon: p.lon })) }),
        });
        const json = await response.json();
        if (!cancelado) {
          if (json.sucesso && json.dados?.linha?.length > 1) {
            setLinhaRota(json.dados.linha);
            setStatusRota('ok');
          } else {
            setStatusRota('indisponivel');
          }
        }
      } catch {
        if (!cancelado) setStatusRota('indisponivel');
      }
    })();

    return () => { cancelado = true; };
  }, [pontos]);

  const linhaReta: [number, number][] = pontos.map((p) => [p.lat, p.lon]);
  const linhaExibida = mostrarRuas && linhaRota ? linhaRota : linhaReta;

  const bounds: LatLngBoundsExpression | null = useMemo(() => {
    if (pontos.length === 0) return null;
    const lats = pontos.map((p) => p.lat);
    const lons = pontos.map((p) => p.lon);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];
  }, [pontos]);

  if (pontos.length === 0) {
    return (
      <div style={{
        height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', borderRadius: 12, color: 'var(--mute)', fontSize: 12.5,
      }}>
        Nenhum ponto de localização válido no período selecionado.
      </div>
    );
  }

  const centro: [number, number] = [pontos[0].lat, pontos[0].lon];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--mute)' }}>
          {statusRota === 'carregando' && 'Calculando rota nas ruas…'}
          {statusRota === 'ok' && mostrarRuas && 'Rota estimada nas ruas, a partir dos pontos reais de GPS (correspondência viária via OSRM)'}
          {statusRota === 'ok' && !mostrarRuas && 'Linha reta entre os pontos reais de GPS'}
          {statusRota === 'indisponivel' && 'Serviço de correspondência viária indisponível — mostrando linha reta entre os pontos reais'}
        </span>
        {statusRota === 'ok' && (
          <button
            type="button"
            className="gauge-link"
            style={{ fontSize: 11, margin: 0 }}
            onClick={() => setMostrarRuas(!mostrarRuas)}
          >
            {mostrarRuas ? 'Ver linha reta entre pontos' : 'Ver rota estimada nas ruas'}
          </button>
        )}
      </div>

      <div style={{ height: 420, borderRadius: 12, overflow: 'hidden' }}>
        <MapContainer center={centro} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <AjustarLimites bounds={bounds} />

          {linhaExibida.length > 1 && (
            <Polyline
              positions={linhaExibida}
              pathOptions={{ color: '#d99a3f', weight: mostrarRuas && linhaRota ? 4 : 3, opacity: 0.8 }}
            />
          )}

          {pontos.map((p, idx) => {
            const ehInicio = idx === 0;
            const ehFim = idx === pontos.length - 1;
            const cor = ehInicio ? '#3f9d5d' : ehFim ? '#d1493c' : corVelocidade(p.velocidadeKmh);
            const raio = ehInicio || ehFim ? 7 : 4;
            return (
              <CircleMarker
                key={p.id}
                center={[p.lat, p.lon]}
                radius={raio}
                pathOptions={{ color: '#fff', weight: 1.5, fillColor: cor, fillOpacity: 0.9 }}
              >
                <Popup>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    {ehInicio && <b style={{ color: '#3f9d5d' }}>Início do trajeto</b>}
                    {ehFim && !ehInicio && <b style={{ color: '#d1493c' }}>Fim do trajeto</b>}
                    {!ehInicio && !ehFim && <b>Ponto registrado</b>}
                    <br />
                    {new Date(p.dataHoraISO).toLocaleString('pt-BR')}
                    <br />
                    Velocidade: {p.velocidadeKmh ?? '—'} km/h
                    <br />
                    Rotação: {p.rpm ?? '—'} rpm
                    <br />
                    <span style={{ color: '#8b9490' }}>{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</span>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
