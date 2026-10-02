-- esquema_gafas.sql — la base de las gafas. MariaDB 10.4 (XAMPP) o MySQL 8.
--
-- Es seguro correrlo las veces que haga falta: sólo crea lo que falte, no borra nada.
-- src/base.js lo ejecuta solo al arrancar. A mano:
--
--   C:\xampp\mysql\bin\mysql.exe -u root gafas < docs\esquema_gafas.sql
--
-- La base se llama `gafas` y es APARTE de `miia_cognitiva`, que vive en el mismo
-- servidor de XAMPP y no se toca.
--
-- Qué persiste y qué no:
--   · El APRENDIZAJE son los ejemplos (tabla `ejemplos`): los vectores de cada
--     objeto que se enseñó. Los pesos de la red NO se guardan: se recalculan de
--     los ejemplos al arrancar, en menos de un segundo. Así no hay dos copias que
--     se puedan desacomodar, y si mañana cambia la red, lo aprendido sigue sirviendo.
--   · No hay fotos. De un objeto enseñado queda el vector, que no se puede volver
--     a convertir en imagen.

CREATE TABLE IF NOT EXISTS objetos (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  nombre  VARCHAR(32) NOT NULL,
  creado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_objetos_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Un vector por cuadro guardado al enseñar. `fuente` y `dim` dicen con qué
-- extractor se sacó (la clave «fuente|dim» de las redes): un ejemplo de dino_s|384
-- no le sirve a una red de rasgos_v0|168, y por eso se filtran al cargar.
CREATE TABLE IF NOT EXISTS ejemplos (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  objeto_id  INT NOT NULL,
  fuente     VARCHAR(32) NOT NULL,
  dim        INT NOT NULL,
  vector     MEDIUMBLOB NOT NULL,          -- float32 little-endian, `dim` números
  creado     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ejemplos_fuente (fuente, dim),
  CONSTRAINT fk_ejemplos_objeto FOREIGN KEY (objeto_id) REFERENCES objetos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Una fila cada vez que cambia lo que las gafas reconocen. No una por cuadro.
CREATE TABLE IF NOT EXISTS reconocimientos (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  cuando     DATETIME(3) NOT NULL,
  nombre     VARCHAR(32) NOT NULL,
  confianza  FLOAT NOT NULL,
  origen     ENUM('ensenado', 'general') NOT NULL,   -- «veo:» o «creo:»
  color      VARCHAR(16) NULL,
  KEY ix_reconocimientos_cuando (cuando),
  KEY ix_reconocimientos_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tarjetas que alguien MOSTRÓ en un código QR y el usuario decidió guardar.
-- Leer una tarjeta no la guarda: hace falta pedirlo.
CREATE TABLE IF NOT EXISTS tarjetas_qr (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  huella      CHAR(64) NOT NULL,           -- sha256 del contenido: la misma tarjeta no se duplica
  tipo        VARCHAR(16) NOT NULL,
  nombre      VARCHAR(120) NULL,
  lineas      TEXT NOT NULL,               -- JSON: los renglones que se mostraron
  contenido   TEXT NOT NULL,               -- lo que decía el QR, tal cual
  guardada    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vista       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  veces       INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tarjetas_huella (huella)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lo que contestó el LLM cuando se le pidió marca y modelo de un APARATO.
CREATE TABLE IF NOT EXISTS identificaciones (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  cuando     DATETIME(3) NOT NULL,
  tipo       VARCHAR(32) NOT NULL,
  marca      VARCHAR(32) NULL,
  modelo     VARCHAR(64) NULL,
  seguridad  ENUM('alta', 'media', 'baja') NOT NULL,
  respuesta  TEXT NOT NULL,                -- JSON completo
  KEY ix_identificaciones_cuando (cuando)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Distancia, velocidad y tiempo de llegada de un vehículo. Hoy no escribe nadie:
-- falta el detector que diga cuántos píxeles ocupa el vehículo (ver PLAN.md).
CREATE TABLE IF NOT EXISTS mediciones (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  cuando        DATETIME(3) NOT NULL,
  objeto        VARCHAR(32) NOT NULL,
  distancia_m   FLOAT NULL,
  velocidad_kmh FLOAT NULL,
  llegada_s     FLOAT NULL,
  metodo        VARCHAR(32) NOT NULL,      -- 'tamano_aparente', 'laser', 'radar'
  KEY ix_mediciones_cuando (cuando)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
