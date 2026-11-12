-- Conteo anónimo de reportes hechos con la guía de GuaZap (issue #14).
-- Sin IP, sin identificadores, sin texto libre. Ver src/worker.js.
CREATE TABLE eventos (
  id     INTEGER PRIMARY KEY,
  ts     INTEGER NOT NULL,          -- ms desde 1970 (UTC)
  tipo   TEXT    NOT NULL,          -- 'abrir' (tocó «Abrir GuaZap») | 'resultado' (contestó al volver)
  mun    INTEGER NOT NULL,          -- 0 Guadalajara · 1 Zapopan · 2 otro municipio de la ZMG
  k      INTEGER NOT NULL,          -- tipo de falla, 1..8 (menú del bot)
  dias   INTEGER,                   -- solo k = 1: 1, 2, 3, 4 (4–7) u 8 (8+)
  ci     INTEGER,                   -- celda: floor(lat / 0.005)
  cj     INTEGER,                   -- celda: floor(lng / 0.005)
  res    TEXT,                      -- 'folio' | 'sin-folio' | 'atorado'
  paso   INTEGER,                   -- paso de la guía donde cambió el bot o se atoró
  cambio TEXT                       -- 'igual' | 'menu' | 'foto' | 'direccion' | 'ubicacion' | 'datos' | 'otro'
);
CREATE INDEX eventos_ts ON eventos (tipo, ts);
