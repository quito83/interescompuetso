# Interés Compuesto (PWA)

Calculadora de interés compuesto instalable y offline, sin dependencias ni build.

## Funciones

**Calculadora**
- Inputs: capital inicial, aporte mensual, tasa anual y plazo (con sliders).
- Gráfico de evolución del capital vs. lo aportado, con tooltip al pasar/tocar.
- Hitos de 100K · 250K · 500K · 1M marcados en la curva, con los años que tarda cada tramo en el eje X.
- Los hitos escalan solos: si el capital final llega a 5M se multiplican ×5 (500K · 1,25M · 2,5M · 5M). La escala también se puede elegir a mano en *Opciones*.
- Barra de tiempo: porcentaje del plazo que lleva cada tramo.
- Tabla año por año y opción de tasa nominal (capitaliza mensual) o efectiva anual.

**Objetivo** (ej.: llegar a 1M en 20 años)
- Sin capital inicial: aporte mensual necesario a tu tasa y tasa necesaria con tu aporte.
- Solo capital inicial: tasa necesaria y capital necesario a tu tasa.
- Capital + aportes: tasa necesaria y aporte necesario.
- Gráfico con los tres caminos hasta el objetivo.
- Mapas de calor: aporte mensual necesario (tasa × capital) y tasa necesaria (aporte × capital). Tocar una celda la usa como referencia.

## Uso local

```bash
python3 -m http.server 8080
```

Abrir http://localhost:8080. Para instalarla como app hace falta servirla por HTTPS (GitHub Pages, Netlify, Vercel, etc.).
