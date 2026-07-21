# Local training

Run `start-local.bat` on Windows, or run `npm install` followed by `npm run start:local`.

Pages:

- `/` game
- `/benchmark/` benchmark
- `/training/` Flat training
- `/training/allspin/` All-Spin training

Training and model storage are local. The browser uses CPU Web Workers, localStorage and the `tetraflux-ai` IndexedDB database.

The Local Model Library supports snapshots, active model selection, rename, delete, selected export, full-library export and import.

Use **Export All** regularly because clearing browser site data removes local models and checkpoints.
