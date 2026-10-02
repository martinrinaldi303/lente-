// permanencia.js — que la pantalla no cambie de tema a cada rato.
//
// Una pantalla pegada al ojo que salta de una cosa a otra cansa la vista y saca la
// atención de lo que hay delante; en la calle, eso es un riesgo. Esto va entre lo
// que las redes opinan cuadro a cuadro y lo que se muestra:
//
//   · Lo que se muestra se queda al menos CUADROS_MINIMOS cuadros antes de dejarle
//     el lugar a otra cosa, o a nada. A 2 cuadros por segundo son 2 segundos: la
//     pantalla cambia de tema, como mucho, una vez cada 2 segundos.
//   · La confianza no se actualiza por un punto: sólo si se movió PASO o más.
//
// No decide QUÉ mostrar (eso es de la sesión): sólo frena los cambios.

const CUADROS_MINIMOS = 4;
const PASO = 0.05;

export class Permanencia {
  constructor({ cuadrosMinimos = CUADROS_MINIMOS, paso = PASO } = {}) {
    this.cuadrosMinimos = cuadrosMinimos;
    this.paso = paso;
    this.reiniciar();
  }

  // `candidato` es { nombre, confianza, … } o null. Devuelve lo que hay que mostrar.
  // Mientras lo mostrado aguanta, se devuelve tal como estaba: no se le pegan datos
  // del candidato nuevo.
  actualizar(candidato) {
    if (this.mostrado) this.cuadros++;
    if (candidato && candidato.nombre === this.mostrado?.nombre) {
      const confianza = Math.abs(candidato.confianza - this.mostrado.confianza) >= this.paso ? candidato.confianza : this.mostrado.confianza;
      this.mostrado = { ...candidato, confianza };
    } else if (!this.mostrado || this.cuadros >= this.cuadrosMinimos) {
      this.mostrado = candidato ?? null;
      this.cuadros = 0;
    }
    return this.mostrado;
  }

  reiniciar() { this.mostrado = null; this.cuadros = 0; }
}
