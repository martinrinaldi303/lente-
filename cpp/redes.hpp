#pragma once
// redes.hpp — las dos redes de MIIA, para clasificar objetos.
//
// Salen de miia_cognitive/class23.cpp y class24.cpp, con tres cambios:
//
//   1 · SALIDA SOFTMAX sobre N clases. En MIIA cada red tiene una sola salida
//       sigmoid («le gana al promedio» sí/no); acá hay que elegir entre muchas.
//   2 · SIN Redis, spdlog ni nlohmann: un solo encabezado, sin dependencias. Así el
//       mismo archivo compila en la PC para entrenar y, más adelante, en el ESP32
//       para reconocer sin el servidor (ahí con -DGAFAS_FLOAT: el S3 no tiene
//       coma flotante de doble precisión por hardware).
//   3 · Las etiquetas vienen de una base pública y son todas ciertas, no un
//       resultado de mercado que llega 48 h después. Se entrena por épocas.
//
// Lo que se conserva tal cual:
//   · class23: capas ocultas PROPORCIONALES, in → in/2 → in/4 → salida.
//   · class24: H FIJO en 64, in → 64 → salida.
//     Que NO compartan arquitectura es lo que le da diversidad real al ensamble.
//   · Normalización por feature, con piso de desvío y tope en ±5 (RunningNorm).
//   · La dimensión se fija en el constructor y no cambia nunca.

#include <algorithm>
#include <cmath>
#include <random>
#include <string>
#include <vector>

#ifdef GAFAS_FLOAT
using real = float;
#else
using real = double;
#endif

struct Norma {
    static constexpr real SD_MIN = (real)1e-3;
    static constexpr real CLAMP  = (real)5.0;
    std::vector<real> media, sd;

    // Media y desvío exactos sobre las filas de entrenamiento. Nunca sobre las de
    // prueba: eso sería mirar el examen antes de rendirlo.
    void ajustar(const std::vector<float>& x, const std::vector<int>& filas, int dim) {
        media.assign(dim, 0); sd.assign(dim, 1);
        if (filas.empty()) return;
        std::vector<double> m(dim, 0.0), v(dim, 0.0);
        for (int f : filas) for (int i = 0; i < dim; i++) m[i] += x[(size_t)f * dim + i];
        for (int i = 0; i < dim; i++) m[i] /= (double)filas.size();
        for (int f : filas) for (int i = 0; i < dim; i++) {
            const double d = x[(size_t)f * dim + i] - m[i];
            v[i] += d * d;
        }
        for (int i = 0; i < dim; i++) {
            media[i] = (real)m[i];
            sd[i]    = std::max(SD_MIN, (real)std::sqrt(v[i] / (double)filas.size()));
        }
    }

    void aplicar(const float* x, real* out) const {
        for (size_t i = 0; i < media.size(); i++) {
            const real z = ((real)x[i] - media[i]) / sd[i];
            out[i] = z > CLAMP ? CLAMP : z < -CLAMP ? -CLAMP : z;
        }
    }
};

struct Red {
    std::string nombre;
    std::vector<int> tam;                    // {entrada, ocultas..., salida}
    std::vector<std::vector<real>> W, b;     // por capa; W[c][o * entradas + i]
    real lr;

    Red(std::string nombre_, std::vector<int> tam_, unsigned semilla, real lr_)
        : nombre(std::move(nombre_)), tam(std::move(tam_)), lr(lr_)
    {
        std::mt19937 rng(semilla);
        for (int c = 0; c < capas(); c++) {
            const int in = tam[c], out = tam[c + 1];
            // He para las capas relu; la de salida arranca más chica.
            const double s = (c + 1 < capas()) ? std::sqrt(2.0 / in) : std::sqrt(1.0 / in);
            std::normal_distribution<double> d(0.0, s);
            W.emplace_back((size_t)in * out);
            b.emplace_back(out, (real)0);
            for (auto& w : W.back()) w = (real)d(rng);
        }
    }

    int capas()   const { return (int)tam.size() - 1; }
    int entrada() const { return tam.front(); }
    int salida()  const { return tam.back(); }

    // act[0] es la entrada y act[c + 1] la salida de la capa c. La última queda
    // en probabilidades (softmax).
    void forward(const real* x, std::vector<std::vector<real>>& act) const {
        act.resize(tam.size());
        act[0].assign(x, x + tam[0]);
        for (int c = 0; c < capas(); c++) {
            const int in = tam[c], out = tam[c + 1];
            const bool ultima = (c + 1 == capas());
            act[c + 1].resize(out);
            for (int o = 0; o < out; o++) {
                real z = b[c][o];
                const real* w = &W[c][(size_t)o * in];
                for (int i = 0; i < in; i++) z += w[i] * act[c][i];
                act[c + 1][o] = (ultima || z > 0) ? z : (real)0;
            }
        }
        auto& p = act.back();
        const real mx = *std::max_element(p.begin(), p.end());
        real suma = 0;
        for (auto& v : p) { v = std::exp(v - mx); suma += v; }
        for (auto& v : p) v /= suma;
    }

    // Un paso de descenso por gradiente con un ejemplo. Devuelve la pérdida.
    real paso(const real* x, int etiqueta,
              std::vector<std::vector<real>>& act, std::vector<std::vector<real>>& delta) {
        forward(x, act);
        const real perdida = -std::log(std::max(act.back()[etiqueta], (real)1e-12));
        delta.resize(tam.size());
        delta.back() = act.back();
        delta.back()[etiqueta] -= 1;
        for (int c = capas() - 1; c >= 0; c--) {
            const int in = tam[c], out = tam[c + 1];
            if (c > 0) delta[c].assign(in, (real)0);
            for (int o = 0; o < out; o++) {
                const real g = delta[c + 1][o];
                if (g == 0) continue;
                real* w = &W[c][(size_t)o * in];
                for (int i = 0; i < in; i++) {
                    if (c > 0) delta[c][i] += g * w[i];     // con el peso de ANTES del paso
                    w[i] -= lr * g * act[c][i];
                }
                b[c][o] -= lr * g;
            }
            if (c > 0) for (int i = 0; i < in; i++) if (act[c][i] <= 0) delta[c][i] = 0;
        }
        return perdida;
    }
};

inline Red red23(int in, int out, unsigned semilla, real lr) {
    return Red("class23", { in, std::max(in / 2, 8), std::max(in / 4, 4), out }, semilla, lr);
}

inline Red red24(int in, int out, unsigned semilla, real lr) {
    return Red("class24", { in, 64, out }, semilla, lr);
}
