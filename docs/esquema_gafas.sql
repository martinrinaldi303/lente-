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
--   · Cada cosa tiene dueño: `usuario_id`. El 0 es «sin cuenta», lo de antes de que
--     existieran las cuentas (2-oct-2026) y lo del emulador sin sesión.
--
-- Las bases creadas antes de las cuentas no tienen esas columnas: las agrega
-- src/base.js (migrar), porque MySQL 8 no entiende «ADD COLUMN IF NOT EXISTS».

-- Quien usa las gafas. Son datos de la persona SOBRE SÍ MISMA. La contraseña va con
-- scrypt y sal propia (src/cuentas.js), nunca en texto. Quien entra con Google puede
-- no tener contraseña. `google_sub` es el número de su cuenta de Google: ni la foto ni
-- nada más del perfil.
CREATE TABLE IF NOT EXISTS usuarios (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL,
  correo      VARCHAR(120) NOT NULL,
  clave       VARCHAR(255) NULL,
  google_sub  VARCHAR(64) NULL,
  edad        TINYINT UNSIGNED NULL,
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_correo (correo),
  UNIQUE KEY uq_usuarios_google (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Una fila por sesión abierta en el panel. Se guarda la huella (sha256) del token de
-- la cookie, no el token.
CREATE TABLE IF NOT EXISTS sesiones_web (
  huella      CHAR(64) PRIMARY KEY,
  usuario_id  INT NOT NULL,
  vence       DATETIME NOT NULL,
  creada      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cada par de anteojos vinculado a un usuario. `huella_token` es la huella de su llave
-- (la que va en firmware/gafas_xiao/config.h). El emulador del navegador no tiene
-- llave: entra con la sesión del panel.
CREATE TABLE IF NOT EXISTS anteojos (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id       INT NOT NULL,
  nombre           VARCHAR(40) NOT NULL,
  modelo           VARCHAR(60) NOT NULL,
  huella_token     CHAR(64) NULL,
  creado           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_conexion  DATETIME NULL,
  UNIQUE KEY uq_anteojos_token (huella_token),
  CONSTRAINT fk_anteojos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cada usuario tiene sus objetos: dos personas pueden enseñar cada una su «celular».
CREATE TABLE IF NOT EXISTS objetos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT NOT NULL DEFAULT 0,
  nombre      VARCHAR(32) NOT NULL,
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_objetos_usuario_nombre (usuario_id, nombre)
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
  usuario_id INT NOT NULL DEFAULT 0,
  anteojos_id INT NULL,
  cuando     DATETIME(3) NOT NULL,
  nombre     VARCHAR(32) NOT NULL,
  confianza  FLOAT NOT NULL,
  origen     ENUM('ensenado', 'general') NOT NULL,   -- «veo:» o «creo:»
  color      VARCHAR(16) NULL,
  KEY ix_reconocimientos_cuando (cuando),
  KEY ix_reconocimientos_nombre (nombre),
  KEY ix_reconocimientos_usuario (usuario_id, cuando)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tarjetas que alguien MOSTRÓ en un código QR y el usuario decidió guardar.
-- Leer una tarjeta no la guarda: hace falta pedirlo.
CREATE TABLE IF NOT EXISTS tarjetas_qr (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT NOT NULL DEFAULT 0,
  huella      CHAR(64) NOT NULL,           -- sha256 del contenido: la misma tarjeta no se duplica
  tipo        VARCHAR(16) NOT NULL,
  nombre      VARCHAR(120) NULL,
  lineas      TEXT NOT NULL,               -- JSON: los renglones que se mostraron
  contenido   TEXT NOT NULL,               -- lo que decía el QR, tal cual
  guardada    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vista       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  veces       INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tarjetas_usuario_huella (usuario_id, huella)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lo que contestó el LLM cuando se le pidió marca y modelo de un APARATO.
CREATE TABLE IF NOT EXISTS identificaciones (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL DEFAULT 0,
  anteojos_id INT NULL,
  cuando     DATETIME(3) NOT NULL,
  tipo       VARCHAR(32) NOT NULL,
  marca      VARCHAR(32) NULL,
  modelo     VARCHAR(64) NULL,
  seguridad  ENUM('alta', 'media', 'baja') NOT NULL,
  respuesta  TEXT NOT NULL,                -- JSON completo
  KEY ix_identificaciones_cuando (cuando),
  KEY ix_identificaciones_usuario (usuario_id, cuando)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Distancia, velocidad y tiempo de llegada de un vehículo. Hoy no escribe nadie:
-- falta el detector que diga cuántos píxeles ocupa el vehículo (ver PLAN.md).
CREATE TABLE IF NOT EXISTS mediciones (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id    INT NOT NULL DEFAULT 0,
  anteojos_id   INT NULL,
  cuando        DATETIME(3) NOT NULL,
  objeto        VARCHAR(32) NOT NULL,
  distancia_m   FLOAT NULL,
  velocidad_kmh FLOAT NULL,
  llegada_s     FLOAT NULL,
  metodo        VARCHAR(32) NOT NULL,      -- 'tamano_aparente', 'laser', 'radar'
  KEY ix_mediciones_cuando (cuando),
  KEY ix_mediciones_usuario (usuario_id, cuando)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Personas conocidas (3-oct-2026, ver src/caras.js y src/conocidos.js). Cada persona
-- carga SU cara desde su cuenta, y elige qué cuentas la pueden reconocer. De la cara
-- se guardan los 128 números de SFace, no la foto. Al borrar la cuenta, o la cara,
-- se va todo: las plantillas y los permisos.
CREATE TABLE IF NOT EXISTS rostros (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT NOT NULL,                 -- de quién es la cara: la persona misma
  vector      BLOB NOT NULL,                -- 128 float32
  pose        VARCHAR(12) NOT NULL,         -- 'frente', 'izquierda', 'derecha'
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_rostros_usuario (usuario_id),
  CONSTRAINT fk_rostros_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Quién puede reconocer a quién: lo da el dueño de la cara y lo saca cuando quiere.
-- El que reconoce también puede dejar de hacerlo.
CREATE TABLE IF NOT EXISTS permisos_rostro (
  dueno_id    INT NOT NULL,                 -- la persona que se cargó
  lector_id   INT NOT NULL,                 -- la cuenta cuyas gafas la pueden reconocer
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dueno_id, lector_id),
  KEY ix_permisos_lector (lector_id),
  CONSTRAINT fk_permisos_dueno FOREIGN KEY (dueno_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_permisos_lector FOREIGN KEY (lector_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lo que el usuario le corrigió al detector: «esto no es una persona» (3-oct-2026,
-- ver src/correcciones.js). Se guarda el vector del recorte (DINOv2), no la foto. Una
-- cosa que se parece mucho a algo corregido, y nada a los ejemplos de verdad de esa
-- clase, deja de marcarse. usuario_id 0 es «sin cuenta».
CREATE TABLE IF NOT EXISTS correcciones (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT NOT NULL DEFAULT 0,
  clase       VARCHAR(32) NOT NULL,         -- lo que dijo el detector y no era
  fuente      VARCHAR(16) NOT NULL,         -- el extractor del vector: 'dino_s'
  dim         SMALLINT UNSIGNED NOT NULL,
  vector      BLOB NOT NULL,
  creado      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_correcciones_usuario (usuario_id, clase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
