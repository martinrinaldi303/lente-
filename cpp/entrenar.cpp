// entrenar.cpp — entrena las dos redes sobre una base pública y MIDE.
//
//   entrenar <entrenamiento.bin> <prueba.bin> <salida.json> [--epocas N] [--lr X] [--semilla S]
//
// Los .bin los escribe herramientas/exportar_rasgos.js (formato en src/formato_rasgos.js).
//
// El orden de lectura del resultado es el de la tesis de MIIA: primero contra qué
// se compara, después el número.
//
//   azar      → acertar siempre la clase más frecuente de la prueba. Es el piso.
//   acierto   → medido sobre imágenes que la red NO vio.
//   ventaja   → acierto − azar. Si no supera el margen de error, no hay nada.
//
// Las tres particiones no se mezclan:
//   entrenamiento → mueve los pesos.
//   validación    → 10 % del entrenamiento; sólo elige en qué época parar.
//   prueba        → se mira UNA vez, al final. Elegir la época con la prueba
//                   inflaría el número, igual que las ventanas solapadas inflaban
//                   el t de la tesis.

#include "redes.hpp"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>

struct Conjunto {
    std::string fuente;
    int n = 0, dim = 0;
    std::vector<std::string> clases;
    std::vector<int> etiquetas;
    std::vector<float> x;
};

template <typename T> static bool leerDato(std::ifstream& f, T& v) {
    return (bool)f.read(reinterpret_cast<char*>(&v), sizeof(T));
}

static bool leerTexto(std::ifstream& f, std::string& s) {
    uint16_t largo = 0;
    if (!leerDato(f, largo)) return false;
    s.resize(largo);
    return largo == 0 || (bool)f.read(&s[0], largo);
}

static std::string leer(const char* ruta, Conjunto& c) {
    std::ifstream f(ruta, std::ios::binary);
    if (!f) return std::string("no se puede abrir ") + ruta;
    char magia[4];
    if (!f.read(magia, 4) || std::memcmp(magia, "GFR1", 4) != 0) return std::string(ruta) + " no es un archivo de rasgos (GFR1)";
    uint32_t n = 0, dim = 0, nClases = 0;
    if (!leerTexto(f, c.fuente) || !leerDato(f, n) || !leerDato(f, dim) || !leerDato(f, nClases)) return "cabecera cortada";
    if (dim == 0 || dim > 65536 || nClases < 2 || nClases > 4096) return "cabecera con valores imposibles";
    c.clases.resize(nClases);
    for (auto& nombre : c.clases) if (!leerTexto(f, nombre)) return "lista de clases cortada";
    c.n = (int)n; c.dim = (int)dim;
    c.etiquetas.resize(n);
    c.x.resize((size_t)n * dim);
    for (uint32_t k = 0; k < n; k++) {
        uint32_t etiqueta = 0;
        if (!leerDato(f, etiqueta) || etiqueta >= nClases) return "fila con etiqueta inválida";
        c.etiquetas[k] = (int)etiqueta;
        if (!f.read(reinterpret_cast<char*>(&c.x[(size_t)k * dim]), (std::streamsize)(sizeof(float) * dim))) return "fila cortada";
    }
    return "";
}

static int argmax(const std::vector<real>& p) {
    return (int)(std::max_element(p.begin(), p.end()) - p.begin());
}

static double aciertoDe(const Red& red, const Norma& norma, const Conjunto& c, const std::vector<int>& filas) {
    if (filas.empty()) return 0.0;
    std::vector<real> xn(c.dim);
    std::vector<std::vector<real>> act;
    int ok = 0;
    for (int f : filas) {
        norma.aplicar(&c.x[(size_t)f * c.dim], xn.data());
        red.forward(xn.data(), act);
        if (argmax(act.back()) == c.etiquetas[f]) ok++;
    }
    return (double)ok / (double)filas.size();
}

static std::string comillas(const std::string& s) {
    std::string out = "\"";
    for (char ch : s) {
        if (ch == '"' || ch == '\\') { out += '\\'; out += ch; }
        else if ((unsigned char)ch < 0x20) out += ' ';
        else out += ch;
    }
    return out + "\"";
}

template <typename V> static void lista(std::ostream& o, const V& v) {
    o << "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) o << ","; o << v[i]; }
    o << "]";
}

int main(int argc, char** argv) {
    if (argc < 4) {
        std::fprintf(stderr, "uso: entrenar <entrenamiento.bin> <prueba.bin> <salida.json> [--epocas N] [--lr X] [--semilla S]\n");
        return 2;
    }
    int epocas = 60, grupo = 1; double lr = 0.01; unsigned semilla = 24;
    for (int i = 4; i + 1 < argc; i += 2) {
        if      (!std::strcmp(argv[i], "--epocas"))  epocas  = std::atoi(argv[i + 1]);
        else if (!std::strcmp(argv[i], "--lr"))      lr      = std::atof(argv[i + 1]);
        else if (!std::strcmp(argv[i], "--semilla")) semilla = (unsigned)std::atoi(argv[i + 1]);
        else if (!std::strcmp(argv[i], "--grupo"))   grupo   = std::atoi(argv[i + 1]);
        else { std::fprintf(stderr, "opción desconocida: %s\n", argv[i]); return 2; }
    }
    if (epocas < 1 || lr <= 0 || grupo < 1) { std::fprintf(stderr, "epocas, lr y grupo tienen que ser positivos\n"); return 2; }

    Conjunto ent, pru;
    std::string error = leer(argv[1], ent);
    if (error.empty()) error = leer(argv[2], pru);
    if (error.empty() && (ent.dim != pru.dim || ent.clases != pru.clases || ent.fuente != pru.fuente))
        error = "entrenamiento y prueba no son del mismo extractor o de las mismas clases";
    if (error.empty() && (ent.n < 20 || pru.n < 1)) error = "muy pocos ejemplos";
    if (error.empty() && ent.n % grupo != 0) error = "la cantidad de filas no es multiplo de --grupo";
    if (!error.empty()) { std::fprintf(stderr, "ERROR: %s\n", error.c_str()); return 1; }

    const int dim = ent.dim, nClases = (int)ent.clases.size();

    // Validación: 1 de cada 10 del entrenamiento, elegidas con la semilla.
    //
    // Se sortea por GRUPOS de filas seguidas, no por fila. Con --espejo el
    // exportador escribe cada foto y enseguida su espejo (--grupo 2): si una
    // quedara en entrenamiento y la otra en validación, la red estaría rindiendo
    // con una foto que ya vio dada vuelta, y la validación mentiría hacia arriba.
    std::mt19937 rng(semilla);
    const int nGrupos = ent.n / grupo;
    std::vector<int> orden(nGrupos);
    std::iota(orden.begin(), orden.end(), 0);
    std::shuffle(orden.begin(), orden.end(), rng);
    const int gruposVal = std::max(1, nGrupos / 10);
    std::vector<int> filasVal, filasEnt;
    for (int k = 0; k < nGrupos; k++)
        for (int j = 0; j < grupo; j++)
            (k < gruposVal ? filasVal : filasEnt).push_back(orden[k] * grupo + j);
    const int nVal = (int)filasVal.size();
    std::vector<int> filasPru(pru.n);
    std::iota(filasPru.begin(), filasPru.end(), 0);

    Norma norma;
    norma.ajustar(ent.x, filasEnt, dim);

    std::vector<Red> redes;
    redes.push_back(red23(dim, nClases, semilla + 23, (real)lr));
    redes.push_back(red24(dim, nClases, semilla + 24, (real)lr));

    std::printf("Extractor %s|%d — %d clases — entrenamiento %d, validacion %d, prueba %d\n",
                ent.fuente.c_str(), dim, nClases, (int)filasEnt.size(), nVal, pru.n);

    std::vector<real> xn(dim);
    std::vector<std::vector<real>> act, delta;
    std::vector<int> mejorEpoca;
    std::vector<double> mejorValidacion;
    for (auto& red : redes) {
        Red mejor = red;
        double mejorVal = -1.0; int cuando = 0;
        red.lr = (real)lr;
        for (int ep = 1; ep <= epocas; ep++) {
            std::shuffle(filasEnt.begin(), filasEnt.end(), rng);
            double perdida = 0.0;
            for (int f : filasEnt) {
                norma.aplicar(&ent.x[(size_t)f * dim], xn.data());
                perdida += red.paso(xn.data(), ent.etiquetas[f], act, delta);
            }
            red.lr *= (real)0.97;
            const double val = aciertoDe(red, norma, ent, filasVal);
            // En empate gana la época más nueva: misma validación, menos pérdida.
            if (val >= mejorVal) { mejorVal = val; mejor = red; cuando = ep; }
            if (ep == 1 || ep % 10 == 0 || ep == epocas)
                std::printf("  %s epoca %3d  perdida %.4f  validacion %.1f%%\n",
                            red.nombre.c_str(), ep, perdida / (double)filasEnt.size(), 100.0 * val);
        }
        red = mejor;
        mejorEpoca.push_back(cuando);
        mejorValidacion.push_back(mejorVal);
        std::printf("  %s: se queda con la epoca %d (validacion %.1f%%)\n", red.nombre.c_str(), cuando, 100.0 * mejorVal);
    }

    // ── La prueba, una sola vez ──────────────────────────────────────────────
    std::vector<int> porClaseTotal(nClases, 0), porClaseOk(nClases, 0), predicciones(pru.n);
    std::vector<int> okRed(redes.size(), 0);
    int okEnsamble = 0;
    std::vector<real> voto(nClases);
    for (int f = 0; f < pru.n; f++) {
        norma.aplicar(&pru.x[(size_t)f * dim], xn.data());
        std::fill(voto.begin(), voto.end(), (real)0);
        for (size_t r = 0; r < redes.size(); r++) {
            redes[r].forward(xn.data(), act);
            if (argmax(act.back()) == pru.etiquetas[f]) okRed[r]++;
            // Voto parejo por módulo, como class25A desde el 11-sep-2026.
            for (int c = 0; c < nClases; c++) voto[c] += act.back()[c] / (real)redes.size();
        }
        const int p = argmax(voto), e = pru.etiquetas[f];
        predicciones[f] = p;
        porClaseTotal[e]++;
        if (p == e) { okEnsamble++; porClaseOk[e]++; }
    }
    const double azar = (double)*std::max_element(porClaseTotal.begin(), porClaseTotal.end()) / pru.n;
    const double acierto = (double)okEnsamble / pru.n;
    // Margen al 95 % de una proporción: 1,96·√(p(1−p)/n), la misma cuenta de CONCLUSION.md.
    const double margen = 1.96 * std::sqrt(acierto * (1.0 - acierto) / pru.n);

    std::printf("\nPRUEBA (%d imagenes que las redes no vieron)\n", pru.n);
    std::printf("  azar (clase mas frecuente)  %5.1f%%\n", 100.0 * azar);
    for (size_t r = 0; r < redes.size(); r++)
        std::printf("  %-27s %5.1f%%\n", redes[r].nombre.c_str(), 100.0 * okRed[r] / pru.n);
    std::printf("  ensamble                    %5.1f%%  (+/- %.1f)\n", 100.0 * acierto, 100.0 * margen);
    std::printf("  ventaja sobre el azar       %+5.1f pp  -> %s\n", 100.0 * (acierto - azar),
                (acierto - azar) > margen ? "significativa" : "NO se distingue del azar");
    std::printf("\n  por clase (aciertos / imagenes):\n");
    for (int c = 0; c < nClases; c++)
        std::printf("    %-18s %4d / %-4d  %5.1f%%\n", ent.clases[c].c_str(), porClaseOk[c], porClaseTotal[c],
                    porClaseTotal[c] ? 100.0 * porClaseOk[c] / porClaseTotal[c] : 0.0);

    std::ofstream o(argv[3], std::ios::binary);
    if (!o) { std::fprintf(stderr, "ERROR: no se puede escribir %s\n", argv[3]); return 1; }
    o << std::setprecision(17);
    o << "{\"version\":1,\"fuente\":" << comillas(ent.fuente) << ",\"inDim\":" << dim << ",\"clases\":[";
    for (int c = 0; c < nClases; c++) { if (c) o << ","; o << comillas(ent.clases[c]); }
    o << "],\"media\":"; lista(o, norma.media);
    o << ",\"sd\":";     lista(o, norma.sd);
    o << ",\"redes\":[";
    for (size_t r = 0; r < redes.size(); r++) {
        if (r) o << ",";
        o << "{\"nombre\":" << comillas(redes[r].nombre) << ",\"tam\":"; lista(o, redes[r].tam);
        o << ",\"W\":[";
        for (int c = 0; c < redes[r].capas(); c++) { if (c) o << ","; lista(o, redes[r].W[c]); }
        o << "],\"b\":[";
        for (int c = 0; c < redes[r].capas(); c++) { if (c) o << ","; lista(o, redes[r].b[c]); }
        o << "]}";
    }
    o << "],\"medicion\":{\"n_entrenamiento\":" << filasEnt.size() << ",\"n_validacion\":" << nVal
      << ",\"n_prueba\":" << pru.n << ",\"epocas\":" << epocas << ",\"lr\":" << lr << ",\"semilla\":" << semilla
      << ",\"azar\":" << azar << ",\"acierto\":" << acierto << ",\"margen95\":" << margen
      << ",\"significativa\":" << ((acierto - azar) > margen ? "true" : "false");
    o << ",\"acierto_por_red\":{";
    for (size_t r = 0; r < redes.size(); r++) { if (r) o << ","; o << comillas(redes[r].nombre) << ":" << (double)okRed[r] / pru.n; }
    // El acierto de validación de cada red: con esto se pesa su voto en el conjunto.
    o << "},\"validacion_por_red\":{";
    for (size_t r = 0; r < redes.size(); r++) { if (r) o << ","; o << comillas(redes[r].nombre) << ":" << mejorValidacion[r]; }
    o << "},\"epoca_elegida\":"; lista(o, mejorEpoca);
    o << ",\"aciertos_por_clase\":"; lista(o, porClaseOk);
    o << ",\"imagenes_por_clase\":"; lista(o, porClaseTotal);
    o << ",\"predicciones_prueba\":"; lista(o, predicciones);
    o << "}}\n";
    o.close();
    if (!o) { std::fprintf(stderr, "ERROR: fallo al escribir %s\n", argv[3]); return 1; }
    std::printf("\nPesos y medicion guardados en %s\n", argv[3]);
    return 0;
}
