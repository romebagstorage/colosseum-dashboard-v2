Modalità demo: con env `DEMO_PAYLOAD=1` la dashboard legge `data/demo-payload.json` (una risposta salvata di /api/data) invece di chiamare Guesty.
Utile per anteprime grafiche senza consumare token. Il file non è versionato (contiene nomi ospiti): genera il tuo con `curl -b cookie https://<host>/api/data > data/demo-payload.json`.
