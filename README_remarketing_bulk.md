# Remarketing Bulk (WhatsApp templates)

Este módulo permite enviar mensajes de plantilla (HSM) de WhatsApp a múltiples contactos cumpliendo las políticas de Meta:
- Solo se envían plantillas aprobadas (APPROVED) y categoría MARKETING.
- Solo se envía a contactos con opt-in válido.
- Delay configurable entre envíos para respetar límites de throughput.
- Selección de destinatarios por etiquetas (opt-in) o manualmente pegando números.

## Alta de plantilla: promo_hogarcril_combos

Plantilla sugerida para combos de Hogar Cril con 3 variables ({{1}}, {{2}}, {{3}}) en idioma `es_AR`.

Ejemplo del cuerpo:

Hola {{1}}! 👋 Tenemos combos especiales de Hogar Cril para {{2}}.
Esta promo vence el {{3}}.
Si te interesa, contestá este mensaje y te asesoramos.

Recomendación de componentes:
- Tipo: MARKETING
- Idioma: es_AR
- Componentes: BODY (texto anterior) y opcional FOOTER (Hogar Cril)

JSON orientativo (para uso en APIs de administración de templates de Meta o BM):

{
  "name": "promo_hogarcril_combos",
  "category": "MARKETING",
  "language": "es_AR",
  "components": [
    {
      "type": "BODY",
      "text": "Hola {{1}}! 👋 Tenemos combos especiales de Hogar Cril para {{2}}.\nEsta promo vence el {{3}}.\nSi te interesa, contestá este mensaje y te asesoramos."
    },
    {
      "type": "FOOTER",
      "text": "Hogar Cril"
    }
  ]
}

Notas:
- La creación/aprobación de plantillas se realiza desde Business Manager o la API correspondiente; este JSON es una guía para los campos esperados.
- Una vez aprobada, `/api/waba/templates` debe listar la plantilla como `status=APPROVED` y `category=MARKETING`.

## Uso del módulo (RemarketingBulk.jsx)

1) Selección de plantilla
- Elegí idioma (default `es_AR`).
- En “Plantilla” se listan únicamente las plantillas con `APPROVED + MARKETING` para el idioma elegido.
- Al seleccionar la plantilla, se detectan automáticamente las variables del BODY (`{{1}}..{{N}}`).

2) Variables
- Modo “Mismas para todos”: completá los campos `{{1}}..{{N}}` que se aplicarán a todos los destinatarios.
- Modo “Por fila (CSV)”: disponible solo cuando el destino es “Pegar números”. Cargá un CSV con columnas `phone,var1,var2,...` para variables por contacto.

3) Destinatarios
- Por etiquetas (default):
  - Cargá o deducí etiquetas. Al seleccionar 1+ etiquetas, se busca en `conversations` (Firestore):
    - `optIn == true`
    - `labels` `array-contains-any` (hasta 10 por chunk)
    - `orderBy lastMessageAt desc`, `limit 1000` por chunk
  - Se normaliza y deduplica cada teléfono en formato E.164.
  - Se muestra la lista y el total.
- Pegar números: pegá telefónos en E.164. Se validan y deduplican.

4) Cumplimiento
- Marcá las confirmaciones: opt-in válido y uso exclusivo de plantillas aprobadas.

5) Envío
- Seteá el delay (default 800 ms).
- Presioná “Enviar a N contactos”. Se loguea `OK/ERROR` por número.

## Pruebas (QA)

- En “Destinatarios → Por etiquetas”, al elegir 1+ etiquetas se listan teléfonos con `optIn=true` y se muestra el total.
- En “Plantilla” solo aparecen aprobadas MARKETING y en el idioma elegido (`es_AR` por defecto).
- Con la plantilla “promo_hogarcril_combos” cargada y aprobada:
  - Se muestran 3 campos de variables (`{{1}}`, `{{2}}`, `{{3}}`).
- Envío a N contactos funciona, con log `OK/ERROR` por número y delay.

## Seguridad y tokens

- El frontend no filtra ni expone tokens. Las llamadas se realizan a endpoints internos:
  - `GET /api/waba/templates` (servidor)
  - `POST /api/waba/send-template` (servidor)
- El servidor es responsable de autenticar contra Meta Cloud API y aplicar controles adicionales.

## CSV de prueba (ejemplo)

```
+5491122334455,Fede,impermeabilizante,31/08
+5491133344455,Romina,pintura exterior,31/08
```

## Consideraciones adicionales

- Si recibís `429 Too Many Requests`, aumentá el delay o dividí la lista en tandas.
- Recordá que fuera de la ventana de 24h solo se pueden enviar mensajes de plantilla aprobada.
- Verificá ópticamente el contenido del BODY en el selector para validar que las variables y el copy sean correctos.